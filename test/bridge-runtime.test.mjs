// A workspace record embeds absolute node/dsh paths. `/compact` is forwarded
// with `session/query`, which dsh only grew in 0.2.2; a workspace still pinned
// to 0.2.1-rc.5 must be retargeted before its runner boots, and the runner
// started from the old build must be retired.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionBridge } from '../lib/bridge.js'

function createBridge(root, { settings = {}, manager = {}, pool = {} } = {}) {
  return new SessionBridge({ pool, store: { root, settings }, manager, log: () => {} })
}

function createState(workspace, extra = {}) {
  return {
    localSessionId: 'local',
    agent: {},
    workspace,
    host: { id: 'host' },
    remoteSessionId: 'remote',
    running: false,
    compacting: false,
    compactForwarding: false,
    remoteCompaction: null,
    sdk: null,
    stream: null,
    sdkPending: new Map(),
    queue: [],
    closed: false,
    turn: 1,
    // A live chat always carries the route its picker resolved; `/compact` adopts
    // it before the runtime boots, so the fixture must carry one too.
    model: { key: 'model-key', provider: 'deepseek', model: 'deepseek-v4.1-flash' },
    modelKey: 'model-key',
    ...extra
  }
}

test('a stale workspace is retargeted to the configured runtime once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-runtime-'))
  try {
    const workspace = { id: 'ws', name: 'demo', dshVersion: '0.2.1-rc.5' }
    const calls = []
    const bridge = createBridge(root, {
      settings: { dshVersion: '0.2.2-rc.1' },
      manager: {
        async refreshWorkspaceRuntime(host, target, options) {
          calls.push({ host, target, options })
          target.dshVersion = '0.2.2-rc.1'
          return true
        }
      }
    })
    const state = createState(workspace)
    assert.equal(await bridge.syncWorkspaceRuntime(state), true)
    // The record now matches settings, so later turns do no remote work.
    assert.equal(await bridge.syncWorkspaceRuntime(state), false)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].host.id, 'host')
    assert.equal(typeof calls[0].options.onLog, 'function')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a host without the configured build is re-probed only after the cooldown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-runtime-'))
  try {
    let calls = 0
    const bridge = createBridge(root, {
      settings: { dshVersion: '0.2.2-rc.1' },
      manager: {
        async refreshWorkspaceRuntime() {
          calls += 1
          return false
        }
      }
    })
    const state = createState({ id: 'ws', name: 'demo', dshVersion: '0.2.1-rc.5' })
    assert.equal(await bridge.syncWorkspaceRuntime(state), false)
    assert.equal(await bridge.syncWorkspaceRuntime(state), false)
    assert.equal(calls, 1)
    assert.equal(state.workspace.dshVersion, '0.2.1-rc.5')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a runtime switch retires the old sdk runner before the next boot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-runtime-'))
  try {
    const workspace = { id: 'ws', name: 'demo', dshVersion: '0.2.1-rc.5' }
    const bridge = createBridge(root, {
      settings: { dshVersion: '0.2.2-rc.1' },
      manager: {
        async refreshWorkspaceRuntime(host, target) {
          target.dshVersion = '0.2.2-rc.1'
          return true
        }
      }
    })
    const state = createState(workspace, { sdk: { ready: true, pidFile: '/tmp/pid' } })
    const events = []
    bridge.killSdk = async (target) => {
      events.push('kill')
      target.sdk = null
    }
    bridge.bootSdk = async (target) => {
      events.push(`boot:${target.workspace.dshVersion}`)
      target.sdk = { ready: true }
    }
    bridge.startTail = async () => {}
    bridge.sdkCall = async (_target, method) => {
      events.push(`call:${method}`)
      return { kind: 'command', execution: { result: { kind: 'success', text: 'No compactable history yet.' } } }
    }
    const returned = await bridge.runRemoteCompact(state)
    assert.equal(returned, null)
    assert.deepEqual(events, ['kill', 'boot:0.2.2-rc.1', 'call:session/query'])
    assert.equal(state.compactForwarding, false)
    assert.equal(state.remoteCompaction, null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a chat that did not perform the switch also retires its old runner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-runtime-'))
  try {
    // Another chat already performed the switch, so no settings probe runs for
    // this one; its own runner still has to move to the new build.
    const workspace = { id: 'ws', name: 'demo', dshVersion: '0.2.2-rc.1', dshBin: '/new/bin.js' }
    const bridge = createBridge(root)
    let killed = 0
    bridge.killSdk = async (target) => {
      killed += 1
      target.sdk = null
    }
    const state = createState(workspace, {
      sdk: { ready: true, dshVersion: '0.2.1-rc.5', pidFile: '/tmp/pid' }
    })
    assert.equal(await bridge.retireStaleRunners(state), true)
    assert.equal(killed, 1)
    assert.equal(state.sdk, null)
    // Same build: nothing to do.
    state.sdk = { ready: true, dshVersion: '0.2.2-rc.1' }
    assert.equal(await bridge.retireStaleRunners(state), false)
    assert.equal(killed, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a journal-restored runner is stale when its command line names another build', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-runtime-'))
  try {
    const workspace = { id: 'ws', name: 'demo', dshBin: '/runtime/dsh-0.2.2-rc.1/node_modules/@deepseek-ai/dsh/lib/bin.js' }
    let output = 'node /runtime/dsh-0.2.1-rc.5/node_modules/@deepseek-ai/dsh/lib/bin.js --profile sdk'
    const bridge = createBridge(root, {
      pool: { async exec() { return { stdout: output } } }
    })
    const state = createState(workspace, { pidFile: '/tmp/pid' })
    assert.equal(await bridge.sdkRunsWorkspaceRuntime(state), false)
    output = `node ${workspace.dshBin} --profile sdk`
    assert.equal(await bridge.sdkRunsWorkspaceRuntime(state), true)
    // Unreadable command line: keep the runner; the in-memory version check
    // still covers a launch from this process.
    output = ''
    assert.equal(await bridge.sdkRunsWorkspaceRuntime(state), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the sdk watchdog is re-armed against the runner and its stderr log', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-runtime-'))
  try {
    const calls = []
    const bridge = createBridge(root, {
      pool: {
        async exec(host, command) {
          calls.push({ host, command })
          return { code: 0, stdout: '' }
        }
      }
    })
    const state = createState({ id: 'ws', name: 'demo' }, {
      sdk: {
        watchdogScript: '/ws/sdk/watchdog.sh',
        pidFile: '/ws/sdk/runner.pid',
        watchdogFile: '/ws/sdk/watchdog.pid',
        errFile: '/ws/sdk/err.log'
      }
    })
    await bridge.armSdkWatchdog(state)
    assert.equal(calls.length, 1)
    const command = calls[0].command
    // The watchdog must know which process it guards, where to publish its
    // own pid, and where to explain a kill when it fires.
    assert.match(command, /watchdog\.sh/u)
    assert.match(command, /runner\.pid/u)
    assert.match(command, /watchdog\.pid/u)
    assert.match(command, /err\.log/u)
    assert.match(command, /kill -TERM/u)
    // A dead/absent runtime marker means there is nothing to arm yet.
    state.sdk = null
    await bridge.armSdkWatchdog(state)
    assert.equal(calls.length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the sdk watchdog heartbeat starts per turn and stops on settle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-runtime-'))
  try {
    const bridge = createBridge(root)
    const state = createState({ id: 'ws', name: 'demo' })
    bridge.startSdkHeartbeat(state)
    assert.ok(state.sdkHeartbeat)
    bridge.startSdkHeartbeat(state)
    assert.ok(state.sdkHeartbeat)
    bridge.stopSdkHeartbeat(state)
    assert.equal(state.sdkHeartbeat, null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a turn the remote starts on its own is adopted instead of streaming idle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-runtime-'))
  try {
    const appended = []
    const bridge = createBridge(root)
    const state = createState({ id: 'ws', name: 'demo' }, {
      agent: {
        session: {
          append(type, data) {
            const event = { type, data, seq: appended.length + 1 }
            appended.push(event)
            return event
          }
        }
      },
      turn: 4,
      offset: 0,
      byteBuffer: Buffer.alloc(0),
      sdk: { ready: true, reused: false }
    })
    bridge.sdkSessionEvent(state, { type: 'turn/start', data: { turn: 12 } })
    assert.equal(state.running, true)
    // The local numbering continues after the last closed turn.
    assert.equal(state.turn, 5)
    assert.equal(state.remoteTurn, 5)
    assert.ok(state.idlePromise)
    assert.equal(typeof state.idleResolve, 'function')
    assert.ok(state.sdkHeartbeat)
    assert.deepEqual(appended.map((event) => [event.type, event.data.turn]), [['turn/start', 5]])
    const saved = bridge.journal.local.active
    assert.equal(saved.inTurn, true)
    assert.equal(saved.turn, 5)
    // A second turn/start for the same open turn must not move the counter.
    bridge.sdkSessionEvent(state, { type: 'turn/start', data: { turn: 12 } })
    assert.equal(state.turn, 5)
    assert.equal(appended.length, 1)
    // While the adopted turn runs its byte offset is persisted, so a reload
    // resumes after it instead of replaying the whole turn.
    bridge.consumeBytes(state, Buffer.from('{"type":"status","phase":"step_start","turn":5,"step":1}\n'))
    assert.ok(bridge.journal.local.active.offset > 0)
    bridge.stopSdkHeartbeat(state)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

function appendRecorder() {
  const appended = []
  return {
    appended,
    agent: {
      session: {
        append(type, data) {
          const event = { type, data, seq: appended.length + 1 }
          appended.push(event)
          return event
        }
      }
    }
  }
}

test('a resume in the middle of a turn is adopted and its steps renumbered', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-runtime-'))
  try {
    const { appended, agent } = appendRecorder()
    const bridge = createBridge(root)
    const state = createState({ id: 'ws', name: 'demo' }, {
      agent,
      turn: 4,
      offset: 0,
      byteBuffer: Buffer.alloc(0),
      // The saved offset sits after this turn's `turn/start` (the runtime was
      // reattached mid-turn), so no start marker is left to trigger adoption.
      sdk: { ready: true, reused: true }
    })
    bridge.sdkSessionEvent(state, { type: 'step/start', data: { turn: 23, step: 10 } })
    assert.equal(state.running, true)
    // The anchor's turn starts at step 1 while the remote is at step 10.
    assert.equal(state.turn, 5)
    assert.equal(state.remoteTurn, 5)
    assert.equal(state.stepBase, 9)
    assert.deepEqual(
      appended.map((event) => [event.type, event.data.turn, event.data.step]),
      [['turn/start', 5, undefined], ['step/start', 5, 1]]
    )
    assert.equal(bridge.journal.local.active.stepBase, 9)
    assert.equal(bridge.journal.local.active.step, 1)
    // Later steps keep counting from the local base.
    bridge.sdkSessionEvent(state, {
      type: 'assistant/message',
      data: { turn: 23, step: 10, message: { content: [{ type: 'text', text: 'hi' }] } }
    })
    bridge.sdkSessionEvent(state, { type: 'step/end', data: { turn: 23, step: 10 } })
    bridge.sdkSessionEvent(state, { type: 'step/start', data: { turn: 23, step: 11 } })
    assert.deepEqual(
      appended.map((event) => [event.type, event.data.turn, event.data.step]),
      [
        ['turn/start', 5, undefined],
        ['step/start', 5, 1],
        ['assistant/message', 5, 1],
        ['step/end', 5, 1],
        ['step/start', 5, 2]
      ]
    )
    bridge.stopSdkHeartbeat(state)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an open anchor turn is continued instead of opened a second time', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-runtime-'))
  try {
    const { appended, agent } = appendRecorder()
    const bridge = createBridge(root)
    const state = createState({ id: 'ws', name: 'demo' }, {
      agent,
      turn: 5,
      remoteTurn: 5,
      remoteStep: 12,
      turnOpen: true,
      stepOpen: false,
      offset: 0,
      byteBuffer: Buffer.alloc(0),
      sdk: { ready: true, reused: true }
    })
    bridge.sdkSessionEvent(state, { type: 'step/start', data: { turn: 23, step: 13 } })
    assert.equal(state.running, true)
    assert.equal(state.turn, 5)
    assert.equal(state.remoteStep, 13)
    // No second turn/start: the anchor's open turn keeps its numbering.
    assert.deepEqual(
      appended.map((event) => [event.type, event.data.turn, event.data.step]),
      [['step/start', 5, 13]]
    )
    bridge.stopSdkHeartbeat(state)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a turn end replayed while idle does not open a turn just to close it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-runtime-'))
  try {
    const { appended, agent } = appendRecorder()
    const bridge = createBridge(root)
    const state = createState({ id: 'ws', name: 'demo' }, {
      agent,
      turn: 29,
      turnOpen: false,
      offset: 0,
      byteBuffer: Buffer.alloc(0),
      sdk: { ready: true, reused: true }
    })
    // This is what corrupted the anchor: an already settled turn's end used to
    // append turn/start 29 again, which dsh rejects for the whole log.
    bridge.sdkSessionEvent(state, { type: 'turn/end', data: { turn: 23, reason: { kind: 'completed' } } })
    assert.equal(state.running, false)
    assert.equal(appended.length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the attach scan recovers the open turn step and unresolved calls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-runtime-'))
  try {
    const bridge = createBridge(root)
    const agent = {
      session: {
        snapshotEvents: () => [
          { type: 'turn/start', data: { turn: 3 }, seq: 0 },
          { type: 'step/start', data: { turn: 3, step: 1 }, seq: 1 },
          { type: 'assistant/message', data: { turn: 3, step: 1 }, seq: 2 },
          { type: 'tool/call', data: { turn: 3, step: 1, callId: 'a' }, seq: 3 },
          { type: 'step/end', data: { turn: 3, step: 1 }, seq: 4 },
          { type: 'step/start', data: { turn: 3, step: 2 }, seq: 5 },
          { type: 'tool/call', data: { turn: 3, step: 2, callId: 'b' }, seq: 6 }
        ]
      }
    }
    const local = bridge.lastLocalTurn(agent)
    assert.deepEqual(
      [local.turn, local.open, local.step, local.stepOpen],
      [3, true, 2, true]
    )
    assert.deepEqual([...local.calls], [['b', { seq: 6, step: 2 }]])
    // A closed turn reports no open step and no calls.
    agent.session.snapshotEvents = () => [
      { type: 'turn/start', data: { turn: 3 }, seq: 0 },
      { type: 'step/start', data: { turn: 3, step: 1 }, seq: 1 },
      { type: 'step/end', data: { turn: 3, step: 1 }, seq: 2 },
      { type: 'turn/end', data: { turn: 3 }, seq: 3 }
    ]
    const closed = bridge.lastLocalTurn(agent)
    assert.deepEqual([closed.open, closed.step, closed.stepOpen], [false, 0, false])
    assert.equal(closed.calls.size, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
// The corruption this guards: the remote numbers a session's steps, the anchor
// numbers a turn's steps. Mirroring a remote status frame verbatim wrote
// `step/end 37/51` into an anchor whose turn 37 had only reached step 1, and dsh
// refused the whole session with "step/end does not match an open turn and step"
// -- the chat's history then failed to load.
test('remote step numbers never leak into the anchor log', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-runtime-'))
  try {
    const { appended, agent } = appendRecorder()
    const bridge = createBridge(root)
    const state = createState({ id: 'ws', name: 'demo' }, {
      agent,
      turn: 37,
      remoteTurn: 37,
      running: true,
      turnOpen: true,
      stepOpen: true,
      remoteStep: 1,
      offset: 0,
      byteBuffer: Buffer.alloc(0),
      sdk: { ready: true, reused: true }
    })
    bridge.consumeStatus(state, { phase: 'step_end', turn: 12, step: 51 })
    bridge.consumeStatus(state, { phase: 'step_start', turn: 12, step: 52 })
    bridge.consumeStatus(state, { phase: 'step_end', turn: 12, step: 52 })
    bridge.consumeStatus(state, { phase: 'step_start', turn: 12, step: 53 })
    bridge.consumeStatus(state, { phase: 'step_end', turn: 12, step: 53 })
    bridge.consumeStatus(state, { phase: 'turn_end', turn: 12, reason: { kind: 'completed' } })
    assert.deepEqual(
      appended.map((event) => [event.type, event.data.turn, event.data.step]),
      [
        ['step/end', 37, 1],
        ['step/start', 37, 2],
        ['step/end', 37, 2],
        ['step/start', 37, 3],
        ['step/end', 37, 3],
        ['turn/end', 37, undefined]
      ]
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// The second corruption: a replayed status frame for the step that is already
// open used to append a second `step/start` with the same number.
test('a replayed step status does not open a duplicate step', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-runtime-'))
  try {
    const { appended, agent } = appendRecorder()
    const bridge = createBridge(root)
    const state = createState({ id: 'ws', name: 'demo' }, {
      agent,
      turn: 2,
      remoteTurn: 2,
      running: true,
      turnOpen: true,
      stepOpen: true,
      stepOptimistic: false,
      remoteStep: 1,
      rawOpenStep: 12,
      offset: 0,
      byteBuffer: Buffer.alloc(0),
      sdk: { ready: true, reused: true }
    })
    bridge.consumeStatus(state, { phase: 'step_start', turn: 9, step: 12 })
    assert.deepEqual(appended.map((event) => event.type), [])
    assert.equal(state.remoteStep, 1)
    // The next remote step still advances the local counter by exactly one.
    bridge.consumeStatus(state, { phase: 'step_start', turn: 9, step: 13 })
    assert.deepEqual(
      appended.map((event) => [event.type, event.data.turn, event.data.step]),
      [['step/end', 2, 1], ['step/start', 2, 2]]
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})