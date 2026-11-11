// Part of lib/routes.js. Route bodies moved verbatim; this module registers
// one group and shares the request helpers through ./support.js.
// host inventory, default host, save/delete/info/action/test
import { join } from 'node:path'
import {
  errorText,
  nowIso
} from '../util.js'
import { validateTarget } from '../targets.js'
import { forgetNativeWorkspace } from '../native.js'
import {
  publicHost,
  publicHostList,
  publicWorkspace,
  readBody,
  sendJson
} from './support.js'

export function registerHostRoutes({ route, ctx, store, pool, manager, jobs, bridge, log }) {
  route('/ssh-remote/hosts', async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    return sendJson(res, 200, { ok: true, hosts: publicHostList(store, manager) })
  })

  // One request for the device page and the sidebar row decorator: they used
  // to fetch hosts, workspaces and settings separately every few seconds.
  route('/ssh-remote/overview', async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    return sendJson(res, 200, {
      ok: true,
      hosts: publicHostList(store, manager),
      workspaces: store.workspaces.map((workspace) => publicWorkspace(workspace)),
      settings: store.settings || {},
      generatedAt: nowIso()
    })
  })

  // Hovering a device row warms the pooled connection, so opening the wizard
  // or the folder picker does not pay for the SSH handshake. Idempotent and
  // deduped by probeConnection.
  route('/ssh-remote/hosts/warm', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const body = await readBody(req)
      const host = store.host(String(body.id || ''))
      if (!host) throw new Error('host not found')
      await manager.probeConnection(host)
      return sendJson(res, 200, { ok: true, connState: host.connState || '' })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  // ZCode 设备管理 → 设为默认连接.
  route('/ssh-remote/hosts/default', async (req, res) => {    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const body = await readBody(req)
      const id = String(body.id || '')
      if (id && !store.host(id)) throw new Error('host not found')
      store.settings.defaultHostId = id
      await store.save()
      return sendJson(res, 200, { ok: true, defaultHostId: id })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  route('/ssh-remote/hosts/save', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const body = await readBody(req)
      validateTarget(body.host || {})
      const saved = await store.upsertHost(body.host || {})
      pool.closeHost(saved.id)
      // Saving means "probe this device next": show 连接中 until the poll
      // reports a result instead of the previous device's stale state.
      saved.connState = 'connecting'
      saved.connCheckedAt = ''
      saved.connError = ''
      await store.save()
      return sendJson(res, 200, { ok: true, host: publicHost(saved) })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  route('/ssh-remote/hosts/delete', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const body = await readBody(req)
      const id = String(body.id || '')
      const host = store.host(id)
      if (!host) throw new Error('host not found')
      const workspaces = store.workspaces.filter((row) => row.hostId === id)
      // Local-only removal, exactly like ZCode: stop relaying, drop local
      // project records, leave the remote service and its data running.
      bridge?.forgetHost?.(id)
      for (const workspace of workspaces) {
        await forgetNativeWorkspace({ ctx, store, workspace, log }).catch(() => {})
      }
      const removed = await store.removeHost(id, { cascade: true })
      pool.closeHost(id)
      log('info', `removed device ${host.name} with ${removed.length} local project record(s); remote data kept`)
      return sendJson(res, 200, { ok: true, removedWorkspaces: removed.map((row) => row.id) })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  // ZCode expanded card metadata: real values read from the device, cached on
  // the host record. A failed probe still answers 200 with the cached values.
  route('/ssh-remote/hosts/info', async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    const url = new URL(req.url, 'http://localhost')
    const host = store.host(url.searchParams.get('id') || '')
    if (!host) return sendJson(res, 404, { ok: false, error: 'host not found' })
    let probeError = ''
    try {
      const script = [
        "printf 'hostname='; (hostname 2>/dev/null || uname -n 2>/dev/null || true); printf '\\n'",
        "printf 'osUser='; (id -un 2>/dev/null || whoami 2>/dev/null || true); printf '\\n'",
        "printf 'deviceId='; (cat /etc/machine-id 2>/dev/null || cat /var/lib/dbus/machine-id 2>/dev/null || true) | tr -d '\\r\\n'; printf '\\n'"
      ].join('\n')
      const result = await pool.exec(host, script, { timeoutMs: 15000 })
      const values = {}
      for (const line of String(result.stdout || '').split(/\r?\n/u)) {
        const index = line.indexOf('=')
        if (index > 0) values[line.slice(0, index)] = line.slice(index + 1).trim()
      }
      host.hostname = values.hostname || host.hostname || host.host || ''
      host.osUser = values.osUser || host.osUser || host.username || ''
      host.deviceId = values.deviceId || host.deviceId || host.id
      const workspace = store.workspaces.find((row) => row.hostId === host.id)
      host.runtimeVersion = workspace?.dshVersion || host.runtimeVersion || store.settings.dshVersion || ''
      host.infoCheckedAt = nowIso()
      host.lastSuccessAt = nowIso()
      host.lastOnlineAt = nowIso()
      await store.save()
    } catch (error) {
      probeError = errorText(error)
    }
    return sendJson(res, 200, {
      ok: true,
      host: publicHost(host, {
        projectCount: store.workspaces.filter((row) => row.hostId === host.id).length,
        updating: manager.installing?.get(host.id) || null
      }),
      error: probeError
    })
  })

  // ZCode device menu lifecycle: 断开 / 重启远端服务 / 停止远端服务 /
  // 重新安装远端服务. Long operations run as the same job type the wizard uses.
  route('/ssh-remote/hosts/action', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const body = await readBody(req)
      const host = store.host(String(body.id || ''))
      if (!host) throw new Error('host not found')
      const op = String(body.op || '')
      const workspaces = store.workspaces.filter((row) => row.hostId === host.id)
      const record = (level, message) => store.appendHostLog(host, level, message)

      if (op === 'disconnect') {
        bridge?.disconnectHost?.(host.id)
        host.disconnectedAt = nowIso()
        record('info', '已断开连接；远端任务继续运行。')
        await store.save()
        return sendJson(res, 200, { ok: true, host: publicHost(host, { projectCount: workspaces.length }) })
      }

      if (op === 'reconnect') {
        // 启动时自动重连: reattach the local relay only. Remote tasks keep
        // running and must not be restarted by a desktop app launch.
        host.disconnectedAt = ''
        host.connState = 'connecting'
        host.connCheckedAt = ''
        host.connError = ''
        record('info', '已重新连接设备；远端任务继续运行。')
        await store.save()
        // Reattach in the background; a cold runner boot must not block the UI.
        void bridge?.bootHostServices?.(host.id)?.catch?.(() => {})
        return sendJson(res, 200, {
          ok: true,
          host: publicHost(host, {
            projectCount: workspaces.length,
            lastOnlineAt: host.lastOnlineAt
          })
        })
      }

      if (op === 'connect') {
        // A plain reconnect (after 断开) must only rebuild the relay: remote
        // tasks are still running. Only a stopped service is restarted.
        const restartServices = host.serviceState === 'stopped'
        host.disconnectedAt = ''
        host.serviceState = 'running'
        host.stoppedAt = ''
        host.connState = 'connecting'
        host.connCheckedAt = ''
        host.connError = ''
        record('info', restartServices ? '正在启动远端服务…' : '正在连接设备…')
        const job = jobs.start(`连接 ${host.name}`, async (append) => {
          await bridge?.bootHostServices?.(host.id)
          if (restartServices) {
            for (const workspace of workspaces) {
              try {
                await manager.startWorkspace(host, workspace, { onLog: append })
                record('info', `${workspace.name} 已启动`)
              } catch (error) {
                append(`${workspace.name} 启动失败: ${errorText(error)}`)
                record('error', `${workspace.name} 启动失败: ${errorText(error)}`)
              }
            }
          } else {
            append('已重新连接设备；远端任务继续运行。')
          }
          await store.save()
          return { connected: true }
        })
        await store.save()
        return sendJson(res, 202, { ok: true, jobId: job.id })
      }

      if (op === 'restart' || op === 'stop' || op === 'reinstall') {
        if (op === 'reinstall' && host.serviceState === 'running') {
          // A reinstall replaces program files; the running service must stop
          // first. This is the same interruption ZCode warns about.
          record('info', '重新安装前先停止远端服务。')
        }
        const job = jobs.start(`${op} ${host.name}`, async (append) => {
          await bridge?.stopHostServices?.(host.id)
          for (const workspace of workspaces) {
            await manager.stopWorkspace(host, workspace).catch((error) => append(`停止 ${workspace.name}: ${errorText(error)}`))
          }
          record('info', '远端服务已停止。')
          if (op === 'stop') {
            host.serviceState = 'stopped'
            host.stoppedAt = nowIso()
            await store.save()
            append('远端服务已停止；运行中的任务不会自动续跑。')
            return { stopped: true }
          }
          if (op === 'reinstall') {
            const version = String(body.version || store.settings.dshVersion || '')
            append(`用本机版本重新安装 dsh ${version}（保留项目与任务）…`)
            await manager.ensureRuntime(host, { version, force: true, onLog: append })
            record('info', `dsh ${version} 已重新安装`)
            bridge?.invalidateProfiles?.(host.id)
          }
          for (const workspace of workspaces) {
            try {
              await manager.startWorkspace(host, workspace, { onLog: append })
            } catch (error) {
              append(`启动 ${workspace.name} 失败: ${errorText(error)}`)
              record('error', `启动 ${workspace.name} 失败: ${errorText(error)}`)
            }
          }
          await bridge?.bootHostServices?.(host.id)
          host.serviceState = 'running'
          host.stoppedAt = ''
          host.disconnectedAt = ''
          host.connState = 'connecting'
          host.connCheckedAt = ''
          record('info', op === 'reinstall' ? '重新安装完成，远端服务已启动。' : '远端服务已重启。')
          await store.save()
          append('远端服务已启动。')
          return { restarted: true }
        })
        await store.save()
        return sendJson(res, 202, { ok: true, jobId: job.id })
      }

      throw new Error(`unknown op: ${op}`)
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  route('/ssh-remote/hosts/test', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const body = await readBody(req)
      let host = body.host?.id ? store.host(body.host.id) : null
      if (body.host) {
        const base = host || {}
        host = {
          ...base,
          ...body.host,
          id: base.id || `test-${Date.now()}`,
          createdAt: base.createdAt || new Date().toISOString(),
          auth: { ...(base.auth || {}), ...(body.host.auth || {}) }
        }
      }
      if (!host) throw new Error('host is required')
      if (host.auth?.kind === 'key' && host.auth.privateKeyPath) {
        // keep the key path as entered
      }
      const probe = await pool.probe(host)
      const savedHost = body.host?.id ? store.host(body.host.id) : null
      if (savedHost) {
        savedHost.lastSuccessAt = nowIso()
        savedHost.lastOnlineAt = nowIso()
        savedHost.connState = 'connected'
        savedHost.connCheckedAt = nowIso()
        savedHost.connError = ''
        await store.save()
      }
      return sendJson(res, 200, { ok: true, probe })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error), code: error?.code || '' })
    }
  })

}
