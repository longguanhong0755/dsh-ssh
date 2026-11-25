// Part of lib/routes.js. Route bodies moved verbatim; this module registers
// one group and shares the request helpers through ./support.js.
// ssh-config parsing, runtime check, discover, rename, prepare
import { rename } from 'node:fs/promises'
import {
  errorText,
  nowIso
} from '../util.js'
import {
  isDockerAvailable,
  isWslAvailable,
  listDockerContainers,
  listWslDistros
} from '../local.js'
import {
  RUNTIME_JOB_LIMITS,
  publicHost,
  publicWorkspace,
  readBody,
  readSshConfig,
  sendError,
  sendJson
} from './support.js'
import { resolveRuntimeTarget } from '../dsh-version.js'

export function registerHostExtraRoutes({ route, ctx, store, pool, manager, jobs, bridge, log }) {
  route('/ssh-remote/ssh-config', async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      return sendJson(res, 200, { ok: true, aliases: await readSshConfig() })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  // Environment checks for one device, before anything is installed. Accepts a
  // saved `hostId` or an unsaved draft `host`, so the wizard can run the same
  // checks it will show on the diagnostics page before it saves a device.
  route('/ssh-remote/hosts/preflight', async (req, res) => {
    if (req.method !== 'POST') return sendError(res, 405, new Error('method not allowed'))
    try {
      const body = await readBody(req)
      let host = store.host(String(body.hostId || body.id || body.host?.id || ''))
      if (body.host) {
        const base = host || {}
        host = {
          ...base,
          ...body.host,
          id: base.id || String(body.host.id || `preflight-${Date.now()}`),
          createdAt: base.createdAt || new Date().toISOString(),
          auth: { ...(base.auth || {}), ...(body.host.auth || {}) }
        }
      }
      if (!host) throw new Error('host not found')
      const result = await manager.preflight(host, {})
      return sendJson(res, 200, { ok: true, preflight: result })
    } catch (error) {
      return sendError(res, 400, error)
    }
  })

  // Preview shown before an install starts: is a runtime already there, which
// version, install path and the npm package size when an install is due.
  route('/ssh-remote/hosts/runtime-check', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const body = await readBody(req)
      const host = body.hostId ? store.host(body.hostId) : null
      if (!host) throw new Error('hostId is required')
      const settingsData = manager.store.settings
      const target = resolveRuntimeTarget(settingsData)
      const result = await manager.runtimeCheck(host, { version: target.version, settings: settingsData })
      return sendJson(res, 200, { ok: true, runtime: result })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error), code: error?.code || '', reason: error?.reason || '' })
    }
  })

  // Local target discovery: WSL availability and distros, Docker availability
  // and containers, each behind the pool in ./local.js.
  route('/ssh-remote/discover', async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    const url = new URL(req.url || '/', 'http://localhost')
    const only = String(url.searchParams.get('kind') || '').trim()
    const wantsWsl = !only || only === 'wsl'
    const wantsDocker = !only || only === 'docker'
    const result = {
      // The available kinds are decided by the machine running the app,
      // not by the renderer UA: WSL only exists on Windows desktops.
      platform: process.platform,
      wsl: { available: false, distros: [], error: '' },
      docker: { available: false, containers: [], error: '' }
    }
    if (wantsWsl) {
      try {
        result.wsl.available = await isWslAvailable()
        if (result.wsl.available) result.wsl.distros = await listWslDistros()
      } catch (error) {
        result.wsl.available = false
        result.wsl.error = errorText(error)
      }
    }
    if (wantsDocker) {
      try {
        result.docker.available = await isDockerAvailable()
        if (result.docker.available) result.docker.containers = await listDockerContainers()
      } catch (error) {
        result.docker.available = false
        result.docker.error = errorText(error)
      }
    }
    return sendJson(res, 200, { ok: true, ...result })
  })

  route('/ssh-remote/hosts/rename', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const body = await readBody(req)
      const host = store.host(String(body.id || ''))
      if (!host) throw new Error('host not found')
      const name = String(body.name || '').trim()
      if (!name) throw new Error('连接名称不能为空')
      host.name = name.slice(0, 80)
      host.updatedAt = nowIso()
      await store.save()
      return sendJson(res, 200, { ok: true, host: publicHost(host) })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  /**
   * Install or reuse the shared dsh runtime on the host before the directory
   * step. The wizard does this during "connect" rather than after the folder is
   * picked, so the final "open workspace" click is near-instant.
   */
  route('/ssh-remote/hosts/prepare', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const body = await readBody(req)
      const host = store.host(String(body.hostId || ''))
      if (!host) throw new Error('host not found')
      const job = jobs.start(`准备远程环境 ${host.name}`, async (append) => {
        append(`主机: ${host.username}@${host.host}:${host.port}`)
        append(`检查远程 dsh 运行时 ${resolveRuntimeTarget(store.settings).version}`)
        const runtime = await manager.ensureRuntime(host, { onLog: append })
        append(`运行时已就绪: dsh ${runtime.dshVersion}`)
        return { version: runtime.dshVersion, node: runtime.nodeBin, dsh: runtime.dshBin }
      }, RUNTIME_JOB_LIMITS)
      return sendJson(res, 202, { ok: true, jobId: job.id })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  /**
   * One report for the diagnostics page: environment checks, the deployed
   * runtime, the service state, the local Web mirror and the tail of the
   * service log. Read-only — it never installs or restarts anything.
   */
  route('/ssh-remote/diagnostics', async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const url = new URL(req.url, 'http://localhost')
      const host = store.host(String(url.searchParams.get('id') || ''))
      if (!host) throw new Error('host not found')
      const workspace = store.workspaces.find((row) => row.hostId === host.id) || null
      const preflight = await manager.preflight(host, {})
        .catch((error) => ({ ok: false, degraded: true, checks: [], error: errorText(error) }))
      const status = workspace
        ? await manager.status(host, workspace, { fresh: true, skipLog: true }).catch(() => null)
        : null
      const logs = workspace ? await manager.logs(host, workspace, 40).catch(() => '') : ''
      return sendJson(res, 200, {
        ok: true,
        diagnostics: {
          host: publicHost(host),
          target: resolveRuntimeTarget(store.settings),
          preflight,
          workspace: workspace ? publicWorkspace(workspace) : null,
          status,
          view: workspace ? await manager.views.status(workspace.id) : { open: false },
          hostKey: pool.hostKeyFor(host),
          logs: String(logs || '').split(/\r?\n/u).filter(Boolean).slice(-40),
          at: nowIso()
        }
      })
    } catch (error) {
      return sendError(res, 400, error)
    }
  })

}
