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
import { clampPollInterval, errorText } from './util.js'

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
  ready
    .then(() => log('info', `loaded ${store.hosts.length} host(s), ${store.workspaces.length} workspace(s)`))
    .catch((error) => log('error', `store load failed: ${errorText(error)}`))

  // If a bridged chat ever falls back to the stock local compaction (closed
  // runtime, no remote history), that summarize call must use a route this
  // machine can reach; local chats keep their own model. `/compact` itself is
  // shadowed per bridged agent on attach, so nothing is needed here for it.
  // The llm service can mount after this plugin, so retry once the profile has
  // composed.
  const installRouting = (label) => {
    let ready = true
    try {
      if (!bridge.installLlmRouting()) {
        ready = false
        log('warn', `llm service not ready for compaction routing (${label})`)
      }
    } catch (error) {
      ready = false
      log('warn', `compaction routing failed (${label}): ${errorText(error)}`)
    }
    return ready
  }
  installRouting('apply')
  const routingTimer = setTimeout(() => installRouting('deferred'), 5000)
  if (typeof routingTimer.unref === 'function') routingTimer.unref()

  // The projection also re-attaches anchor sessions the registry dropped from a
  // row. Persistence listings can still be warming up right after startup, so
  // repeat the pass a couple of times instead of trusting the first one.
  const syncNative = async (label) => {
    try {
      const result = await reconcileNativeWorkspaces({ ctx, store, log })
      if (result.available) {
        log('info', `native projection (${label}): ${result.rows.length} workspace row(s), ${result.attached || 0} session(s) re-attached`)
      }
    } catch (error) {
      log('warn', `native projection failed (${label}): ${errorText(error)}`)
    }
  }

  void ready.then(async () => {
    await syncNative('startup')
    for (const delay of [8000, 30000]) {
      const timer = setTimeout(() => void syncNative(`+${delay}ms`), delay)
      if (typeof timer.unref === 'function') timer.unref()
    }
    try {
      const agents = ctx.get?.('agents')
      for (const agent of agents?.list?.() || []) {
        void bridge.handleAgentCreated({ agent }).catch((error) => log('warn', `bridge attach failed: ${errorText(error)}`))
      }
    } catch (error) {
      log('warn', `bridge attach scan failed: ${errorText(error)}`)
    }
  }).catch((error) => log('warn', `startup projection skipped: ${errorText(error)}`))

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
  let loadWarned = false
  let disposed = false
  let startupReset = false
  let timer = null
  const poll = async () => {
    if (polling || disposed) return
    polling = true
    try {
      await ready
      if (!startupReset) {
        startupReset = true
        // After a plugin/app restart the persisted reachability is stale: show
        // 连接中 until this cycle actually probes each device.
        for (const host of store.hosts) {
          if (host.disconnectedAt || host.serviceState === 'stopped') continue
          host.connState = 'connecting'
          host.connCheckedAt = ''
        }
      }
      // A long turn only makes its own workspace slow to probe; other devices
      // should keep refreshing. Devices are probed on every cycle even when
      // they have no projects, so the sidebar shows 已连接 / 无连接 live.
      const hosts = store.hosts.filter((host) => !host.disconnectedAt && host.serviceState !== 'stopped')
      const workspaces = store.workspaces.filter((workspace) => !bridge.busyWorkspace?.(workspace.id))
      const tasks = [
        ...hosts.map((host) => async () => {
          try {
            await manager.probeConnection(host)
          } catch (error) {
            log('warn', `connection probe failed for ${host.name}: ${errorText(error)}`)
          }
        }),
        ...workspaces.map((workspace) => async () => {
          const host = store.host(workspace.hostId)
          if (!host) return
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
        })
      ]
      if (tasks.length === 0) return
      let cursor = 0
      const worker = async () => {
        while (!disposed) {
          const task = tasks[cursor]
          cursor += 1
          if (!task) return
          await task()
        }
      }
      // Bound the fan-out: a large device list must not open one shell
      // channel per host at the same instant.
      const concurrency = Math.min(2, tasks.length)
      await Promise.all(Array.from({ length: concurrency }, () => worker()))
    } catch (error) {
      // A rejected `ready` means state.json could not be loaded safely. Do not
      // overwrite it; surface the cause once and keep the timer idle.
      if (!disposed && !loadWarned) {
        log('warn', `status poll paused: ${errorText(error)}`)
        loadWarned = true
      }
    } finally {
      polling = false
    }
  }

  const schedule = () => {
    if (disposed) return
    // Re-read the setting every cycle so a change takes effect without a
    // plugin restart; the same clamp is used by the settings route.
    const delay = clampPollInterval(store.settings?.pollIntervalMs, 5000)
    timer = setTimeout(() => {
      void poll().then(schedule, schedule)
    }, delay)
    if (typeof timer.unref === 'function') timer.unref()
  }

  void ready.then(() => {
    void poll().then(schedule, schedule)
  }).catch(() => {
    // store load failure is already logged; do not start polling or writes.
  })

  ctx.effect(() => () => {
    disposed = true
    if (timer) clearTimeout(timer)
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
