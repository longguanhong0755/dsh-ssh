// SSH transport copied in spirit from ZCode's `SSHBackend`: password, private
// key, passphrase and agent authentication; keyboard-interactive fallback for
// password logins; keepalives; TOFU host-key verification; exec with a timeout;
// and SFTP uploads. There is no port-forwarding API on purpose: this plugin
// monitors remote workspaces instead of proxying their Web console.

import { Client } from 'ssh2'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { errorText, firstLine } from './util.js'

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

function expandLocalPath(path) {
  const text = String(path ?? '').trim()
  if (!text) return ''
  if (text === '~') return homedir()
  if (text.startsWith('~/') || text.startsWith('~\\')) return join(homedir(), text.slice(2))
  return resolve(text)
}

// ZCode 3.17.2 flags password+OTP servers (dynamic passwords and similar
// prompts) as unsupported instead of silently failing authentication.
const OTP_PROMPT_RE = /verification code|one[- ]?time|\bOTP\b|pass ?code|(?:second|two|2nd)[- ]?factor|\b(?:2FA|MFA)\b|authenticator|动态口令|动态密码/iu

function keyboardInteractive(password, onAdditionalVerification) {
  return (name, instructions, lang, prompts, finish) => {
    if (!password || prompts.length === 0) {
      finish([])
      return
    }
    if ([name, instructions, ...prompts.map((row) => row.prompt)].some((text) => OTP_PROMPT_RE.test(String(text)))) {
      onAdditionalVerification?.()
    }
    finish(prompts.map(() => password))
  }
}

function normalizeSshError(error, host, { additionalVerificationPrompted = false } = {}) {
  const message = errorText(error)
  const where = `${host.username}@${host.host}:${host.port || 22}`
  if (additionalVerificationPrompted && /authentication methods failed|all configured authentication methods failed|authentication failure/iu.test(message)) {
    return Object.assign(new Error('SSH 认证失败：服务器在密码之后还要求额外验证（例如动态口令），当前不支持，请改用私钥或 SSH agent 登录'), {
      code: 'remote-authentication-unsupported'
    })
  }
  if (/authentication methods failed|all configured authentication methods failed|authentication failure/iu.test(message)) {
    return Object.assign(new Error(`SSH 认证失败（${where}）：请检查用户名、密码或私钥配置`), {
      code: 'remote-authentication-failed',
      cause: error
    })
  }
  if (/timed out|timeout/iu.test(message)) {
    return Object.assign(new Error(`SSH 连接超时（${where}）：请检查网络、端口或 SSH 服务`), {
      code: 'remote-connection-timeout',
      cause: error
    })
  }
  if (/host key|verification failed|fingerprint/iu.test(message)) {
    return Object.assign(new Error(`SSH 主机密钥校验失败（${where}）：${message}`), {
      code: 'remote-host-key-changed',
      cause: error
    })
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/iu.test(message)) {
    return Object.assign(new Error(`无法解析主机名 ${host.host}`), { code: 'remote-host-not-found', cause: error })
  }
  if (/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/iu.test(message)) {
    return Object.assign(new Error(`无法连接 ${where}：${message}`), { code: 'remote-host-unreachable', cause: error })
  }
  return Object.assign(new Error(`SSH 连接失败（${where}）：${message}`), { code: 'remote-connection-unknown', cause: error })
}

export class SSHPool {
  constructor({ knownHostsPath, saveKnownHosts, log = () => {} }) {
    this.knownHostsPath = knownHostsPath
    this.saveKnownHosts = saveKnownHosts
    this.log = log
    this.entries = new Map()
    this.knownHosts = null
    this.disposed = false
  }

  async loadKnownHosts() {
    if (this.knownHosts) return this.knownHosts
    try {
      this.knownHosts = JSON.parse(await readFile(this.knownHostsPath, 'utf8'))
    } catch {
      this.knownHosts = {}
    }
    return this.knownHosts
  }

  async persistKnownHosts() {
    if (typeof this.saveKnownHosts === 'function') {
      await this.saveKnownHosts(this.knownHosts)
      return
    }
    const { writeFile, mkdir } = await import('node:fs/promises')
    const { dirname } = await import('node:path')
    await mkdir(dirname(this.knownHostsPath), { recursive: true })
    await writeFile(this.knownHostsPath, `${JSON.stringify(this.knownHosts, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  }

  hostVerifier(host) {
    if (host.hostKeyMode === 'off') return undefined
    return (hashedKey) => {
      if (!this.knownHosts) this.knownHosts = {}
      const key = `${host.host}:${host.port || 22}`
      const entry = this.knownHosts[key]
      if (!entry) {
        if (host.hostKeyMode === 'verify') {
          throw new Error(`host key for ${key} is not known; connect once with accept-new first`)
        }
        this.knownHosts[key] = {
          algo: 'ssh-ed25519',
          fingerprint: hashedKey,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString()
        }
        this.persistKnownHosts().catch((error) => this.log('warn', `known_hosts save failed: ${errorText(error)}`))
        return true
      }
      if (entry.fingerprint !== hashedKey) {
        this.log('error', `host key changed for ${key}: expected ${entry.fingerprint}, got ${hashedKey}`)
        return false
      }
      entry.lastSeen = new Date().toISOString()
      this.persistKnownHosts().catch(() => {})
      return true
    }
  }

  async connectConfig(host) {
    let privateKey
    if (host.auth?.kind === 'key' && host.auth.privateKeyPath) {
      const keyPath = expandLocalPath(host.auth.privateKeyPath)
      const info = await stat(keyPath).catch(() => null)
      if (!info?.isFile()) throw new Error(`私钥文件不存在: ${host.auth.privateKeyPath}`)
      privateKey = await readFile(keyPath)
    }
    const password = host.auth?.kind === 'password' ? String(host.auth.password || '') : ''
    const agent = password || host.auth?.kind === 'key' ? undefined : process.env.SSH_AUTH_SOCK
    return {
      host: host.host,
      port: Number(host.port) || 22,
      username: host.username,
      privateKey,
      passphrase: host.auth?.passphrase || undefined,
      password: password || undefined,
      agent,
      readyTimeout: 30000,
      keepaliveInterval: 15000,
      keepaliveCountMax: 3,
      tryKeyboard: Boolean(password),
      hostHash: 'sha256',
      hostVerifier: this.hostVerifier(host)
    }
  }

  async client(host) {
    if (this.disposed) throw new Error('SSH pool disposed')
    await this.loadKnownHosts()
    const key = host.id || `${host.username}@${host.host}:${host.port}`
    const existing = this.entries.get(key)
    if (existing?.ready) return existing.ready
    const entry = { client: new Client(), ready: null, connected: false }
    this.entries.set(key, entry)
    entry.ready = new Promise((resolvePromise, reject) => {
      let settled = false
      let additionalVerificationPrompted = false
      const fail = (error) => {
        if (settled) return
        settled = true
        this.entries.delete(key)
        try {
          entry.client.end()
        } catch {
          // ignore
        }
        const normalized = normalizeSshError(error, host, { additionalVerificationPrompted })
        if (normalized.code === 'remote-authentication-unsupported') {
          this.log('warn', `[ssh] ${key} password+OTP not supported`)
        }
        reject(normalized)
      }
      entry.client.on('keyboard-interactive', keyboardInteractive(host.auth?.password || '', () => {
        additionalVerificationPrompted = true
      }))
      entry.client.on('error', (error) => {
        entry.connected = false
        this.entries.delete(key)
        this.log('warn', `[ssh] ${key} error: ${errorText(error)}`)
        fail(error)
      })
      entry.client.on('close', () => {
        entry.connected = false
        if (this.entries.get(key) === entry) this.entries.delete(key)
      })
      entry.client.once('ready', () => {
        if (settled) return
        settled = true
        entry.connected = true
        this.log('info', `[ssh] connected ${key}`)
        resolvePromise(entry.client)
      })
      void this.connectConfig(host)
        .then((config) => entry.client.connect(config))
        .catch(fail)
    })
    try {
      return await entry.ready
    } catch (error) {
      if (this.entries.get(key) === entry) this.entries.delete(key)
      throw error
    }
  }

  async exec(host, command, options = {}) {
    const client = await this.client(host)
    const timeoutMs = Number(options.timeoutMs) || 120000
    return await new Promise((resolvePromise, reject) => {
      let settled = false
      let stdout = ''
      let stderr = ''
      const finish = (error, code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error)
        else resolvePromise({ stdout, stderr, code: code ?? 0 })
      }
      const timer = setTimeout(() => {
        this.log('warn', `[ssh] exec timeout after ${timeoutMs}ms: ${firstLine(command).slice(0, 160)}`)
        finish(Object.assign(new Error(`远程命令超时（${Math.round(timeoutMs / 1000)}s）`), { code: 'remote-connection-timeout' }))
      }, timeoutMs)
      client.exec(command, (error, stream) => {
        if (error) {
          finish(normalizeSshError(error, host))
          return
        }
        stream.on('data', (chunk) => {
          if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString('utf8')
        })
        stream.stderr.on('data', (chunk) => {
          if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString('utf8')
        })
        stream.on('exit', (code) => {
          stream.__exitCode = code
        })
        stream.on('close', (code) => {
          finish(null, stream.__exitCode ?? code ?? 0)
        })
        stream.on('error', (streamError) => finish(streamError))
      })
    })
  }

  /**
   * Exec with incremental stdout/stderr delivery over one SSH channel.
   * The returned handle keeps the channel open until the remote command exits
   * or `close()` is called. Used by the session bridge's `tail -f` transport.
   */
  async execStream(host, command, options = {}) {
    const client = await this.client(host)
    let channel = null
    let settled = false
    const stderr = []
    const done = new Promise((resolvePromise, rejectPromise) => {
      const finish = (error, code) => {
        if (settled) return
        settled = true
        if (error) rejectPromise(error)
        else resolvePromise({ code: code ?? 0, stderr: Buffer.concat(stderr).toString('utf8') })
      }
      try {
        client.exec(command, (error, stream) => {
          if (error) {
            finish(normalizeSshError(error, host))
            return
          }
          channel = stream
          stream.on('data', (chunk) => {
            options.onStdout?.(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          })
          stream.stderr.on('data', (chunk) => {
            if (stderr.length < 64) stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
            options.onStderr?.(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          })
          stream.on('exit', (code) => { stream.__exitCode = code })
          stream.on('close', (code) => finish(null, stream.__exitCode ?? code ?? 0))
          stream.on('error', (streamError) => finish(streamError))
        })
      } catch (error) {
        finish(error)
      }
    })
    const abort = () => {
      try { channel?.close() } catch { /* ignore */ }
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

  /** Exec and throw on a non-zero exit, with the remote stderr in the message. */
  async run(host, command, options = {}) {
    const result = await this.exec(host, command, options)
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout || '').trim()
      throw new Error(`远程命令失败（exit ${result.code}）${detail ? `: ${detail.slice(0, 800)}` : ''}`)
    }
    return result
  }

  async upload(host, localPath, remotePath, options = {}) {
    const client = await this.client(host)
    return await new Promise((resolvePromise, reject) => {
      client.sftp((error, sftp) => {
        if (error) {
          reject(normalizeSshError(error, host))
          return
        }
        const source = createReadStream(localPath)
        const sink = sftp.createWriteStream(remotePath, { mode: 0o600 })
        let settled = false
        let transferred = 0
        source.on('data', (chunk) => {
          transferred += chunk.length
          options.onProgress?.(transferred)
        })
        const fail = (uploadError) => {
          if (settled) return
          settled = true
          source.destroy()
          try {
            sftp.end()
          } catch {
            // ignore
          }
          reject(uploadError)
        }
        sink.on('close', () => {
          if (settled) return
          settled = true
          sftp.end()
          resolvePromise()
        })
        sink.on('error', fail)
        source.on('error', fail)
        source.pipe(sink)
      })
    })
  }

  /** Write small config files without an OS-specific SFTP path translation. */
  async writeFile(host, remotePath, content, mode = 0o600) {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8')
    const client = await this.client(host)
    return await new Promise((resolvePromise, reject) => {
      client.sftp((error, sftp) => {
        if (error) {
          reject(normalizeSshError(error, host))
          return
        }
        sftp.open(remotePath, 'w', (openError, handle) => {
          if (openError) {
            sftp.end()
            reject(openError)
            return
          }
          sftp.write(handle, buffer, 0, buffer.length, 0, (writeError) => {
            sftp.close(handle, () => {
              sftp.chmod(remotePath, mode, () => {
                sftp.end()
                if (writeError) reject(writeError)
                else resolvePromise()
              })
            })
          })
        })
      })
    })
  }

  /** Cheap reachability/latency probe used by the "test connection" button. */
  async probe(host) {
    const started = Date.now()
    const result = await this.exec(host, 'printf ok', { timeoutMs: 20000 })
    const latencyMs = Date.now() - started
    const uname = await this.exec(host, 'uname -s; uname -m; printf "home="; printf %s "$HOME"; printf "\\n"; printf "nodePath="; command -v node || true; printf "node="; node -v 2>/dev/null || true', { timeoutMs: 20000 })
    const lines = uname.stdout.trim().split(/\r?\n/u)
    return {
      ok: result.stdout.trim() === 'ok',
      latencyMs,
      platform: lines[0] || '',
      arch: lines[1] || '',
      home: (lines.find((line) => line.startsWith('home=')) || '').slice(5),
      nodePath: (lines.find((line) => line.startsWith('nodePath=')) || '').slice(9),
      node: (lines.find((line) => line.startsWith('node=')) || '').slice(5)
    }
  }

  closeHost(hostId) {
    const entry = this.entries.get(hostId)
    if (entry) {
      this.entries.delete(hostId)
      try {
        entry.client.end()
      } catch {
        // ignore
      }
    }
  }

  dispose() {
    this.disposed = true
    for (const entry of this.entries.values()) {
      try {
        entry.client.end()
      } catch {
        // ignore
      }
    }
    this.entries.clear()
  }
}

export { createHash }
