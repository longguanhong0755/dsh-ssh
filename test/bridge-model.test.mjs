// A bridged chat must run the model its own picker shows. The bridge used to
// hardcode the remote route (SDK: deepseek-official/deepseek-chat, headless:
// the remote default), so the same chat produced different context windows and
// compaction thresholds on the two hosts. These tests pin the selection chain,
// the route validation, and the generated remote profile.
import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionBridge, extractYamlBlock } from '../lib/bridge.js'

function createBridge(ctx = null, manager = {}) {
  return new SessionBridge({ pool: {}, store: { root: '/tmp/dsh-ssh-store' }, manager, log: () => {}, ctx })
}

const LLM_BLOCK = [
  '- id: llm-pi-ai',
  '  name: "@deepseek-ai/dsh-llm-pi-ai"',
  '  config:',
  '    providers:',
  '      - id: ds-break',
  '        models:',
  '          - id: deepseek-v4.1-flash',
  '            contextWindow: 200000',
  '',
  '- id: other',
  '  name: "@deepseek-ai/other"',
  ''
].join('\n')

test('extractYamlBlock copies one id-targeted block and stops at the next entry', () => {
  const block = extractYamlBlock(LLM_BLOCK, 'llm-pi-ai')
  assert.match(block, /^- id: llm-pi-ai$/mu)
  assert.match(block, /contextWindow: 200000/u)
  assert.doesNotMatch(block, /id: other/u)
  assert.equal(extractYamlBlock(LLM_BLOCK, 'missing'), '')
})

test('the generated profile overlay names the selected model', () => {
  const bridge = createBridge()
  const patch = bridge.modelPatch({ provider: 'ds-break', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' })
  assert.match(patch, /^- id: agent-default-model$/mu)
  assert.match(patch, /^ {4}provider: "ds-break"$/mu)
  assert.match(patch, /^ {4}model: "deepseek-v4\.1-flash"$/mu)
  assert.match(patch, /^ {4}reasoningEffort: "high"$/mu)
  // Without a resolved model there is no overlay to add.
  assert.equal(bridge.modelPatch(null), '')
})

test('the selection chain prefers the live agent and falls back to the log', () => {
  const none = createBridge()
  assert.equal(none.currentSelection({ agent: { session: {} } }), null)

  const live = createBridge({
    get: (name) => {
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'default', model: 'fallback' }) }
      return undefined
    }
  })
  const liveState = {
    agent: {
      model: { current: () => ({ provider: 'ds-break', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' }) },
      session: { log: [{ type: 'model/selection', data: { provider: 'old', model: 'old' } }] }
    }
  }
  assert.deepEqual(live.currentSelection(liveState), {
    provider: 'ds-break',
    model: 'deepseek-v4.1-flash',
    reasoningEffort: 'high'
  })

  const projected = createBridge({
    get: (name) => (name === 'sessionProjections'
      ? { stateOf: () => ({ pending: null, lastUsed: { provider: 'loongapi', model: 'deepseek-v4.1' } }) }
      : undefined)
  })
  assert.deepEqual(projected.currentSelection({ agent: { session: {} } }), { provider: 'loongapi', model: 'deepseek-v4.1' })

  const logged = createBridge()
  const logState = {
    agent: {
      session: {
        log: [
          { type: 'model/selection', data: { provider: 'first', model: 'one' } },
          { type: 'model/selection', data: { provider: 'last', model: 'two', reasoningEffort: 'low' } }
        ],
        requestHeader: () => ({ config: { provider: 'header', model: 'three' } })
      }
    }
  }
  assert.deepEqual(logged.currentSelection(logState), { provider: 'last', model: 'two', reasoningEffort: 'low' })

  const headerState = {
    agent: {
      session: { log: [], requestHeader: () => ({ config: { provider: 'header', model: 'three' } }) }
    }
  }
  assert.deepEqual(logged.currentSelection(headerState), { provider: 'header', model: 'three' })

  const fallback = createBridge({
    get: (name) => (name === 'agentDefaultModel'
      ? { currentSelection: () => ({ provider: 'default', model: 'fallback' }) }
      : undefined)
  })
  assert.deepEqual(fallback.currentSelection({ agent: { session: {} } }), { provider: 'default', model: 'fallback' })
})

test('the resolved route materializes adapter defaults and the context window', async () => {
  const calls = []
  const llm = {
    async resolveCallConfig(config) {
      calls.push(config)
      return { ...config, reasoningEffort: config.reasoningEffort || 'high', maxTokens: 384000 }
    },
    async resolveModelInfo(provider, model) {
      assert.equal(provider, 'ds-break')
      assert.equal(model, 'deepseek-v4.1-flash')
      return { context: { contextWindow: 200000 }, defaultMaxTokens: 128000 }
    }
  }
  const bridge = createBridge({ get: (name) => (name === 'llm' ? llm : undefined) })
  const model = await bridge.resolveModel({
    agent: { model: { current: () => ({ provider: 'ds-break', model: 'deepseek-v4.1-flash' }) } }
  })
  assert.deepEqual(calls, [{ provider: 'ds-break', model: 'deepseek-v4.1-flash' }])
  assert.equal(model.reasoningEffort, 'high')
  assert.equal(model.maxTokens, 384000)
  assert.equal(model.contextWindow, 200000)
  assert.match(model.key, /^ds-break\u0000deepseek-v4\.1-flash\u0000high\u0000384000\u0000200000$/u)
})

test('a route this machine cannot resolve fails with a clear error', async () => {
  const llm = {
    async resolveCallConfig() {
      throw new Error('no adapter registered for provider "loongapi"')
    }
  }
  const bridge = createBridge({ get: (name) => (name === 'llm' ? llm : undefined) })
  await assert.rejects(
    bridge.resolveModel({ agent: { model: { current: () => ({ provider: 'loongapi', model: 'x' }) } } }),
    /模型 loongapi\/x 在本机不可用/u
  )
  // No selection at all is its own message, not a silent remote default.
  const bare = createBridge()
  await assert.rejects(bare.resolveModel({ agent: { session: {} } }), /还没有可用的模型选择/u)
})

test('a changed route invalidates the shared profile and retires the runners', async () => {
  const bridge = createBridge()
  let key = 'route-a'
  bridge.resolveModel = async () => ({ provider: 'p', model: 'm', reasoningEffort: '', maxTokens: 0, contextWindow: 0, key })
  let invalidations = 0
  let retires = 0
  bridge.invalidateProfiles = () => { invalidations += 1 }
  bridge.retireRunners = async () => { retires += 1 }

  const state = { modelKey: 'route-a', model: null }
  assert.equal(await bridge.applyModel(state), false)
  assert.equal(invalidations, 0)
  assert.equal(retires, 0)

  key = 'route-b'
  assert.equal(await bridge.applyModel(state), true)
  assert.equal(state.modelKey, 'route-b')
  assert.equal(invalidations, 1)
  assert.equal(retires, 1)
})

test('the headless profile carries the local providers and the chat route', async () => {
  const writes = new Map()
  const pool = {
    async run() {},
    async writeFile(_host, path, content) { writes.set(path, content) }
  }
  let syncs = 0
  const bridge = new SessionBridge({
    pool,
    store: { root: '/tmp/dsh-ssh-store' },
    manager: { syncCredentials: async () => { syncs += 1 } },
    log: () => {}
  })
  bridge.localProvidersPatch = () => LLM_BLOCK.split('\n\n')[0] + '\n'
  bridge.providersTag = () => 'providers'
  const workspace = { id: 'w1', dshHome: '/home/u/.dsh-remote', wsRoot: '/home/u/ws', remotePath: '/repo' }
  const host = { id: 'h1' }
  const state = {
    host,
    workspace,
    localSessionId: 's1',
    model: { provider: 'ds-break', model: 'deepseek-v4.1-flash', reasoningEffort: 'high', key: 'route-1' }
  }

  await bridge.ensureProfile(state)
  const patchPath = '/home/u/.dsh-remote/profiles/headless/cordis.patch.yml'
  const patch = writes.get(patchPath)
  assert.ok(patch)
  assert.match(patch, /- id: llm-pi-ai/u)
  assert.match(patch, /- id: agent-default-model/u)
  assert.match(patch, /provider: "ds-break"/u)
  assert.match(patch, /model: "deepseek-v4\.1-flash"/u)
  // The stream plugin still rides along for live output.
  assert.match(patch, /id: dsh-ssh-stream/u)
  assert.equal(syncs, 1)

  // Same route: the cached promise skips the rewrite.
  await bridge.ensureProfile(state)
  assert.equal(syncs, 1)

  // Another route of the same workspace rewrites the shared profile; only the
  // newest cache entry survives so a later turn cannot reuse stale bytes.
  const other = { ...state, model: { ...state.model, key: 'route-2' } }
  await bridge.ensureProfile(other)
  assert.equal(syncs, 2)
  assert.equal(bridge.profiles.size, 1)
  assert.match([...bridge.profiles.keys()][0], /route-2$/u)
})
