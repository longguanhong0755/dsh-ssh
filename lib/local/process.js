// Local target plumbing: process execution, output decoding and the
// discovery caches shared by the WSL and Docker backends.
// Split out of lib/local.js (verbatim) to keep every file readable.
import { spawn } from 'node:child_process'

export const WSL = 'wsl.exe'
export const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
export const DISCOVERY_TTL_MS = 5000
export const DEFAULT_TIMEOUT_MS = 120000
// ZCode 3.17.2's WSL identity probe marker (`__ZCODE_WSL_IDENTITY__`).
export const WSL_IDENTITY_MARKER = '__ZCODE_WSL_IDENTITY__'

// ── shared helpers ──────────────────────────────────────────────────────────

export function decodeBuffer(buffer) {
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

export function normalizeOutput(text) {
  return String(text ?? '').replaceAll('\0', '').replace(/^\uFEFF/u, '').replace(/\r/gu, '')
}

export function quoteShellArg(value) {
  return `'${String(value ?? '').replaceAll("'", `'"'"'`)}'`
}

export function timeoutError(timeoutMs) {
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

export function discoveryCache() {
  return { expiresAt: 0, promise: null }
}
