// A relaunched remote runner recreates out.jsonl. The tail must then read from
// byte 0 and tell the bridge to forget its saved offset, otherwise the next
// turn is silently dropped and reported as "runtime exited".
import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionBridge } from '../lib/bridge.js'

function createBridge(overrides = {}) {
  const bridge = new SessionBridge({
    pool: { async exec() { return { stdout: '', stderr: '', code: 0 } } },
    store: { root: 'C:\\tmp\\dsh-ssh-test', settings: {} },
    manager: {},
    log: () => {}
  })
  Object.assign(bridge, overrides)
  return bridge
}

function createState(extra = {}) {
  return {
    localSessionId: 'session-local',
    remoteSessionId: 'session-remote',
    host: { id: 'host' },
    workspace: { id: 'ws', wsRoot: '/root/.dsh-remote/workspaces/ws' },
    sdk: null,
    turn: 4,
    running: true,
    closed: false,
    offset: 0,
    byteBuffer: Buffer.alloc(0),
    eventsFile: '/root/.dsh-remote/workspaces/ws/bridge/s/sdk/out.jsonl',
    pidFile: '/root/.dsh-remote/workspaces/ws/bridge/s/sdk/runner.pid',
    calls: [],
    ...extra
  }
}

test('the tail falls back to byte 0 when the event log is shorter than the offset', () => {
  const bridge = createBridge()
  const state = createState({ offset: 5000 })
  const command = bridge.buildTailCommand(state)
  assert.match(command, /size=\$\(stat -c %s/u)
  assert.match(command, /if \[ "\$size" -lt 5000 \]; then start=1/u)
  assert.match(command, /tail -c \+\$start -f/u)
})

test('the tail keeps the saved offset while the log still covers it', () => {
  const bridge = createBridge()
  const command = bridge.buildTailCommand(createState({ offset: 0 }))
  assert.match(command, /if \[ "\$size" -lt 0 \]; then start=1/u)
  // No offset means "read everything", so the guard must not fire on size 0.
  assert.match(command, /else start=1; fi/u)
})

test('the reset marker clears the stale offset and partial line', () => {
  const bridge = createBridge()
  const state = createState({ offset: 9000, byteBuffer: Buffer.from('{"half":') })
  bridge.consumeFrame(state, { __bridge: 'tail-reset' })
  assert.equal(state.offset, 0)
  assert.equal(state.byteBuffer.length, 0)
})

test('the reset marker never reaches the event consumer', () => {
  const bridge = createBridge()
  const state = createState()
  const seen = []
  bridge.consumeEvent = (target, event) => seen.push(event)
  bridge.consumeFrame(state, { __bridge: 'tail-reset' })
  assert.deepEqual(seen, [])
})

test('a tail that reports a truncated log re-attaches instead of failing the turn', async () => {
  const bridge = createBridge()
  const state = createState({ offset: 1200, tailStderr: 'tail: /root/out.jsonl: file truncated' })
  const failures = []
  bridge.failTurn = (target, message) => failures.push(message)
  bridge.processAlive = async () => false
  bridge.readStderrTail = async () => ''
  bridge.startTail = async (target) => {
    target.stream = { close() {} }
    target.calls.push('tail')
  }
  await bridge.onStreamClosed(state, { code: 0 }, state.generation, true, state.sdk)
  assert.deepEqual(failures, [])
  assert.equal(state.offset, 0)
  assert.equal(state.tailResets, 1)
  assert.deepEqual(state.calls, ['tail'])
})

test('the re-attach is bounded so a broken log cannot spin', async () => {
  const bridge = createBridge()
  const state = createState({ tailResets: 2, tailStderr: 'tail: out.jsonl: file truncated' })
  const failures = []
  bridge.failTurn = (target, message) => failures.push(message)
  bridge.processAlive = async () => false
  bridge.readStderrTail = async () => 'tail: out.jsonl: file truncated'
  bridge.startTail = async () => { throw new Error('must not be called') }
  await bridge.onStreamClosed(state, { code: 0 }, state.generation, true, state.sdk)
  assert.equal(failures.length, 1)
  assert.match(failures[0], /runtime exited/u)
})
