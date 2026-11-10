// A retry after a failed attempt must not reuse the closed turn's number: the
// anchor log keys turns by value, and a second `turn/start` for the same number
// is what broke session-3628add6 with
// "turn/start does not open the expected turn".
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionBridge } from '../lib/bridge.js'
import { planTurnNumber } from '../lib/bridge/turns.js'

function createAgent() {
  const events = []
  let seq = 0
  return {
    events,
    session: {
      append(type, data) {
        seq += 1
        const event = { type, seq, data }
        events.push(event)
        return event
      }
    },
    dispatch: { emit() {} },
    ctx: { emit() {} }
  }
}

function createState(agent, extra = {}) {
  return {
    localSessionId: 'local',
    agent,
    workspace: { id: 'ws', name: 'ui', remotePath: '/remote', wsRoot: '/remote/.dsh-remote' },
    host: { id: 'host' },
    remoteSessionId: 'remote',
    running: false,
    cancelled: false,
    queue: [],
    closed: false,
    generation: 0,
    turn: 5,
    remoteTurn: 0,
    remoteStep: 0,
    turnOpen: false,
    stepOpen: false,
    sdk: null,
    stream: null,
    ...extra
  }
}

/** Every collaborator a cold launch would touch, replaced by a no-op. */
function createBridge(root) {
  const bridge = new SessionBridge({ pool: {}, store: { root, settings: {} }, manager: {}, log: () => {} })
  bridge.emitAgentStatus = () => {}
  bridge.startSdkHeartbeat = () => {}
  bridge.clearStreamWatchdog = () => {}
  bridge.armStreamWatchdog = () => {}
  bridge.syncWorkspaceRuntime = async () => false
  bridge.retireStaleRunners = async () => {}
  bridge.retireRunners = async () => {}
  bridge.applyModel = async () => {}
  bridge.mirrorResolvedModel = () => {}
  bridge.sdkUsable = () => false
  bridge.ensureProfile = async () => {}
  bridge.launch = async () => {}
  bridge.startTail = async () => {}
  return bridge
}

test('a retry of a closed turn takes the next number', () => {
  const plan = planTurnNumber({ turn: 48, remoteTurn: 33 }, { retry: true, wasOpen: false })
  assert.deepEqual(plan, { turn: 49, remoteTurn: 0 })
})

test('a retry of a turn that is still open keeps its number', () => {
  const plan = planTurnNumber({ turn: 48, remoteTurn: 33 }, { retry: true, wasOpen: true })
  assert.deepEqual(plan, { turn: 48, remoteTurn: 33 })
})

test('a fresh turn always advances', () => {
  assert.deepEqual(planTurnNumber({ turn: 48, remoteTurn: 33 }, { retry: false, wasOpen: true }), {
    turn: 49,
    remoteTurn: 0
  })
})

test('a failed attempt then its retry leaves one turn per number', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-turn-number-'))
  try {
    const bridge = createBridge(root)
    const agent = createAgent()
    // Turn 5 was already opened by an earlier attempt and then failed.
    const state = createState(agent, { turnOpen: true, stepOpen: false, remoteTurn: 5 })
    bridge.failTurn(state, '远程会话发送失败：boom')
    assert.equal(state.turn, 5)
    assert.equal(state.turnOpen, false)

    await bridge.startTurn(state, { text: 'retry', input: null }, { retry: true })
    assert.equal(state.turn, 6)
    bridge.consumeStatus(state, { phase: 'turn_start', step: 0 })

    const turns = agent.events.filter((event) => event.type === 'turn/start').map((event) => event.data.turn)
    // Turn 5 was closed by failTurn; the retry opens its own, never a second 5.
    assert.deepEqual(turns, [6])
    const ends = agent.events.filter((event) => event.type === 'turn/end').map((event) => event.data.turn)
    assert.deepEqual(ends, [5])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a retry that continues an open turn reuses it instead of duplicating it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-turn-reuse-'))
  try {
    const bridge = createBridge(root)
    const agent = createAgent()
    const state = createState(agent, { turnOpen: true, remoteTurn: 5 })
    await bridge.startTurn(state, { text: 'retry', input: null }, { retry: true })
    assert.equal(state.turn, 5)
    bridge.consumeStatus(state, { phase: 'turn_start', step: 0 })
    const turns = agent.events.filter((event) => event.type === 'turn/start').map((event) => event.data.turn)
    // The reused turn is opened exactly once, with its original number.
    assert.deepEqual(turns, [5])
    assert.equal(state.turnOpen, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
