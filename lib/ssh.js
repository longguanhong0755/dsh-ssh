// SSH transport copied in spirit from ZCode's `SSHBackend`: password, private
// key, passphrase and agent authentication; keyboard-interactive fallback for
// password logins; keepalives; TOFU host-key verification; exec with a timeout;
// and SFTP uploads. There is no port-forwarding API on purpose: this plugin
// monitors remote workspaces instead of proxying their Web console.

import { Client } from 'ssh2'
import { StringDecoder } from 'node:string_decoder'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { errorText, firstLine } from './util.js'

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

// A hop that dies and comes back (a local forward watchdog restarting, a
// Tailscale or Wi-Fi blip, a VPN reconnecting) used to surface as one
// ECONNREFUSED on the first try and fail the whole session start. Retrying for
// a few seconds turns that window into a short delay instead of an error.
const CONNECT_ATTEMPTS = 5
const CONNECT_RETRY_DELAYS = [600, 1200, 1800, 2400]

// Reported by GET /ssh-remote/health. The plugin is loaded once per DSH process,
// so a code change can only be proven live from outside if the running module
// names its own behaviour: bump this whenever the transport changes.
export const SSH_TRANSPORT_REVISION = '2026-11-10 connect-retry'

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

/** Transport-level failures worth a second try; auth and host-key are not. */
function isRetriableConnectError(error) {
  const code = String(error?.code || '')
  if (code === 'remote-host-unreachable') return true
  if (code === 'remote-connection-timeout' || code === 'remote-connection-closed') return true
  if (code === 'remote-connection-unknown') return true
  return false
}

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
  // Errors raised by this pool are already user-facing; wrapping them again
  // would bury the actionable part behind a generic "SSH 连接失败".
  if (String(error?.code || '').startsWith('remote-')) return error
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

// Transport-level failures where the connection itself is suspect. SFTP
// writes are idempotent, so one retry over a fresh connection is safe and
// turns a black-holed tunnel (NAT timeout, sleeping laptop) into a hiccup
// instead of a failed session start.
function isTransientTransportError(error) {
  const code = String(error?.code || '')
  if (code === 'remote-connection-timeout' || code === 'remote-connection-closed') return true
  if (['ECONNRESET', 'ECONNABORTED', 'EPIPE', 'ETIMEDOUT'].includes(code)) return true
  return /no response from server|connection lost|not connected|channel open failure/iu.test(errorText(error))
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

  /** A pooled client is only reusable while its TCP socket is actually open. */
  alive(client) {
    const socket = client?._sock
    return Boolean(socket && socket.destroyed !== true && socket.readable !== false && socket.writable !== false)
  }

  closeEntry(entry) {
    try {
      entry?.client?.end()
    } catch {
      // ignore
    }
    try {
      entry?.client?.destroy?.()
    } catch {
      // ignore
    }
  }

  async client(host, options = {}) {
    if (this.disposed) throw new Error('SSH pool disposed')
    await this.loadKnownHosts()
    const key = host.id || `${host.username}@${host.host}:${host.port}`
    const where = `${host.username}@${host.host}:${host.port || 22}`
    const attempts = Math.max(1, Math.min(Number(options.attempts) || CONNECT_ATTEMPTS, 10))
    let lastError
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.connectOnce(host, key, where, options)
      } catch (error) {
        lastError = error
        if (attempt >= attempts || !isRetriableConnectError(error)) throw error
        const delay = CONNECT_RETRY_DELAYS[Math.min(attempt - 1, CONNECT_RETRY_DELAYS.length - 1)]
        this.log('warn', `[ssh] ${key} attempt ${attempt}/${attempts} failed: ${errorText(error)}; retrying in ${delay}ms`)
        await sleep(delay)
      }
    }
    throw lastError
  }

  /** One handshake attempt. Retries and logging live in `client()`. */
  async connectOnce(host, key, where, options = {}) {
    const existing = this.entries.get(key)
    // Share a handshake that is still in flight instead of opening a second
    // connection for every concurrent caller.
    if (existing?.state === 'connecting') return await existing.ready
    if (existing?.state === 'ready' && existing.connected && this.alive(existing.client)) {
      return existing.client
    }
    if (existing) {
      // A resolved promise whose socket is gone must not be handed out: the
      // next exec would be written into a dead tunnel and never come back.
      this.entries.delete(key)
      this.closeEntry(existing)
      existing.ready?.catch(() => {})
    }
    const connectTimeoutMs = Number(options.timeoutMs) || 30000
    const entry = { client: new Client(), ready: null, connected: false, state: 'connecting' }
    this.entries.set(key, entry)
    entry.ready = new Promise((resolvePromise, reject) => {
      let settled = false
      let additionalVerificationPrompted = false
      const deadline = setTimeout(() => {
        fail(Object.assign(new Error(`SSH 连接超时（${where}）：${Math.round(connectTimeoutMs / 1000)} 秒内未完成握手`), {
          code: 'remote-connection-timeout'
        }))
        // ssh2 clears its own timer on socket close; destroying the socket
        // here also aborts a handshake stuck on a half-open tunnel.
        try { entry.client.destroy() } catch { /* ignore */ }
      }, connectTimeoutMs)
      const fail = (error) => {
        if (settled) return
        settled = true
        clearTimeout(deadline)
        entry.state = 'closed'
        if (this.entries.get(key) === entry) this.entries.delete(key)
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
        entry.state = 'closed'
        if (this.entries.get(key) === entry) this.entries.delete(key)
        // ssh2 clears `readyTimeout` when the socket closes and emits no
        // error, so a handshake that dies halfway would otherwise leave
        // every `await client(host)` pending forever — the create dialog
        // freezing at 「正在读取」 was exactly this.
        fail(Object.assign(new Error(`SSH 连接在握手完成前关闭（${where}）`), {
          code: 'remote-connection-closed'
        }))
      })
      entry.client.once('ready', () => {
        if (settled) return
        settled = true
        clearTimeout(deadline)
        entry.state = 'ready'
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
    const timeoutMs = Number(options.timeoutMs) || 120000
    // Connection setup is bounded separately; otherwise a stalled handshake
    // sits outside the command timeout and the caller waits forever.
    const connectTimeoutMs = Number(options.connectTimeoutMs) || 30000
    const client = await this.client(host, { timeoutMs: connectTimeoutMs, attempts: options.attempts })
    return await new Promise((resolvePromise, reject) => {
      let settled = false
      let channel = null
      let stdout = ''
      let stderr = ''
      let stdoutBytes = 0
      let stderrBytes = 0
      const stdoutDecoder = new StringDecoder('utf8')
      const stderrDecoder = new StringDecoder('utf8')
      const finish = (error, code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        stdout += stdoutDecoder.end()
        stderr += stderrDecoder.end()
        if (error) reject(error)
        else resolvePromise({ stdout, stderr, code: code ?? 0 })
      }
      const closeChannel = () => {
        try { channel?.close() } catch { /* ignore */ }
        try { channel?.destroy?.() } catch { /* ignore */ }
      }
      const timer = setTimeout(() => {
        this.log('warn', `[ssh] exec timeout after ${timeoutMs}ms: ${firstLine(command).slice(0, 160)}`)
        // Rejecting without closing leaves the remote command and its sshd
        // session alive; repeated timeouts eventually exhaust MaxSessions.
        closeChannel()
        if (!channel) {
          // The channel never opened: the pooled transport is wedged, so drop
          // it and let the next call reconnect instead of failing the same way.
          try { client.destroy() } catch { /* ignore */ }
        }
        finish(Object.assign(new Error(`远程命令超时（${Math.round(timeoutMs / 1000)}s）`), { code: 'remote-connection-timeout' }))
      }, timeoutMs)
      try {
        client.exec(command, (error, stream) => {
          if (error) {
            finish(normalizeSshError(error, host))
            return
          }
          if (settled) {
            // The timeout fired before the channel opened: close it immediately.
            try { stream.close() } catch { /* ignore */ }
            return
          }
          channel = stream
          const append = (text, chunk, decoder, used, cap) => {
            if (used >= cap) return { text, used }
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            const room = cap - used
            const slice = buffer.length > room ? buffer.subarray(0, room) : buffer
            return { text: text + decoder.write(slice), used: used + slice.length }
          }
          stream.on('data', (chunk) => {
            const next = append(stdout, chunk, stdoutDecoder, stdoutBytes, MAX_OUTPUT_BYTES)
            stdout = next.text
            stdoutBytes = next.used
          })
          stream.stderr.on('data', (chunk) => {
            const next = append(stderr, chunk, stderrDecoder, stderrBytes, MAX_OUTPUT_BYTES)
            stderr = next.text
            stderrBytes = next.used
          })
          stream.on('exit', (code) => {
            stream.__exitCode = code
          })
          stream.on('close', (code) => {
            if (settled) return
            finish(null, stream.__exitCode ?? code ?? 0)
          })
          stream.on('error', (streamError) => {
            closeChannel()
            finish(streamError)
          })
        })
      } catch (error) {
        finish(normalizeSshError(error, host))
      }
    })
  }

  /**
   * Exec with incremental stdout/stderr delivery over one SSH channel.
   * The returned handle keeps the channel open until the remote command exits
   * or `close()` is called. Used by the session bridge's `tail -f` transport.
   */
  async execStream(host, command, options = {}) {
    const connectTimeoutMs = Number(options.connectTimeoutMs) || 30000
    const client = await this.client(host, { timeoutMs: connectTimeoutMs, attempts: options.attempts })
    let channel = null
    let settled = false
    const stderr = []
    const openTimeoutMs = Number(options.openTimeoutMs) || 20000
    const done = new Promise((resolvePromise, rejectPromise) => {
      const finish = (error, code) => {
        if (settled) return
        settled = true
        clearTimeout(openTimer)
        if (error) rejectPromise(error)
        else resolvePromise({ code: code ?? 0, stderr: Buffer.concat(stderr).toString('utf8') })
      }
      const openTimer = setTimeout(() => {
        if (channel) return
        this.log('warn', `[ssh] channel open timeout after ${openTimeoutMs}ms: ${firstLine(command).slice(0, 160)}`)
        // A channel that never opens means the pooled connection is wedged;
        // dropping it forces the next call to reconnect.
        try { client.destroy() } catch { /* ignore */ }
        finish(Object.assign(new Error(`SSH 通道打开超时（${Math.round(openTimeoutMs / 1000)}s）`), { code: 'remote-connection-timeout' }))
      }, openTimeoutMs)
      try {
        client.exec(command, (error, stream) => {
          if (error) {
            finish(normalizeSshError(error, host))
            return
          }
          channel = stream
          clearTimeout(openTimer)
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
        finish(normalizeSshError(error, host))
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
    const client = await this.client(host, { timeoutMs: Number(options.connectTimeoutMs) || 30000, attempts: options.attempts })
    const openTimeoutMs = Number(options.openTimeoutMs) || 20000
    // Reset on every chunk: a slow but moving transfer must not be killed,
    // while a stalled SFTP channel has to fail instead of hanging the job.
    const idleTimeoutMs = Number(options.idleTimeoutMs) || 120000
    return await new Promise((resolvePromise, reject) => {
      let sftp = null
      let source = null
      let settled = false
      const settle = (error) => {
        if (settled) return
        settled = true
        clearTimeout(openTimer)
        clearTimeout(idleTimer)
        if (error) {
          try { source?.destroy() } catch { /* ignore */ }
          try { sftp?.end() } catch { /* ignore */ }
          // A stalled transfer leaves the transport unusable; drop it so the
          // next call reconnects instead of hanging on the same socket. Local
          // read errors (ENOENT and friends) keep their original shape.
          if (isTransientTransportError(error)) {
            try { client.destroy() } catch { /* ignore */ }
          }
          reject(error)
        } else {
          resolvePromise()
        }
      }
      const timeoutError = () => Object.assign(
        new Error(`SFTP 上传超时（${Math.round(idleTimeoutMs / 1000)}s 无进展）`),
        { code: 'remote-connection-timeout' }
      )
      const openTimer = setTimeout(() => {
        settle(Object.assign(new Error('SFTP 通道打开超时'), { code: 'remote-connection-timeout' }))
      }, openTimeoutMs)
      let idleTimer = setTimeout(() => settle(timeoutError()), idleTimeoutMs)
      const touch = () => {
        clearTimeout(idleTimer)
        idleTimer = setTimeout(() => settle(timeoutError()), idleTimeoutMs)
      }
      try {
        client.sftp((error, handle) => {
          if (error) {
            settle(normalizeSshError(error, host))
            return
          }
          sftp = handle
          clearTimeout(openTimer)
          source = createReadStream(localPath)
          const sink = sftp.createWriteStream(remotePath, { mode: 0o600 })
          let transferred = 0
          source.on('data', (chunk) => {
            transferred += chunk.length
            touch()
            options.onProgress?.(transferred)
          })
          sink.on('close', () => settle(null))
          sink.on('error', (uploadError) => settle(uploadError))
          source.on('error', (uploadError) => settle(uploadError))
          source.pipe(sink)
        })
      } catch (error) {
        settle(normalizeSshError(error, host))
      }
    })
  }

  /** Write small config files without an OS-specific SFTP path translation. */
  async writeFile(host, remotePath, content, mode = 0o600, options = {}) {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8')
    const attempts = options.retry === false ? 1 : 2
    let lastError = null
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        await this.writeFileOnce(host, remotePath, buffer, mode, options)
        return
      } catch (error) {
        lastError = normalizeSshError(error, host)
        if (attempt === attempts - 1 || !isTransientTransportError(lastError)) throw lastError
        this.log('warn', `[ssh] SFTP 写入失败，重建连接后重试：${remotePath}（${lastError.code || firstLine(errorText(lastError))}）`)
      }
    }
    throw lastError
  }

  async writeFileOnce(host, remotePath, buffer, mode, options) {
    const client = await this.client(host, { timeoutMs: Number(options.connectTimeoutMs) || 30000, attempts: options.attempts })
    // Opening the SFTP subsystem is one round-trip. On the reported device a
    // single round-trip measures 1–6s (relayed link), so the budget has to be
    // generous: 30s still bounds a dead transport without failing a slow but
    // healthy host, which is what the old 30s whole-write deadline did.
    const openTimeoutMs = Number(options.openTimeoutMs) || 30000
    const writeTimeoutMs = Number(options.timeoutMs) || 60000
    return await new Promise((resolvePromise, reject) => {
      let sftp = null
      let settled = false
      let timer = null
      const finish = (error, { drop = false } = {}) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try { sftp?.end() } catch { /* ignore */ }
        if (error) {
          // A timed-out request on this connection means the transport is
          // dead or black-holed (sshd never replied). Leaving it in the pool
          // would make every later call — including the session start that
          // triggered this write — hang the same way.
          if (drop) {
            try { client.destroy() } catch { /* ignore */ }
          }
          reject(error)
        } else {
          resolvePromise()
        }
      }
      const arm = (ms, message) => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          finish(Object.assign(new Error(message), { code: 'remote-connection-timeout' }), { drop: true })
        }, ms)
      }
      arm(openTimeoutMs, `SFTP 通道打开超时（${Math.round(openTimeoutMs / 1000)}s）: ${remotePath}`)
      try {
        client.sftp((error, handle) => {
          if (error) {
            finish(normalizeSshError(error, host))
            return
          }
          sftp = handle
          arm(writeTimeoutMs, `SFTP 写入超时（${Math.round(writeTimeoutMs / 1000)}s）: ${remotePath}`)
          sftp.open(remotePath, 'w', (openError, fileHandle) => {
            if (openError) {
              finish(openError)
              return
            }
            sftp.write(fileHandle, buffer, 0, buffer.length, 0, (writeError) => {
              sftp.close(fileHandle, () => {
                sftp.chmod(remotePath, mode, (chmodError) => {
                  finish(writeError || chmodError || null)
                })
              })
            })
          })
        })
      } catch (error) {
        finish(normalizeSshError(error, host))
      }
    })
  }

  /** Cheap reachability/latency probe used by the "test connection" button. */
  async probe(host) {
    const key = host.id || `${host.username}@${host.host}:${host.port || 22}`
    try {
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
    } finally {
      // A test connection must not keep a pooled client alive after the probe.
      this.closeHost(key)
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
