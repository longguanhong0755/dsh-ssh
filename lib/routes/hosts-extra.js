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
  readBody,
  readSshConfig,
  sendJson
} from './support.js'

export function registerHostExtraRoutes({ route, ctx, store, pool, manager, jobs, bridge, log }) {
  route('/ssh-remote/ssh-config', async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      return sendJson(res, 200, { ok: true, aliases: await readSshConfig() })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  // Install-confirmation preview (ZCode 3.17.2): runtime present? version,
  // install path and the npm-registry package size when an install is due.
  route('/ssh-remote/hosts/runtime-check', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const body = await readBody(req)
      const host = body.hostId ? store.host(body.hostId) : null
      if (!host) throw new Error('hostId is required')
      const settingsData = manager.store.settings
      const result = await manager.runtimeCheck(host, { version: settingsData.dshVersion, settings: settingsData })
      return sendJson(res, 200, { ok: true, runtime: result })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error), code: error?.code || '' })
    }
  })

  // Local target discovery, mirroring ZCode's `isWSLAvailable` /
  // `listWSLDistros` / `isDockerAvailable` / `listDockerContainers`.
  route('/ssh-remote/discover', async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    const url = new URL(req.url || '/', 'http://localhost')
    const only = String(url.searchParams.get('kind') || '').trim()
    const wantsWsl = !only || only === 'wsl'
    const wantsDocker = !only || only === 'docker'
    const result = {
      // ZCode's `availableKinds` is decided by the machine running the app,
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
   * Install/reuse the shared dsh runtime on the host before the directory step.
   * ZCode's wizard installs its server during "connect" rather than after the
   * user picks a folder, so the final "open workspace" click is near-instant.
   */
  route('/ssh-remote/hosts/prepare', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const body = await readBody(req)
      const host = store.host(String(body.hostId || ''))
      if (!host) throw new Error('host not found')
      const job = jobs.start(`准备远程环境 ${host.name}`, async (append) => {
        append(`主机: ${host.username}@${host.host}:${host.port}`)
        append(`检查远程 dsh 运行时 ${store.settings.dshVersion}`)
        const runtime = await manager.ensureRuntime(host, { onLog: append })
        append(`运行时已就绪: dsh ${runtime.dshVersion}`)
        return { version: runtime.dshVersion, node: runtime.nodeBin, dsh: runtime.dshBin }
      }, RUNTIME_JOB_LIMITS)
      return sendJson(res, 202, { ok: true, jobId: job.id })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

}
