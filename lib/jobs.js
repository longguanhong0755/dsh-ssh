// In-memory progress jobs for long remote operations (npm install, service
// restart). The client polls a job by id and renders its log lines.

import { errorText, nowIso, randomId } from './util.js'

const MAX_LINES = 4000

export class JobManager {
  constructor({ log = () => {} } = {}) {
    this.jobs = new Map()
    this.log = log
  }

  start(title, run) {
    const id = randomId('job')
    const job = {
      id,
      title,
      state: 'running',
      lines: [],
      result: null,
      error: '',
      startedAt: nowIso(),
      endedAt: null
    }
    this.jobs.set(id, job)
    const append = (line) => {
      const text = String(line ?? '')
      for (const row of text.replace(/\r\n/gu, '\n').split('\n')) {
        if (row.trim() === '') continue
        job.lines.push(row)
      }
      if (job.lines.length > MAX_LINES) job.lines.splice(0, job.lines.length - MAX_LINES)
    }
    Promise.resolve()
      .then(() => run(append))
      .then((result) => {
        job.state = 'succeeded'
        job.result = result
        append('完成')
      })
      .catch((error) => {
        job.state = 'failed'
        job.error = errorText(error)
        append(`失败: ${job.error}`)
        this.log('warn', `[ssh-remote] job ${id} (${title}) failed: ${job.error}`)
      })
      .finally(() => {
        job.endedAt = nowIso()
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
      startedAt: job.startedAt,
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
