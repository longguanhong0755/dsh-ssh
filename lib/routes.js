// JSON routes shared by the Web carrier (`webServer.register`) and the Desktop
// carrier (`connection.fetch.register` under /api). The client picks the prefix
// by location.protocol, exactly like dsh-remote does for dsh-app.

import { readdir, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { errorText, nowIso } from './util.js'
import { isDockerAvailable, isWslAvailable, listDockerContainers, listWslDistros } from './local.js'
import { validateTarget } from './targets.js'
import { forgetNativeWorkspace, reconcileNativeWorkspaces, renameNativeWorkspace } from './native.js'

const MAX_BODY_BYTES = 1024 * 1024

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) return {}
  return JSON.parse(text)
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function publicHost(host) {
  if (!host) return null
  const kind = host.kind === 'wsl' || host.kind === 'docker' ? host.kind : 'ssh'
  return {
    id: host.id,
    kind,
    name: host.name,
    host: host.host,
    port: host.port,
    username: host.username,
    distro: host.distro || '',
    user: host.user || '',
    container: host.container || '',
    image: host.image || '',
    auth: {
      kind: host.auth?.kind || 'password',
      hasPassword: Boolean(host.auth?.password),
      privateKeyPath: host.auth?.privateKeyPath || '',
      hasPassphrase: Boolean(host.auth?.passphrase)
    },
    hostKeyMode: host.hostKeyMode || 'accept-new',
    assetInstallMode: host.assetInstallMode || 'local-download-upload',
    defaultPath: host.defaultPath || '~',
    source: host.source || '',
    createdAt: host.createdAt,
    updatedAt: host.updatedAt
  }
}

function publicWorkspace(workspace, { includeLog = false } = {}) {
  if (!workspace) return null
  const status = workspace.lastStatus ? { ...workspace.lastStatus } : null
  if (status) {
    if (!includeLog) delete status.logTail
    // The remote Web token is only needed by the (removed) console proxy.
    delete status.tokenUrl
  }
  return {
    id: workspace.id,
    name: workspace.name,
    hostId: workspace.hostId,
    targetKind: workspace.targetKind || 'ssh',
    targetPort: workspace.targetPort || 22,
    hostName: workspace.hostName,
    host: workspace.host,
    username: workspace.username,
    port: workspace.port,
    remotePath: workspace.remotePath,
    dshVersion: workspace.dshVersion,
    unit: workspace.unit,
    serviceKind: workspace.serviceKind,
    desiredState: workspace.desiredState,
    syncedCredentials: workspace.syncedCredentials,
    nativeWorkspaceId: workspace.nativeWorkspaceId || '',
    lastOpenedAt: workspace.lastOpenedAt || '',
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    status
  }
}

function expandLocal(input) {
  const text = String(input || '').trim()
  if (!text) return homedir()
  if (text === '~') return homedir()
  if (text.startsWith('~/') || text.startsWith('~\\')) return join(homedir(), text.slice(2))
  return resolve(text)
}

/**
 * Parse the local ~/.ssh/config Host blocks, mirroring ZCode's "从 SSH config
 * 导入": only concrete aliases (no wildcards/negations) are offered.
 */
async function readSshConfig() {
  let text = ''
  try {
    text = await readFile(join(homedir(), '.ssh', 'config'), 'utf8')
  } catch {
    return []
  }
  const rows = []
  let current = null
  const flush = () => {
    if (current?.alias) rows.push(current)
    current = null
  }
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Za-z][A-Za-z0-9]*)\s+(.+)$/u)
    if (!match) continue
    const key = match[1].toLowerCase()
    const value = match[2].trim().replace(/^"(.*)"$/u, '$1')
    if (key === 'host') {
      flush()
      for (const alias of value.split(/\s+/u)) {
        if (!alias || /[*?!]/u.test(alias)) continue
        current = { alias, host: '', port: 22, username: '', privateKeyPath: '' }
        break
      }
    } else if (current) {
      if (key === 'hostname') current.host = value
      else if (key === 'port') current.port = Number(value) || 22
      else if (key === 'user') current.username = value
      else if (key === 'identityfile') current.privateKeyPath = value.replace(/^~(?=\/)/u, homedir())
    }
  }
  flush()
  return rows.map((row) => ({ ...row, host: row.host || row.alias }))
}

async function localListing(input) {  const target = expandLocal(input)
  const rows = await readdir(target, { withFileTypes: true })
  const entries = rows
    .filter((row) => row.isDirectory())
    .map((row) => ({
      name: row.name,
      path: join(target, row.name),
      dir: true,
      hidden: row.name.startsWith('.')
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    path: target,
    home: homedir(),
    parent: dirname(target) === target ? null : dirname(target),
    entries
  }
}

/** Adapt one Node-style route handler to the Desktop/Web Fetch carrier. */
export function connectionRoute(route) {
  if (!route.path.startsWith('/ssh-remote/')) {
    throw new Error('dsh-ssh-remote: expected a plugin route under /ssh-remote/')
  }
  return {
    path: `/api${route.path}`,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      const chunks = []
      let size = 0
      const reader = request.body?.getReader()
      try {
        if (reader) {
          while (true) {
            request.signal.throwIfAborted()
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > MAX_BODY_BYTES) {
              await reader.cancel()
              return Response.json({ ok: false, error: 'request body too large' }, { status: 413 })
            }
            chunks.push(Buffer.from(value))
          }
        }
      } finally {
        reader?.releaseLock()
      }
      request.signal.throwIfAborted()
      const url = new URL(request.url)
      const req = Readable.from(size ? [Buffer.concat(chunks, size)] : [])
      req.method = request.method
      req.url = `${route.path}${url.search}`
      const headers = new Headers()
      let response
      const res = {
        statusCode: 200,
        setHeader(key, value) {
          headers.set(key, value)
        },
        end(body) {
          response = new Response(body, { status: this.statusCode, headers })
        }
      }
      try {
        await route.handler(req, res)
        if (!response) throw new Error('route handler did not finish its response')
        return response
      } finally {
        req.destroy()
      }
    }
  }
}

export function createRoutes({ ctx, store, pool, manager, jobs, bridge, log, ready = Promise.resolve() }) {
  const routes = []
  const route = (path, handler) => routes.push({
    kind: 'exact',
    path,
    handler: async (req, res) => {
      await ready
      return handler(req, res)
    }
  })

  route('/ssh-remote/hosts', async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    return sendJson(res, 200, { ok: true, hosts: store.hosts.map(publicHost) })
  })

  route('/ssh-remote/hosts/save', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const body = await readBody(req)
      validateTarget(body.host || {})
      const saved = await store.upsertHost(body.host || {})
      pool.closeHost(saved.id)
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
      await store.removeHost(id)
      pool.closeHost(id)
      return sendJson(res, 200, { ok: true })
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
      return sendJson(res, 200, { ok: true, probe })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error), code: error?.code || '' })
    }
  })

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
      })
      return sendJson(res, 202, { ok: true, jobId: job.id })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

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
      const status = await manager.status(host, workspace, { fresh: true })
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
      })
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
        const status = await manager.status(host, workspace, { fresh: true })
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
        })
        return sendJson(res, 202, { ok: true, jobId: job.id })
      }
      throw new Error(`unknown op: ${op}`)
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  route('/ssh-remote/jobs', async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    const url = new URL(req.url, 'http://localhost')
    const job = jobs.get(url.searchParams.get('id') || '')
    if (!job) return sendJson(res, 404, { ok: false, error: 'job not found' })
    return sendJson(res, 200, { ok: true, job: jobs.snapshot(job) })
  })

  route('/ssh-remote/remote/list', async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const url = new URL(req.url, 'http://localhost')
      const host = store.host(url.searchParams.get('hostId') || '')
      if (!host) throw new Error('host not found')
      const listing = await manager.listRemoteDirs(host, url.searchParams.get('path') || '~')
      return sendJson(res, 200, { ok: true, ...listing })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  route('/ssh-remote/remote/mkdir', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const body = await readBody(req)
      const host = store.host(String(body.hostId || ''))
      if (!host) throw new Error('host not found')
      const target = await manager.makeRemoteDir(host, String(body.path || '~'), String(body.name || ''))
      return sendJson(res, 200, { ok: true, path: target })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  route('/ssh-remote/local/pick', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const picker = typeof ctx.get === 'function' ? ctx.get('directoryPicker') : null
      if (picker && typeof picker.capability === 'function') {
        const capability = await picker.capability()
        if (capability?.kind === 'native' && typeof capability.pick === 'function') {
          try {
            // `DirectoryPickerNativeCapability.pick` requires a real
            // AbortSignal; null throws before the OS dialog can open.
            const path = await capability.pick(new AbortController().signal)
            if (path) return sendJson(res, 200, { ok: true, path })
            return sendJson(res, 200, { ok: true, cancelled: true })
          } catch (error) {
            // The Host has no usable OS chooser; `browse` is a successful
            // answer to "which picking interaction is available?", so the
            // client can fall back instead of showing an error.
            return sendJson(res, 200, { ok: true, kind: 'browse', reason: errorText(error) })
          }
        }
      }
      return sendJson(res, 200, { ok: true, kind: 'browse' })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  route('/ssh-remote/local/list', async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const url = new URL(req.url, 'http://localhost')
      const listing = await localListing(url.searchParams.get('path') || '')
      return sendJson(res, 200, { ok: true, ...listing })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  route('/ssh-remote/local/mkdir', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const body = await readBody(req)
      const base = expandLocal(String(body.path || ''))
      const name = String(body.name || '').trim().replace(/[\\/]+/gu, '')
      if (!name || name === '.' || name === '..') throw new Error('目录名不合法')
      const target = join(base, name)
      await mkdir(target, { recursive: false })
      return sendJson(res, 200, { ok: true, path: target })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  route('/ssh-remote/settings', async (req, res) => {
    if (req.method === 'GET') return sendJson(res, 200, { ok: true, settings: store.settings })
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const body = await readBody(req)
      const incoming = body.settings || {}
      const next = { ...store.settings }
      if (typeof incoming.dshVersion === 'string' && /^\d+\.\d+\.\d+(?:-[\w.]+)?$/u.test(incoming.dshVersion)) next.dshVersion = incoming.dshVersion
      if (typeof incoming.nodeVersion === 'string' && /^\d+\.\d+\.\d+$/u.test(incoming.nodeVersion)) next.nodeVersion = incoming.nodeVersion
      if (typeof incoming.npmRegistry === 'string' && /^https?:\/\//u.test(incoming.npmRegistry)) next.npmRegistry = incoming.npmRegistry
      if (Number.isFinite(Number(incoming.pollIntervalMs))) next.pollIntervalMs = Math.min(60000, Math.max(2000, Number(incoming.pollIntervalMs)))
      if (typeof incoming.syncCredentials === 'boolean') next.syncCredentials = incoming.syncCredentials
      if (typeof incoming.createIfMissing === 'boolean') next.createIfMissing = incoming.createIfMissing
      if (typeof incoming.bridgeEnabled === 'boolean') next.bridgeEnabled = incoming.bridgeEnabled
      if (incoming.remotePermissionMode === 'danger-full-access') next.remotePermissionMode = incoming.remotePermissionMode
      store.state.settings = next
      await store.save()
      return sendJson(res, 200, { ok: true, settings: next })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  route('/ssh-remote/bridge', async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    return sendJson(res, 200, { ok: true, sessions: bridge?.status?.() || [], enabled: store.settings.bridgeEnabled !== false })
  })

  route('/ssh-remote/native/sync', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const result = await reconcileNativeWorkspaces({ ctx, store, log })
      if (!result.available) return sendJson(res, 503, { ok: false, error: 'workspaceRegistry unavailable' })
      return sendJson(res, 200, { ok: true, rows: result.rows })
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: errorText(error) })
    }
  })

  route('/ssh-remote/health', async (req, res) => {
    return sendJson(res, 200, { ok: true, plugin: 'dsh-ssh-remote', workspaces: store.workspaces.length, hosts: store.hosts.length })
  })

  return routes
}

export function registerTransports(ctx, routes, log = () => {}) {
  const disposers = []
  try {
    ctx.inject(['webServer'], (inner) => {
      const server = inner.get('webServer')
      const own = routes.map((item) => server.register(item))
      disposers.push(...own)
    })
  } catch (error) {
    log('warn', `[ssh-remote] webServer unavailable: ${errorText(error)}`)
  }
  try {
    ctx.inject(['connection'], (inner) => {
      const connection = inner.get('connection')
      if (!connection?.fetch || typeof connection.fetch.register !== 'function') return
      for (const item of routes) disposers.push(connection.fetch.register(connectionRoute(item)))
    })
  } catch (error) {
    log('warn', `[ssh-remote] connection carrier unavailable: ${errorText(error)}`)
  }
  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch {
        // ignore
      }
    }
  }
}
