// A bridged chat only works while exactly one remote runtime answers its FIFO.
// These tests pin the repair ladder: refused requests are replayed exactly once
// after a repair, ambiguous failures (a timeout) are never replayed, and a
// duplicate or dead runtime is replaced instead of being trusted.
import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionBridge } from '../lib/bridge.js'
import { parseSdkOwnerPids, sdkOwnerScanCommand, sdkReapCommand } from '../lib/bridge/sdk-owner.js'

function createBridge(overrides = {}) {
  const bridge = new SessionBridge({
    pool: { async exec() { return { stdout: '', stderr: '', code: 0 } } },
    store: { root: 'C:\\tmp\\dsh-ssh-test', settings: {} },
    manager: {},
    log: () => {}
  })
  Object.assign(bridge, {
    async killSdk(state) { state.calls.push('kill') },
    async bootSdk(state) { state.calls.push('boot') },
    async sdkHandshake(state, options) { state.calls.push(`handshake:${options?.resume ? 'resume' : 'plain'}`) }
  }, overrides)
  return bridge
}

function createState(extra = {}) {
  return {
    localSessionId: 'session-local',
    remoteSessionId: 'session-remote',
    host: { id: 'host' },
    workspace: { id: 'ws', wsRoot: '/root/.dsh-remote/workspaces/ws', remotePath: '/root/ui-showcase' },
    model: { key: 'k', provider: 'p', model: 'm' },
    sdk: null,
    turn: 3,
    closed: false,
    calls: [],
    ...extra
  }
}

test('a prompt refused before it was queued is repaired and delivered once', async () => {
  const bridge = createBridge()
  const state = createState()
  const calls = []
  // The first attempt fails, the repair succeeds, the replay lands.
  let attempt = 0
  bridge.sdkCall = async (target, method) => {
    calls.push(method)
    attempt += 1
    if (attempt === 1) throw new Error('session/prompt: SDK server is not initialized')
    return { kind: 'turn', ok: true }
  }
  bridge.healSdk = async (target, reason) => { target.calls.push(`heal:${reason}`); return true }
  const result = await bridge.sdkPrompt(state, { sessionId: state.remoteSessionId, contentBlocks: [] })
  assert.equal(result.ok, true)
  assert.deepEqual(calls, ['session/prompt', 'session/prompt'])
  assert.equal(state.calls.filter((entry) => entry.startsWith('heal:')).length, 1)
  assert.match(state.calls[0], /heal:session\/prompt: SDK server is not initialized/u)
})

test('a timeout is never replayed because the prompt may already be queued', async () => {
  const bridge = createBridge()
  const state = createState()
  let attempts = 0
  bridge.sdkCall = async () => {
    attempts += 1
    throw new Error('sdk request timed out after 20000ms')
  }
  bridge.healSdk = async (target, reason) => { target.calls.push(`heal:${reason}`); return true }
  await assert.rejects(bridge.sdkPrompt(state, {}), /timed out/u)
  assert.equal(attempts, 1)
  assert.deepEqual(state.calls, [])
})

test('an unrelated failure is surfaced without touching the runtime', async () => {
  const bridge = createBridge()
  const state = createState()
  let attempts = 0
  bridge.sdkCall = async () => {
    attempts += 1
    throw new Error('unknown method: session/query')
  }
  bridge.healSdk = async (target, reason) => { target.calls.push(`heal:${reason}`); return true }
  await assert.rejects(bridge.sdkRequest(state, 'session/query', {}), /unknown method/u)
  assert.equal(attempts, 1)
  assert.deepEqual(state.calls, [])
})

test('a repair that cannot finish rethrows the original error', async () => {
  const bridge = createBridge()
  const state = createState()
  let attempts = 0
  bridge.sdkCall = async () => {
    attempts += 1
    throw new Error('sdk runtime is not running')
  }
  bridge.healSdk = async (target, reason) => { target.calls.push(`heal:${reason}`); return false }
  await assert.rejects(bridge.sdkPrompt(state, {}), /sdk runtime is not running/u)
  assert.equal(attempts, 1)
})

test('the compaction route is repaired by the same ladder', async () => {
  const bridge = createBridge()
  const state = createState()
  let attempt = 0
  bridge.sdkCall = async () => {
    attempt += 1
    if (attempt === 1) throw new Error('sdk request failed (exit 9)')
    return { kind: 'command' }
  }
  bridge.healSdk = async (target, reason) => { target.calls.push(`heal:${reason}`); return true }
  const result = await bridge.sdkRequest(state, 'session/query', {}, 1000)
  assert.equal(result.kind, 'command')
  assert.equal(state.calls.length, 1)
  assert.match(state.calls[0], /exit 9/u)
})

test('one live runtime is re-handshaken instead of being rebooted', async () => {
  const bridge = createBridge({
    async sdkOwnerPids() { return [4242] },
    async processAlive() { return true }
  })
  const state = createState({ sdk: { ready: true } })
  assert.equal(await bridge.healSdk(state, 'not initialized'), true)
  assert.deepEqual(state.calls, ['handshake:resume'])
})

test('two processes on one chat are reaped and replaced', async () => {
  const bridge = createBridge({
    async sdkOwnerPids() { return [4242, 4243] },
    async processAlive() { return true }
  })
  const state = createState({ sdk: { ready: true } })
  assert.equal(await bridge.healSdk(state, 'not initialized'), true)
  assert.deepEqual(state.calls, ['kill', 'boot'])
})

test('a dead runtime is rebooted even when it still looks ready', async () => {
  const bridge = createBridge({
    async sdkOwnerPids() { return [] },
    async processAlive() { return false }
  })
  const state = createState({ sdk: { ready: true } })
  assert.equal(await bridge.healSdk(state, 'sdk-dead'), true)
  assert.deepEqual(state.calls, ['kill', 'boot'])
})

test('a failed re-handshake falls through to a fresh runtime', async () => {
  const bridge = createBridge({
    async sdkOwnerPids() { return [4242] },
    async processAlive() { return true },
    async sdkHandshake(state) {
      state.calls.push('handshake:resume')
      throw new Error('sdk-dead')
    }
  })
  const state = createState({ sdk: { ready: true } })
  assert.equal(await bridge.healSdk(state, 'not initialized'), true)
  assert.deepEqual(state.calls, ['handshake:resume', 'kill', 'boot'])
})

test('concurrent callers share a single repair', async () => {
  let boots = 0
  const bridge = createBridge({
    async sdkOwnerPids() { return [] },
    async bootSdk() { boots += 1 }
  })
  const state = createState()
  const results = await Promise.all([
    bridge.healSdk(state, 'not initialized'),
    bridge.healSdk(state, 'not initialized'),
    bridge.healSdk(state, 'not initialized')
  ])
  assert.deepEqual(results, [true, true, true])
  assert.equal(boots, 1)
  assert.equal(state.sdkHealing, null)
})

test('a failing repair is reported and backs off for a minute', async () => {
  const bridge = createBridge({
    async sdkOwnerPids() { return [] },
    async bootSdk() { throw new Error('remote host unreachable') }
  })
  const state = createState()
  assert.equal(await bridge.healSdk(state, 'not initialized'), false)
  assert.equal(state.sdkFailed, true)
  assert.ok(state.sdkRetryAt > Date.now())
})

test('a closed chat is never repaired', async () => {
  const bridge = createBridge()
  const state = createState({ closed: true })
  assert.equal(await bridge.healSdk(state, 'not initialized'), false)
  assert.deepEqual(state.calls, [])
})

test('owner scan output is parsed into sorted unique pids', () => {
  assert.deepEqual(parseSdkOwnerPids('4243\n4242\n4243\n\nnot-a-pid\n-7\n0\n'), [4242, 4243])
  assert.deepEqual(parseSdkOwnerPids(''), [])
  assert.deepEqual(parseSdkOwnerPids(null), [])
})

test('the owner scan counts runtimes on the FIFO and adds the lock on request', () => {
  const sdk = {
    inFile: '/root/ws/bridge/s/sdk/in.fifo',
    lockFile: '/root/ws/bridge/s/sdk/runner.lock'
  }
  const fifoOnly = sdkOwnerScanCommand(sdk)
  assert.match(fifoOnly, /in\.fifo/u)
  assert.ok(!fifoOnly.includes('runner.lock'))
  const withLock = sdkOwnerScanCommand(sdk, { lock: true })
  assert.match(withLock, /runner\.lock/u)
  // The pid is the directory, never the fd number or target text, and only
  // numeric lines survive so nothing else can reach `kill`.
  assert.match(fifoOnly, /find \/proc\/\[0-9\]\*\/fd/u)
  assert.match(fifoOnly, /-printf "%h\\n"/u)
  assert.match(fifoOnly, /grep -E '\^\[0-9\]\+\$'/u)
  assert.equal(sdkOwnerScanCommand({}), 'exit 0')
})

test('the reap command never signals a non-numeric token', () => {
  const command = sdkReapCommand({ watchdogFile: '/root/ws/sdk/watchdog.pid' }, [4242], 0)
  assert.match(command, /case "\$w" in ""\|\*\[!0-9\]\*\) w=0;; esac/u)
  assert.match(command, /kill -TERM -4242/u)
})

test('the reap command stops the watchdog group first and escalates', () => {
  const command = sdkReapCommand({
    watchdogFile: '/root/ws/bridge/s/sdk/watchdog.pid'
  }, [4242, 4243, 9999], 9999)
  const watchdogAt = command.indexOf('kill -TERM "-$w"')
  assert.ok(watchdogAt > 0)
  assert.ok(command.indexOf('kill -TERM -4242') > watchdogAt)
  assert.ok(!command.includes('kill -TERM -9999'))
  assert.match(command, /kill -KILL -4242/u)
  assert.match(command, /exit 0$/u)
})

test('a chat with no runtime at all reports no owners', async () => {
  const bridge = createBridge()
  const state = createState()
  assert.deepEqual(await bridge.sdkOwnerPids(state, { inFile: '' }), [])
})

test('an unreachable host yields no owners instead of throwing', async () => {
  const bridge = createBridge({
    pool: { async exec() { throw new Error('connect ECONNREFUSED 100.66.35.17:22') } }
  })
  const state = createState()
  const pids = await bridge.sdkOwnerPids(state)
  assert.deepEqual(pids, [])
})

test('the adopted runtime is handshaken before it is trusted', async () => {
  const bridge = createBridge({
    async startTail(state) { state.calls.push('tail') }
  })
  const state = createState()
  const sdk = await bridge.adoptSdk(state, 'lock held elsewhere')
  assert.equal(sdk.ready, true)
  assert.equal(state.sdkFailed, false)
  assert.deepEqual(state.calls, ['tail', 'handshake:resume'])
})


function createRawBridge(overrides = {}) {
  const bridge = new SessionBridge({
    pool: { async exec() { return { stdout: '', stderr: '', code: 0 } } },
    store: { root: 'C:\\tmp\\dsh-ssh-test', settings: {} },
    manager: {},
    log: () => {}
  })
  Object.assign(bridge, {
    async ensureSdkProfile(state) { state.calls.push('profile') },
    async launchSdk(state, sdk) { state.calls.push('launch') },
    async startTail(state) { state.calls.push('tail') },
    async sdkHandshake(state, options) { state.calls.push(`handshake:${options?.resume ? 'resume' : 'plain'}`) },
    rememberActive() {}
  }, overrides)
  return bridge
}

test('a journaled runtime that is already gone is replaced, not trusted', async () => {
  const bridge = createRawBridge({
    async processAlive() { return false },
    async sdkOwnerPids() { return [] }
  })
  const state = createState({ sdk: { ready: true } })
  const sdk = await bridge.bootSdk(state)
  assert.equal(sdk, state.sdk)
  assert.equal(sdk.localReady, true)
  assert.deepEqual(state.calls, ['profile', 'launch', 'tail', 'handshake:resume'])
})

test('a runtime this process verified is reused without another probe', async () => {
  let probes = 0
  const bridge = createRawBridge({
    async processAlive() { probes += 1; return true },
    async sdkOwnerPids() { probes += 1; return [1] }
  })
  const state = createState({ sdk: { ready: true, localReady: true } })
  const sdk = await bridge.bootSdk(state)
  assert.equal(sdk, state.sdk)
  assert.equal(probes, 0)
  assert.deepEqual(state.calls, ['tail'])
})

test('a journaled runtime with exactly one live owner is adopted as usable', async () => {
  const bridge = createRawBridge({
    async processAlive() { return true },
    async sdkOwnerPids() { return [4242] }
  })
  const state = createState({ sdk: { ready: true } })
  const sdk = await bridge.bootSdk(state)
  assert.equal(sdk, state.sdk)
  assert.equal(sdk.localReady, true)
  // Reused without a reboot, but the tail and the handshake both had to run.
  assert.deepEqual(state.calls, ['tail', 'handshake:resume'])
})

test('an adopted runtime that will not handshake is replaced', async () => {
  let handshakes = 0
  const bridge = createRawBridge({
    async processAlive() { return true },
    async sdkOwnerPids() { return [4242] },
    async sdkHandshake(state, options) {
      handshakes += 1
      state.calls.push(`handshake:${options?.resume ? 'resume' : 'plain'}`)
      if (handshakes === 1) throw new Error('no answer')
    }
  })
  const state = createState({ sdk: { ready: true } })
  const sdk = await bridge.bootSdk(state)
  assert.equal(sdk, state.sdk)
  assert.deepEqual(state.calls, ['tail', 'handshake:resume', 'profile', 'launch', 'tail', 'handshake:resume'])
  assert.equal(sdk.localReady, true)
})

test('a journaled runtime with several owners is replaced', async () => {
  const bridge = createRawBridge({
    async processAlive() { return true },
    async sdkOwnerPids() { return [4242, 4243] }
  })
  const state = createState({ sdk: { ready: true } })
  await bridge.bootSdk(state)
  assert.deepEqual(state.calls, ['profile', 'launch', 'tail', 'handshake:resume'])
})

test('a write into a FIFO nobody reads fails fast instead of hanging', async () => {
  const bridge = createBridge()
  const state = createState()
  state.sdkSendChain = Promise.resolve()
  bridge.pool = { async exec() { return { code: 10, stdout: '', stderr: 'sdk-write-blocked' } } }
  state.sdk = { inFile: '/x/in.fifo' }
  await assert.rejects(bridge.sdkWrite(state, '{}'), /sdk-write-blocked/u)
  assert.ok(state.sdkSendChain instanceof Promise)
})