// RemoteManager methods: remote service lifecycle (start/stop/restart/remove).
//
// Moved verbatim out of lib/remote.js (the bodies still use `this`) and assigned
// onto RemoteManager.prototype at the end of that module.

import { errorText, joinRemote, q, tailLines } from '../util.js'
import { DEFAULT_HTTP_TIMEOUT_MS, PROBE_INTERVAL_MS, sleep } from './shared.js'
import { startScript, stopScript, unitContent } from './units.js'

export const serviceMethods = {
  serviceCommand(workspace, action) {
    if (workspace.serviceKind === 'systemd') return `systemctl ${action} ${q(workspace.unit)}`
    if (workspace.serviceKind === 'systemd-user') {
      return [
        `export XDG_RUNTIME_DIR=\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}`,
        `export DBUS_SESSION_BUS_ADDRESS=\${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}`,
        `systemctl --user ${action} ${q(workspace.unit)}`
      ].join(' && ')
    }
    return ''
  },

  /**
   * Point a stored workspace at the runtime version configured in settings.
   *
   * A workspace record embeds absolute node/dsh paths plus generated start
   * scripts, and a systemd unit bakes ExecStart in as well. Installing a new
   * runtime without rewriting them leaves the service — and every bridged SDK
   * process — on the old build, which speaks an older JSON-RPC dialect.
   */
  async ensureWorkspaceRuntime(host, workspace, { onLog = () => {} } = {}) {
    const runtime = await this.ensureRuntime(host, { onLog })
    const changed = workspace.dshVersion !== runtime.dshVersion
      || workspace.dshBin !== runtime.dshBin
      || workspace.nodeBin !== runtime.nodeBin
    if (!changed) return runtime
    const patch = {
      nodeBin: runtime.nodeBin,
      nodeDir: runtime.nodeDir,
      dshBin: runtime.dshBin,
      dshVersion: runtime.dshVersion
    }
    Object.assign(workspace, patch)
    await this.store.patchWorkspace(workspace.id, patch)
    if (workspace.startPath && workspace.stopPath) {
      await this.pool.writeFile(host, workspace.startPath, startScript(workspace), 0o700)
      await this.pool.writeFile(host, workspace.stopPath, stopScript(workspace), 0o700)
    }
    if (workspace.serviceKind === 'systemd' || workspace.serviceKind === 'systemd-user') {
      const userUnit = workspace.serviceKind === 'systemd-user'
      const path = workspace.unitPath
        || (userUnit
          ? joinRemote(workspace.home, `.config/systemd/user/${workspace.unit}.service`)
          : `/etc/systemd/system/${workspace.unit}.service`)
      await this.pool.writeFile(host, path, unitContent(workspace, { userUnit }), 0o644)
      const reload = userUnit
        ? [
            `export XDG_RUNTIME_DIR=\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}`,
            `export DBUS_SESSION_BUS_ADDRESS=\${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}`,
            'systemctl --user daemon-reload'
          ].join(' && ')
        : 'systemctl daemon-reload'
      await this.pool.exec(host, reload, { timeoutMs: 60000 }).catch(() => {})
    }
    onLog(`[ssh-remote:install] 工作区 ${workspace.name} 已切换到 dsh ${runtime.dshVersion}`)
    return runtime
  },

  /**
   * Retarget a workspace when settings ask for a different runtime that is
   * already installed on the host. Installing on demand belongs to the
   * explicit "reinstall remote service" job, not to every start.
   */
  async refreshWorkspaceRuntime(host, workspace, { onLog = () => {} } = {}) {
    const wanted = String(this.store?.settings?.dshVersion || '')
    if (!wanted || !workspace.dshVersion || workspace.dshVersion === wanted) return false
    const home = await this.hostHome(host)
    const dshBin = joinRemote(home, `.dsh-remote/runtime/dsh-${wanted}/node_modules/@deepseek-ai/dsh/lib/bin.js`)
    const present = (await this.pool.exec(host, `test -f ${q(dshBin)} && printf yes`, { timeoutMs: 20000 })).stdout.includes('yes')
    if (!present) {
      onLog(`[ssh-remote:verify] 远端尚未安装 dsh ${wanted}，继续使用 ${workspace.dshVersion}（可在设备页重新安装）`)
      return false
    }
    await this.ensureWorkspaceRuntime(host, workspace, { onLog })
    return true
  },

  async startWorkspace(host, workspace, { onLog = () => {} } = {}) {
    const tag = (stage, line) => onLog(`[ssh-remote:${stage}] ${line}`)
    await this.refreshWorkspaceRuntime(host, workspace, { onLog }).catch((error) => {
      tag('verify', `检查工作区运行时失败，继续使用 ${workspace.dshVersion}: ${errorText(error)}`)
    })
    tag('daemon', '启动远程服务…')
    const startCommand = [
      `rm -f ${q(workspace.pidFile)}`,
      `cd ${q(workspace.remotePath)}`,
      'if command -v setsid >/dev/null 2>&1; then',
      `  setsid nohup ${q(workspace.startPath)} >> ${q(workspace.logPath)} 2>&1 < /dev/null &`,
      'elif command -v nohup >/dev/null 2>&1; then',
      `  nohup ${q(workspace.startPath)} >> ${q(workspace.logPath)} 2>&1 < /dev/null &`,
      'else',
      `  ${q(workspace.startPath)} >> ${q(workspace.logPath)} 2>&1 < /dev/null &`,
      'fi',
      'sleep 0.3',
      `cat ${q(workspace.pidFile)} 2>/dev/null || true`
    ].join('\n')
    if (workspace.serviceKind === 'systemd' || workspace.serviceKind === 'systemd-user') {
      await this.pool.run(host, `${this.serviceCommand(workspace, 'restart')}`, { timeoutMs: 60000 })
    } else {
      // setsid detaches the child; a lingering channel is handled by the
      // health wait below, not by this exec.
      await this.pool.exec(host, startCommand, { timeoutMs: 15000 }).catch(() => {})
    }
    workspace.desiredState = 'running'
    tag('daemon', '等待服务健康检查…')
    return await this.waitForHealthy(host, workspace, { onLog })
  },

  async waitForHealthy(host, workspace, { onLog = () => {}, timeoutMs = DEFAULT_HTTP_TIMEOUT_MS } = {}) {
    const started = Date.now()
    let last = null
    while (Date.now() - started < timeoutMs) {
      await sleep(PROBE_INTERVAL_MS)
      last = await this.status(host, workspace, { fresh: true, skipLog: true })
      // 401 is the expected unauthenticated answer from the tokenized Web
      // server; it proves the listener is up just as well as 200/303.
      if (last.active && ['200', '302', '303', '401'].includes(last.httpStatus)) {
        onLog(`[ssh-remote:publish-online] 远程 dsh 已就绪 (HTTP ${last.httpStatus}, PID ${last.pid || '—'})`)
        return last
      }
      // `status` reports an active service whose listener is not bound yet as
      // error, because this call does not sample uptime (that costs 0.5 s).
      // dsh can take several seconds to load its plugins, so only a terminal
      // unit state ends the wait early; a slow boot gets the full timeout.
      if (last.subState === 'failed' || (last.subState === 'dead' && !last.active)) {
        const log = await this.logs(host, workspace, 30)
        throw new Error(`远程 dsh 启动失败: ${tailLines(log, 8)}`)
      }
    }
    const log = await this.logs(host, workspace, 40)
    throw new Error(`远程 dsh 未在 ${Math.round(timeoutMs / 1000)}s 内就绪: ${tailLines(log, 10)}`)
  },

  async stopWorkspace(host, workspace) {
    workspace.desiredState = 'stopped'
    if (workspace.serviceKind === 'systemd' || workspace.serviceKind === 'systemd-user') {
      await this.pool.run(host, this.serviceCommand(workspace, 'stop'), { timeoutMs: 60000 }).catch((error) => {
        this.log('warn', `[ssh-remote] systemctl stop failed: ${errorText(error)}`)
      })
    } else {
      await this.pool.run(host, `sh ${q(workspace.stopPath)} || true`, { timeoutMs: 60000 })
    }
    await this.store.patchWorkspace(workspace.id, { desiredState: 'stopped' })
  },

  async restartWorkspace(host, workspace, { onLog = () => {} } = {}) {
    await this.refreshWorkspaceRuntime(host, workspace, { onLog }).catch((error) => {
      onLog(`[ssh-remote:verify] 检查工作区运行时失败，继续使用 ${workspace.dshVersion}: ${errorText(error)}`)
    })
    if (workspace.serviceKind === 'systemd' || workspace.serviceKind === 'systemd-user') {
      await this.pool.run(host, this.serviceCommand(workspace, 'restart'), { timeoutMs: 60000 })
    } else {
      await this.pool.run(host, `sh ${q(workspace.stopPath)} 2>/dev/null || true`, { timeoutMs: 60000 })
      await sleep(500)
      await this.pool.exec(host, [
        `cd ${q(workspace.remotePath)}`,
        'if command -v setsid >/dev/null 2>&1; then',
        `  setsid nohup ${q(workspace.startPath)} >> ${q(workspace.logPath)} 2>&1 < /dev/null &`,
        'elif command -v nohup >/dev/null 2>&1; then',
        `  nohup ${q(workspace.startPath)} >> ${q(workspace.logPath)} 2>&1 < /dev/null &`,
        'else',
        `  ${q(workspace.startPath)} >> ${q(workspace.logPath)} 2>&1 < /dev/null &`,
        'fi',
        'sleep 0.3',
        `cat ${q(workspace.pidFile)} 2>/dev/null || true`
      ].join('\n'), { timeoutMs: 15000 }).catch(() => {})
    }
    workspace.desiredState = 'running'
    const status = await this.waitForHealthy(host, workspace, { onLog })
    await this.store.patchWorkspace(workspace.id, { desiredState: 'running' })
    return status
  },

  async removeWorkspace(host, workspace, { onLog = () => {} } = {}) {
    onLog(`停止并移除远程服务 ${workspace.unit} …`)
    await this.stopWorkspace(host, workspace).catch(() => {})
    if (workspace.serviceKind === 'systemd') {
      await this.pool.exec(host, `systemctl disable ${q(workspace.unit)} >/dev/null 2>&1 || true; rm -f ${q(workspace.unitPath || `/etc/systemd/system/${workspace.unit}.service`)}; systemctl daemon-reload`, { timeoutMs: 60000 }).catch(() => {})
    } else if (workspace.serviceKind === 'systemd-user') {
      await this.pool.exec(host, `export XDG_RUNTIME_DIR=\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}; export DBUS_SESSION_BUS_ADDRESS=\${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}; systemctl --user disable ${q(workspace.unit)} >/dev/null 2>&1 || true; rm -f ${q(workspace.unitPath || '')}`, { timeoutMs: 60000 }).catch(() => {})
    }
    await this.pool.exec(host, `rm -rf ${q(workspace.wsRoot)}`, { timeoutMs: 30000 }).catch(() => {})
    await this.store.removeWorkspace(workspace.id)
    onLog('远程工作区已删除（远程项目目录保留）')
  }
}
