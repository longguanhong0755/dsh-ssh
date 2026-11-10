// Bridged chats render their footer from the anchor session's own log: token
// totals, decode speed and context occupancy all fold `assistant/message.usage`,
// its embedded `stream` records, and the `request/header` / `request/context`
// records of the request that produced them. The bridge used to drop all four,
// so a remote chat could only report turns and steps.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionBridge } from '../lib/bridge.js'

function createState(localSessionId = 'local-session') {
  let seq = 0
  const events = []
  const agent = {
    session: {
      id: localSessionId,
      append(type, data, options = {}) {
        seq += 1
        const event = { type, seq, data, options }
        events.push(event)
        return event
      }
    },
    dispatch: { emit() {} }
  }
  const state = {
    localSessionId,
    agent,
    workspace: { id: 'workspace', remotePath: '/remote' },
    host: { id: 'host' },
    turn: 1,
    remoteTurn: 0,
    remoteStep: 0,
    reasoning: '',
    text: '',
    pendingTools: [],
    toolSeqs: new Map(),
    assistantForStep: false,
    assistantEvent: null,
    stepOpen: false,
    stepOptimistic: false,
    turnOpen: false,
    final: false,
    running: true,
    liveAttempt: null,
    streamRevision: 0,
    streamStats: { frames: 0, chunks: 0, firstAt: 0, lastAt: 0 }
  }
  return { state, events }
}

async function withBridge(run) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-bridge-stats-'))
  const bridge = new SessionBridge({ pool: {}, store: { root }, manager: {}, log: () => {} })
  try {
    await run(bridge)
  } finally {
    // No dispose(): these states are stubs, and the bridge's own cleanup path
    // expects a fully attached runtime. Only the temp journal dir is ours.
    await rm(root, { recursive: true, force: true })
  }
}

const USAGE = { inputTokens: 282, outputTokens: 141, cacheReadTokens: 5376, cacheWriteTokens: 0, totalTokens: 5799 }
const STREAM = [
  { type: 'chunk', time: 1794063728544, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } },
  { type: 'chunk', time: 1794063729089, chunk: { type: 'block-start', index: 1, blockType: 'text' } },
  { type: 'chunk', time: 1794063729100, chunk: { type: 'text-delta', index: 1, text: 'hi' } }
]

test('a bridged assistant message keeps its usage and stream records', async () => {
  await withBridge(async (bridge) => {
    const { state, events } = createState()
    bridge.sdkSessionEvent(state, { type: 'step/start', data: { turn: 1, step: 1 } })
    bridge.sdkSessionEvent(state, {
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 1,
        usage: USAGE,
        stream: STREAM,
        message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] }
      }
    })
    const row = events.find((event) => event.type === 'assistant/message')
    assert.ok(row)
    assert.deepEqual(row.data.usage, USAGE)
    assert.deepEqual(row.data.stream, STREAM)
    assert.equal(row.data.turn, 1)
    assert.equal(row.data.step, 1)
  })
})

test('request headers and context windows are mirrored once per distinct value', async () => {
  await withBridge(async (bridge) => {
    const { state, events } = createState()
    const header = { config: { provider: 'deepseek-official', model: 'deepseek-chat', maxTokens: 256000 } }
    bridge.sdkSessionEvent(state, { type: 'request/header', data: { header } })
    bridge.sdkSessionEvent(state, { type: 'request/header', data: { header } })
    const headers = events.filter((event) => event.type === 'request/header')
    assert.equal(headers.length, 1)
    // Native v4 requires a reason; without it the log cannot be restored.
    assert.deepEqual(headers[0].data, { header, reason: 'initial' })

    bridge.sdkSessionEvent(state, { type: 'request/header', data: { header: { config: { ...header.config, model: 'deepseek-reasoner' } } } })
    const changed = events.filter((event) => event.type === 'request/header')
    assert.equal(changed.length, 2)
    assert.equal(changed[1].data.reason, 'change')

    bridge.sdkSessionEvent(state, {
      type: 'request/header',
      data: { header: { config: { ...header.config, model: 'deepseek-reasoner', maxTokens: 128000 } }, reason: 'series', startsSeries: true }
    })
    const series = events.filter((event) => event.type === 'request/header')
    assert.equal(series.length, 3)
    assert.equal(series[2].data.reason, 'series')
    assert.equal(series[2].data.startsSeries, true)

    const context = { provider: 'deepseek-official', model: 'deepseek-chat', contextWindow: 1000000 }
    bridge.sdkSessionEvent(state, { type: 'request/context', data: context })
    bridge.sdkSessionEvent(state, { type: 'request/context', data: context })
    bridge.sdkSessionEvent(state, { type: 'request/context', data: { ...context, contextWindow: 200000 } })
    const contexts = events.filter((event) => event.type === 'request/context')
    assert.equal(contexts.length, 2)
    assert.deepEqual(contexts[0].data, context)
  })
})

test('compaction of a bridged session uses the remote chat route', async () => {
  await withBridge(async (bridge) => {
    bridge.sessions.set('local-session', { localSessionId: 'local-session' })

    const rewritten = bridge.routeCompactionOptions({
      purpose: 'compaction',
      sessionId: 'local-session',
      provider: 'opencode-go',
      model: 'deepseek-v4.1-flash',
      messages: []
    })
    assert.equal(rewritten.provider, bridge.compactionProvider)
    assert.equal(rewritten.model, bridge.compactionModel)
    assert.deepEqual(rewritten.messages, [])

    // Already on the target route: the same request object is reused.
    const same = { purpose: 'compaction', sessionId: 'local-session', provider: bridge.compactionProvider, model: bridge.compactionModel }
    assert.equal(bridge.routeCompactionOptions(same), same)

    // Local chats, other purposes and unknown sessions keep their own route.
    const local = { purpose: 'compaction', sessionId: 'session-other', provider: 'opencode-go', model: 'deepseek-v4.1-flash' }
    assert.equal(bridge.routeCompactionOptions(local), local)
    const chat = { purpose: 'chat', sessionId: 'local-session', provider: 'opencode-go', model: 'deepseek-v4.1-flash' }
    assert.equal(bridge.routeCompactionOptions(chat), chat)
    assert.equal(bridge.routeCompactionOptions(undefined), undefined)
  })
})

test('the resolved route is mirrored before the remote reports its own', async () => {
  await withBridge(async (bridge) => {
    const { state, events } = createState()
    state.model = {
      provider: 'ds-break',
      model: 'deepseek-v4.1-flash',
      reasoningEffort: 'high',
      maxTokens: 384000,
      contextWindow: 200000,
      config: { provider: 'ds-break', model: 'deepseek-v4.1-flash', reasoningEffort: 'high', maxTokens: 384000 }
    }
    bridge.mirrorResolvedModel(state)
    const header = events.find((event) => event.type === 'request/header')
    assert.ok(header)
    assert.equal(header.data.header.config.provider, 'ds-break')
    assert.equal(header.data.header.config.model, 'deepseek-v4.1-flash')
    assert.equal(header.data.header.config.reasoningEffort, 'high')
    assert.equal(header.data.reason, 'initial')
    const context = events.find((event) => event.type === 'request/context')
    assert.deepEqual(context.data, { provider: 'ds-break', model: 'deepseek-v4.1-flash', contextWindow: 200000 })

    // The same route on the next turn is not repeated.
    bridge.mirrorResolvedModel(state)
    assert.equal(events.filter((event) => event.type === 'request/header').length, 1)
    assert.equal(events.filter((event) => event.type === 'request/context').length, 1)

    // A route change replaces both records with an explicit change reason.
    state.model = { ...state.model, provider: 'lingxi', model: 'deepseek-v4.1', contextWindow: 1000000 }
    bridge.mirrorResolvedModel(state)
    const headers = events.filter((event) => event.type === 'request/header')
    assert.equal(headers.length, 2)
    assert.equal(headers[1].data.reason, 'change')
    assert.equal(headers[1].data.header.config.provider, 'lingxi')
    assert.equal(events.filter((event) => event.type === 'request/context').length, 2)
  })
})

test('a header that changes beyond provider/model is mirrored instead of swallowed', async () => {
  await withBridge(async (bridge) => {
    const { state, events } = createState()
    const base = { config: { provider: 'ds-break', model: 'deepseek-v4.1-flash', maxTokens: 384000, temperature: 0.2 } }
    bridge.mirrorRequestRecord(state, { type: 'request/header', data: { header: base } })
    bridge.mirrorRequestRecord(state, { type: 'request/header', data: { header: base } })
    assert.equal(events.filter((event) => event.type === 'request/header').length, 1)
    bridge.mirrorRequestRecord(state, {
      type: 'request/header',
      data: { header: { config: { ...base.config, temperature: 0.7 } } }
    })
    const headers = events.filter((event) => event.type === 'request/header')
    assert.equal(headers.length, 2)
    assert.equal(headers[1].data.reason, 'change')
    assert.equal(headers[1].data.header.config.temperature, 0.7)
  })
})

test('dedupe keys are hydrated from the anchor log so a restart does not duplicate', async () => {
  await withBridge(async (bridge) => {
    const header = { config: { provider: 'ds-break', model: 'deepseek-v4.1-flash', maxTokens: 384000 } }
    const context = { provider: 'ds-break', model: 'deepseek-v4.1-flash', contextWindow: 200000 }
    const { state, events } = createState()
    state.agent.session.log = [
      { type: 'request/context', data: context },
      { type: 'request/header', data: { header, reason: 'initial' } }
    ]
    bridge.hydrateRequestKeys(state)
    assert.equal(typeof state.headerKey, 'string')
    assert.equal(typeof state.contextKey, 'string')
    bridge.mirrorRequestRecord(state, { type: 'request/header', data: { header } })
    bridge.mirrorRequestRecord(state, { type: 'request/context', data: context })
    assert.equal(events.length, 0)
    // The next real change still writes, and not as a second `initial`.
    bridge.mirrorRequestRecord(state, {
      type: 'request/header',
      data: { header: { config: { ...header.config, maxTokens: 128000 } } }
    })
    const written = events.find((event) => event.type === 'request/header')
    assert.equal(written.data.reason, 'change')
  })
})

test('compaction prefers the chat route once one was resolved', async () => {
  await withBridge(async (bridge) => {
    bridge.sessions.set('local-session', {
      localSessionId: 'local-session',
      model: { provider: 'ds-break', model: 'deepseek-v4.1-flash' }
    })
    const rewritten = bridge.routeCompactionOptions({
      purpose: 'compaction',
      sessionId: 'local-session',
      provider: 'opencode-go',
      model: 'deepseek-v4.1-flash'
    })
    assert.equal(rewritten.provider, 'ds-break')
    assert.equal(rewritten.model, 'deepseek-v4.1-flash')
  })
})

test('installing the stream wrapper twice does not stack calls', async () => {
  const calls = []
  const llm = {
    stream(options) {
      calls.push(options)
      return { ok: true }
    }
  }
  await withBridge(async (bridge) => {
    bridge.ctx = { get: (name) => (name === 'llm' ? llm : undefined) }
    bridge.sessions.set('local-session', { localSessionId: 'local-session' })

    assert.equal(bridge.installLlmRouting(), true)
    assert.equal(bridge.installLlmRouting(), true)
    assert.equal(calls.length, 0)

    // The wrapper is installed once and dispatches through the global router.
    const second = new SessionBridge({ pool: {}, store: { root: bridge.store.root }, manager: {}, log: () => {} })
    second.ctx = bridge.ctx
    second.sessions.set('local-session', { localSessionId: 'local-session' })
    assert.equal(second.installLlmRouting(), true)

    const out = llm.stream({ purpose: 'compaction', sessionId: 'local-session', provider: 'opencode-go', model: 'deepseek-v4.1-flash' })
    assert.deepEqual(out, { ok: true })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].provider, second.compactionProvider)
    assert.equal(calls[0].model, second.compactionModel)

    const local = llm.stream({ purpose: 'compaction', sessionId: 'other', provider: 'lingxi', model: 'x' })
    assert.deepEqual(local, { ok: true })
    assert.equal(calls[1].provider, 'lingxi')
  })
})

test('a transient compaction stream failure is retried from scratch', async () => {
  let attempts = 0
  const llm = {
    stream() {
      attempts += 1
      const attempt = attempts
      return (async function* () {
        if (attempt === 1) {
          yield { type: 'text', text: 'partial output' }
          const error = new Error('Request timed out.')
          error.code = 'TIMEOUT'
          throw error
        }
        yield { type: 'text', text: 'final summary' }
      })()
    }
  }
  await withBridge(async (bridge) => {
    bridge.ctx = { get: (name) => (name === 'llm' ? llm : undefined) }
    assert.equal(bridge.installLlmRouting(), true)
    const chunks = []
    for await (const chunk of llm.stream({ purpose: 'compaction', sessionId: 'local', provider: 'p', model: 'm' })) {
      chunks.push(chunk)
    }
    // The failed attempt's partial output is never mixed into the retry.
    assert.deepEqual(chunks, [{ type: 'text', text: 'final summary' }])
    assert.equal(attempts, 2)
  })
})

test('a permanent compaction failure is not retried', async () => {
  let attempts = 0
  const llm = {
    stream() {
      attempts += 1
      return (async function* () {
        const error = new Error('invalid api key')
        error.status = 401
        throw error
      })()
    }
  }
  await withBridge(async (bridge) => {
    bridge.ctx = { get: (name) => (name === 'llm' ? llm : undefined) }
    assert.equal(bridge.installLlmRouting(), true)
    await assert.rejects(async () => {
      for await (const _chunk of llm.stream({ purpose: 'compaction', sessionId: 'local', provider: 'p', model: 'm' })) {
        // no chunks
      }
    }, /invalid api key/u)
    assert.equal(attempts, 1)
  })
})

test('a newer module evaluation replaces the stream wrapper without stacking', async () => {
  let calls = 0
  const llm = {
    stream() {
      calls += 1
      return (async function* () {
        yield { type: 'text', text: 'summary' }
      })()
    }
  }
  await withBridge(async (bridge) => {
    bridge.ctx = { get: (name) => (name === 'llm' ? llm : undefined) }
    assert.equal(bridge.installLlmRouting(), true)
    const firstWrapper = llm.stream
    // Simulate HMR: the service still holds the old wrapper while a newer
    // module evaluation proves it is newer and reinstalls.
    llm[Symbol.for('dsh-ssh-remote.llm.stream.version')] = 0
    assert.equal(bridge.installLlmRouting(), true)
    assert.notEqual(llm.stream, firstWrapper)
    const chunks = []
    for await (const chunk of llm.stream({ purpose: 'compaction', sessionId: 'local', provider: 'p', model: 'm' })) {
      chunks.push(chunk)
    }
    assert.deepEqual(chunks, [{ type: 'text', text: 'summary' }])
    assert.equal(calls, 1)
  })
})
