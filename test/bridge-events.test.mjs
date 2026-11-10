// The bridged transcript must reproduce the native event order: each step's
// durable assistant message carries every tool-call block before the matching
// tool/call rows and tool/results. A lazy flush at the first tool/result used
// to drop later blocks and break dsh's tool-call/tool-result pairing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionBridge } from '../lib/bridge.js'

function createState(bridge) {
  let seq = 0
  const events = []
  const frames = []
  const agent = {
    session: {
      id: 'local-session',
      append(type, data, options = {}) {
        seq += 1
        const event = { type, seq, data, options }
        events.push(event)
        return event
      }
    },
    dispatch: {
      emit(name, payload) {
        if (name === 'agent/assistant-stream') frames.push(payload.frame)
      }
    }
  }
  const state = {
    localSessionId: 'local-session',
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
  return { state, events, frames, bridge }
}

test('a durable assistant message keeps every tool-call block before its calls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-bridge-'))
  const bridge = new SessionBridge({ pool: {}, store: { root }, manager: {}, log: () => {} })
  const { state, events } = createState(bridge)
  try {
    bridge.sdkSessionEvent(state, { type: 'step/start', data: { turn: 1, step: 1 } })
    bridge.sdkSessionEvent(state, {
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 1,
        message: {
          role: 'assistant',
          id: 'message-1',
          source: { kind: 'model', provider: 'remote', model: 'remote' },
          content: [
            { type: 'reasoning', text: 'think' },
            { type: 'text', text: 'plan' },
            { type: 'tool-call', id: 'call-1', name: 'read', arguments: '{"path":"a"}' },
            { type: 'tool-call', id: 'call-2', name: 'read', arguments: '{"path":"b"}' }
          ]
        }
      }
    })
    const messageRows = events.filter((event) => event.type === 'assistant/message')
    assert.equal(messageRows.length, 1)
    assert.deepEqual(
      messageRows[0].data.message.content.map((block) => block.type),
      ['reasoning', 'text', 'tool-call', 'tool-call']
    )
    const calls = events.filter((event) => event.type === 'tool/call')
    assert.deepEqual(calls.map((event) => event.data.callId), ['call-1', 'call-2'])
    for (const call of calls) assert.ok(call.seq > messageRows[0].seq)

    // The SDK reports the same calls again; the rows must not be duplicated.
    bridge.sdkSessionEvent(state, { type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-1', name: 'read', arguments: '{"path":"a"}' } })
    bridge.sdkSessionEvent(state, { type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-2', name: 'read', arguments: '{"path":"b"}' } })
    assert.equal(events.filter((event) => event.type === 'tool/call').length, 2)

    bridge.sdkSessionEvent(state, {
      type: 'tool/result',
      data: { turn: 1, step: 1, toolCallId: 'call-1', message: { role: 'tool', content: [{ type: 'text', text: 'ok' }] } }
    })
    const firstResult = events.find((event) => event.type === 'tool/result')
    assert.ok(firstResult)
    // Pair the result with the tool/call row emitted for the same call, not
    // with the assistant message that carried the block.
    assert.deepEqual(firstResult.options.sourceEventSeqs, [calls[0].seq])
    assert.equal(events.filter((event) => event.type === 'assistant/message').length, 1)

    bridge.sdkSessionEvent(state, { type: 'step/end', data: { turn: 1, step: 1 } })
    assert.equal(events.filter((event) => event.type === 'assistant/message').length, 1)
    assert.ok(events.some((event) => event.type === 'step/end'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a step that only has text settles one assistant message at step end', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-bridge-'))
  const bridge = new SessionBridge({ pool: {}, store: { root }, manager: {}, log: () => {} })
  const { state, events } = createState(bridge)
  try {
    bridge.sdkSessionEvent(state, { type: 'step/start', data: { turn: 1, step: 1 } })
    bridge.sdkSessionEvent(state, {
      type: 'assistant/message',
      data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'answer' }] } }
    })
    bridge.sdkSessionEvent(state, { type: 'step/end', data: { turn: 1, step: 1 } })
    const rows = events.filter((event) => event.type === 'assistant/message')
    assert.equal(rows.length, 1)
    assert.deepEqual(rows[0].data.message.content, [{ type: 'text', text: 'answer' }])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// The headless --json projection caps every string at 8 KiB, so long reasoning
// reached the bridge truncated. The profile channel now forwards the committed
// message verbatim; it must win over the projection's fell-back text.
const LONG_REASONING = '思'.repeat(12 * 1024)

test('the committed message keeps reasoning longer than the projection cap', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-bridge-'))
  const bridge = new SessionBridge({ pool: {}, store: { root }, manager: {}, log: () => {} })
  const { state, events } = createState(bridge)
  const usage = { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 30 }
  const stream = [{ type: 'chunk', time: 1, chunk: { type: 'text-delta', index: 0, text: 'ok' } }]
  try {
    state.remoteSessionId = 'remote-session'
    bridge.consumeEvent(state, { type: 'status', phase: 'turn_start', turn: 1 })
    bridge.consumeEvent(state, { type: 'status', phase: 'step_start', turn: 1, step: 1 })
    // What the capped projection delivered first (truncated).
    bridge.consumeEvent(state, { type: 'thinking', text: LONG_REASONING.slice(0, 8192) })
    bridge.consumeEvent(state, {
      type: 'assistant-content',
      sessionId: 'remote-session',
      turn: 1,
      step: 1,
      usage,
      stream,
      message: {
        id: 'message-long',
        role: 'assistant',
        source: { kind: 'model', provider: 'ds-break', model: 'deepseek-v4.1-flash' },
        content: [
          { type: 'reasoning', text: LONG_REASONING },
          { type: 'text', text: '结论' }
        ]
      }
    })
    bridge.consumeEvent(state, { type: 'status', phase: 'step_end', turn: 1, step: 1 })
    const rows = events.filter((event) => event.type === 'assistant/message')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].data.message.content[0].text, LONG_REASONING)
    assert.deepEqual(rows[0].data.message.content.map((block) => block.type), ['reasoning', 'text'])
    assert.equal(rows[0].data.message.id, 'message-long')
    assert.deepEqual(rows[0].data.message.source, { kind: 'model', provider: 'ds-break', model: 'deepseek-v4.1-flash' })
    assert.deepEqual(rows[0].data.usage, usage)
    assert.deepEqual(rows[0].data.stream, stream)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a committed message from another remote session is ignored', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-bridge-'))
  const bridge = new SessionBridge({ pool: {}, store: { root }, manager: {}, log: () => {} })
  const { state, events } = createState(bridge)
  try {
    state.remoteSessionId = 'mine'
    bridge.consumeEvent(state, { type: 'status', phase: 'step_start', turn: 1, step: 1 })
    bridge.consumeEvent(state, {
      type: 'assistant-content',
      sessionId: 'other',
      message: { role: 'assistant', content: [{ type: 'text', text: 'not mine' }] }
    })
    bridge.consumeEvent(state, { type: 'status', phase: 'step_end', turn: 1, step: 1 })
    assert.equal(events.filter((event) => event.type === 'assistant/message').length, 0)
    assert.equal(state.authoritativeContent, null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('without a committed message thinking and text keep their interleaved order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-bridge-'))
  const bridge = new SessionBridge({ pool: {}, store: { root }, manager: {}, log: () => {} })
  const { state, events } = createState(bridge)
  try {
    bridge.consumeEvent(state, { type: 'status', phase: 'step_start', turn: 1, step: 1 })
    bridge.consumeEvent(state, { type: 'thinking', text: '先想' })
    bridge.consumeEvent(state, { type: 'text', text: '中间' })
    bridge.consumeEvent(state, { type: 'thinking', text: '再想' })
    bridge.consumeEvent(state, { type: 'text', text: '结尾' })
    bridge.consumeEvent(state, { type: 'status', phase: 'step_end', turn: 1, step: 1 })
    const row = events.find((event) => event.type === 'assistant/message')
    assert.ok(row)
    // The old flush concatenated both scalars, losing the interleaving.
    assert.deepEqual(row.data.message.content, [
      { type: 'reasoning', text: '先想' },
      { type: 'text', text: '中间' },
      { type: 'reasoning', text: '再想' },
      { type: 'text', text: '结尾' }
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('streamed reasoning survives a step that closes before the durable message', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-bridge-'))
  const bridge = new SessionBridge({ pool: {}, store: { root }, manager: {}, log: () => {} })
  const { state, events, frames } = createState(bridge)
  try {
    bridge.consumeEvent(state, { type: 'status', phase: 'step_start', turn: 1, step: 1 })
    // The projection delivered a truncated copy first; the live stream is the
    // complete one and must win when the step closes early.
    bridge.consumeEvent(state, { type: 'thinking', text: '半截' })
    bridge.pushLive(state, { type: 'reasoning-delta', text: '半截思考' })
    bridge.pushLive(state, { type: 'text-delta', text: '半截答案' })
    // A stopped/failed turn closes the step without ever committing a message.
    bridge.closeStep(state)
    const row = events.find((event) => event.type === 'assistant/message')
    assert.ok(row)
    assert.deepEqual(row.data.message.content, [
      { type: 'reasoning', text: '半截思考' },
      { type: 'text', text: '半截答案' }
    ])
    // The temporary preview gets a committed end instead of vanishing.
    const end = frames.find((frame) => frame.type === 'end')
    assert.ok(end)
    assert.equal(end.outcome.kind, 'committed')
    assert.equal(end.outcome.seq, row.seq)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a failed turn writes one assistant row that keeps the partial reasoning', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-bridge-'))
  const bridge = new SessionBridge({ pool: {}, store: { root }, manager: {}, log: () => {} })
  const { state, events } = createState(bridge)
  try {
    bridge.finish = () => {}
    bridge.consumeEvent(state, { type: 'status', phase: 'step_start', turn: 1, step: 1 })
    bridge.pushLive(state, { type: 'reasoning-delta', text: '失败前思考' })
    bridge.failTurn(state, '连接中断')
    const rows = events.filter((event) => event.type === 'assistant/message')
    assert.equal(rows.length, 1)
    assert.deepEqual(rows[0].data.message.content, [
      { type: 'reasoning', text: '失败前思考' },
      { type: 'text', text: '连接中断' }
    ])
    const end = events.find((event) => event.type === 'turn/end')
    assert.equal(end.data.reason.kind, 'error')
    assert.equal(events.filter((event) => event.type === 'step/end').length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a new remote step closes the previous one under its own coordinates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-bridge-'))
  const bridge = new SessionBridge({ pool: {}, store: { root }, manager: {}, log: () => {} })
  const { state, events } = createState(bridge)
  try {
    bridge.consumeEvent(state, { type: 'status', phase: 'turn_start', turn: 1 })
    bridge.consumeEvent(state, { type: 'status', phase: 'step_start', turn: 1, step: 1 })
    bridge.consumeEvent(state, { type: 'thinking', text: '第一段' })
    bridge.consumeEvent(state, { type: 'status', phase: 'step_start', turn: 1, step: 2 })
    const ends = events.filter((event) => event.type === 'step/end')
    assert.equal(ends.length, 1)
    assert.deepEqual(ends[0].data, { turn: 1, step: 1 })
    const row = events.find((event) => event.type === 'assistant/message')
    assert.equal(row.data.step, 1)
    assert.deepEqual(row.data.message.content, [{ type: 'reasoning', text: '第一段' }])
    const starts = events.filter((event) => event.type === 'step/start')
    assert.deepEqual(starts.map((event) => [event.data.turn, event.data.step]), [[1, 1], [1, 2]])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an oversized event line fails the turn instead of dropping events', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-bridge-'))
  const bridge = new SessionBridge({ pool: {}, store: { root }, manager: {}, log: () => {} })
  const { state } = createState(bridge)
  const failures = []
  try {
    bridge.failTurn = (target, message) => failures.push({ target, message })
    state.byteBuffer = Buffer.alloc(0)
    bridge.consumeBytes(state, Buffer.alloc(9 * 1024 * 1024, 0x61))
    assert.equal(failures.length, 1)
    assert.match(failures[0].message, /超过 8 \* 1024 \* 1024|超过 8388608/u)
    assert.equal(state.byteBuffer.length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
