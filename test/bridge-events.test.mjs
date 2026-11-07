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
