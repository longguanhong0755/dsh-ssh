// RemoteManager methods: remote runtime discovery and installation.
//
// Moved verbatim out of lib/remote.js (the bodies still use `this`) and assigned
// onto RemoteManager.prototype at the end of that module.

import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { errorText, firstLine, joinRemote, nodeVersionAtLeast, q, stripAnsi, tailLines } from '../util.js'
import { DEFAULT_ASSET_INSTALL_MODE, INSTALL_TIMEOUT_MS, PROBE_INTERVAL_MS, assetInstallModeOf, directorySize, downloadToFile, formatMegabytes, runLocal, sleep } from './shared.js'

// A lock holder is a live install unless it is older than this. Installs are
// bounded by INSTALL_TIMEOUT_MS (15 min), so a 30 min holder is a crash.
const INSTALL_LOCK_STALE_MS = 30 * 60 * 1000

export const runtimeMethods = {
  async hostHome(host) {
    const key = host.id
    if (this.homeCache.has(key)) return this.homeCache.get(key)
    const result = await this.pool.run(host, 'printf %s "$HOME"', { timeoutMs: 20000 })
    const home = result.stdout.trim()
    if (!home) throw new Error('无法解析远程 $HOME')
    this.homeCache.set(key, home)
    return home
  },

  async resolveRemotePath(host, input) {
    const raw = String(input || '').trim()
    if (!raw) throw new Error('远程工作区路径不能为空')
    const home = await this.hostHome(host)
    if (raw === '~') return home
    if (raw.startsWith('~/')) return joinRemote(home, raw.slice(2))
    if (raw.startsWith('/')) return joinRemote(raw)
    return joinRemote(home, raw)
  },

  async ensureRemoteDir(host, path, mode = 0o755) {
    await this.pool.run(host, `mkdir -p ${q(path)} && chmod ${mode.toString(8)} ${q(path)}`, { timeoutMs: 20000 })
  },

  /** Resolve (and optionally install) the Node + dsh binary pair. */
  async ensureRuntime(host, options = {}) {
    const settings = this.store.settings
    const version = options.version || settings.dshVersion
    const key = `${host.id}@${version}${options.force ? `@force-${Date.now()}` : ''}`
    if (this.runtimePromises.has(key)) return this.runtimePromises.get(key)
    // The remote install lock is taken deep inside (only when an install is
    // really needed) and released here, so a throw cannot leave it behind.
    const lock = {}
    const promise = this.ensureRuntimeInner(host, { ...options, version, settings, lock })
      .finally(async () => {
        this.runtimePromises.delete(key)
        if (lock.release) await lock.release().catch(() => {})
      })
    this.runtimePromises.set(key, promise)
    return promise
  },

  /**
   * Take the per-host install lock before writing a runtime directory.
   *
   * ZCode answers a second desktop with `source-server-update-in-progress`
   * while the device is updating its remote service; two desktops can point at
   * the same host, and two `npm install` runs into one dsh-<version> tree
   * corrupt node_modules. The guard therefore lives on the host: `mkdir` is
   * atomic on every POSIX filesystem and the holder records when it started.
   * A holder older than INSTALL_LOCK_STALE_MS is a crashed install and can be
   * taken over, because every install path is bounded by INSTALL_TIMEOUT_MS.
   */
  async acquireInstallLock(host, runtimeRoot, version) {
    const lockDir = joinRemote(runtimeRoot, 'install.lock')
    const staleSec = Math.round(INSTALL_LOCK_STALE_MS / 1000)
    const acquire = async () => {
      const script = [
        // The runtime root may not exist on a first install (or in a test
        // harness): create it first so a failed lock mkdir really means
        // contention, not a missing parent directory.
        `mkdir -p ${q(runtimeRoot)} 2>/dev/null`,
        `lock=${q(lockDir)}`,
        'if mkdir "$lock" 2>/dev/null; then',
        `  printf 'started=%s\\nversion=%s\\n' "$(date +%s)" ${q(version)} > "$lock/holder"`,
        `  printf '@@ACQUIRED@@\\n'`,
        'else',
        `  if [ ! -d "$lock" ]; then printf '@@LOCK-ERROR@@\\n'; exit 0; fi`,
        `  cat "$lock/holder" 2>/dev/null || true`,
        `  printf '@@LOCK-END@@\\n'`,
        `  started=$(sed -n 's/^started=//p' "$lock/holder" 2>/dev/null | head -1)`,
        '  [ -n "$started" ] || started=0',
        `  printf 'age=%s\\n' "$(( $(date +%s) - started ))"`,
        'fi'
      ].join('\n')
      const result = await this.pool.exec(host, script, { timeoutMs: 20000 })
      return String(result.stdout || '')
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const text = await acquire()
      if (text.includes('@@ACQUIRED@@')) {
        const entry = { version, startedAt: Date.now(), lockDir }
        this.installing.set(host.id, entry)
        this.log('info', `install lock acquired on ${host.name || host.host} for dsh ${version}`)
        return {
          release: async () => {
            await this.pool.exec(host, `rm -rf ${q(lockDir)}`, { timeoutMs: 20000 })
            if (this.installing.get(host.id) === entry) this.installing.delete(host.id)
          }
        }
      }
      if (text.includes('@@LOCK-ERROR@@')) {
        // mkdir failed and no lock directory exists: a real problem (permissions
        // or a read-only home), not another desktop's install. Reporting
        // "updating" here would send the user to wait for a lock that is not
        // there.
        throw new Error(`无法在 ${runtimeRoot} 创建安装锁，请检查远程目录权限`)
      }
      if (!text.includes('@@LOCK-END@@')) {
        throw new Error('无法获取远程安装锁：主机没有返回锁状态')
      }
      const holder = text.split('@@LOCK-END@@')[0] || ''
      const ageSec = Number((text.match(/^age=(\d+)$/mu) || [])[1]) || 0
      if (attempt === 0 && ageSec >= staleSec) {
        this.log('warn', `install lock on ${host.name || host.host} is stale (${ageSec}s); taking over`)
        await this.pool.exec(host, `rm -rf ${q(lockDir)}`, { timeoutMs: 20000 }).catch(() => {})
        continue
      }
      const holderVersion = (holder.match(/^version=(.+)$/mu) || [])[1] || ''
      const error = new Error('远程设备正在更新远端服务')
      error.code = 'source-server-update-in-progress'
      // Mirrors remote.error.sourceServerUpdateInProgress.reason.
      error.reason = '这次连接没有发起。等更新完成后点击重试。'
      error.hostVersion = holderVersion
      error.ageSec = ageSec
      throw error
    }
    throw new Error('无法获取远程安装锁')
  },

  async ensureRuntimeInner(host, { version, settings, force = false, onLog = () => {}, lock = {} }) {
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
    // Another desktop may be installing the same directory right now; report
    // that as source-server-update-in-progress instead of racing it.
    lock.release = (await this.acquireInstallLock(host, runtimeRoot, version)).release
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
  },

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
  },

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
      return { present: true, version, installPath: dshRoot, sizeBytes: null, installedVersion: version, outdated: false }
    }
    // Another version may already be deployed here. That is ZCode's
    // 需要更新 / 更新远端 state, not a first install: the wizard asks before
    // replacing a working runtime instead of silently downloading it.
    const installedVersion = await this.detectInstalledRuntime(host, runtimeRoot)
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
    return {
      present: false,
      version,
      installPath: dshRoot,
      sizeBytes,
      installedVersion,
      outdated: Boolean(installedVersion && installedVersion !== version)
    }
  },

  /**
   * Highest deployed runtime under `<home>/.dsh-remote/runtime`, or ''. The
   * directory name carries the version (`dsh-0.2.1`), so `sort -V` answers it
   * without reading package.json five times.
   */
  async detectInstalledRuntime(host, runtimeRoot) {
    try {
      const result = await this.pool.exec(host, `ls -1d ${q(runtimeRoot)}/dsh-* 2>/dev/null | sed 's#^.*/dsh-##' | sort -V | tail -1`, { timeoutMs: 20000 })
      return String(result.stdout || '').trim().split(/\r?\n/u).pop() || ''
    } catch {
      return ''
    }
  },

  async resolveNpm(host, nodeBin) {
    const nodeDir = dirname(nodeBin)
    const candidates = [joinRemote(nodeDir, 'npm'), 'npm']
    for (const candidate of candidates) {
      const found = await this.pool.exec(host, `command -v ${q(candidate)} 2>/dev/null || true`, { timeoutMs: 15000 })
      if (found.stdout.trim()) return found.stdout.trim()
    }
    throw new Error('远程未找到 npm；请在服务器安装 Node.js/npm 或检查 PATH')
  },

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
  },

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
}
