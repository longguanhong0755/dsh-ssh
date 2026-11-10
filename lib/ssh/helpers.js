// Pure helpers for the SSH transport: retry classification, error mapping,
// keyboard-interactive fallback and the OTP prompt matcher. Split out of
// lib/ssh.js (bodies verbatim) so the transport class stays readable.
import { homedir } from 'node:os'
import {
  join,
  resolve
} from 'node:path'
import { errorText } from '../util.js'

export const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

// A hop that dies and comes back (a local forward watchdog restarting, a
// Tailscale or Wi-Fi blip, a VPN reconnecting) used to surface as one
// ECONNREFUSED on the first try and fail the whole session start. Retrying for
// a few seconds turns that window into a short delay instead of an error.
export const CONNECT_ATTEMPTS = 5
export const CONNECT_RETRY_DELAYS = [600, 1200, 1800, 2400]

// Reported by GET /ssh-remote/health. The plugin is loaded once per DSH process,
// so a code change can only be proven live from outside if the running module
// names its own behaviour: bump this whenever the transport changes.
export const SSH_TRANSPORT_REVISION = '2026-11-10 connect-retry'

export const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

/** Transport-level failures worth a second try; auth and host-key are not. */
export function isRetriableConnectError(error) {
  const code = String(error?.code || '')
  if (code === 'remote-host-unreachable') return true
  if (code === 'remote-connection-timeout' || code === 'remote-connection-closed') return true
  if (code === 'remote-connection-unknown') return true
  return false
}

export function expandLocalPath(path) {
  const text = String(path ?? '').trim()
  if (!text) return ''
  if (text === '~') return homedir()
  if (text.startsWith('~/') || text.startsWith('~\\')) return join(homedir(), text.slice(2))
  return resolve(text)
}

// ZCode 3.17.2 flags password+OTP servers (dynamic passwords and similar
// prompts) as unsupported instead of silently failing authentication.
export const OTP_PROMPT_RE = /verification code|one[- ]?time|\bOTP\b|pass ?code|(?:second|two|2nd)[- ]?factor|\b(?:2FA|MFA)\b|authenticator|动态口令|动态密码/iu

export function keyboardInteractive(password, onAdditionalVerification) {
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

export function normalizeSshError(error, host, { additionalVerificationPrompted = false } = {}) {
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
export function isTransientTransportError(error) {
  const code = String(error?.code || '')
  if (code === 'remote-connection-timeout' || code === 'remote-connection-closed') return true
  if (['ECONNRESET', 'ECONNABORTED', 'EPIPE', 'ETIMEDOUT'].includes(code)) return true
  return /no response from server|connection lost|not connected|channel open failure/iu.test(errorText(error))
}
