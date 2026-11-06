// Local remote targets: WSL distributions and Docker containers.
//
// This is a direct port of ZCode Desktop 3.16.2's own backends:
//   * out/main/chunk-DMITVDCT.js  -> WSLBackend / buildWslArgs / listWSLDistros
//   * out/main/chunk-EHXYYQDR.js  -> DockerBackend / listDockerContainers
//
// Both expose the same surface the plugin already needs from SSHPool
// (exec/upload/writeFile/exists/readFile/listDirs/detect), so the deployment,
// status polling, directory browser and headless bridge work unchanged.
//
// Notes from the original implementation that are intentionally preserved:
//   - wsl.exe output is UTF-16LE when it carries NUL bytes; `--status` is the
//     availability probe, `-l -v --all` the distro list.
//   - a WSL target without a distro means the default distribution; the real
//     distro/user/home are resolved inside the distribution
//     (`$WSL_DISTRO_NAME`, `id -un`, `$HOME`).
//   - WSL uploads prefer \\wsl.localhost\<distro>\... / \\wsl$\<distro>\...
//     and fall back to `cat >` inside the distribution.
//   - Docker uploads always stream through `docker exec -i ... cat >`.
//   - Docker containers are addressed by name, full id or id prefix and must
//     be running.

import { execFile, spawn } from 'node:child_process'
import { accessSync, constants, createReadStream } from 'node:fs'
import { access, copyFile, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, posix, win32 } from 'node:path'
import { errorText, firstLine } from './util.js'

const WSL = 'wsl.exe'
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const DISCOVERY_TTL_MS = 5000
const DEFAULT_TIMEOUT_MS = 120000
// ZCode 3.17.2's WSL identity probe marker (`__ZCODE_WSL_IDENTITY__`).
const WSL_IDENTITY_MARKER = '__ZCODE_WSL_IDENTITY__'

// ── shared helpers ──────────────────────────────────────────────────────────

function decodeBuffer(buffer) {
  if (!buffer || buffer.length === 0) return ''
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024))
  let zeroAtOdd = 0
  let zeroAtEven = 0
  for (let index = 0; index < sample.length; index += 1) {
    if (sample[index] !== 0) continue
    if (index % 2 === 0) zeroAtEven += 1
    else zeroAtOdd += 1
  }
  // wsl.exe emits UTF-16LE (ASCII code units carry an odd zero byte).
  if (zeroAtOdd > sample.length / 4 && zeroAtOdd > zeroAtEven) return buffer.toString('utf16le')
  return buffer.toString('utf8')
}

function normalizeOutput(text) {
  return String(text ?? '').replaceAll('\0', '').replace(/^\uFEFF/u, '').replace(/\r/gu, '')
}

export function quoteShellArg(value) {
  return `'${String(value ?? '').replaceAll("'", `'"'"'`)}'`
}

function timeoutError(timeoutMs) {
  return Object.assign(new Error(`远程命令超时（${Math.round(timeoutMs / 1000)}s）`), {
    code: 'remote-connection-timeout'
  })
}

/**
 * Spawn a local executable and collect its output. Used by both backends so
 * channel failures (missing wsl.exe / docker) surface as one normalized error.
 */
export function runProcess(file, args, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS
  return new Promise((resolvePromise, reject) => {
    let child
    try {
      child = spawn(file, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) {
      reject(error)
      return
    }
    const stdout = []
    const stderr = []
    let settled = false
    let timer = null
    const finish = (error, result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (error) reject(error)
      else resolvePromise(result)
    }
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          // ignore
        }
        finish(timeoutError(timeoutMs))
      }, timeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
    }
    child.once('error', (error) => finish(error))
    child.stdout?.on('data', (chunk) => {
      if (stdout.reduce((total, part) => total + part.length, 0) < MAX_OUTPUT_BYTES) stdout.push(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      if (stderr.reduce((total, part) => total + part.length, 0) < MAX_OUTPUT_BYTES) stderr.push(chunk)
    })
    child.once('close', (code) => {
      finish(null, {
        stdout: decodeBuffer(Buffer.concat(stdout)),
        stderr: decodeBuffer(Buffer.concat(stderr)),
        code: code ?? 0
      })
    })
    if (options.input === null || options.input === undefined) {
      child.stdin?.end()
    } else if (typeof options.input === 'string' || Buffer.isBuffer(options.input)) {
      child.stdin?.end(options.input)
    }
  })
}

/**
 * Spawn a local executable and stream its output. Used for WSL/Docker session
 * tails so the bridge gets the same incremental contract as SSH.
 */
export function streamProcess(file, args, options = {}) {
  let child
  try {
    child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    return { done: Promise.reject(error), close() {} }
  }
  let settled = false
  const stderr = []
  let timer = null
  const done = new Promise((resolvePromise, rejectPromise) => {
    const finish = (error, code) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (error) rejectPromise(error)
      else resolvePromise({ code: code ?? 0, stderr: decodeBuffer(Buffer.concat(stderr)) })
    }
    const timeoutMs = Number(options.timeoutMs) || 0
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try { child.kill() } catch { /* ignore */ }
        finish(timeoutError(timeoutMs))
      }, timeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
    }
    child.once('error', (error) => finish(error))
    child.stdout?.on('data', (chunk) => options.onStdout?.(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < 64) stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      options.onStderr?.(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    child.once('close', (code) => finish(null, code))
  })
  const abort = () => {
    try { child.kill() } catch { /* ignore */ }
  }
  options.signal?.addEventListener('abort', abort, { once: true })
  return {
    done,
    close() {
      options.signal?.removeEventListener('abort', abort)
      abort()
    }
  }
}

function discoveryCache() {
  return { expiresAt: 0, promise: null }
}

// ── WSL ─────────────────────────────────────────────────────────────────────

export function parseWslDistroList(input) {
  const lines = normalizeOutput(input)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
  const rows = []
  for (const line of lines) {
    const cells = line.trim().split(/\s{2,}/u).map((cell) => cell.trim()).filter(Boolean)
    if (cells.length < 3) continue
    const versionText = cells.at(-1) ?? ''
    const version = Number.parseInt(versionText, 10)
    if (!Number.isFinite(version)) continue
    const state = cells.at(-2) ?? ''
    const nameCell = cells.slice(0, -2).join(' ').trim()
    const isDefault = nameCell.startsWith('*')
    const name = nameCell.replace(/^\*\s*/u, '').trim()
    if (!name) continue
    rows.push({ name, isDefault, state, version: version === 1 || version === 2 ? version : null })
  }
  return rows
}

function execWslForBuffer(args) {
  return new Promise((resolvePromise, reject) => {
    execFile(WSL, args, { encoding: 'buffer', maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const detail = normalizeOutput(decodeBuffer(Buffer.isBuffer(stderr) ? stderr : Buffer.from(stderr ?? ''))).trim()
        reject(new Error(detail || error.message))
        return
      }
      resolvePromise(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? ''))
    })
  })
}

const wslAvailability = discoveryCache()
const wslDistroCache = discoveryCache()

/** ZCode `isWSLAvailable`, with the localized "not installed" hint recognized. */
export async function isWslAvailable() {
  if (process.platform !== 'win32') return false
  if (wslAvailability.promise && wslAvailability.expiresAt > Date.now()) return wslAvailability.promise
  const entry = { expiresAt: Date.now() + DISCOVERY_TTL_MS, promise: null }
  entry.promise = (async () => {
    try {
      await execWslForBuffer(['--status'])
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // `wsl.exe --status` exits non-zero and prints "未安装适用于 Linux 的
      // Windows 子系统" on machines without the optional feature.
      return !/not recognized|enoent|未安装适用于 Linux 的 Windows 子系统|wsl\.exe --install/iu.test(message)
    }
  })()
  wslAvailability.promise = entry.promise
  wslAvailability.expiresAt = entry.expiresAt
  entry.promise.catch(() => {
    if (wslAvailability.promise === entry.promise) wslAvailability.promise = null
  })
  return entry.promise
}

/** ZCode `listWSLDistros`: `wsl.exe -l -v --all`. */
export async function listWslDistros() {
  if (process.platform !== 'win32') return []
  if (wslDistroCache.promise && wslDistroCache.expiresAt > Date.now()) return wslDistroCache.promise
  const entry = { expiresAt: Date.now() + DISCOVERY_TTL_MS, promise: null }
  entry.promise = (async () => {
    const buffer = await execWslForBuffer(['-l', '-v', '--all'])
    return parseWslDistroList(decodeBuffer(buffer))
  })()
  wslDistroCache.promise = entry.promise
  wslDistroCache.expiresAt = entry.expiresAt
  entry.promise.catch(() => {
    if (wslDistroCache.promise === entry.promise) wslDistroCache.promise = null
  })
  return entry.promise
}

/** ZCode's Linux-user rule (validation-D4kY6DZr.js `dd`). */
export function isValidWslUser(value) {
  const text = String(value ?? '').trim()
  if (text.length === 0 || text.length > 64) return false
  if (text.includes(':') || text.includes('/') || text.includes('\\')) return false
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint < 32 || codePoint === 127) return false
  }
  return true
}

function buildWslArgs(args, distro, user) {
  const result = []
  if (distro) result.push('-d', distro)
  if (user) result.push('-u', user)
  result.push('--exec', ...args)
  return result
}

function toWslUncCandidates(linuxPath, distro) {
  const parts = String(linuxPath).replaceAll('\\', '/').split('/').filter(Boolean)
  const tail = parts.length > 0 ? `\\${parts.join('\\')}` : ''
  return [`\\\\wsl.localhost\\${distro}${tail}`, `\\\\wsl$\\${distro}${tail}`]
}

async function accessAnyPath(paths) {
  for (const path of paths) {
    try {
      await access(path)
      return path
    } catch {
      // try the next spelling
    }
  }
  return null
}

async function copyToAnyPath(localPath, paths) {
  for (const target of paths) {
    try {
      await mkdir(dirname(target), { recursive: true })
      await copyFile(localPath, target)
      return true
    } catch {
      // try the next spelling
    }
  }
  return false
}

export class WSLBackend {
  kind = 'wsl'

  constructor(options = {}) {
    this.distro = String(options.distro ?? '').trim()
    this.user = String(options.user ?? '').trim()
    this.infoPromise = null
    this.disposed = false
  }

  assertUsable() {
    if (this.disposed) throw new Error('WSL backend 已释放，无法启动新命令')
  }

  async resolveInfo() {
    if (this.infoPromise) return this.infoPromise
    this.infoPromise = (async () => {
      await this.ensureAvailable()
      let distros = []
      try {
        distros = await listWslDistros()
      } catch {
        distros = []
      }
      const picked = this.pickDistro(distros)
      const distroName = picked?.name ?? (this.distro || null)
      const userName = this.user || null
      // ZCode 3.17.2 probes identity with a marker line and bash --noprofile
      // --norc, then parses after the LAST marker (motd/profile noise-proof).
      const output = normalizeOutput(
        await this.execDirect(
          ['bash', '--noprofile', '--norc', '-c', `printf '%s\\n' '${WSL_IDENTITY_MARKER}' "$WSL_DISTRO_NAME" "$(id -un)" "$HOME"`],
          distroName,
          userName
        )
      )
      const lines = output.split('\n').map((row) => row.trim())
      const markerIndex = lines.lastIndexOf(WSL_IDENTITY_MARKER)
      if (markerIndex < 0) throw new Error('无法解析 WSL 身份：缺少身份标记')
      const [first = '', second = '', ...rest] = lines.slice(markerIndex + 1)
      const resolvedDistro = first.trim() || distroName
      const resolvedUser = second.trim() || userName
      const homeDir = rest.join('\n').trim()
      if (!homeDir) throw new Error('无法解析 WSL 用户 HOME')
      return {
        distroName: resolvedDistro,
        userName: resolvedUser,
        version: picked?.version ?? null,
        homeDir
      }
    })()
    return this.infoPromise
  }

  pickDistro(distros) {
    const wanted = this.distro
    if (wanted) {
      if (distros.length === 0) return null
      const found = distros.find((row) => row.name.localeCompare(wanted, undefined, { sensitivity: 'base' }) === 0)
      if (!found) throw new Error(`未找到名为 ${this.distro} 的 WSL distro`)
      return found
    }
    return distros.find((row) => row.isDefault) ?? distros[0] ?? null
  }

  async ensureAvailable() {
    if (process.platform !== 'win32') throw new Error('WSL 连接仅支持在 Windows 上使用')
    if (!(await isWslAvailable())) throw new Error('当前系统未检测到可用的 WSL 环境')
  }

  async exec(command, options = {}) {
    this.assertUsable()
    const info = await this.resolveInfo()
    return await runProcess(
      WSL,
      buildWslArgs(['bash', '-lc', command], info.distroName, info.userName),
      { timeoutMs: options.timeoutMs }
    )
  }

  async run(command, options = {}) {
    const result = await this.exec(command, options)
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout || '').trim()
      const error = new Error(detail || `WSL command failed with exit code ${result.code}`)
      error.exitCode = result.code
      error.stdout = result.stdout
      error.stderr = result.stderr
      throw error
    }
    return result
  }

  async execRaw(command, options = {}) {
    this.assertUsable()
    const info = await this.resolveInfo()
    return await runProcess(
      WSL,
      buildWslArgs(['bash', '-lc', command], info.distroName, info.userName),
      { timeoutMs: options.timeoutMs }
    )
  }

  async execStream(command, options = {}) {
    this.assertUsable()
    const info = await this.resolveInfo()
    return streamProcess(
      WSL,
      buildWslArgs(['bash', '-lc', command], info.distroName, info.userName),
      options
    )
  }

  async execSimple(command, options = {}) {
    return normalizeOutput((await this.run(command, options)).stdout)
  }

  async execDirect(args, distro, user, options = {}) {
    this.assertUsable()
    const result = await runProcess(WSL, buildWslArgs(args, distro, user), { timeoutMs: options.timeoutMs })
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout || '').trim()
      throw new Error(detail || `WSL command failed with exit code ${result.code}`)
    }
    return result.stdout
  }

  async resolveLinuxPath(input) {
    const info = await this.resolveInfo()
    if (input === '~') return info.homeDir
    if (String(input).startsWith('~/')) return posix.join(info.homeDir, String(input).slice(2))
    return String(input)
  }

  async detect() {
    await this.ensureAvailable()
    const platform = normalizeOutput(await this.execSimple('uname -s')).trim()
    const arch = normalizeOutput(await this.execSimple('uname -m')).trim()
    let ostype = ''
    try {
      ostype = normalizeOutput(await this.execSimple('if [ -r /proc/sys/kernel/ostype ]; then cat /proc/sys/kernel/ostype; fi')).trim()
    } catch {
      ostype = ''
    }
    return {
      platform: ostype && ostype.toLowerCase() === 'linux' ? 'linux' : platform.toLowerCase(),
      arch
    }
  }

  async upload(localPath, remotePath) {
    this.assertUsable()
    const info = await this.resolveInfo()
    const linuxPath = await this.resolveLinuxPath(remotePath)
    if (info.distroName) {
      const copied = await copyToAnyPath(localPath, toWslUncCandidates(linuxPath, info.distroName))
      if (copied) return
    }
    const parent = posix.dirname(linuxPath)
    const command = `mkdir -p ${quoteShellArg(parent)} && cat > ${quoteShellArg(linuxPath)}`
    const child = spawn(WSL, buildWslArgs(['bash', '-lc', command], info.distroName, info.userName), {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    await new Promise((resolvePromise, reject) => {
      const source = createReadStream(localPath)
      const sink = child.stdin
      const errors = []
      let settled = false
      const finish = (error) => {
        if (settled) return
        settled = true
        source.destroy()
        if (error) reject(error)
        else resolvePromise()
      }
      source.on('error', finish)
      sink.on('error', finish)
      child.stderr.on('data', (chunk) => {
        if (errors.reduce((total, part) => total + part.length, 0) < 4096) errors.push(chunk)
      })
      child.once('error', finish)
      child.once('close', (code) => {
        if (code !== 0) {
          const detail = normalizeOutput(decodeBuffer(Buffer.concat(errors))).trim()
          finish(new Error(detail || `WSL upload failed with exit code ${code}`))
          return
        }
        finish(null)
      })
      source.pipe(sink)
    })
  }

  async writeFile(remotePath, content, mode = 0o600) {
    const temp = join(tmpdir(), `dsh-ssh-wsl-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8')
    await writeFile(temp, buffer, { mode: 0o600 })
    try {
      await this.upload(temp, remotePath)
    } finally {
      await unlink(temp).catch(() => {})
    }
    await this.exec(`chmod ${Number(mode).toString(8)} ${quoteShellArg(await this.resolveLinuxPath(remotePath))}`, { timeoutMs: 20000 }).catch(() => {})
  }

  async exists(input) {
    const info = await this.resolveInfo()
    const linuxPath = await this.resolveLinuxPath(input)
    if (info.distroName && (await accessAnyPath(toWslUncCandidates(linuxPath, info.distroName)))) return true
    try {
      await this.exec(`test -f ${quoteShellArg(linuxPath)} && printf OK`, { timeoutMs: 20000 })
      return true
    } catch {
      return false
    }
  }

  async readFile(input) {
    const info = await this.resolveInfo()
    const linuxPath = await this.resolveLinuxPath(input)
    if (info.distroName) {
      const direct = await accessAnyPath(toWslUncCandidates(linuxPath, info.distroName))
      if (direct) return await readFile(direct, 'utf8')
    }
    return normalizeOutput(await this.execSimple(`cat ${quoteShellArg(linuxPath)}`, { timeoutMs: 20000 }))
  }

  async listDirs(input) {
    const info = await this.resolveInfo()
    const linuxPath = await this.resolveLinuxPath(input || '~')
    if (info.distroName) {
      const direct = await accessAnyPath(toWslUncCandidates(linuxPath, info.distroName))
      if (direct) {
        const { readdir } = await import('node:fs/promises')
        const rows = await readdir(direct, { withFileTypes: true })
        const { statSync } = await import('node:fs')
        return rows.map((row) => {
          const full = join(direct, row.name)
          let size = null
          let mtime = null
          try {
            const metadata = statSync(full)
            size = metadata.size
            mtime = metadata.mtime.toISOString()
          } catch {
            // ignore metadata failures
          }
          return { name: row.name, dir: row.isDirectory(), size, mtime }
        })
      }
    }
    return await shellListDirs(this, linuxPath)
  }

  async home() {
    return (await this.resolveInfo()).homeDir
  }

  dispose() {
    this.disposed = true
  }
}

// Shell-based listing shared by Docker and as the WSL fallback.
async function shellListDirs(backend, path) {
  const script = [
    `cd ${quoteShellArg(path)} 2>/dev/null || exit 3`,
    `for entry in .[!.]* ..?* *; do`,
    `  [ "$entry" = "*" ] && continue`,
    `  [ -e "$entry" ] || [ -L "$entry" ] || continue`,
    `  if [ -d "$entry" ]; then type=d; else type=f; fi`,
    `  printf '%s\\0%s\\0' "$type" "$entry"`,
    `done`
  ].join('\n')
  const result = await backend.exec(script, { timeoutMs: 20000 })
  const parts = String(result.stdout ?? '').split('\0')
  const entries = []
  for (let index = 0; index + 1 < parts.length; index += 2) {
    const type = parts[index]
    const name = parts[index + 1]
    if (!name) continue
    entries.push({ name, dir: type === 'd', size: null, mtime: null })
  }
  return entries
}

// ── Docker ──────────────────────────────────────────────────────────────────

function dockerExecutableNames(platform) {
  return platform === 'win32' ? ['docker.exe', 'docker.cmd', 'docker.bat', 'docker'] : ['docker']
}

function dockerFallbackPaths(platform, homeDir) {
  if (platform === 'darwin') {
    return [
      '/usr/local/bin/docker',
      '/opt/homebrew/bin/docker',
      '/Applications/OrbStack.app/Contents/MacOS/xbin/docker',
      posix.join(homeDir, '.orbstack/bin/docker'),
      '/Applications/Docker.app/Contents/Resources/bin/docker'
    ]
  }
  if (platform === 'linux') return ['/usr/local/bin/docker', '/usr/bin/docker', '/snap/bin/docker']
  if (platform === 'win32') {
    return [
      'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
      'C:\\ProgramData\\DockerDesktop\\version-bin\\docker.exe'
    ]
  }
  return []
}

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function resolveDockerCommand(options = {}) {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const check = options.isExecutable ?? isExecutable
  const pathValue = env.PATH ?? ''
  const delimiter = platform === 'win32' ? ';' : ':'
  const joiner = platform === 'win32' ? win32.join : posix.join
  for (const directory of pathValue.split(delimiter)) {
    const trimmed = directory.trim()
    if (!trimmed) continue
    for (const name of dockerExecutableNames(platform)) {
      const candidate = joiner(trimmed, name)
      if (check(candidate)) return candidate
    }
  }
  const homeDir = options.homeDir ?? (process.env.HOME || process.env.USERPROFILE || '')
  for (const candidate of dockerFallbackPaths(platform, homeDir)) {
    if (check(candidate)) return candidate
  }
  return 'docker'
}

function execDocker(args, options = {}) {
  return runProcess(resolveDockerCommand(), args, {
    timeoutMs: options.timeoutMs ?? 30000
  })
}

export function parseDockerContainerList(input) {
  return normalizeOutput(input)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        const row = JSON.parse(line)
        if (!row.ID || !row.Names) return []
        return [{
          id: row.ID,
          image: row.Image ?? '',
          name: row.Names,
          state: row.State ?? '',
          status: row.Status ?? ''
        }]
      } catch {
        return []
      }
    })
}

const dockerAvailability = discoveryCache()

/** ZCode `isDockerAvailable`: `docker version --format {{.Server.Version}}`. */
export async function isDockerAvailable() {
  try {
    await execDocker(['version', '--format', '{{.Server.Version}}'], { timeoutMs: 15000 })
    return true
  } catch {
    return false
  }
}

/** ZCode `listDockerContainers`, running containers by default. */
export async function listDockerContainers(options = {}) {
  const args = ['ps']
  if (options.all) args.push('-a')
  args.push('--format', '{{json .}}')
  const result = await execDocker(args, { timeoutMs: 20000 })
  return parseDockerContainerList(result.stdout)
}

export function dockerDiscovery() {
  return dockerAvailability
}

export function isDockerContainerRef(value) {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(String(value ?? ''))
}

export class DockerBackend {
  kind = 'docker'

  constructor(options = {}) {
    this.container = String(options.container ?? '').trim()
    this.dockerCommand = resolveDockerCommand()
    this.infoPromise = null
    this.availabilityPromise = null
    // Every exec resolves the container first; on a running project that is
    // one `docker ps -a` per command. A short cache keeps the container list
    // without hiding a stopped/recreated container for long.
    this.containerRows = null
    this.containerCacheUntil = 0
  }

  async ensureAvailable() {
    if (!this.availabilityPromise) {
      this.availabilityPromise = isDockerAvailable().then((available) => {
        if (!available) throw new Error('当前系统未检测到可用的 Docker 环境')
      }).catch((error) => {
        this.availabilityPromise = null
        throw error
      })
    }
    await this.availabilityPromise
  }

  buildArgs(container, command) {
    if (!isDockerContainerRef(container)) throw new Error('Invalid Docker container reference')
    return ['exec', '-i', container, 'sh', '-lc', command]
  }

  async exec(command, options = {}) {
    try {
      const info = await this.resolveContainer()
      return await this.execInContainer(info.name, command, options)
    } catch (error) {
      // A failed exec is the cheapest signal that the container may have been
      // stopped or recreated; re-resolve on the next call.
      this.containerRows = null
      throw error
    }
  }

  async run(command, options = {}) {
    const result = await this.exec(command, options)
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout || '').trim()
      const error = new Error(detail || `Docker command failed with exit code ${result.code}`)
      error.exitCode = result.code
      error.stdout = result.stdout
      error.stderr = result.stderr
      throw error
    }
    return result
  }

  async execRaw(command, options = {}) {
    try {
      const info = await this.resolveContainer()
      return await this.execRawInContainer(info.name, command, options)
    } catch (error) {
      this.containerRows = null
      throw error
    }
  }

  async execStream(command, options = {}) {
    const info = await this.resolveContainer()
    return streamProcess(this.dockerCommand, this.buildArgs(info.name, command), options)
  }

  async execInContainer(container, command, options = {}) {
    return await runProcess(this.dockerCommand, this.buildArgs(container, command), {
      timeoutMs: options.timeoutMs
    })
  }

  async execRawInContainer(container, command, options = {}) {
    return await runProcess(this.dockerCommand, this.buildArgs(container, command), {
      timeoutMs: options.timeoutMs
    })
  }

  async resolveContainer() {
    await this.ensureAvailable()
    if (!this.containerRows || Date.now() > this.containerCacheUntil) {
      this.containerRows = await listDockerContainers({ all: true })
      this.containerCacheUntil = Date.now() + 5000
    }
    const rows = this.containerRows
    const found = rows.find((row) => (
      row.name === this.container
      || row.id === this.container
      || row.id.startsWith(this.container)
    ))
    if (!found) {
      this.containerRows = null
      throw new Error(`未找到名为 ${this.container} 的 Docker 容器`)
    }
    if (String(found.state).toLowerCase() !== 'running') {
      this.containerRows = null
      throw new Error(`Docker 容器 ${found.name} 当前未运行（state=${found.state || 'unknown'}）`)
    }
    return found
  }

  async resolveInfo() {
    if (this.infoPromise) return this.infoPromise
    this.infoPromise = (async () => {
      await this.ensureAvailable()
      const container = await this.resolveContainer()
      const homeDir = normalizeOutput(
        await this.execDirectInContainer(container.name, ['sh', '-lc', 'printf %s ~'])
      ).trim()
      return { containerName: container.name, homeDir }
    })()
    return this.infoPromise
  }

  async execDirectInContainer(container, args, options = {}) {
    const result = await runProcess(this.dockerCommand, ['exec', '-i', container, ...args], {
      timeoutMs: options.timeoutMs
    })
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout || '').trim()
      throw new Error(detail || `Docker command failed with exit code ${result.code}`)
    }
    return result.stdout
  }

  async execSimple(command, options = {}) {
    return normalizeOutput((await this.exec(command, options)).stdout)
  }

  resolveLinuxPath(input, homeDir) {
    if (input === '~') return homeDir
    if (String(input).startsWith('~/')) return `${homeDir.replace(/\/$/u, '')}/${String(input).slice(2)}`
    return String(input)
  }

  async detect() {
    await this.ensureAvailable()
    const platform = normalizeOutput(await this.execSimple('uname -s')).trim()
    const arch = normalizeOutput(await this.execSimple('uname -m')).trim()
    let ostype = ''
    try {
      ostype = normalizeOutput(await this.execSimple('if [ -r /proc/sys/kernel/ostype ]; then cat /proc/sys/kernel/ostype; fi')).trim()
    } catch {
      ostype = ''
    }
    return {
      platform: ostype && ostype.toLowerCase() === 'linux' ? 'linux' : platform.toLowerCase(),
      arch
    }
  }

  async upload(localPath, remotePath) {
    await this.ensureAvailable()
    const info = await this.resolveInfo()
    const linuxPath = this.resolveLinuxPath(remotePath, info.homeDir)
    const parent = posix.dirname(linuxPath)
    await this.run(`mkdir -p ${quoteShellArg(parent)}`, { timeoutMs: 20000 })
    const info2 = await this.resolveContainer()
    const child = spawn(this.dockerCommand, this.buildArgs(info2.name, `cat > ${quoteShellArg(linuxPath)}`), {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    await new Promise((resolvePromise, reject) => {
      const source = createReadStream(localPath)
      const sink = child.stdin
      const errors = []
      let settled = false
      const finish = (error) => {
        if (settled) return
        settled = true
        source.destroy()
        if (error) reject(error)
        else resolvePromise()
      }
      source.on('error', finish)
      sink.on('error', finish)
      child.stderr.on('data', (chunk) => {
        if (errors.reduce((total, part) => total + part.length, 0) < 4096) errors.push(chunk)
      })
      child.once('error', finish)
      child.once('close', (code) => {
        if (code !== 0) {
          const detail = normalizeOutput(decodeBuffer(Buffer.concat(errors))).trim()
          finish(new Error(detail || `Docker upload failed with exit code ${code}`))
          return
        }
        finish(null)
      })
      source.pipe(sink)
    })
  }

  async writeFile(remotePath, content, mode = 0o600) {
    const temp = join(tmpdir(), `dsh-ssh-docker-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8')
    await writeFile(temp, buffer, { mode: 0o600 })
    try {
      await this.upload(temp, remotePath)
    } finally {
      await unlink(temp).catch(() => {})
    }
    const info = await this.resolveInfo()
    await this.exec(`chmod ${Number(mode).toString(8)} ${quoteShellArg(this.resolveLinuxPath(remotePath, info.homeDir))}`, { timeoutMs: 20000 }).catch(() => {})
  }

  async exists(input) {
    try {
      const info = await this.resolveInfo()
      const linuxPath = this.resolveLinuxPath(input, info.homeDir)
      await this.exec(`test -f ${quoteShellArg(linuxPath)} && printf OK`, { timeoutMs: 20000 })
      return true
    } catch {
      return false
    }
  }

  async readFile(input) {
    const info = await this.resolveInfo()
    const linuxPath = this.resolveLinuxPath(input, info.homeDir)
    return normalizeOutput(await this.execSimple(`cat ${quoteShellArg(linuxPath)}`, { timeoutMs: 20000 }))
  }

  async listDirs(input) {
    const info = await this.resolveInfo()
    const linuxPath = this.resolveLinuxPath(input || '~', info.homeDir)
    return await shellListDirs(this, linuxPath)
  }

  async home() {
    return (await this.resolveInfo()).homeDir
  }

  dispose() {}
}

export { buildWslArgs, toWslUncCandidates, shellListDirs }
