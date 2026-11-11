import test from 'node:test'
import assert from 'node:assert/strict'
import { RemoteManager } from '../lib/remote.js'

function workspace(id, overrides = {}) {
  return {
    id,
    serviceKind: 'setsid',
    pidFile: `/root/.dsh-remote/ws/${id}/dsh.pid`,
    port: 39080,
    logPath: `/root/.dsh-remote/ws/${id}/dsh.log`,
    desiredState: 'running',
    nodeBin: 'node',
    ...overrides
  }
}

function taggedBlock(index, { pid = 111, http = '200', uptime = 500 } = {}) {
  return [
    `@@WSS:${index}@@`,
    `@@SVC:${index}@@`,
    'ActiveState=active',
    'SubState=running',
    `MainPID=${pid}`,
    'NRestarts=0',
    `@@PID:${index}@@`,
    `${pid}@@UPTIME:${index}@@`,
    `uptime=${uptime}`,
    `@@HTTP:${index}@@`,
    http,
    `@@WSE:${index}@@`
  ].join('\n')
}

function plainBlock({ pid = 111, http = '200', uptime = 500 } = {}) {
  return [
    '@@SVC@@',
    'ActiveState=active',
    'SubState=running',
    `MainPID=${pid}`,
    'NRestarts=0',
    '@@PID@@',
    `${pid}@@UPTIME@@`,
    `uptime=${uptime}`,
    '@@HTTP@@',
    http
  ].join('\n')
}

function makeManager(stdout, error = null) {
  const calls = []
  const pool = {
    calls,
    async exec(host, command) {
      calls.push(command)
      if (error) throw error
      return { stdout, stderr: '', code: 0 }
    }
  }
  const saves = []
  const store = {
    save: async () => {
      saves.push(Date.now())
    }
  }
  const manager = new RemoteManager({ dshHome: '/tmp/dsh-e2e', pool, store })
  return { manager, pool, saves }
}

const HOST = { id: 'h1', name: 'dev-1' }

test('statusScript tags every marker when a tag is given', () => {
  const { manager } = makeManager('')
  const script = manager.statusScript(workspace('w1'), { tag: ':3', skipLog: true })
  for (const name of ['SVC', 'PID', 'UPTIME', 'HTTP']) {
    assert.ok(script.includes(`@@${name}:3@@`), `${name} marker missing`)
  }
  assert.ok(!script.includes('@@LOG:3@@'), 'log section must stay optional')
})

test('statusMany reports every workspace from one exec', async () => {
  HOST.connState = ''
  const first = workspace('w1')
  const second = workspace('w2', { port: 39081 })
  const { manager, pool, saves } = makeManager(`${taggedBlock(0)}\n${taggedBlock(1, { pid: 222 })}\n`)
  const statuses = await manager.statusMany(HOST, [first, second], { fresh: true })
  assert.equal(pool.calls.length, 1)
  assert.match(pool.calls[0], /@@WSS:0@@/u)
  assert.match(pool.calls[0], /@@WSS:1@@/u)
  assert.deepEqual(statuses.map((status) => [status.id, status.state, status.pid]), [
    ['w1', 'running', 111],
    ['w2', 'running', 222]
  ])
  assert.equal(first.lastStatus.state, 'running')
  assert.equal(second.lastStatus.pid, 222)
  // The batch already proved the connection, so the host is marked connected
  // and saved once instead of paying a second `printf ok`.
  assert.equal(HOST.connState, 'connected')
  assert.equal(saves.length, 1)
})

test('a missing workspace section becomes unreachable without spoiling the rest', async () => {
  const first = workspace('w1')
  const second = workspace('w2')
  const { manager } = makeManager(`${taggedBlock(0)}\n`)
  const statuses = await manager.statusMany(HOST, [first, second], { fresh: true })
  assert.equal(statuses[0].state, 'running')
  assert.equal(statuses[1].state, 'unreachable')
  assert.match(statuses[1].error, /没有返回该工作区/u)
})

test('a host-level exec failure marks every workspace unreachable', async () => {
  const host = { id: 'h2', name: 'dev-2', connState: 'connected' }
  const first = workspace('w1')
  const second = workspace('w2')
  const { manager, pool } = makeManager('', new Error('connection closed'))
  const statuses = await manager.statusMany(host, [first, second], { fresh: true })
  assert.equal(pool.calls.length, 1)
  assert.deepEqual(statuses.map((status) => status.state), ['unreachable', 'unreachable'])
  assert.equal(first.lastStatus.error, 'connection closed')
  assert.equal(host.connState, 'unreachable')
  assert.equal(host.connError, 'connection closed')
})

test('fresh=false reuses recent cached statuses and probes only the rest', async () => {
  const cached = workspace('w1')
  cached.lastStatus = { id: 'w1', state: 'stopped' }
  cached.lastStatusAt = Date.now()
  const stale = workspace('w2')
  const { manager, pool } = makeManager(plainBlock())
  const statuses = await manager.statusMany(HOST, [cached, stale], { fresh: false })
  assert.equal(pool.calls.length, 1)
  assert.equal(statuses[0], cached.lastStatus)
  assert.equal(statuses[1].state, 'running')
})

test('one workspace still goes through the shared status cache path', async () => {
  const only = workspace('w1')
  const { manager, pool } = makeManager('')
  // A cached value inside the 2.5 s window answers without any exec at all.
  only.lastStatus = { id: 'w1', state: 'running' }
  only.lastStatusAt = Date.now()
  const statuses = await manager.statusMany(HOST, [only], { fresh: false })
  assert.equal(pool.calls.length, 0)
  assert.equal(statuses[0].state, 'running')
})
