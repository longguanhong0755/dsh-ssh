// A remote command (`/compact`) is the first thing a chat does after the app
// restarts: no turn has run `applyModel` yet, so the route is unresolved when
// the SDK handshake needs it. The handshake must adopt the anchor's picker
// selection there — and adopting must never retire a runner that was just
// launched, which is why it cannot reuse `applyModel`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionBridge } from '../lib/bridge.js'

function createBridge(overrides = {}) {
  const bridge = new SessionBridge({
    pool: { async exec() { return { stdout: '', stderr: '', code: 0 } } },
    store: { root: 'C:\\tmp\\dsh-ssh-adopt', settings: {} },
    manager: {},
    log: () => {}
  })
  bridge.ctx = {
    get(name) {
      if (name === 'agentDefaultModel') {
        return {
          currentSelection: () => ({
            provider: 'deepseek',
            model: 'deepseek-v4.1-flash',
            reasoningEffort: 'high'
          })
        }
      }
      return null
    }
  }
  return Object.assign(bridge, overrides)
}

function createState(extra = {}) {
  return {
    localSessionId: 'session-local',
    remoteSessionId: 'session-remote',
    host: { id: 'host' },
    workspace: { id: 'ws', wsRoot: '/root/.dsh-remote/workspaces/ws', remotePath: '/root/ui-showcase' },
    model: null,
    modelKey: '',
    sdk: null,
    turn: 4,
    closed: false,
    calls: [],
    ...extra
  }
}

test('an idle chat adopts the picker selection for a forwarded command', async () => {
  const bridge = createBridge()
  const state = createState()
  const model = await bridge.adoptModel(state)
  assert.equal(model.provider, 'deepseek')
  assert.equal(model.model, 'deepseek-v4.1-flash')
  assert.equal(model.reasoningEffort, 'high')
  assert.equal(state.model, model)
  assert.equal(state.modelKey, model.key)
})

test('adopting a route never retires the runtime it was launched for', async () => {
  const calls = []
  const bridge = createBridge({
    async retireRunners(state) { calls.push('retire') },
    async killSdk(state) { calls.push('kill') }
  })
  const state = createState()
  await bridge.adoptModel(state)
  assert.deepEqual(calls, [])
})

test('an adopted route is left alone by the next turn', async () => {
  const bridge = createBridge({
    async resolveModel() { throw new Error('must not re-resolve') }
  })
  const existing = { key: 'already', provider: 'p', model: 'm' }
  const state = createState({ model: existing, modelKey: existing.key })
  assert.equal(await bridge.adoptModel(state), existing)
  assert.equal(state.modelKey, 'already')
})

test('adopting without any selection explains what to do', async () => {
  const bridge = createBridge()
  bridge.ctx = { get: () => null }
  const state = createState({ agent: null })
  await assert.rejects(() => bridge.adoptModel(state), /当前会话还没有可用的模型选择/u)
  assert.equal(state.model, null)
})

test('the handshake adopts the route before it initializes the runtime', async () => {
  const bridge = createBridge()
  const state = createState()
  const calls = []
  bridge.sdkCall = async (target, method, params) => {
    calls.push([method, params])
    return { kind: 'ready' }
  }
  await bridge.sdkHandshake(state, { resume: false })
  assert.equal(calls.length, 1)
  const [method, params] = calls[0]
  assert.equal(method, 'initialize')
  assert.equal(params.provider, 'deepseek')
  assert.equal(params.model, 'deepseek-v4.1-flash')
  assert.equal(params.reasoningEffort, 'high')
  assert.equal(params.cwd, '/root/ui-showcase')
  assert.equal(params.maxTokens, undefined)
})

test('a forwarded command prepares its route before touching the runtime', async () => {
  const bridge = createBridge()
  const state = createState()
  const order = []
  bridge.syncWorkspaceRuntime = async () => { order.push('sync'); return false }
  bridge.retireStaleRunners = async () => { order.push('stale'); return false }
  await bridge.prepareRemoteCommands(state)
  assert.deepEqual(order, ['sync', 'stale'])
  assert.equal(state.model?.model, 'deepseek-v4.1-flash')
})
