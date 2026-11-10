// Docker backend: executable discovery, container listing and exec plumbing.
// Split out of lib/local.js (verbatim) to keep every file readable.
import { spawn } from 'node:child_process'
import {
  accessSync,
  constants,
  createReadStream
} from 'node:fs'
import {
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
  decodeBuffer,
  normalizeOutput,
  quoteShellArg,
  discoveryCache
} from './process.js'
import { shellListDirs } from './wsl.js'

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
