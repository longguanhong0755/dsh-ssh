import test from 'node:test'
import assert from 'node:assert/strict'
import { RemoteManager } from '../lib/remote.js'

// A pool whose exec answers from a queue and remembers every command, so the
// lock protocol (mkdir → holder → rm) is asserted shell-command by command.
function poolWith(responses) {
  const calls = []
  return {
    calls,
    async exec(host, command) {
      calls.push(command)
      if (responses.length === 0) throw new Error(`unexpected exec: ${command}`)
      return { stdout: responses.shift(), stderr: '', code: 0 }
    }
  }
}

function manager(pool) {
  return new RemoteManager({ dshHome: '/tmp/dsh-e2e', pool, store: {} })
}

const HOST = { id: 'host-1', name: 'dev-1', host: '10.0.0.1' }
const ROOT = '/home/u/.dsh-remote/runtime'

test('acquireInstallLock marks the host as updating until release', async () => {
  const pool = poolWith(['@@ACQUIRED@@\n', ''])
  const remote = manager(pool)
  const lock = await remote.acquireInstallLock(HOST, ROOT, '0.2.1')
  assert.match(pool.calls[0], /^mkdir -p /u)
  assert.match(pool.calls[0], /mkdir "\$lock" 2>\/dev\/null/u)
  assert.match(pool.calls[0], /started=%s\\nversion=%s/u)
  assert.deepEqual(
    { version: remote.installing.get('host-1').version, started: Boolean(remote.installing.get('host-1').startedAt) },
    { version: '0.2.1', started: true }
  )
  await lock.release()
  assert.match(pool.calls[1], /^rm -rf/u)
  assert.equal(remote.installing.has('host-1'), false)
})

test('a live holder reports source-server-update-in-progress instead of racing it', async () => {
  const pool = poolWith(['started=1700000000\nversion=0.1.0\n@@LOCK-END@@\nage=42\n'])
  const remote = manager(pool)
  await assert.rejects(
    remote.acquireInstallLock(HOST, ROOT, '0.2.1'),
    (error) => {
      assert.equal(error.code, 'source-server-update-in-progress')
      assert.equal(error.message, '远程设备正在更新远端服务')
      assert.equal(error.reason, '这次连接没有发起。等更新完成后点击重试。')
      assert.equal(error.hostVersion, '0.1.0')
      assert.equal(error.ageSec, 42)
      return true
    }
  )
  // A refused acquisition must not leave the device flagged as updating.
  assert.equal(remote.installing.size, 0)
  assert.equal(pool.calls.length, 1)
})

test('a stale holder is taken over once', async () => {
  const pool = poolWith([
    'started=1\nversion=0.1.0\n@@LOCK-END@@\nage=4000\n',
    '',
    '@@ACQUIRED@@\n',
    ''
  ])
  const remote = manager(pool)
  const lock = await remote.acquireInstallLock(HOST, ROOT, '0.2.1')
  assert.match(pool.calls[1], /^rm -rf/u)
  assert.match(pool.calls[2], /mkdir "\$lock"/u)
  assert.equal(remote.installing.get('host-1').version, '0.2.1')
  await lock.release()
  assert.equal(remote.installing.has('host-1'), false)
})

test('a holder without a start time is treated as live', async () => {
  const pool = poolWith(['@@LOCK-END@@\nage=0\n'])
  const remote = manager(pool)
  await assert.rejects(
    remote.acquireInstallLock(HOST, ROOT, '0.2.1'),
    (error) => error.code === 'source-server-update-in-progress'
  )
  assert.equal(pool.calls.length, 1)
})

test('a failed mkdir with no lock directory is a real error, not an update', async () => {
  const pool = poolWith(['@@LOCK-ERROR@@\n'])
  const remote = manager(pool)
  await assert.rejects(
    remote.acquireInstallLock(HOST, ROOT, '0.2.1'),
    (error) => {
      assert.equal(error.code, undefined)
      assert.match(error.message, /无法在 .* 创建安装锁/u)
      return true
    }
  )
  assert.equal(remote.installing.size, 0)
})

test('missing lock status output is reported as such', async () => {
  const pool = poolWith([''])
  const remote = manager(pool)
  await assert.rejects(
    remote.acquireInstallLock(HOST, ROOT, '0.2.1'),
    /主机没有返回锁状态/u
  )
})

test('detectInstalledRuntime reads the newest deployed version', async () => {
  const pool = poolWith(['0.2.1\n'])
  const remote = manager(pool)
  assert.equal(await remote.detectInstalledRuntime(HOST, ROOT), '0.2.1')
  assert.match(pool.calls[0], /ls -1d .*\/dsh-\* .*sort -V \| tail -1/u)
})

test('detectInstalledRuntime answers empty when nothing is deployed', async () => {
  const pool = poolWith([''])
  const remote = manager(pool)
  assert.equal(await remote.detectInstalledRuntime(HOST, ROOT), '')
})
