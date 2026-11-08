import test from 'node:test'
import assert from 'node:assert/strict'
import { JobManager } from '../lib/jobs.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true
    await sleep(20)
  }
  return predicate()
}

test('a job that makes no progress fails on the idle watchdog', async () => {
  const manager = new JobManager()
  let signal = null
  const job = manager.start('空闲任务', async (append, options) => {
    signal = options.signal
    append('开始')
    await new Promise(() => {})
  }, { idleMs: 80 })
  assert.ok(await waitFor(() => job.state === 'failed'))
  assert.equal(job.timedOut, true)
  assert.match(job.error, /没有进展/u)
  assert.equal(signal.aborted, true)
  assert.ok(job.lines.some((line) => line.includes('失败')))
})

test('a job that never finishes fails on the total deadline and cannot flip to succeeded', async () => {
  const manager = new JobManager()
  const job = manager.start('超时任务', async () => {
    await sleep(200)
    return 'late'
  }, { timeoutMs: 60 })
  assert.ok(await waitFor(() => job.state === 'failed'))
  assert.match(job.error, /任务超时/u)
  // The underlying work resolves after the deadline: the state must stay failed.
  await sleep(250)
  assert.equal(job.state, 'failed')
  assert.equal(job.result, null)
})

test('activity resets the idle watchdog and a healthy job still succeeds', async () => {
  const manager = new JobManager()
  const job = manager.start('正常任务', async (append) => {
    for (let index = 0; index < 8; index += 1) {
      await sleep(40)
      append(`step ${index}`)
    }
    return 'ok'
  }, { idleMs: 120 })
  assert.ok(await waitFor(() => job.state === 'succeeded'))
  assert.equal(job.result, 'ok')
  assert.equal(job.endedAt !== null, true)
  assert.equal(manager.snapshot(job).lastActivityAt !== undefined, true)
})

test('a rejected job records the error text', async () => {
  const manager = new JobManager()
  const job = manager.start('失败任务', async () => {
    throw new Error('boom')
  })
  assert.ok(await waitFor(() => job.state === 'failed'))
  assert.match(job.error, /boom/u)
  assert.equal(job.timedOut, false)
})
