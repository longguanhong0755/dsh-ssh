// Host half of dsh-ssh-remote. It owns the SSH pool, the remote dsh runtime
// lifecycle, the local status cache, the native workspace projection, and the
// JSON API used by the client half.

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { RemoteStore } from './store.js'
import { SSHPool } from './ssh.js'
import { TargetPool } from './targets.js'
import { RemoteManager } from './remote.js'
import { JobManager } from './jobs.js'
import { createRoutes, registerTransports } from './routes.js'
import { reconcileNativeWorkspaces } from './native.js'
import { SessionBridge } from './bridge.js'
import { errorText } from './util.js'

const name = 'dsh-ssh-remote'
const inject = []

function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME?.trim()
  if (fromEnv) return fromEnv
  return join(homedir(), '.dsh')
}

function apply(ctx) {
  const dshHome = resolveDshHome()
  const log = (level, message) => {
    const line = `[ssh-remote] ${message}`
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
  }
  log('info', `starting (dsh home: ${dshHome})`)

  const store = new RemoteStore({ dshHome })
  const knownHostsPath = join(store.root, 'known_hosts.json')
  const sshPool = new SSHPool({
    knownHostsPath,
    log,
    saveKnownHosts: async (value) => {
      await mkdir(dirname(knownHostsPath), { recursive: true })
      await writeFile(knownHostsPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    }
  })
  const pool = new TargetPool({ sshPool, log })
  const manager = new RemoteManager({ dshHome, pool, store, log })
  const jobs = new JobManager({ log })
  const bridge = new SessionBridge({ pool, store, manager, log, ctx })
  const ready = store.load()
    .then(() => log('info', `loaded ${store.hosts.length} host(s), ${store.workspaces.length} workspace(s)`))
    .catch((error) => log('error', `store load failed: ${errorText(error)}`))

  ready.then(async () => {
    try {
      const result = await reconcileNativeWorkspaces({ ctx, store, log })
      if (result.available) log('info', `native projection: ${result.rows.length} workspace row(s)`)
    } catch (error) {
      log('warn', `native projection failed: ${errorText(error)}`)
    }
    try {
      const agents = ctx.get?.('agents')
      for (const agent of agents?.list?.() || []) {
        void bridge.handleAgentCreated({ agent }).catch((error) => log('warn', `bridge attach failed: ${errorText(error)}`))
      }
    } catch (error) {
      log('warn', `bridge attach scan failed: ${errorText(error)}`)
    }
  })

  const disposeAgentCreated = (() => {
    try {
      return ctx.on('agent/created', (payload) => {
        void bridge.handleAgentCreated(payload).catch((error) => log('warn', `bridge attach failed: ${errorText(error)}`))
      })
    } catch (error) {
      log('warn', `agent/created listener unavailable: ${errorText(error)}`)
      return () => {}
    }
  })()

  const routes = createRoutes({ ctx, store, pool, manager, jobs, bridge, log, ready })
  const disposeRoutes = registerTransports(ctx, routes, log)

  let polling = false
  let disposed = false
  let timer = null
  const poll = async () => {
    if (polling || disposed) return
    await ready
    if (store.workspaces.length === 0) return
    // A status probe opens a shell channel and, with the CPU sample, sleeps
    // 0.5s on the remote. Never compete with an active streamed turn.
    if (bridge.busy) return
    polling = true
    try {
      for (const workspace of store.workspaces) {
        if (disposed) break
        const host = store.host(workspace.hostId)
        if (!host) continue
        try {
          await manager.status(host, workspace, { fresh: true, skipLog: true })
        } catch (error) {
          workspace.lastStatus = {
            id: workspace.id,
            state: 'unreachable',
            active: false,
            error: errorText(error),
            checkedAt: new Date().toISOString()
          }
          workspace.lastStatusAt = Date.now()
        }
      }
    } finally {
      polling = false
    }
  }
  timer = setInterval(() => {
    void poll()
  }, Math.max(10000, Number(store.settings.pollIntervalMs) || 5000))
  if (typeof timer.unref === 'function') timer.unref()
  void poll()

  ctx.effect(() => () => {
    disposed = true
    if (timer) clearInterval(timer)
    try {
      disposeAgentCreated()
    } catch {
      // ignore
    }
    try {
      disposeRoutes()
    } catch (error) {
      log('warn', `route disposal failed: ${errorText(error)}`)
    }
    bridge.dispose()
    jobs.dispose()
    manager.dispose()
    pool.dispose()
  }, 'dsh-ssh-remote.dispose')
}

const plugin = { name, inject, apply }
export { name, inject, apply }
export default plugin
