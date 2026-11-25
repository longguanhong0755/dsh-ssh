// "Open the remote DSH" — the feature the plugin exists for.
//
// The remote workspace already runs a full dsh Web server on its loopback
// interface. Opening it locally needs three things, all of which happen here:
//   1. the service is running (start it when it is not),
//   2. a launch URL with the one-time token from the current process log,
//   3. a fixed local port bridged into the remote loopback port, so the
//      30-day browser cookie keeps its authority and survives restarts.
// The caller gets `http://127.0.0.1:<localPort>/?token=…` and opens a tab.

import { errorText, stripAnsi } from './util.js'
import { targetKind } from './targets.js'

/** Lines of the workspace log that can contain the launch banner. */
const LOG_SCAN_LINES = 400
const URL_PATTERN = /dsh web:\s+(https?:\/\/\S+)/u
/** Any of these proves the listener is up (401 = tokenized server, no token). */
const LISTENER_HTTP = new Set(['200', '302', '303', '304', '401'])
/** These prove a *tokenized* request was accepted. */
const AUTH_HTTP = new Set(['200', '302', '303', '304'])

function codedError(code, message, hint = '') {
  return Object.assign(new Error(message), { code, hint, retryable: true })
}

async function waitFor(check, { timeoutMs = 30000, intervalMs = 500 } = {}) {
  const started = Date.now()
  let last = null
  while (Date.now() - started < timeoutMs) {
    last = await check().catch(() => null)
    if (last) return last
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return last
}

export class ViewService {
  constructor({ manager, pool, store, forwarder, log = () => {} }) {
    this.manager = manager
    this.pool = pool
    this.store = store
    this.forwarder = forwarder
    this.log = log
  }

  /** The last launch URL in the log, or '' when this process never printed one. */
  async launchUrlOf(host, workspace) {
    const text = await this.manager.logs(host, workspace, LOG_SCAN_LINES).catch(() => '')
    const matches = [...stripAnsi(text).matchAll(new RegExp(URL_PATTERN, 'gu'))]
    if (matches.length === 0) return ''
    return matches[matches.length - 1][1]
  }

  async healthy(host, workspace) {
    const status = await this.manager.status(host, workspace, { fresh: true, skipLog: true }).catch(() => null)
    if (!status?.active) return false
    return LISTENER_HTTP.has(String(status.httpStatus || ''))
  }

  async ensureRunning(host, workspace, { onLog = () => {} } = {}) {
    if (await this.healthy(host, workspace)) return
    onLog('[ssh-remote:view] 远程 dsh 未就绪，先启动服务…')
    await this.manager.startWorkspace(host, workspace, { onLog })
    const ready = await waitFor(() => this.healthy(host, workspace).then((ok) => (ok ? true : null)), { timeoutMs: 45000 })
    if (!ready) throw codedError('view-target-offline', '远程 dsh 启动后仍不可访问', '到设备页查看服务日志，或重启这台设备。')
  }

  /**
   * Accept the scraped token only if the server answers with it. A launch URL
   * from a previous process is stale (tokens are per launch), so the service is
   * restarted once to print a fresh one.
   */
  async restartForUrl(host, workspace, { onLog = () => {} } = {}) {
    onLog('[ssh-remote:view] 重启远端服务以生成新的登录地址…')
    await this.manager.restartWorkspace(host, workspace, { onLog })
    const next = await waitFor(() => this.launchUrlOf(host, workspace).then((url) => url || null), { timeoutMs: 45000 })
    if (next) return next
    throw codedError('view-token-missing', '远端 dsh 没有打印登录地址',
      '在设备页的「服务日志」里确认启动参数包含 --print-url，或重新安装远端服务。')
  }

  async introspect(url) {
    try {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000) })
      return { status: response.status, ok: AUTH_HTTP.has(String(response.status)) }
    } catch (error) {
      return { status: 0, ok: false, error: errorText(error) }
    }
  }

  /**
   * Open (or reuse) the local mirror for one workspace.
   *
   * @returns {Promise<{url: string, port: number, remotePort: number, started: boolean}>}
   */
  async open(workspaceId, { onLog = () => {} } = {}) {
    const workspace = this.store.workspace(String(workspaceId))
    if (!workspace) throw codedError('view-unsupported', '工作区不存在', '刷新项目列表后重试。')
    const host = this.store.host(workspace.hostId)
    if (!host) throw codedError('view-unsupported', '工作区所属设备已被删除', '重新连接这台设备后再打开项目。')

    await this.ensureRunning(host, workspace, { onLog })
    let launchUrl = await this.launchUrlOf(host, workspace)
    if (!launchUrl) launchUrl = await this.restartForUrl(host, workspace, { onLog })

    // WSL and Docker targets run on this machine: WSL forwards its loopback to
    // Windows already, and a container's port is only reachable if it was
    // published at create time. Neither needs (or can use) an SSH channel.
    const localTarget = targetKind(host) !== 'ssh'
    if (localTarget && targetKind(host) === 'docker') {
      throw codedError('view-unsupported', '容器里的 DSH 没有发布到本机端口',
        '重新创建容器时把 127.0.0.1:<端口> 映射出来，或改用 SSH 连接这台机器。')
    }
    const mirror = localTarget ? null : await this.forwarder.ensure(workspace.id, {
      host,
      remotePort: Number(workspace.port),
      preferred: Number(workspace.viewPort) || 0
    })
    const port = mirror ? mirror.port : Number(workspace.port)
    if (mirror && mirror.port !== Number(workspace.viewPort)) {
      await this.store.patchWorkspace(workspace.id, { viewPort: mirror.port })
    }
    const rewrite = (text) => {
      const parsed = new URL(text)
      return new URL(`http://127.0.0.1:${port}${parsed.pathname || '/'}${parsed.search || ''}`)
    }
    let local = rewrite(launchUrl)
    let probe = await this.introspect(local.toString())
    if (!probe.ok) {
      // The last banner in the log may belong to a previous process, whose
      // token no longer authenticates; one restart publishes a fresh one.
      onLog('[ssh-remote:view] 现有登录地址已失效，重启远端服务换一个…')
      launchUrl = await this.restartForUrl(host, workspace, { onLog })
      local = rewrite(launchUrl)
      probe = await this.introspect(local.toString())
    }
    if (!probe.ok) {
      await this.forwarder.close(workspace.id)
      throw codedError('view-target-offline', `本地转发已建立，但远端返回 ${probe.status || '无响应'}`,
        '重新点一次「打开远程 DSH」；如果仍然失败，重启这台设备的服务。')
    }
    this.log('info', `[ssh-remote:view] opened ${workspace.name} at ${local.origin}`)
    return { url: local.toString(), port, remotePort: Number(workspace.port), started: true }
  }

  async close(workspaceId) {
    return this.forwarder.close(workspaceId)
  }

  async status(workspaceId) {
    const entry = this.forwarder.get(workspaceId)
    return entry
      ? { open: true, port: entry.port, remotePort: entry.remotePort, url: `http://127.0.0.1:${entry.port}/` }
      : { open: false, port: 0, remotePort: 0, url: '' }
  }

  async closeAll() {
    return this.forwarder.closeAll()
  }
}