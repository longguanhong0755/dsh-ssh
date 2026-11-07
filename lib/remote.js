// Remote side of the plugin. Mirrors what ZCode's SSH feature does for a
// remote workspace: upload a Node runtime when needed, install the dsh Web
// runtime under the remote home, write credentials, start the Web profile as a
// detached service (systemd when available, setsid/nohup otherwise), verify its
// health, and keep it alive when the local app disconnects.
//
// This file deliberately has no port-forwarding / console code: the local side
// only monitors the remote service, it never proxies its HTTP UI.

import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { prepareRemoteCredentials } from './credentials.js'
import { errorText, firstLine, joinRemote, nodeVersionAtLeast, nowIso, q, randomId, safeId, stripAnsi, tailLines } from './util.js'

const DEFAULT_HTTP_TIMEOUT_MS = 120000
const INSTALL_TIMEOUT_MS = 20 * 60 * 1000
const PROBE_INTERVAL_MS = 2000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ZCode 3.17.2 `ssh.assetInstallMode`: local-download-upload moves the runtime
// artifacts over SFTP; remote-download lets the server fetch them itself.
const DEFAULT_ASSET_INSTALL_MODE = 'local-download-upload'

function assetInstallModeOf(host) {
  return host?.assetInstallMode === 'remote-download' ? 'remote-download' : DEFAULT_ASSET_INSTALL_MODE
}

function formatMegabytes(bytes) {
  return `${(Number(bytes || 0) / 1048576).toFixed(1)} MB`
}

// Recursive size of a directory; used as the progress signal for a local npm
// install, whose piped output has nothing to parse.
async function directorySize(root) {
  let total = 0
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) stack.push(path)
      else if (entry.isFile()) total += (await stat(path).catch(() => null))?.size ?? 0
    }
  }
  return total
}

function runLocal(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs || 10 * 60 * 1000,
      maxBuffer: 16 * 1024 * 1024,
      // npm/tar are .cmd shims on Windows; every argument is fixed by us or
      // validated before this point.
      shell: process.platform === 'win32',
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = tailLines(String(stderr || '').trim(), 8) || firstLine(error.message)
        reject(new Error(`${command} ${args.slice(0, 2).join(' ')} 失败: ${detail}`))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

async function downloadToFile(url, destination, { onProgress } = {}) {
  if (typeof fetch !== 'function') throw new Error('当前 dsh 运行时没有 fetch，无法本地下载资源')
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）：${url}`)
  const total = Number(response.headers.get('content-length') || 0)
  const handle = await open(destination, 'w')
  let received = 0
  try {
    for await (const chunk of response.body) {
      await handle.write(chunk)
      received += chunk.length
      onProgress?.(received, total)
    }
  } finally {
    await handle.close()
  }
  if (total > 0 && received !== total) throw new Error(`下载不完整（${received}/${total} 字节）：${url}`)
  return received
}

function httpProbeCommand(port, nodeBin = 'node') {
  return [
    `if command -v curl >/dev/null 2>&1; then`,
    `  curl -s -o /dev/null -w '%{http_code}' --max-time 4 ${q(`http://127.0.0.1:${port}/`)} 2>/dev/null || true`,
    `elif command -v wget >/dev/null 2>&1; then`,
    `  wget -q -O /dev/null --timeout=4 ${q(`http://127.0.0.1:${port}/`)} >/dev/null 2>&1 && printf 200 || printf 000`,
    `else`,
    `  ${q(nodeBin)} -e ${q(`fetch('http://127.0.0.1:${port}/').then(r=>{console.log(r.status);process.exit(0)}).catch(()=>{console.log(0);process.exit(0)})`)} 2>/dev/null || printf 000`,
    `fi`
  ].join('\n')
}

function unitEnv(workspace) {
  return [
    `Environment=${q(`HOME=${workspace.home}`)}`,
    `Environment=${q(`DSH_HOME=${workspace.dshHome}`)}`,
    `Environment=${q(`DSH_SSH_REMOTE_WORKSPACE=${workspace.id}`)}`,
    `Environment=${q(`PATH=${workspace.nodeDir}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`)}`
  ].join('\n')
}

function unitPath(value) {
  // WorkingDirectory= takes the value literally (quotes are not stripped), so
  // escape spaces/percent signs with systemd's C-style escapes instead.
  return String(value ?? '').replace(/\\/gu, '\\\\').replace(/ /gu, '\\x20').replace(/%/gu, '%%')
}

function unitContent(workspace, { userUnit }) {
  const exec = `"${workspace.nodeBin}" "${workspace.dshBin}" --profile web --no-open --port ${workspace.port}`
  return [
    '[Unit]',
    `Description=DSH SSH remote workspace ${workspace.name} (${workspace.id})`,
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    ...(userUnit ? [] : ['User=' + workspace.username]),
    `WorkingDirectory=${unitPath(workspace.remotePath)}`,
    unitEnv(workspace),
    `ExecStart=${exec}`,
    'Restart=always',
    'RestartSec=3',
    'KillMode=mixed',
    'TimeoutStopSec=20',
    // Journal, not a file: SELinux on RHEL-family hosts denies init_t writing
    // into a user home, which makes append: log targets fail with 209/STDOUT.
    'StandardOutput=journal',
    'StandardError=journal',
    `SyslogIdentifier=${workspace.unit}`,
    '',
    '[Install]',
    `WantedBy=${userUnit ? 'default.target' : 'multi-user.target'}`,
    ''
  ].join('\n')
}

function startScript(workspace) {
  return [
    '#!/bin/sh',
    'set -eu',
    `export HOME=${q(workspace.home)}`,
    `export DSH_HOME=${q(workspace.dshHome)}`,
    `export DSH_SSH_REMOTE_WORKSPACE=${q(workspace.id)}`,
    `export PATH=${q(`${workspace.nodeDir}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`)}`,
    `echo $$ > ${q(workspace.pidFile)}`,
    `cd ${q(workspace.remotePath)}`,
    `exec ${q(workspace.nodeBin)} ${q(workspace.dshBin)} --profile web --no-open --port ${workspace.port}`,
    ''
  ].join('\n')
}

function stopScript(workspace) {
  return [
    '#!/bin/sh',
    'set -u',
    `pidfile=${q(workspace.pidFile)}`,
    'if [ -f "$pidfile" ]; then',
    '  pid=$(cat "$pidfile" 2>/dev/null || true)',
    '  if [ -n "${pid:-}" ]; then',
    '    kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true',
    '    i=0',
    '    while [ $i -lt 30 ]; do',
    '      kill -0 "$pid" 2>/dev/null || break',
    '      i=$((i + 1))',
    '      sleep 0.5',
    '    done',
    '    kill -0 "$pid" 2>/dev/null && { kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true; }',
    '  fi',
    'fi',
    'rm -f "$pidfile"',
    ''
  ].join('\n')
}

// The remote dsh answers on 127.0.0.1; a 5xx means the process is up but the
// service is broken, while any 2xx/3xx/4xx proves it accepted the request.
export function deriveWorkspaceState({ active, httpStatus, desiredState, uptimeSec, subState } = {}) {
  const code = String(httpStatus ?? '000').replace(/[^0-9]/gu, '').slice(-3) || '000'
  let state = 'stopped'
  if (active) {
    if (code !== '000' && !code.startsWith('5')) state = 'running'
    else if (desiredState === 'running' && uptimeSec != null && uptimeSec < 90 && code === '000') state = 'starting'
    else state = 'error'
  } else if (desiredState === 'running') {
    state = 'error'
  }
  if (subState === 'failed') state = 'error'
  return state
}

export class RemoteManager {
  constructor({ dshHome, pool, store, log = () => {} }) {
    this.dshHome = dshHome
    this.pool = pool
    this.store = store
    this.log = log
    this.homeCache = new Map()
    this.runtimePromises = new Map()
    this.statusPromises = new Map()
    // In-flight per-host connection probes (device page status).
    this.connProbes = new Map()
    this.disposed = false
  }

  async hostHome(host) {
    const key = host.id
    if (this.homeCache.has(key)) return this.homeCache.get(key)
    const result = await this.pool.run(host, 'printf %s "$HOME"', { timeoutMs: 20000 })
    const home = result.stdout.trim()
    if (!home) throw new Error('无法解析远程 $HOME')
    this.homeCache.set(key, home)
    return home
  }

  async resolveRemotePath(host, input) {
    const raw = String(input || '').trim()
    if (!raw) throw new Error('远程工作区路径不能为空')
    const home = await this.hostHome(host)
    if (raw === '~') return home
    if (raw.startsWith('~/')) return joinRemote(home, raw.slice(2))
    if (raw.startsWith('/')) return joinRemote(raw)
    return joinRemote(home, raw)
  }

  async ensureRemoteDir(host, path, mode = 0o755) {
    await this.pool.run(host, `mkdir -p ${q(path)} && chmod ${mode.toString(8)} ${q(path)}`, { timeoutMs: 20000 })
  }

  /** Resolve (and optionally install) the Node + dsh binary pair. */
  async ensureRuntime(host, options = {}) {
    const settings = this.store.settings
    const version = options.version || settings.dshVersion
    const key = `${host.id}@${version}${options.force ? `@force-${Date.now()}` : ''}`
    if (this.runtimePromises.has(key)) return this.runtimePromises.get(key)
    const promise = this.ensureRuntimeInner(host, { ...options, version, settings }).finally(() => {
      this.runtimePromises.delete(key)
    })
    this.runtimePromises.set(key, promise)
    return promise
  }

  async ensureRuntimeInner(host, { version, settings, force = false, onLog = () => {} }) {
    const home = await this.hostHome(host)
    const root = joinRemote(home, '.dsh-remote')
    const runtimeRoot = joinRemote(root, 'runtime')
    const dshRoot = joinRemote(runtimeRoot, `dsh-${version}`)
    const dshBin = joinRemote(dshRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
    const dshPkg = joinRemote(dshRoot, 'node_modules/@deepseek-ai/dsh/package.json')
    // Stage tags mirror ZCode's [source-server:*] log markers; the client's
    // wizard parses them to drive per-stage sub-messages.
    const tag = (stage, line) => onLog(`[ssh-remote:${stage}] ${line}`)
    const installMode = assetInstallModeOf(host)

    await this.ensureRemoteDir(host, runtimeRoot)

    // ZCode 重新安装远端服务: replace the program files with this computer's
    // version while leaving the remote home (projects, tasks, credentials)
    // untouched.
    if (force) {
      tag('install', `用本机版本重新安装 dsh ${version}（保留项目与任务）…`)
      await this.pool.exec(host, `rm -rf ${q(dshRoot)}`, { timeoutMs: 60000 })
    }

    // 1. Node: reuse the host's Node when it is >= 22, otherwise unpack a
    // portable official build under the remote home.
    let nodeBin = ''
    let nodeDir = ''
    tag('preflight', '检查远程运行环境…')
    const nodeProbe = await this.pool.exec(host, 'command -v node 2>/dev/null; node -v 2>/dev/null || true; node -p process.platform 2>/dev/null || true', { timeoutMs: 20000 })
    const nodeLines = nodeProbe.stdout.trim().split(/\r?\n/u).filter(Boolean)
    const systemNode = nodeLines[0] || ''
    const systemVersion = nodeLines[1] || ''
    const systemPlatform = (nodeLines[2] || '').trim()
    // WSL exposes Windows executables through interop (/mnt/c/...). A Windows
    // node.exe cannot run a Linux dsh install, so treat it as missing.
    const usableSystemNode = systemNode
      && !systemNode.startsWith('/mnt/')
      && (systemPlatform === '' || systemPlatform === 'linux')
    if (usableSystemNode && nodeVersionAtLeast(systemVersion, 22)) {
      nodeBin = systemNode
      nodeDir = dirname(systemNode)
      tag('verify', `使用远程 Node ${systemVersion} (${systemNode})`)
    } else {
      nodeBin = await this.installPortableNode(host, { runtimeRoot, version: settings.nodeVersion || '22.23.2', onLog, mode: installMode })
      nodeDir = dirname(nodeBin)
      const check = await this.pool.run(host, `${q(nodeBin)} -v`, { timeoutMs: 20000 })
      tag('verify', `便携 Node: ${check.stdout.trim()} (${nodeBin})`)
    }

    // 2. dsh: install the npm package once per version.
    const pkgCheck = await this.pool.exec(host, `if [ -f ${q(dshPkg)} ]; then grep -m1 '"version"' ${q(dshPkg)}; fi`, { timeoutMs: 20000 })
    if (pkgCheck.stdout.includes(version) && (await this.pool.exec(host, `test -f ${q(dshBin)} && printf yes`, { timeoutMs: 20000 })).stdout.includes('yes')) {
      tag('install', `dsh ${version} 已部署 (${dshRoot})`)
      return { nodeBin, nodeDir, dshBin, dshRoot, dshVersion: version, home, root }
    }

    tag('install', `安装 @deepseek-ai/dsh@${version} 到 ${dshRoot} …`)
    await this.ensureRemoteDir(host, dshRoot)
    const packageJson = JSON.stringify({ name: 'dsh-ssh-remote-runtime', private: true, version: '1.0.0' }, null, 2)
    const registry = settings.npmRegistry || 'https://registry.npmmirror.com'
    let localBundle = null
    if (installMode === 'local-download-upload') {
      try {
        // npm's `--libc` matches the `libc` field of optional dependencies,
        // whose values are glibc/musl — not the `gnu` ABI suffix used in the
        // package names.
        const uname = await this.pool.exec(host, 'uname -s 2>/dev/null; uname -m 2>/dev/null; if ldd --version 2>&1 | grep -qi musl; then printf musl; elif command -v ldd >/dev/null 2>&1; then printf glibc; else printf unknown; fi', { timeoutMs: 15000 })
        const [systemName = '', machine = '', libcName = ''] = uname.stdout.trim().split(/\r?\n/u)
        const platform = /darwin/iu.test(systemName) ? 'darwin' : 'linux'
        const cpu = ({ x86_64: 'x64', amd64: 'x64', aarch64: 'arm64', arm64: 'arm64', armv7l: 'armv7l', ppc64le: 'ppc64le', s390x: 's390x' })[machine.trim()] || 'x64'
        const libc = platform === 'linux' && ['glibc', 'musl'].includes(libcName) ? libcName : ''
        localBundle = await this.prepareLocalDshBundle({ version, registry, onLog, platform, cpu, libc })
        const remoteTar = joinRemote(dshRoot, 'runtime.tgz')
        const size = (await stat(localBundle.tarPath)).size
        onLog(`[ssh-remote:upload] 上传 dsh 运行时（${formatMegabytes(size)}）`)
        let lastUpload = -1
        await this.pool.upload(host, localBundle.tarPath, remoteTar, {
          onProgress: (transferred) => {
            if (!size) return
            const pct = Math.floor((transferred / size) * 100)
            if (pct >= lastUpload + 10) {
              lastUpload = pct
              onLog(`[ssh-remote:upload] ${pct}%`)
            }
          }
        })
        onLog('[ssh-remote:extract] 解压 dsh 运行时 …')
        await this.pool.run(host, `cd ${q(dshRoot)} && tar -xzf ${q(remoteTar)} && rm -f ${q(remoteTar)}`, { timeoutMs: 10 * 60 * 1000 })
        onLog(`[ssh-remote:install] dsh ${version} 安装完成（本地上传）`)
      } catch (error) {
        // Keep the workspace usable when the local machine has no npm/tar:
        // the server-side path is the documented fallback, and the log says so.
        onLog(`[ssh-remote:verify] 本地准备失败，改用远端服务器下载：${firstLine(errorText(error))}`)
        localBundle = null
      } finally {
        if (localBundle) await rm(localBundle.dir, { recursive: true, force: true }).catch(() => {})
      }
    }
    if (!localBundle) {
      await this.pool.writeFile(host, joinRemote(dshRoot, 'package.json'), `${packageJson}\n`, 0o600)
      const npm = await this.resolveNpm(host, nodeBin)
      const logPath = joinRemote(dshRoot, 'install.log')
      const exitPath = joinRemote(dshRoot, 'install.exit')
      const install = [
        `cd ${q(dshRoot)}`,
        `rm -f ${q(exitPath)}`,
        `(${q(npm)} install ${q(`@deepseek-ai/dsh@${version}`)} --registry=${q(registry)} --no-audit --no-fund --omit=dev --loglevel=notice > ${q(logPath)} 2>&1; echo $? > ${q(exitPath)})`,
        'echo started'
      ].join(' && ')
      // The installer owns a detached session; a lingering exec channel is not a
      // failure because the exit file below is the source of truth.
      await this.pool.exec(host, `setsid nohup sh -c ${q(install)} </dev/null >/dev/null 2>&1 & echo ok`, { timeoutMs: 15000 }).catch(() => {})
      const started = Date.now()
      let lastSize = 0
      while (Date.now() - started < INSTALL_TIMEOUT_MS) {
        await sleep(PROBE_INTERVAL_MS)
        const exit = await this.pool.exec(host, `cat ${q(exitPath)} 2>/dev/null || true`, { timeoutMs: 15000 })
        const log = await this.pool.exec(host, `tail -c +${lastSize + 1} ${q(logPath)} 2>/dev/null | tail -n 40 || true`, { timeoutMs: 15000 })
        if (log.stdout.trim()) {
          lastSize += Buffer.byteLength(log.stdout, 'utf8')
          // npm output is file-verification detail, not the install step itself;
          // tagging it `verify` keeps the wizard's install sub-message accurate.
          for (const line of stripAnsi(log.stdout).trim().split(/\r?\n/u).slice(-8)) tag('verify', line)
        }
        const code = exit.stdout.trim()
        if (code !== '') {
          if (code !== '0') {
            const tail = await this.pool.exec(host, `tail -n 40 ${q(logPath)} 2>/dev/null || true`, { timeoutMs: 15000 })
            throw new Error(`远程 dsh 安装失败（exit ${code}）: ${tailLines(stripAnsi(tail.stdout), 12)}`)
          }
          break
        }
        if (Date.now() - started > INSTALL_TIMEOUT_MS - 1000) throw new Error('远程 dsh 安装超时')
      }
    }
    const installed = await this.pool.exec(host, `test -f ${q(dshBin)} && printf yes`, { timeoutMs: 20000 })
    if (!installed.stdout.includes('yes')) throw new Error(`安装后未找到 dsh 入口: ${dshBin}`)
    tag('install', `dsh ${version} 安装完成`)
    return { nodeBin, nodeDir, dshBin, dshRoot, dshVersion: version, home, root }
  }

  // Install the dsh package on the local machine and pack node_modules for
  // upload. This is the "本地下载后上传" mode; dependency resolution happens
  // locally, so the remote host needs no registry access.
  async prepareLocalDshBundle({ version, registry, onLog, platform = 'linux', cpu = 'x64', libc = '' }) {
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(String(version))) {
      throw new Error(`dsh 版本格式无效: ${version}`)
    }
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ssh-runtime-'))
    try {
      const packageJson = JSON.stringify({ name: 'dsh-ssh-remote-runtime', private: true, version: '1.0.0' }, null, 2)
      await writeFile(join(dir, 'package.json'), `${packageJson}\n`, 'utf8')
      const target = platform === 'linux' && libc ? `${platform}/${cpu}/${libc}` : `${platform}/${cpu}`
      onLog(`[ssh-remote:download] 本地安装 @deepseek-ai/dsh@${version}（目标 ${target}）…`)
      // npm on a pipe prints nothing until it finishes, and the dependency
      // download regularly takes minutes. Report the growing node_modules as
      // the download progress so the wizard's 正在下载安装包 keeps moving.
      let reportedMb = 0
      let lastActivity = Date.now()
      const startedAt = Date.now()
      const probe = setInterval(() => {
        void directorySize(join(dir, 'node_modules')).then((bytes) => {
          const mb = Math.floor(bytes / 1048576)
          if (mb >= reportedMb + 10) {
            reportedMb = mb
            lastActivity = Date.now()
            onLog(`[ssh-remote:download] 已获取 ${mb} MB …`)
            return
          }
          if (Date.now() - lastActivity >= 30000) {
            lastActivity = Date.now()
            onLog(`[ssh-remote:download] 仍在获取依赖… ${Math.round((Date.now() - startedAt) / 1000)}s`)
          }
        }).catch(() => {})
      }, 2500)
      try {
        // --os/--cpu pick platform-specific optional deps, but a native binding
        // such as node-addon-require-builtin-linux-x64-gnu is also constrained
        // by libc. Without --libc, npm on a Windows/macOS client silently
        // resolves only the base package and the remote dsh dies at startup
        // with "No usable native binding found". --libc needs npm >= 10.1.
        const npmArgs = [
          'install', `@deepseek-ai/dsh@${version}`,
          '--registry', registry,
          `--os=${platform}`, `--cpu=${cpu}`,
          // Cross-platform bundle: postinstall scripts run on the wrong platform
          // (e.g. koffi/CMake). Platform-specific optional packages are already
          // selected by --os/--cpu/--libc, so scripts are not needed locally.
          '--ignore-scripts',
          '--no-audit', '--no-fund', '--omit=dev', '--loglevel=error'
        ]
        if (platform === 'linux' && libc) {
          const npmVersion = await runLocal('npm', ['--version'], { timeoutMs: 30000 }).then((out) => out.stdout.trim()).catch(() => '')
          const [major = 0, minor = 0] = npmVersion.split('.').map((part) => Number.parseInt(part, 10) || 0)
          if (major > 10 || (major === 10 && minor >= 1)) npmArgs.push(`--libc=${libc}`)
          else onLog(`[ssh-remote:verify] 本地 npm ${npmVersion || '未知'} 不支持 --libc，无法选择 ${libc} 原生依赖`)
        }
        await runLocal('npm', npmArgs, { cwd: dir, timeoutMs: 15 * 60 * 1000 })
      } finally {
        clearInterval(probe)
      }
      // The binding package the remote runtime loads is named after the target
      // triplet. If npm resolved only the libc-agnostic base package, uploading
      // this bundle would just move the failure to the server; throw so the
      // caller falls back to the remote install.
      if (platform === 'linux' && libc) {
        // The optional dependency is named after the ABI suffix (gnu/musl)
        // while npm's libc field uses glibc/musl.
        const abi = libc === 'glibc' ? 'gnu' : libc
        const bindingName = `node-addon-require-builtin-linux-${cpu}-${abi}`
        const binding = join(dir, 'node_modules', bindingName)
        const base = join(dir, 'node_modules', 'node-addon-require-builtin')
        const [bindingExists, baseExists] = await Promise.all([
          stat(binding).then((s) => s.isDirectory(), () => false),
          stat(base).then((s) => s.isDirectory(), () => false)
        ])
        if (baseExists && !bindingExists) {
          throw new Error(`本地依赖缺少 ${libc} 原生绑定（${bindingName}）`)
        }
      }
      const totalBytes = await directorySize(join(dir, 'node_modules'))
      onLog(`[ssh-remote:extract] 本地打包运行时（${formatMegabytes(totalBytes)}）…`)
      const tarPath = join(dir, 'runtime.tgz')
      // Relative output: Git's GNU tar on Windows parses "C:\..." as a remote
      // host, and the process already runs with cwd = dir.
      await runLocal('tar', ['-czf', 'runtime.tgz', 'package.json', 'node_modules'], { cwd: dir, timeoutMs: 5 * 60 * 1000 })
      return { dir, tarPath }
    } catch (error) {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }

  // ZCode's install confirmation preview: is the dsh runtime present, and if
  // not, how big would the install be? Size comes from the npm registry's
  // dist.unpackedSize via the remote npm; null renders as 暂无法获取.
  async runtimeCheck(host, { version, settings }) {
    const home = await this.hostHome(host)
    const runtimeRoot = joinRemote(home, '.dsh-remote/runtime')
    const dshRoot = joinRemote(runtimeRoot, `dsh-${version}`)
    const dshBin = joinRemote(dshRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
    const present = (await this.pool.exec(host, `test -f ${q(dshBin)} && printf yes`, { timeoutMs: 20000 })).stdout.includes('yes')
    if (present) {
      return { present: true, version, installPath: dshRoot, sizeBytes: null }
    }
    let sizeBytes = null
    try {
      const nodeBin = await this.pool.exec(host, 'command -v node 2>/dev/null || true', { timeoutMs: 15000 })
      const nodePath = nodeBin.stdout.trim()
      if (nodePath && !nodePath.startsWith('/mnt/')) {
        const nodeDir = dirname(nodePath)
        const npmProbe = await this.pool.exec(host, `command -v ${q(joinRemote(nodeDir, 'npm'))} 2>/dev/null || command -v npm 2>/dev/null || true`, { timeoutMs: 15000 })
        const npm = npmProbe.stdout.trim()
        if (npm) {
          const registry = settings?.npmRegistry || 'https://registry.npmmirror.com'
          const view = await this.pool.exec(host, `${q(npm)} view ${q(`@deepseek-ai/dsh@${version}`)} dist.unpackedSize --registry=${q(registry)}`, { timeoutMs: 30000 })
          const parsed = Number(view.stdout.trim())
          if (Number.isFinite(parsed) && parsed > 0) sizeBytes = parsed
        }
      }
    } catch {
      sizeBytes = null
    }
    return { present: false, version, installPath: dshRoot, sizeBytes }
  }

  async resolveNpm(host, nodeBin) {
    const nodeDir = dirname(nodeBin)
    const candidates = [joinRemote(nodeDir, 'npm'), 'npm']
    for (const candidate of candidates) {
      const found = await this.pool.exec(host, `command -v ${q(candidate)} 2>/dev/null || true`, { timeoutMs: 15000 })
      if (found.stdout.trim()) return found.stdout.trim()
    }
    throw new Error('远程未找到 npm；请在服务器安装 Node.js/npm 或检查 PATH')
  }

  // systemd runs a service unit in `initrc_t`, and a portable Node unpacked
  // under the SSH user's home carries that home's label (`admin_home_t`).
  // That domain can read and list the runtime but not execute the binary, so
  // the unit dies with status=203/EXEC while the same command works in an
  // interactive (unconfined) SSH shell. Relabeling the executable is the fix;
  // every command is best-effort because most hosts run no SELinux at all.
  async relabelExecutable(host, bin) {
    try {
      await this.pool.exec(host, `chcon -t bin_t ${q(bin)} >/dev/null 2>&1 || true`, { timeoutMs: 15000 })
    } catch {
      // chcon missing or the host forbids relabeling: keep the install usable
      // for interactive shells and let systemd report its own error.
    }
  }

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
  }

  async installPortableNode(host, { runtimeRoot, version, onLog, mode = DEFAULT_ASSET_INSTALL_MODE }) {
    const archProbe = await this.pool.run(host, 'uname -m', { timeoutMs: 15000 })
    const machine = archProbe.stdout.trim()
    const arch = ({ x86_64: 'x64', amd64: 'x64', aarch64: 'arm64', arm64: 'arm64', armv7l: 'armv7l', ppc64le: 'ppc64le', s390x: 's390x' })[machine]
    if (!arch) throw new Error(`不支持的远程 CPU 架构: ${machine}`)
    const nodeRoot = joinRemote(runtimeRoot, 'node')
    const nodeBin = joinRemote(nodeRoot, 'bin/node')
    // Relabel before the version probe so a runtime installed by an older
    // plugin build (or by an interactive shell) is repaired instead of being
    // reinstalled.
    await this.relabelExecutable(host, nodeBin)
    const existing = await this.pool.exec(host, `${q(nodeBin)} -v 2>/dev/null || true`, { timeoutMs: 15000 })
    if (nodeVersionAtLeast(existing.stdout, 22)) return nodeBin
    await this.ensureRemoteDir(host, nodeRoot)
    const dist = `node-v${version}-linux-${arch}`
    const tar = joinRemote(runtimeRoot, `${dist}.tar.gz`)
    const url = `https://npmmirror.com/mirrors/node/v${version}/${dist}.tar.gz`
    if (mode === 'local-download-upload') {
      if (!/^\d+\.\d+\.\d+$/u.test(String(version))) throw new Error(`Node 版本格式无效: ${version}`)
      const dir = await mkdtemp(join(tmpdir(), 'dsh-ssh-node-'))
      try {
        const localTar = join(dir, `${dist}.tar.gz`)
        onLog(`[ssh-remote:download] 本地下载 ${url}`)
        let lastDownload = -1
        const bytes = await downloadToFile(url, localTar, {
          onProgress: (received, total) => {
            if (!total) return
            const pct = Math.floor((received / total) * 100)
            if (pct >= lastDownload + 10) {
              lastDownload = pct
              onLog(`[ssh-remote:download] ${pct}%`)
            }
          }
        })
        onLog(`[ssh-remote:upload] 上传 ${dist}.tar.gz（${formatMegabytes(bytes)}）`)
        let lastUpload = -1
        await this.pool.upload(host, localTar, tar, {
          onProgress: (transferred) => {
            if (!bytes) return
            const pct = Math.floor((transferred / bytes) * 100)
            if (pct >= lastUpload + 10) {
              lastUpload = pct
              onLog(`[ssh-remote:upload] ${pct}%`)
            }
          }
        })
        onLog(`[ssh-remote:extract] 解压 ${dist} …`)
        const result = await this.pool.run(host, `tar -xzf ${q(tar)} -C ${q(nodeRoot)} --strip-components=1 && rm -f ${q(tar)} && (chcon -t bin_t ${q(nodeBin)} >/dev/null 2>&1 || true) && ${q(nodeBin)} -v`, { timeoutMs: 10 * 60 * 1000 })
        onLog(`[ssh-remote:verify] 便携 Node: ${result.stdout.trim() || version} (${nodeBin})`)
        return nodeBin
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {})
      }
    }
    // One command per line: joining these with spaces runs `cd` and `rm` as
    // arguments of each other and makes the shell choke on `then`.
    const download = [
      'set -e',
      `cd ${q(runtimeRoot)}`,
      `rm -f ${q(tar)}`,
      'if command -v curl >/dev/null 2>&1; then',
      `  curl -fL --retry 3 --connect-timeout 20 -o ${q(tar)} ${q(url)}`,
      'elif command -v wget >/dev/null 2>&1; then',
      `  wget -q -O ${q(tar)} ${q(url)}`,
      'elif command -v node >/dev/null 2>&1; then',
      // Minimal Docker images often ship neither curl nor wget. The system
      // Node that is already present can follow the mirror redirect itself.
      `  node -e ${q('const https=require("https");const http=require("http");const get=(url,depth=0)=>{const mod=url.startsWith("https:")?https:http;mod.get(url,res=>{if([301,302,303,307,308].includes(res.statusCode)&&res.headers.location&&depth<5){res.resume();get(new URL(res.headers.location,url).toString(),depth+1);return}if(res.statusCode!==200){process.exit(2)}res.pipe(process.stdout)}).on("error",()=>process.exit(1))};get(process.argv[1])')} ${q(url)} > ${q(tar)}`,
      'else',
      `  echo 'curl/wget/node not found' >&2`,
      '  exit 127',
      'fi',
      `tar -xzf ${q(tar)} -C ${q(nodeRoot)} --strip-components=1`,
      `rm -f ${q(tar)}`,
      `(chcon -t bin_t ${q(nodeBin)} >/dev/null 2>&1 || true)`,
      `${q(nodeBin)} -v`
    ].join('\n')
       onLog(`[ssh-remote:download] 下载 ${url}`)
    const result = await this.pool.run(host, download, { timeoutMs: 10 * 60 * 1000 })
    onLog(`[ssh-remote:verify-archive] ${result.stdout.trim() || '下载完成'}`)
    return nodeBin
  }

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
  }

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
  }

  async create(host, input, onLog = () => {}) {
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
  }

  async cleanupFailedCreate(host, workspace) {
    if (workspace.serviceKind === 'systemd') {
      await this.pool.exec(host, `systemctl stop ${q(workspace.unit)} >/dev/null 2>&1 || true; systemctl disable ${q(workspace.unit)} >/dev/null 2>&1 || true; rm -f ${q(workspace.unitPath || `/etc/systemd/system/${workspace.unit}.service`)}; systemctl daemon-reload`, { timeoutMs: 60000 }).catch(() => {})
    } else if (workspace.serviceKind === 'systemd-user') {
      await this.pool.exec(host, `export XDG_RUNTIME_DIR=\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}; export DBUS_SESSION_BUS_ADDRESS=\${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}; systemctl --user stop ${q(workspace.unit)} >/dev/null 2>&1 || true; systemctl --user disable ${q(workspace.unit)} >/dev/null 2>&1 || true; rm -f ${q(workspace.unitPath || '')}`, { timeoutMs: 60000 }).catch(() => {})
    } else if (workspace.stopPath) {
      await this.pool.exec(host, `sh ${q(workspace.stopPath)} >/dev/null 2>&1 || true`, { timeoutMs: 30000 }).catch(() => {})
    }
  }

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
  }

  async addRebootCron(host, workspace) {
    const line = `@reboot ${workspace.startPath} >> ${workspace.logPath} 2>&1`
    const command = [
      `if command -v crontab >/dev/null 2>&1; then`,
      `  (crontab -l 2>/dev/null | grep -vF ${q(workspace.startPath)} || true; echo ${q(line)}) | crontab - >/dev/null 2>&1 || true;`,
      `fi`
    ].join('\n')
    await this.pool.exec(host, command, { timeoutMs: 20000 }).catch(() => {})
  }

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
  }

  async startWorkspace(host, workspace, { onLog = () => {} } = {}) {
    const tag = (stage, line) => onLog(`[ssh-remote:${stage}] ${line}`)
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
  }

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
  }

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
  }

  async restartWorkspace(host, workspace, { onLog = () => {} } = {}) {
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
  }

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

  /**
   * Shell fragment that puts the real dsh pid in `$pid`: the pidfile is
   * authoritative for setsid runs, systemd's MainPID for services (a pidfile
   * left over from an earlier setsid deployment is ignored once it is dead).
   */
  pidCommand(workspace, { svcPrefix, systemctl, isSystemd }) {
    const lines = [`pid=$(cat ${q(workspace.pidFile)} 2>/dev/null || true)`]
    if (isSystemd) {
      lines.push(
        'if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then',
        `  pid=$(${svcPrefix}${systemctl}show ${q(workspace.unit)} --property=MainPID --value 2>/dev/null || true)`,
        'fi'
      )
    }
    lines.push('printf %s "${pid:-0}"')
    return lines.join('\n')
  }

  async status(host, workspace, options = {}) {
    // The sidebar refresh and the background poll often ask for the same
    // workspace at the same time; share one remote probe instead of queueing
    // two shell channels on the same host.
    const key = `${workspace.id}|${options.skipLog ? 'l' : 'f'}|${options.includeMetrics ? 'm' : 'n'}`
    const inflight = this.statusPromises.get(key)
    if (inflight) return inflight
    const promise = this.statusUncached(host, workspace, options)
    this.statusPromises.set(key, promise)
    try {
      return await promise
    } finally {
      if (this.statusPromises.get(key) === promise) this.statusPromises.delete(key)
    }
  }

  async statusUncached(host, workspace, { fresh = false, skipLog = false, includeMetrics = false } = {}) {
    const now = Date.now()
    if (!fresh && workspace.lastStatus && now - (workspace.lastStatusAt || 0) < 2500) return workspace.lastStatus
    const isSystemd = workspace.serviceKind === 'systemd' || workspace.serviceKind === 'systemd-user'
    const svcPrefix = workspace.serviceKind === 'systemd-user'
      ? `export XDG_RUNTIME_DIR=\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}; export DBUS_SESSION_BUS_ADDRESS=\${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}; `
      : ''
    const systemctl = `systemctl ${workspace.serviceKind === 'systemd-user' ? '--user ' : ''}`
    const svcCommand = isSystemd
      ? `${svcPrefix}${systemctl}show ${q(workspace.unit)} --property=ActiveState,SubState,MainPID,NRestarts --no-pager 2>/dev/null || true`
      : [
          `pid=$(cat ${q(workspace.pidFile)} 2>/dev/null || true)`,
          'if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then',
          `  echo 'ActiveState=active'; echo 'SubState=running'; echo "MainPID=$pid"; echo 'NRestarts=0'`,
          'else',
          `  echo 'ActiveState=inactive'; echo 'SubState=dead'; echo 'MainPID=0'; echo 'NRestarts=0'`,
          'fi'
        ].join('\n')
    // Real per-process numbers, sampled from /proc. `ps -o pcpu` is a lifetime
    // average (a fresh server often reads 100%), so CPU is measured over 0.5s.
    const metricsCommand = [
      'if [ -n "$pid" ] && [ "$pid" != "0" ] && kill -0 "$pid" 2>/dev/null; then',
      '  clk=$(getconf CLK_TCK 2>/dev/null || echo 100)',
      `  t0=$(awk '{print $14 + $15}' "/proc/$pid/stat" 2>/dev/null || echo 0)`,
      '  sleep 0.5',
      `  t1=$(awk '{print $14 + $15}' "/proc/$pid/stat" 2>/dev/null || echo 0)`,
      `  cpu=$(awk -v a="$t0" -v b="$t1" -v c="$clk" 'BEGIN { printf "%.1f", (b - a) / c / 0.5 * 100 }')`,
      `  rss=$(awk '/^VmRSS:/ { print $2 }' "/proc/$pid/status" 2>/dev/null || true)`,
      `  [ -n "$rss" ] || rss=$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ' || true)`,
      `  etimes=$(ps -o etimes= -p "$pid" 2>/dev/null | tr -d ' ' || true)`,
      '  echo "cpu=$cpu"',
      '  echo "rssKb=$rss"',
      '  echo "etimes=$etimes"',
      'fi'
    ].join('\n')
    const script = [
      `echo '@@SVC@@'`,
      svcCommand,
      `echo '@@PID@@'`,
      this.pidCommand(workspace, { svcPrefix, systemctl, isSystemd }),
      // Age of the process, needed to tell "still binding its port" from
      // "running but not serving". /proc gives it without the 0.5 s CPU
      // sample, so the cheap status path can compute `starting` too.
      `echo '@@UPTIME@@'`,
      `if [ -n "$pid" ] && [ "$pid" != "0" ] && kill -0 "$pid" 2>/dev/null; then`,
      `  clk=$(getconf CLK_TCK 2>/dev/null || echo 100)`,
      `  start=$(awk '{print $22}' "/proc/$pid/stat" 2>/dev/null || echo 0)`,
      `  up=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0)`,
      `  [ "\${start:-0}" -gt 0 ] 2>/dev/null && printf 'uptime=%s\\n' $((up - start / clk)) || true`,
      `fi`,
      `echo '@@HTTP@@'`,
      `if [ -n "$pid" ] && [ "$pid" != "0" ] && kill -0 "$pid" 2>/dev/null; then`,
      httpProbeCommand(workspace.port, workspace.nodeBin).split('\n').map((line) => `  ${line}`).join('\n'),
      `else`,
      `  echo 000`,
      `fi`
    ]
    // CPU is a 0.5 s delta; only pay for it when the caller renders metrics.
    if (includeMetrics) script.push(`echo '@@METRICS@@'`, metricsCommand)
    // skipLog must skip the journalctl/tail round trip entirely, not fetch and
    // discard it: the background poll runs this for every workspace.
    if (!skipLog) script.push(`echo '@@LOG@@'`, this.logsCommand(workspace, 80))
    const command = script.filter(Boolean).join('\n')
    const result = await this.pool.exec(host, command, { timeoutMs: 30000 })
    const text = stripAnsi(result.stdout)
    const section = (name, next) => {
      const start = text.indexOf(`@@${name}@@`)
      if (start < 0) return ''
      const from = start + name.length + 4
      const end = next ? text.indexOf(`@@${next}@@`, from) : text.length
      return text.slice(from, end < 0 ? text.length : end).trim()
    }
    const svc = new Map(section('SVC', 'HTTP').split(/\r?\n/u).map((line) => {
      const index = line.indexOf('=')
      return index > 0 ? [line.slice(0, index), line.slice(index + 1)] : ['', '']
    }))
    const active = svc.get('ActiveState') === 'active'
    const restarts = svc.get('NRestarts') || ''
    const subState = svc.get('SubState') || ''
    const pid = Number((section('PID', 'HTTP') || '0').replace(/[^0-9]/gu, '')) || 0
    const quickUptime = Number((section('UPTIME', 'HTTP') || '').replace(/[^0-9]/gu, '')) || null
    // Always delimit the HTTP section: without the metrics section the log
    // tail would otherwise be read as part of the status code.
    const httpEnd = includeMetrics ? 'METRICS' : skipLog ? null : 'LOG'
    const httpStatus = ((section('HTTP', httpEnd).split(/\r?\n/u).pop() || '000').trim().slice(-3) || '000')
    const metrics = new Map(section('METRICS', 'LOG').split(/\r?\n/u).map((line) => {
      const index = line.indexOf('=')
      return index > 0 ? [line.slice(0, index), line.slice(index + 1)] : ['', '']
    }))
    const cpuPercent = metrics.has('cpu') ? Number(metrics.get('cpu')) : null
    const rssKb = Number(metrics.get('rssKb')) || 0
    const rssBytes = rssKb > 0 ? rssKb * 1024 : null
    const uptimeSec = metrics.has('etimes') ? Number(metrics.get('etimes')) || null : quickUptime
    const logTail = skipLog ? '' : section('LOG', null)
    const state = deriveWorkspaceState({
      active,
      httpStatus,
      desiredState: workspace.desiredState,
      uptimeSec,
      subState
    })
    const status = {
      id: workspace.id,
      state,
      active,
      pid: pid > 0 ? pid : null,
      restarts: restarts ? Number(restarts) : null,
      subState,
      httpStatus,
      uptimeSec,
      rssBytes,
      cpuPercent,
      logTail,
      serviceKind: workspace.serviceKind,
      port: workspace.port,
      checkedAt: nowIso()
    }
    workspace.lastStatus = status
    workspace.lastStatusAt = now
    return status
  }

  logsCommand(workspace, lines) {
    const count = Math.max(1, Math.min(2000, Number(lines) || 200))
    if (workspace.serviceKind === 'systemd') {
      return `journalctl -u ${q(workspace.unit)} -n ${count} --no-pager -o cat 2>/dev/null || true`
    }
    if (workspace.serviceKind === 'systemd-user') {
      return [
        `export XDG_RUNTIME_DIR=\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}`,
        `export DBUS_SESSION_BUS_ADDRESS=\${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}`,
        `journalctl --user -u ${q(workspace.unit)} -n ${count} --no-pager -o cat 2>/dev/null || true`
      ].join('; ')
    }
    return `tail -n ${count} ${q(workspace.logPath)} 2>/dev/null || true`
  }

  async logs(host, workspace, lines = 200) {
    const result = await this.pool.exec(host, this.logsCommand(workspace, lines), { timeoutMs: 20000 })
    return stripAnsi(result.stdout)
  }

  async listRemoteDirs(host, inputPath) {
    const path = await this.resolveRemotePath(host, inputPath || '~')
    const rows = await this.pool.listDirs(host, path)
    const entries = rows
      .filter((row) => row.name !== '.' && row.name !== '..')
      .map((row) => ({
        name: row.name,
        path: joinRemote(path, row.name),
        dir: row.dir === true,
        // ZCode's `fI` hides dot-directories until 显示隐藏目录 is on.
        hidden: row.name.startsWith('.'),
        size: row.size ?? null,
        mtime: row.mtime ?? null
      }))
      .sort((a, b) => {
        if (a.dir !== b.dir) return a.dir ? -1 : 1
        const aHidden = a.name.startsWith('.')
        const bHidden = b.name.startsWith('.')
        if (aHidden !== bHidden) return aHidden ? 1 : -1
        return a.name.localeCompare(b.name)
      })
    const home = await this.hostHome(host)
    return { path, home, parent: path === '/' ? null : dirname(path), entries }
  }

  async readRemoteFile(host, inputPath, maxBytes) {
    const path = await this.resolveRemotePath(host, inputPath || '~')
    const file = await this.pool.readFile(host, path, maxBytes)
    return { path, ...file }
  }

  async makeRemoteDir(host, inputPath, name) {
    const base = await this.resolveRemotePath(host, inputPath || '~')
    const clean = String(name || '').trim().replace(/[\\/]+/gu, '')
    if (!clean || clean === '.' || clean === '..') throw new Error('目录名不合法')
    const target = joinRemote(base, clean)
    await this.pool.run(host, `mkdir -p ${q(target)}`, { timeoutMs: 20000 })
    return target
  }

  dispose() {
    this.disposed = true
  }
}
