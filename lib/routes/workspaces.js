// Part of lib/routes.js. Route bodies moved verbatim; this module registers
// one group and shares the request helpers through ./support.js.
// workspace list/open/rename/pin/status/logs/create/action
import { rename } from 'node:fs/promises'
import {
  errorText,
  nowIso
} from '../util.js'
import {
  forgetNativeWorkspace,
  reconcileNativeWorkspaces,
  renameNativeWorkspace
} from '../native.js'
import {
  WORKSPACE_JOB_LIMITS,
  publicWorkspace,
  readBody,
  sendJson
} from './support.js'

export function registerWorkspaceRoutes({ route, ctx, store, pool, manager, jobs, bridge, log }) {
  route('/ssh-remote/workspaces/open', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const body = await readBody(req)
      const workspace = store.workspace(String(body.id || ''))
      if (!workspace) throw new Error('workspace not found')
      await store.patchWorkspace(workspace.id, { lastOpenedAt: nowIso() })
      const native = await reconcileNativeWorkspaces({ ctx, store, log })
      return sendJson(res, 200, { ok: true, workspace: publicWorkspace(workspace), native: Boolean(native.available) })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  route('/ssh-remote/workspaces/rename', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const body = await readBody(req)
      const workspace = store.workspace(String(body.id || ''))
      if (!workspace) throw new Error('workspace not found')
      const name = String(body.name || '').trim()
      if (!name) throw new Error('项目名称不能为空')
      if (name.length > 120) throw new Error('项目名称过长')
      await store.patchWorkspace(workspace.id, { name })
      await renameNativeWorkspace({ ctx, store, workspace, log }).catch(() => {})
      return sendJson(res, 200, { ok: true, workspace: publicWorkspace(workspace) })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  route('/ssh-remote/workspaces/pin', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const body = await readBody(req)
      const workspace = store.workspace(String(body.id || ''))
      if (!workspace) throw new Error('workspace not found')
      const pinned = body.pinned !== false
      // Ordering itself belongs to the DSH sidebar (`insertBefore`); this flag
      // only lets the row menu offer 置顶 or 取消置顶.
      await store.patchWorkspace(workspace.id, { pinned, pinnedAt: pinned ? nowIso() : '' })
      return sendJson(res, 200, { ok: true, workspace: publicWorkspace(workspace) })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  route('/ssh-remote/workspaces', async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    const url = new URL(req.url, 'http://localhost')
    // Status is sampled by the background poller; an explicit refresh=1 is the
    // only path that pays for a fresh SSH probe. This keeps the sidebar row
    // decoration and the status panel from competing with an active turn.
    const refresh = url.searchParams.get('refresh') === '1'
    const rows = []
    for (const workspace of store.workspaces) {
      if (refresh) {
        const host = store.host(workspace.hostId)
        if (host) {
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
      }
      rows.push(publicWorkspace(workspace))
    }
    return sendJson(res, 200, { ok: true, workspaces: rows })
  })

  route('/ssh-remote/workspaces/status', async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    const url = new URL(req.url, 'http://localhost')
    const workspace = store.workspace(url.searchParams.get('id') || '')
    if (!workspace) return sendJson(res, 404, { ok: false, error: 'workspace not found' })
    const host = store.host(workspace.hostId)
    if (!host) return sendJson(res, 404, { ok: false, error: 'host not found' })
    try {
      const status = await manager.status(host, workspace, { fresh: true, includeMetrics: true })
      return sendJson(res, 200, { ok: true, status, workspace: publicWorkspace(workspace) })
    } catch (error) {
      return sendJson(res, 200, { ok: false, error: errorText(error), workspace: publicWorkspace(workspace) })
    }
  })

  route('/ssh-remote/workspaces/logs', async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    const url = new URL(req.url, 'http://localhost')
    const workspace = store.workspace(url.searchParams.get('id') || '')
    if (!workspace) return sendJson(res, 404, { ok: false, error: 'workspace not found' })
    const host = store.host(workspace.hostId)
    if (!host) return sendJson(res, 404, { ok: false, error: 'host not found' })
    try {
      const lines = Math.min(2000, Math.max(20, Number(url.searchParams.get('lines')) || 300))
      const text = await manager.logs(host, workspace, lines)
      return sendJson(res, 200, { ok: true, lines: text })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  route('/ssh-remote/workspaces/create', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const body = await readBody(req)
      const host = store.host(String(body.hostId || ''))
      if (!host) throw new Error('请选择一台 SSH 主机')
      const input = {
        remotePath: String(body.remotePath || host.defaultPath || '~'),
        name: String(body.name || ''),
        port: body.port ? Number(body.port) : undefined,
        syncCredentials: body.syncCredentials !== false,
        createIfMissing: body.createIfMissing !== false
      }
      const duplicate = store.workspaces.find((row) => row.hostId === host.id && row.remotePath === input.remotePath)
      if (duplicate) throw new Error(`该主机上的远程目录已经是工作区: ${duplicate.name}`)
      const job = jobs.start(`创建远程工作区 ${input.name || input.remotePath}`, async (append) => {
        append(`主机: ${host.username}@${host.host}:${host.port}`)
        append(`目录: ${input.remotePath}`)
        const workspace = await manager.create(host, input, append)
        try {
          const native = await reconcileNativeWorkspaces({ ctx, store, log })
          if (native.available) append('已加入 DSH 原生工作区列表')
        } catch (error) {
          append(`原生工作区注册失败: ${errorText(error)}`)
        }
        return publicWorkspace(workspace)
      }, WORKSPACE_JOB_LIMITS)
      return sendJson(res, 202, { ok: true, jobId: job.id })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  route('/ssh-remote/workspaces/action', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const body = await readBody(req)
      const op = String(body.op || '')
      const workspace = store.workspace(String(body.id || ''))
      if (!workspace) throw new Error('workspace not found')
      const host = store.host(workspace.hostId)
      if (!host) throw new Error('host not found')
      if (op === 'stop') {
        await manager.stopWorkspace(host, workspace)
        const status = await manager.status(host, workspace, { fresh: true, includeMetrics: true })
        return sendJson(res, 200, { ok: true, status, workspace: publicWorkspace(workspace) })
      }
      if (op === 'start' || op === 'restart' || op === 'remove') {
        const job = jobs.start(`${op} ${workspace.name}`, async (append) => {
          if (op === 'remove') {
            await bridge?.cancelWorkspace?.(workspace.id)
            await forgetNativeWorkspace({ ctx, store, workspace, log }).catch(() => {})
            await manager.removeWorkspace(host, workspace, { onLog: append })
            return { removed: true }
          }
          const status = op === 'start'
            ? await manager.startWorkspace(host, workspace, { onLog: append })
            : await manager.restartWorkspace(host, workspace, { onLog: append })
          return { status, workspace: publicWorkspace(workspace) }
        }, WORKSPACE_JOB_LIMITS)
        return sendJson(res, 202, { ok: true, jobId: job.id })
      }
      throw new Error(`unknown op: ${op}`)
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

}
