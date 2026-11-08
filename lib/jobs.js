// In-memory progress jobs for long remote operations (npm install, service
// restart). The client polls a job by id and renders its log lines.

import { errorText, nowIso, randomId } from './util.js'

const MAX_LINES = 4000

export class JobManager {
  constructor({ log = () => {} } = {}) {
    this.jobs = new Map()
    this.log = log
  }

  /**
   * `options.timeoutMs` caps the whole job; `options.idleMs` fails it when no
   * line was appended for that long. Both exist so a wedged remote operation
   * can never leave the dialog spinning at 「执行中…」 forever.
   */
  start(title, run, options = {}) {
    const id = randomId('job')
    const timeoutMs = Number(options.timeoutMs) || 0
    const idleMs = Number(options.idleMs) || 0
    const controller = new AbortController()
    const job = {
      id,
      title,
      state: 'running',
      lines: [],
      result: null,
      error: '',
      timedOut: false,
      startedAt: nowIso(),
      lastActivityAt: nowIso(),
      endedAt: null
    }
    this.jobs.set(id, job)
    let timer = null
    let idleTimer = null
    const stopWatchdogs = () => {
      if (timer) clearTimeout(timer)
      if (idleTimer) clearInterval(idleTimer)
      timer = null
      idleTimer = null
    }
    const append = (line) => {
      const text = String(line ?? '')
      for (const row of text.replace(/\r\n/gu, '\n').split('\n')) {
        if (row.trim() === '') continue
        job.lines.push(row)
      }
      job.lastActivityAt = nowIso()
      if (job.lines.length > MAX_LINES) job.lines.splice(0, job.lines.length - MAX_LINES)
    }
    const settle = (state, patch = {}) => {
      if (job.state !== 'running') return false
      job.state = state
      Object.assign(job, patch)
      job.endedAt = nowIso()
      stopWatchdogs()
      return true
    }
    const expire = (message) => {
      if (!settle('failed', { error: message, timedOut: true })) return
      append(`失败: ${message}`)
      this.log('warn', `[ssh-remote] job ${id} (${title}) timed out: ${message}`)
      try { controller.abort() } catch { /* ignore */ }
    }
    if (timeoutMs > 0) {
      timer = setTimeout(() => expire(`任务超时（${Math.round(timeoutMs / 60000)} 分钟未完成）`), timeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
    }
    if (idleMs > 0) {
      idleTimer = setInterval(() => {
        const idleFor = Date.now() - Date.parse(job.lastActivityAt)
        if (idleFor >= idleMs) expire(`任务超过 ${Math.round(idleMs / 60000)} 分钟没有进展`)
      }, Math.min(Math.max(Math.floor(idleMs / 4), 100), 60000))
      if (typeof idleTimer.unref === 'function') idleTimer.unref()
    }
    Promise.resolve()
      .then(() => run(append, { signal: controller.signal }))
      .then((result) => {
        // A timed-out job must not flip back to succeeded when the remote
        // operation finally returns.
        if (!settle('succeeded', { result })) return
        append('完成')
      })
      .catch((error) => {
        if (!settle('failed', { error: errorText(error) })) return
        append(`失败: ${job.error}`)
        this.log('warn', `[ssh-remote] job ${id} (${title}) failed: ${job.error}`)
      })
      .finally(() => {
        // Covers a run that resolves before its watchdogs were armed.
        stopWatchdogs()
        if (!job.endedAt) job.endedAt = nowIso()
      })
    return job
  }

  get(id) {
    return this.jobs.get(id) || null
  }

  snapshot(job) {
    if (!job) return null
    return {
      id: job.id,
      title: job.title,
      state: job.state,
      lines: job.lines.slice(-400),
      result: job.result,
      error: job.error,
      timedOut: job.timedOut,
      startedAt: job.startedAt,
      lastActivityAt: job.lastActivityAt,
      endedAt: job.endedAt
    }
  }

  dispose() {
    for (const job of this.jobs.values()) {
      if (job.state === 'running') {
        job.state = 'cancelled'
        job.endedAt = nowIso()
      }
    }
    this.jobs.clear()
  }
}
