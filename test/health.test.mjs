import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildHealth } from '../lib/health.js'
import { anchorPath } from '../lib/native.js'

async function makeStore(workspaces = []) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-health-'))
  const hosts = [{ id: 'h1', name: 'dev-1' }, { id: 'h2', name: 'dev-2' }]
  for (const workspace of workspaces) {
    await mkdir(anchorPath({ root }, workspace), { recursive: true })
  }
  return {
    root,
    hosts,
    workspaces,
    host: (id) => hosts.find((host) => host.id === id) || null
  }
}

function check(report, id) {
  return report.checks.find((item) => item.id === id)
}

test('a healthy plugin reports ok with anchors present', async () => {
  const workspace = { id: 'w1', name: 'proj', hostId: 'h1' }
  const store = await makeStore([workspace])
  const report = await buildHealth({
    store,
    bridge: { sessions: new Map(), journal: {} },
    ctx: { get: () => ({}) }
  })
  assert.equal(report.ok, true)
  assert.equal(check(report, 'store').state, 'ok')
  assert.equal(check(report, 'anchor').state, 'ok')
  assert.equal(check(report, 'bridge').state, 'ok')
  assert.equal(report.anchors.length, 1)
  assert.equal(report.anchors[0].present, true)
  assert.equal(report.bridge.sessions.length, 0)
})

test('a missing anchor directory and registry warn without failing the plugin', async () => {
  const workspace = { id: 'w1', name: 'proj', hostId: 'h1' }
  const store = await makeStore()
  const report = await buildHealth({
    store: { ...store, workspaces: [workspace] },
    bridge: { sessions: new Map(), journal: {} },
    ctx: { get: () => null }
  })
  assert.equal(check(report, 'anchor').state, 'warn')
  assert.match(check(report, 'anchor').detail, /registry 未就绪/u)
  assert.match(check(report, 'anchor').detail, /0\/1 个 anchor 目录存在/u)
  assert.equal(report.ok, true)
})

test('workspaces without a host are inconsistent and reported', async () => {
  const store = await makeStore([{ id: 'w1', name: 'proj', hostId: 'h1' }])
  const report = await buildHealth({
    store: { ...store, hosts: [] },
    bridge: { sessions: new Map(), journal: {} }
  })
  assert.equal(check(report, 'store').state, 'warn')
})

test('closed sessions are ignored and stale journal entries warn', async () => {
  const workspace = { id: 'w1', name: 'proj', hostId: 'h1' }
  const store = await makeStore([workspace])
  const sessions = new Map([
    ['s1', { localSessionId: 's1', workspace, running: true, turn: 3, closed: false }],
    ['s2', { localSessionId: 's2', workspace, running: false, closed: true }]
  ])
  const report = await buildHealth({
    store,
    bridge: { sessions, journal: { s9: { workspaceId: 'gone' } } }
  })
  assert.equal(report.bridge.sessions.length, 1)
  assert.equal(report.bridge.sessions[0].running, true)
  assert.deepEqual(report.bridge.stale.map((item) => item.workspaceId), ['gone'])
  assert.equal(check(report, 'bridge').state, 'warn')
  assert.match(check(report, 'bridge').detail, /残留 journal/u)
})

test('an SDK runner failure fails the health check', async () => {
  const store = await makeStore([])
  const report = await buildHealth({
    store,
    bridge: {
      sessions: new Map([
        ['s1', { localSessionId: 's1', workspace: { id: 'w1' }, sdk: {}, sdkFailed: true, closed: false }]
      ]),
      journal: {}
    }
  })
  assert.equal(report.ok, false)
  assert.equal(check(report, 'bridge').state, 'warn')
  assert.match(check(report, 'bridge').detail, /SDK 运行器失败/u)
  assert.equal(report.bridge.sessions[0].mode, 'sdk')
})

test('deep probes report each workspace state', async () => {
  const first = { id: 'w1', name: 'a', hostId: 'h1' }
  const second = { id: 'w2', name: 'b', hostId: 'h2' }
  const store = await makeStore([first, second])
  const manager = {
    status: async (host, workspace) => {
      if (workspace.id === 'w2') throw new Error('probe exploded')
      return { state: 'running', httpStatus: '204', pid: 4242 }
    }
  }
  const report = await buildHealth({ store, bridge: null, manager, deep: true })
  const runtime = check(report, 'runtime')
  assert.equal(runtime.state, 'warn')
  assert.match(runtime.detail, /1\/2 个工作区未运行/u)
  assert.deepEqual(
    runtime.workspaces.map((row) => [row.workspaceId, row.state]),
    [['w1', 'running'], ['w2', 'error']]
  )
  assert.equal(runtime.workspaces[0].pid, 4242)
  assert.equal(runtime.workspaces[1].error, 'probe exploded')
})

test('deep probes are bounded by the timeout', async () => {
  const store = await makeStore([{ id: 'w1', name: 'a', hostId: 'h1' }])
  const manager = { status: () => new Promise(() => {}) }
  const started = Date.now()
  const report = await buildHealth({ store, manager, deep: true, deepTimeoutMs: 30 })
  assert.ok(Date.now() - started < 2000)
  const runtime = check(report, 'runtime')
  assert.equal(runtime.workspaces[0].state, 'error')
  assert.match(runtime.workspaces[0].error, /probe timeout 30ms/u)
})

test('deep probes skip workspaces whose host is gone', async () => {
  const store = await makeStore([{ id: 'w1', name: 'a', hostId: 'gone' }])
  const report = await buildHealth({ store, manager: { status: async () => ({}) }, deep: true })
  const runtime = check(report, 'runtime')
  assert.equal(runtime.workspaces[0].state, 'skipped')
  assert.equal(runtime.workspaces[0].error, 'host missing')
})

test('ssh connection counts come from the transport pool', async () => {
  const store = await makeStore([])
  const pool = { ssh: { entries: new Map([['h1', { state: 'ready' }], ['h2', { state: 'connecting' }]]) } }
  const report = await buildHealth({ store, pool })
  const ssh = check(report, 'ssh')
  assert.equal(ssh.state, 'ok')
  assert.match(ssh.detail, /1\/2 条连接就绪/u)
})
