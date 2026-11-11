import test from 'node:test'
import assert from 'node:assert/strict'
import { RemoteManager } from '../lib/remote.js'

function manager() {
  return new RemoteManager({ dshHome: '/tmp/dsh-e2e', pool: {}, store: {} })
}

test('withHostLock serializes work and keeps the queue drainable', async () => {
  const remote = manager()
  const events = []
  let releaseFirst
  const first = remote.withHostLock('create:host-1', async () => {
    events.push('a:in')
    await new Promise((resolve) => { releaseFirst = resolve })
    events.push('a:out')
    return 'a'
  })
  await new Promise((resolve) => setTimeout(resolve, 10))
  const second = remote.withHostLock('create:host-1', async () => {
    events.push('b:in')
    return 'b'
  })
  await new Promise((resolve) => setTimeout(resolve, 10))
  // The second create must not allocate a port while the first one is still
  // between "allocated" and "persisted".
  assert.deepEqual(events, ['a:in'])
  releaseFirst()
  assert.equal(await first, 'a')
  assert.equal(await second, 'b')
  assert.deepEqual(events, ['a:in', 'a:out', 'b:in'])
  assert.equal(remote.hostLocks.size, 0)
})

test('withHostLock releases the queue when a holder throws', async () => {
  const remote = manager()
  await assert.rejects(remote.withHostLock('create:host-1', async () => {
    throw new Error('deploy failed')
  }), /deploy failed/u)
  assert.equal(await remote.withHostLock('create:host-1', async () => 'next'), 'next')
  assert.equal(remote.hostLocks.size, 0)
})

test('withHostLock does not serialize different hosts', async () => {
  const remote = manager()
  let release
  const blocked = remote.withHostLock('create:host-1', () => new Promise((resolve) => { release = () => resolve('one') }))
  const other = await remote.withHostLock('create:host-2', async () => 'two')
  assert.equal(other, 'two')
  release()
  assert.equal(await blocked, 'one')
})
