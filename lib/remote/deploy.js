// RemoteManager methods: workspace creation, service install and credential sync.
//
// Moved verbatim out of lib/remote.js (the bodies still use `this`) and assigned
// onto RemoteManager.prototype at the end of that module.

import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { prepareRemoteCredentials } from '../credentials.js'
import { errorText, firstLine, joinRemote, nowIso, q, randomId, safeId } from '../util.js'
import { startScript, stopScript, unitContent } from './units.js'

export const deployMethods = {
  // ZCode keeps every device connected even when it has no projects: the
  // device row reflects the live SSH connection, not the workspaces. One cheap
  // exec through the pooled connection per poll cycle; dedupe per host so the
  // UI refresh and the background poll share one probe.
  async probeConnection(host) {
    const inflight = this.connProbes.get(host.id)
    if (inflight) return inflight
    const promise = (async () => {
      const previous = host.connState || ''
      if (!previous) host.connState = 'connecting'
      try {
        await this.pool.exec(host, 'printf ok', { timeoutMs: 15000 })
        host.connState = 'connected'
        host.connCheckedAt = nowIso()
        host.lastOnlineAt = nowIso()
        host.connError = ''
        if (previous !== 'connected') await this.store.save()
      } catch (error) {
        host.connState = 'unreachable'
        host.connCheckedAt = nowIso()
        host.connError = firstLine(errorText(error))
        if (previous !== 'unreachable') await this.store.save()
      }
      return host.connState
    })()
    this.connProbes.set(host.id, promise)
    try {
      return await promise
    } finally {
      if (this.connProbes.get(host.id) === promise) this.connProbes.delete(host.id)
    }
  },

  async allocatePort(host, preferred, nodeBin = '') {
    const used = new Set(this.store.workspaces.filter((row) => row.hostId === host.id).map((row) => row.port))
    const candidates = []
    if (preferred) candidates.push(Number(preferred))
    for (let port = 39080; port <= 39280; port += 1) candidates.push(port)
    candidates.push(3080)
    const nodeExecutable = nodeBin || 'node'
    for (const port of candidates) {
      if (!Number.isInteger(port) || port < 1 || port > 65535 || used.has(port)) continue
      const pattern = q(`[:.]${port}[[:space:]]`)
      const nodeProbe = q(`const net=require('net');const s=net.connect({host:'127.0.0.1',port:${port}});s.setTimeout(700);s.on('connect',()=>{console.log('busy');s.destroy()});s.on('timeout',()=>{console.log('free');s.destroy()});s.on('error',()=>console.log('free'))`)
      // Minimal containers often lack ss/netstat; Node is guaranteed once the
      // runtime has been prepared, so use it as the fallback listener probe.
      const check = await this.pool.exec(host, [
        'if command -v ss >/dev/null 2>&1; then',
        `  ss -ltn 2>/dev/null | grep -qE ${pattern} && printf busy || printf free`,
        'elif command -v netstat >/dev/null 2>&1; then',
        `  netstat -ltn 2>/dev/null | grep -qE ${pattern} && printf busy || printf free`,
        `elif [ -x ${q(nodeExecutable)} ] || command -v ${q(nodeExecutable)} >/dev/null 2>&1; then`,
        `  ${q(nodeExecutable)} -e ${nodeProbe} 2>/dev/null || printf free`,
        'else',
        '  printf free',
        'fi'
      ].join('\n'), { timeoutMs: 15000 })
      if (check.stdout.includes('free')) return port
    }
    throw new Error('远程没有可用的本地端口 (3080/39080-39280)')
  },

  async syncCredentials(host, dshHome) {
    const localCandidates = [
      join(this.dshHome, '.credentials.yaml'),
      join(homedir(), '.dsh', '.credentials.yaml')
    ]
    const local = localCandidates.find((path) => existsSync(path))
    if (!local) return { synced: false, reason: '本地没有 .credentials.yaml' }
    await this.ensureRemoteDir(host, dshHome, 0o700)
    const remotePath = joinRemote(dshHome, '.credentials.yaml')
    // The local app writes a newer document than the pinned remote runtime
    // reads; uploading it verbatim makes the remote profile fail to activate
    // (quoted version, `kind: grant` records). Ship the shape it accepts.
    const source = await readFile(local, 'utf8')
    const prepared = prepareRemoteCredentials(source)
    let uploadPath = local
    let tempDir = null
    if (prepared.text !== source) {
      tempDir = await mkdtemp(join(tmpdir(), 'dsh-ssh-cred-'))
      uploadPath = join(tempDir, '.credentials.yaml')
      await writeFile(uploadPath, prepared.text, { encoding: 'utf8', mode: 0o600 })
    }
    try {
      await this.pool.upload(host, uploadPath, remotePath)
    } finally {
      if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
    await this.pool.run(host, `chmod 600 ${q(remotePath)}`, { timeoutMs: 15000 })
    return { synced: true, path: remotePath, droppedRecords: prepared.droppedRecords }
  },

  /**
   * Creating a workspace allocates a port from the persisted workspace list and
   * only appends the new row after the service is healthy. Two dialogs opened
   * at once both see the same list, pick the same free port, and the loser
   * ends up `error` with no listener. Serialize creation per host; the actual
   * install is already deduped by `ensureRuntime`.
   */
  async create(host, input, onLog = () => {}) {
    return this.withHostLock(`create:${host.id}`, () => this.createNow(host, input, onLog))
  },

  async createNow(host, input, onLog = () => {}) {
    const settings = this.store.settings
    const home = await this.hostHome(host)
    // ZCode resolves the real WSL/docker user when none is configured; the
    // systemd unit and the workspace metadata need an existing account.
    let runUser = String(host.username || '').trim()
    if (!runUser && (host.kind === 'wsl' || host.kind === 'docker')) {
      try {
        runUser = (await this.pool.run(host, 'id -un', { timeoutMs: 15000 })).stdout.trim()
      } catch {
        runUser = ''
      }
    }
    const remotePath = await this.resolveRemotePath(host, input.remotePath || host.defaultPath || '~')
    onLog(`[ssh-remote:workspace] 正在读取 ${remotePath}`)
    const exists = await this.pool.exec(host, `test -d ${q(remotePath)} && printf yes || printf no`, { timeoutMs: 15000 })
    if (!exists.stdout.includes('yes')) {
      if (input.createIfMissing === false) throw new Error(`远程目录不存在: ${remotePath}`)
      onLog(`[ssh-remote:workspace] 远程目录不存在，创建 ${remotePath}`)
      await this.ensureRemoteDir(host, remotePath)
    }
    const runtime = await this.ensureRuntime(host, { onLog })
    const id = randomId('ws')
    const root = runtime.root
    const wsRoot = joinRemote(root, 'workspaces', id)
    const dshHome = joinRemote(wsRoot, 'home')
    const logPath = joinRemote(wsRoot, 'logs/web.log')
    const runDir = joinRemote(wsRoot, 'run')
    const pidFile = joinRemote(runDir, 'web.pid')
    const startPath = joinRemote(runDir, 'start.sh')
    const stopPath = joinRemote(runDir, 'stop.sh')
    await this.ensureRemoteDir(host, joinRemote(wsRoot, 'logs'))
    await this.ensureRemoteDir(host, dshHome, 0o700)
    await this.ensureRemoteDir(host, runDir, 0o700)
    const synced = input.syncCredentials === false ? { synced: false } : await this.syncCredentials(host, dshHome)
    if (synced.synced) {
      const skipped = synced.droppedRecords
        ? `，跳过 ${synced.droppedRecords} 条远程运行时不支持的记录`
        : ''
      onLog(`已同步本地凭证 (.credentials.yaml${skipped})`)
    } else if (input.syncCredentials !== false) onLog(`未同步凭证: ${synced.reason || 'unknown'}`)
    const port = await this.allocatePort(host, input.port, runtime.nodeBin)
    onLog(`远程端口: ${port}`)
    const baseName = remotePath.split('/').filter(Boolean).pop() || 'workspace'
    const workspace = {
      id,
      name: String(input.name || baseName).trim(),
      hostId: host.id,
      targetKind: host.kind === 'wsl' || host.kind === 'docker' ? host.kind : 'ssh',
      targetPort: Number(host.port) || 22,
      hostName: host.name,
      host: host.host,
      username: runUser || host.username || 'root',
      port,
      remotePath,
      home,
      root,
      wsRoot,
      dshHome,
      logPath,
      runDir,
      pidFile,
      startPath,
      stopPath,
      nodeBin: runtime.nodeBin,
      nodeDir: runtime.nodeDir,
      dshBin: runtime.dshBin,
      dshVersion: runtime.dshVersion,
      unit: `dsh-ssh-remote-${safeId(id, 'ws')}`,
      serviceKind: 'pending',
      desiredState: 'running',
      syncedCredentials: Boolean(synced.synced),
      lastOpenedAt: nowIso(),
      createdAt: nowIso(),
      updatedAt: nowIso()
    }
    await this.pool.writeFile(host, startPath, startScript(workspace), 0o700)
    await this.pool.writeFile(host, stopPath, stopScript(workspace), 0o700)
    await this.pool.run(host, `chmod 700 ${q(startPath)} ${q(stopPath)}`, { timeoutMs: 15000 })
    try {
      const service = await this.installService(host, workspace, onLog)
      workspace.serviceKind = service.kind
      workspace.unitPath = service.unitPath || ''
      onLog(`服务方式: ${service.kind}`)
      await this.startWorkspace(host, workspace, { onLog })
    } catch (error) {
      await this.cleanupFailedCreate(host, workspace).catch(() => {})
      throw error
    }
    const status = await this.status(host, workspace, { fresh: true, includeMetrics: true })
    workspace.lastStatus = status
    this.store.state.workspaces.push(workspace)
    if (status.state === 'running') {
      host.lastSuccessAt = nowIso()
      host.lastOnlineAt = nowIso()
    }
    await this.store.save()
    onLog(`远程工作区已就绪: ${workspace.name} (${workspace.remotePath})`)
    return workspace
  },

  async cleanupFailedCreate(host, workspace) {
    if (workspace.serviceKind === 'systemd') {
      await this.pool.exec(host, `systemctl stop ${q(workspace.unit)} >/dev/null 2>&1 || true; systemctl disable ${q(workspace.unit)} >/dev/null 2>&1 || true; rm -f ${q(workspace.unitPath || `/etc/systemd/system/${workspace.unit}.service`)}; systemctl daemon-reload`, { timeoutMs: 60000 }).catch(() => {})
    } else if (workspace.serviceKind === 'systemd-user') {
      await this.pool.exec(host, `export XDG_RUNTIME_DIR=\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}; export DBUS_SESSION_BUS_ADDRESS=\${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}; systemctl --user stop ${q(workspace.unit)} >/dev/null 2>&1 || true; systemctl --user disable ${q(workspace.unit)} >/dev/null 2>&1 || true; rm -f ${q(workspace.unitPath || '')}`, { timeoutMs: 60000 }).catch(() => {})
    } else if (workspace.stopPath) {
      await this.pool.exec(host, `sh ${q(workspace.stopPath)} >/dev/null 2>&1 || true`, { timeoutMs: 30000 }).catch(() => {})
    }
  },

  async installService(host, workspace, onLog) {
    const [systemdProbe, uidProbe] = await Promise.all([
      this.pool.exec(host, `ps -p 1 -o comm= 2>/dev/null || true`, { timeoutMs: 15000 }),
      this.pool.exec(host, `id -u`, { timeoutMs: 15000 })
    ])
    const hasSystemd = systemdProbe.stdout.includes('systemd')
    const isRoot = uidProbe.stdout.trim() === '0'
    if (hasSystemd) {
      if (isRoot) {
        const unitPath = `/etc/systemd/system/${workspace.unit}.service`
        await this.pool.writeFile(host, unitPath, unitContent(workspace, { userUnit: false }), 0o644)
        try {
          await this.pool.run(host, `systemctl daemon-reload && systemctl enable ${q(workspace.unit)} >/dev/null 2>&1`, { timeoutMs: 60000 })
          return { kind: 'systemd', unitPath }
        } catch (error) {
          onLog(`systemd 安装失败，回退到 setsid: ${errorText(error)}`)
        }
      } else {
        const unitPath = joinRemote(workspace.home, `.config/systemd/user/${workspace.unit}.service`)
        await this.ensureRemoteDir(host, dirname(unitPath).replace(/\\/gu, '/'))
        await this.pool.writeFile(host, unitPath, unitContent(workspace, { userUnit: true }), 0o644)
        const userCtl = [
          `export XDG_RUNTIME_DIR=\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}`,
          `export DBUS_SESSION_BUS_ADDRESS=\${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}`,
          `systemctl --user daemon-reload`,
          `systemctl --user enable ${q(workspace.unit)} >/dev/null 2>&1`,
          `systemctl --user cat ${q(workspace.unit)} >/dev/null 2>&1`
        ].join(' && ')
        try {
          await this.pool.run(host, userCtl, { timeoutMs: 60000 })
          await this.pool.exec(host, `loginctl enable-linger $(id -u) >/dev/null 2>&1 || true`, { timeoutMs: 20000 })
          return { kind: 'systemd-user', unitPath }
        } catch (error) {
          onLog(`user systemd 安装失败，回退到 setsid: ${errorText(error)}`)
        }
      }
    }
    // Portable fallback: setsid + nohup; survives the SSH channel closing.
    await this.addRebootCron(host, workspace)
    return { kind: 'setsid' }
  },

  async addRebootCron(host, workspace) {
    const line = `@reboot ${workspace.startPath} >> ${workspace.logPath} 2>&1`
    const command = [
      `if command -v crontab >/dev/null 2>&1; then`,
      `  (crontab -l 2>/dev/null | grep -vF ${q(workspace.startPath)} || true; echo ${q(line)}) | crontab - >/dev/null 2>&1 || true;`,
      `fi`
    ].join('\n')
    await this.pool.exec(host, command, { timeoutMs: 20000 }).catch(() => {})
  }
}
