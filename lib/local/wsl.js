// WSL backend: distro discovery, path mapping, upload and directory listing.
// Split out of lib/local.js (verbatim) to keep every file readable.
import {
  execFile,
  spawn
} from 'node:child_process'
import { createReadStream } from 'node:fs'
import {
  access,
  copyFile,
  mkdir,
  readFile,
  unlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  dirname,
  join,
  posix,
  win32
} from 'node:path'
import {
  WSL,
  MAX_OUTPUT_BYTES,
  DISCOVERY_TTL_MS,
  WSL_IDENTITY_MARKER,
  decodeBuffer,
  normalizeOutput,
  quoteShellArg,
  discoveryCache
} from './process.js'

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

export { buildWslArgs, toWslUncCandidates, shellListDirs }
