// Small, dependency-free helpers shared by the host plugin and its test harness.

import { randomBytes } from 'node:crypto'
import { posix as remotePath } from 'node:path'

/** Quote one value for a POSIX shell (single-quote form, safe for any bytes). */
export function shq(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

/** Quote a path for a POSIX shell. */
export function q(path) {
  return shq(path)
}

/** Join remote POSIX paths without turning a leading `~` into an absolute path. */
export function joinRemote(...parts) {
  const cleaned = parts.filter((part) => part != null && part !== '')
  if (cleaned.length === 0) return '.'
  if (cleaned[0].startsWith('~/') || cleaned[0] === '~') {
    return `~/${remotePath.normalize(cleaned.join('/').slice(2))}`
  }
  return remotePath.normalize(cleaned.join('/'))
}

/** A filesystem-safe id fragment. */
export function safeId(value, fallback = 'ws') {
  const text = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40)
  return text || fallback
}

export function randomId(prefix = 'ws') {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
}

export function nowIso() {
  return new Date().toISOString()
}

/** Parse a `node -v` / `v22.23.2` string into [major, minor, patch]. */
export function parseNodeVersion(text) {
  const match = String(text ?? '').match(/v?(\d+)\.(\d+)\.(\d+)/u)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

export function nodeVersionAtLeast(text, major) {
  const parsed = parseNodeVersion(text)
  return parsed != null && parsed[0] >= major
}

/** Last N lines of a text blob, without the trailing newline noise. */
export function tailLines(text, lines = 120) {
  const rows = String(text ?? '').replace(/\r\n/gu, '\n').split('\n')
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop()
  return rows.slice(-Math.max(1, lines)).join('\n')
}

/** One line of a possibly multi-line command output. */
export function firstLine(text) {
  return String(text ?? '').split(/\r?\n/u)[0].trim()
}

/** The single poll-interval range used by the settings API and the poller. */
export function clampPollInterval(value, fallback = 5000) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(60000, Math.max(2000, Math.round(number)))
}

/** Replace a home prefix with `~` for display. */
export function displayRemotePath(path, home) {
  const value = String(path ?? '')
  if (!home) return value
  if (value === home) return '~'
  if (value.startsWith(`${home}/`)) return `~${value.slice(home.length)}`
  return value
}

/** Turn arbitrary errors into a useful one-line message. */
export function errorText(error) {
  if (error instanceof Error) return error.message || String(error)
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/** Only keep JSON-friendly bytes: strips ANSI color escapes from logs. */
export function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return String(text ?? '').replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/gu, '')
}
