// `/compact` in a bridged chat must run on the remote agent and then replace
// the same span in the anchor. These tests pin the two halves of that:
// `localCompactionSpan` picks a surface span the v4 validator accepts, and
// `compactBridgedNow` forwards `session/query` + mirrors the remote records.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionBridge } from '../lib/bridge.js'

/** Minimal session with the surface/append semantics the bridge relies on. */
function createSession(id = 'local-session') {
  let seq = 10
  const events = []
  const surface = []
  const session = {
    id,
    events,
    surface: {
      nodes: surface,
      replaceGeneration: 0
    },
    append(type, data, options = {}) {
      seq += 1
      const event = { type, seq, data, surfaceOp: options.surfaceOp, sourceEventSeqs: options.sourceEventSeqs }
      events.push(event)
      if (options.surfaceOp === 'append') {
        surface.push(seq)
      } else if (options.surfaceOp && typeof options.surfaceOp === 'object') {
        const first = surface.indexOf(options.surfaceOp.startSeq)
        const last = surface.indexOf(options.surfaceOp.endSeq)
        if (first < 0 || last < first) throw new Error('replacement range is not on the current surface')
        surface.splice(first, last - first + 1, seq)
      }
      return event
    },
    eventAt(value) {
      return events.find((event) => event.seq === value)
    }
  }
  return session
}

function appendSurface(session, entries) {
  for (const entry of entries) session.append(entry.type, entry.data, { surfaceOp: 'append' })
}

function createBridge(root) {
  return new SessionBridge({ pool: {}, store: { root }, manager: {}, log: () => {} })
}

function createState(bridge, session, extra = {}) {
  const state = {
    localSessionId: session.id,
    agent: { session },
    workspace: { id: 'workspace', remotePath: '/remote' },
    host: { id: 'host' },
    remoteSessionId: 'remote-session',
    running: false,
    compacting: false,
    compactForwarding: false,
    remoteCompaction: null,
    sdk: { ready: true, localReady: true },
    stream: { close() {} },
    sdkPending: new Map(),
    queue: [],
    closed: false,
    turn: 1,
    remoteTurn: 0,
    remoteStep: 0,
    toolSeqs: new Map(),
    pendingTools: [],
    ...extra
  }
  bridge.sessions.set(session.id, state)
  return state
}

const user = (text) => ({ type: 'user/message', data: { role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' }, id: `u-${text}` } })
const assistant = (blocks) => ({ type: 'assistant/message', data: { message: { role: 'assistant', content: blocks } } })
const result = () => ({ type: 'tool/result', data: { message: { role: 'tool', content: [{ type: 'text', text: 'ok' }] } } })

test('the compaction span skips a system head and keeps the last balanced tail', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-compact-'))
  const bridge = createBridge(root)
  try {
    const session = createSession()
    appendSurface(session, [
      { type: 'system/message', data: { role: 'system', content: [{ type: 'text', text: 'sys' }] } },
      user('first'),
      assistant([{ type: 'tool-call', id: 'c1', name: 'read', arguments: '{}' }]),
      result(),
      assistant([{ type: 'text', text: 'done' }])
    ])
    const span = bridge.localCompactionSpan({ session })
    assert.deepEqual(span.seqs, [session.surface.nodes[1], session.surface.nodes[2], session.surface.nodes[3]])
    assert.equal(span.start, session.surface.nodes[1])
    assert.equal(span.end, session.surface.nodes[3])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the compaction span never cuts an unanswered tool call', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-compact-'))
  const bridge = createBridge(root)
  try {
    const session = createSession()
    appendSurface(session, [
      user('first'),
      assistant([{ type: 'tool-call', id: 'c1', name: 'read', arguments: '{}' }])
    ])
    const span = bridge.localCompactionSpan({ session })
    // Only the opening user message is safe to replace; the unanswered call
    // stays in the retained tail.
    assert.deepEqual(span.seqs, [session.surface.nodes[0]])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('mirrorRemoteCompaction writes the native record sequence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-compact-'))
  const bridge = createBridge(root)
  try {
    const session = createSession()
    appendSurface(session, [
      user('first'),
      assistant([{ type: 'tool-call', id: 'c1', name: 'read', arguments: '{}' }]),
      result(),
      assistant([{ type: 'text', text: 'tail' }])
    ])
    const state = createState(bridge, session)
    const span = bridge.localCompactionSpan({ session })
    const returned = bridge.mirrorRemoteCompaction({ session }, span, {
      summary: {
        blocks: [{ type: 'text', text: 'condensed' }],
        rawOutput: [{ type: 'text', text: 'condensed' }, { type: 'reasoning', text: 'ignored' }],
        provider: 'remote-provider',
        model: 'remote-model',
        maxTokens: 4096,
        usage: { inputTokens: 10 },
        tokenCount: 99
      },
      checkpoint: { content: [{ type: 'text', text: 'checkpoint body' }] }
    }, 'command-1')

    const start = session.events.at(-4)
    const summary = session.events.at(-3)
    const checkpoint = session.events.at(-2)
    const end = session.events.at(-1)
    assert.deepEqual([start.type, summary.type, checkpoint.type, end.type], [
      'compaction/start', 'compaction/summary', 'user/message', 'compaction/end'
    ])
    assert.equal(start.data.turn, null)
    assert.equal(start.data.sourceCommandId, 'command-1')
    assert.deepEqual(summary.data.shadowedSeqs, span.seqs)
    assert.deepEqual(summary.data.shadowedRange, { start: span.start, end: span.end })
    assert.equal(summary.data.provider, 'remote-provider')
    assert.equal(summary.data.model, 'remote-model')
    assert.deepEqual(summary.data.rawOutput, [{ type: 'text', text: 'condensed' }])
    assert.equal(summary.data.shadowedTokenCount, 99)
    assert.deepEqual(checkpoint.data.content, [{ type: 'text', text: 'checkpoint body' }])
    assert.deepEqual(checkpoint.data.source, {
      kind: 'compact-checkpoint',
      compactionId: start.data.compactionId,
      sourceCommandId: 'command-1'
    })
    assert.deepEqual(checkpoint.surfaceOp, { op: 'replace', startSeq: span.start, endSeq: span.end })
    assert.deepEqual(checkpoint.sourceEventSeqs, [start.seq, summary.seq, ...span.seqs])
    assert.equal(end.data.compactionId, start.data.compactionId)
    assert.equal(returned.summarySeq, summary.seq)
    assert.deepEqual(returned.shadowedSeqs, span.seqs)
    assert.deepEqual(session.surface.nodes, [checkpoint.seq, session.surface.nodes[1]])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a failed checkpoint closes the compaction with an error record', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-compact-'))
  const bridge = createBridge(root)
  try {
    const session = createSession()
    appendSurface(session, [user('first'), assistant([{ type: 'text', text: 'answer' }])])
    createState(bridge, session)
    const span = bridge.localCompactionSpan({ session })
    const original = session.append
    session.append = (type, data, options) => {
      if (type === 'user/message') return null
      return original.call(session, type, data, options)
    }
    assert.throws(
      () => bridge.mirrorRemoteCompaction({ session }, span, {
        summary: { blocks: [{ type: 'text', text: 'condensed' }] },
        checkpoint: null
      }, 'command-1'),
      /checkpoint/u
    )
    const end = session.events.at(-1)
    assert.equal(end.type, 'compaction/end')
    assert.equal(typeof end.data.error, 'string')
    assert.ok(end.data.error.length > 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('remote compaction events are captured only during a forwarded /compact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-compact-'))
  const bridge = createBridge(root)
  try {
    const session = createSession()
    createState(bridge, session, { running: true })
    const state = bridge.sessions.get(session.id)
    // Outside a forwarded command the same records are ignored.
    bridge.sdkSessionEvent(state, { type: 'compaction/summary', data: { summary: [{ type: 'text', text: 'x' }] } })
    assert.equal(state.remoteCompaction, null)

    state.remoteCompaction = { summary: null, checkpoint: null }
    bridge.sdkSessionEvent(state, {
      type: 'compaction/summary',
      data: {
        summary: [{ type: 'text', text: 'condensed' }, { type: 'reasoning', text: 'drop' }],
        rawOutput: [{ type: 'text', text: 'raw' }],
        provider: 'p',
        model: 'm',
        shadowedTokenCount: 12
      }
    })
    bridge.sdkSessionEvent(state, {
      type: 'user/message',
      data: { role: 'user', content: [{ type: 'text', text: 'plain user turn' }], source: { kind: 'user' } }
    })
    assert.equal(state.remoteCompaction.checkpoint, null)
    bridge.sdkSessionEvent(state, {
      type: 'user/message',
      data: {
        role: 'user',
        content: [{ type: 'text', text: 'checkpoint' }],
        source: { kind: 'compact-checkpoint', compactionId: 'c', sourceCommandId: 'cmd' }
      }
    })
    assert.deepEqual(state.remoteCompaction.summary.blocks, [{ type: 'text', text: 'condensed' }])
    assert.equal(state.remoteCompaction.summary.tokenCount, 12)
    assert.deepEqual(state.remoteCompaction.checkpoint.content, [{ type: 'text', text: 'checkpoint' }])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('compactBridgedNow sends session/query and mirrors the captured checkpoint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-compact-'))
  const bridge = createBridge(root)
  try {
    const session = createSession()
    appendSurface(session, [
      user('first'),
      assistant([{ type: 'tool-call', id: 'c1', name: 'read', arguments: '{}' }]),
      result(),
      assistant([{ type: 'text', text: 'tail' }])
    ])
    const state = createState(bridge, session)
    let sent = null
    bridge.sdkCall = async (target, method, params) => {
      sent = { target, method, params }
      bridge.sdkSessionEvent(target, { type: 'turn/start', data: { turn: 9 } })
      bridge.sdkSessionEvent(target, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'should not mirror' }] } } })
      bridge.sdkSessionEvent(target, {
        type: 'compaction/summary',
        data: { summary: [{ type: 'text', text: 'remote summary' }], provider: 'remote', model: 'remote', shadowedTokenCount: 50 }
      })
      bridge.sdkSessionEvent(target, {
        type: 'user/message',
        data: { role: 'user', content: [{ type: 'text', text: 'remote checkpoint' }], source: { kind: 'compact-checkpoint', compactionId: 'r', sourceCommandId: 'r' } }
      })
      return { kind: 'command', execution: { commandId: 'r', result: { kind: 'success', text: 'Compacted 3 history items (~50 tokens).', sourceEventSeq: 77 } } }
    }
    const assistantBefore = session.events.filter((event) => event.type === 'assistant/message').length
    const turnBefore = session.events.filter((event) => event.type === 'turn/start').length
    const returned = await bridge.compactBridgedNow(state.agent, undefined, 'command-1')
    assert.equal(sent.method, 'session/query')
    assert.equal(sent.params.sessionId, 'remote-session')
    assert.deepEqual(sent.params.contentBlocks, [{ type: 'text', text: '/compact' }])
    assert.ok(session.events.some((event) => event.type === 'compaction/start'))
    const checkpoint = session.events.find((event) => event.data?.source?.kind === 'compact-checkpoint')
    assert.deepEqual(checkpoint.data.content, [{ type: 'text', text: 'remote checkpoint' }])
    // Turn-shaped remote events during the forwarded command are not mirrored:
    // the anchor has no local turn markers for them.
    assert.equal(session.events.filter((event) => event.type === 'assistant/message').length, assistantBefore)
    assert.equal(session.events.filter((event) => event.type === 'turn/start').length, turnBefore)
    const summaryEvent = session.events.at(-3)
    assert.equal(summaryEvent.type, 'compaction/summary')
    assert.equal(returned.summarySeq, summaryEvent.seq)
    assert.equal(state.compacting, false)
    assert.equal(state.remoteCompaction, null)
    assert.equal(state.compactForwarding, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a compact success without a summary rewrites nothing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-compact-'))
  const bridge = createBridge(root)
  try {
    const session = createSession()
    appendSurface(session, [user('first'), assistant([{ type: 'text', text: 'tail' }])])
    const state = createState(bridge, session)
    bridge.sdkCall = async () => ({
      kind: 'command',
      execution: { commandId: 'r', result: { kind: 'success', text: 'No compactable history yet.' } }
    })
    const before = session.events.length
    const returned = await bridge.compactBridgedNow(state.agent, undefined, 'command-1')
    assert.equal(returned, null)
    assert.equal(session.events.length, before)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an old remote runtime reports the version gap instead of a protocol error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-compact-'))
  const bridge = new SessionBridge({
    pool: {},
    store: { root, settings: { dshVersion: '0.2.2-rc.1' } },
    manager: {},
    log: () => {}
  })
  try {
    const session = createSession()
    appendSurface(session, [user('first'), assistant([{ type: 'text', text: 'tail' }])])
    const state = createState(bridge, session, {
      workspace: { id: 'workspace', remotePath: '/remote', dshVersion: '0.2.1-rc.5' }
    })
    bridge.sdkCall = async () => {
      throw new Error('session/query: unknown DeepSeek Harness SDK runtime method: session/query')
    }
    await assert.rejects(
      () => bridge.compactBridgedNow(state.agent, undefined, 'command-1'),
      (error) => /still runs dsh 0\.2\.1-rc\.5/u.test(error.message)
        && /cannot forward remote commands/u.test(error.message)
        && /dsh 0\.2\.2-rc\.1 is not installed on this host/u.test(error.message)
    )
    assert.equal(state.compacting, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/** Per-agent command registry stand-in: one layer, `find` sees the stock one. */
function createCommandHost(stock) {
  const registrations = new Map()
  const commands = {
    find(_agent, name) {
      return name === 'compact' && stock ? stock : undefined
    },
    register(definition) {
      if (registrations.has(definition.name)) throw new Error('duplicate command')
      registrations.set(definition.name, definition)
      return () => registrations.delete(definition.name)
    }
  }
  return { commands, registrations }
}

function attachCommandHost(state, host) {
  state.agent.ctx = {
    inject(_deps, callback) {
      callback({ commands: host.commands })
      return () => {}
    }
  }
  return state
}

const invocation = (state, rawInput = '') => ({
  commandId: 'cmd-1',
  agent: state.agent,
  rawInput,
  attachments: [],
  signal: { aborted: false, addEventListener() {}, removeEventListener() {} }
})

test('a bridged agent gets its own /compact, and it runs on the remote agent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-compact-'))
  const bridge = createBridge(root)
  try {
    const session = createSession()
    appendSurface(session, [user('first'), assistant([{ type: 'text', text: 'tail' }])])
    const state = createState(bridge, session)
    let stockCalls = 0
    const stock = {
      name: 'compact',
      description: 'Compact older conversation history',
      handler: () => {
        stockCalls += 1
        return { kind: 'success', text: 'stock' }
      }
    }
    const host = createCommandHost(stock)
    attachCommandHost(state, host)
    assert.equal(bridge.installRemoteCompactCommand(state), true)
    const definition = host.registrations.get('compact')
    assert.equal(definition.description, stock.description)
    bridge.sdkCall = async (target) => {
      bridge.sdkSessionEvent(target, {
        type: 'compaction/summary',
        data: { summary: [{ type: 'text', text: 'remote summary' }], provider: 'remote', model: 'remote', shadowedTokenCount: 50 }
      })
      bridge.sdkSessionEvent(target, {
        type: 'user/message',
        data: { role: 'user', content: [{ type: 'text', text: 'checkpoint' }], source: { kind: 'compact-checkpoint', compactionId: 'r', sourceCommandId: 'r' } }
      })
      return { kind: 'command', execution: { commandId: 'r', result: { kind: 'success', text: 'Compacted 2 history items (~50 tokens).', sourceEventSeq: 7 } } }
    }
    const result = await definition.handler(invocation(state))
    assert.equal(stockCalls, 0)
    assert.equal(result.kind, 'success')
    assert.equal(result.text, 'Compacted 1 history items (~50 tokens).')
    assert.equal(typeof result.sourceEventSeq, 'number')
    assert.ok(session.events.some((event) => event.type === 'compaction/end' && !event.data.error))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the scoped /compact answers like the stock command where it cannot act', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-compact-'))
  const bridge = createBridge(root)
  try {
    const session = createSession()
    appendSurface(session, [user('first'), assistant([{ type: 'text', text: 'tail' }])])
    const state = createState(bridge, session)
    let stockCalls = 0
    const stock = {
      name: 'compact',
      description: 'Compact older conversation history',
      handler: () => {
        stockCalls += 1
        return { kind: 'success', text: 'stock' }
      }
    }
    const host = createCommandHost(stock)
    attachCommandHost(state, host)
    bridge.installRemoteCompactCommand(state)
    const definition = host.registrations.get('compact')

    assert.deepEqual(await definition.handler(invocation(state, ' extra')), {
      kind: 'error',
      text: 'Usage: /compact (no arguments)'
    })
    state.running = true
    assert.match((await definition.handler(invocation(state))).text, /active compaction/u)
    state.running = false
    // No remote history yet: the anchor falls back to the stock command.
    const savedRemote = state.remoteSessionId
    state.remoteSessionId = ''
    assert.equal((await definition.handler(invocation(state))).kind, 'success')
    assert.equal(stockCalls, 1)
    state.remoteSessionId = savedRemote
    // Nothing to compact: the native "no history" answer, without rewriting.
    session.surface.nodes.length = 0
    assert.deepEqual(await definition.handler(invocation(state)), { kind: 'success', text: 'No compactable history yet.' })
    assert.equal(stockCalls, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('without a stock command the fallback names the real problem', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-compact-'))
  const bridge = createBridge(root)
  try {
    const session = createSession()
    appendSurface(session, [user('first'), assistant([{ type: 'text', text: 'tail' }])])
    const state = createState(bridge, session, { remoteSessionId: '' })
    const host = createCommandHost(null)
    attachCommandHost(state, host)
    bridge.installRemoteCompactCommand(state)
    const definition = host.registrations.get('compact')

    // No remote history and no stock command: saying "an active compaction"
    // would blame the wrong cause.
    assert.deepEqual(await definition.handler(invocation(state)), {
      kind: 'error',
      text: 'Compaction is not available for this session.'
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a step boundary closes a tool call whose result never arrived', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-compact-'))
  const bridge = createBridge(root)
  try {
    const session = createSession()
    const state = createState(bridge, session)
    state.stepOpen = true
    state.turnOpen = true
    state.remoteTurn = 1
    state.remoteStep = 1
    state.assistantForStep = true
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'call_lost', name: 'bash', arguments: '{}' }]
      }
    }, { surfaceOp: 'append' })
    const call = session.append('tool/call', { turn: 1, step: 1, callId: 'call_lost', name: 'bash', arguments: '{}' })
    state.toolSeqs.set('call_lost', call.seq)

    bridge.closeStep(state)

    const result = session.events.find((event) => event.type === 'tool/result')
    assert.equal(result.data.message.toolCallId, 'call_lost')
    assert.equal(result.data.message.isError, true)
    assert.deepEqual(result.data.error, { name: 'ToolOutcomeUnknownError', code: 'TOOL_OUTCOME_UNKNOWN' })
    assert.deepEqual(result.surfaceOp, 'append')
    assert.deepEqual(result.sourceEventSeqs, [call.seq])
    // A result after step/end would still fail the v4 validator.
    const end = session.events.find((event) => event.type === 'step/end')
    assert.ok(result.seq < end.seq)
    assert.equal(state.toolSeqs.size, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('detaching the bridge removes the scoped /compact again', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-compact-'))
  const bridge = createBridge(root)
  try {
    const session = createSession()
    const state = createState(bridge, session, {
      generation: 0,
      warmSerial: 0,
      live: false,
      timer: null,
      warmTimer: null,
      warmRefresh: null,
      original: { followup() {}, steer() {}, cancel() {}, whenIdle() {} }
    })
    const host = createCommandHost({ name: 'compact', description: 'stock', handler: () => ({ kind: 'success', text: 'stock' }) })
    attachCommandHost(state, host)
    bridge.installRemoteCompactCommand(state)
    assert.ok(host.registrations.has('compact'))
    bridge.detach(state)
    assert.equal(host.registrations.has('compact'), false)
    assert.equal(state.compactCommand, null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a remote compaction end error is captured as the real failure reason', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-compact-'))
  const bridge = createBridge(root)
  try {
    const session = createSession()
    createState(bridge, session)
    const state = bridge.sessions.get(session.id)
    state.remoteCompaction = { summary: null, checkpoint: null, failure: null }
    bridge.sdkSessionEvent(state, { type: 'compaction/end', data: { compactionId: 'c', error: 'Request timed out.' } })
    assert.equal(state.remoteCompaction.failure, 'Request timed out.')
    // Outside a forwarded command the record is ignored.
    state.remoteCompaction = null
    bridge.sdkSessionEvent(state, { type: 'compaction/end', data: { compactionId: 'c', error: 'ignored' } })
    assert.equal(state.remoteCompaction, null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a transient remote compaction failure is retried and succeeds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-compact-'))
  const bridge = createBridge(root)
  try {
    const session = createSession()
    appendSurface(session, [user('first'), assistant([{ type: 'text', text: 'tail' }])])
    const state = createState(bridge, session)
    let attempts = 0
    bridge.sdkCall = async (target) => {
      attempts += 1
      if (attempts === 1) {
        bridge.sdkSessionEvent(target, { type: 'compaction/start', data: { compactionId: 'r1' } })
        bridge.sdkSessionEvent(target, { type: 'compaction/end', data: { compactionId: 'r1', error: 'Request timed out.' } })
        return {
          kind: 'command',
          execution: { commandId: 'r1', result: { kind: 'error', text: 'Compaction could not produce a useful summary.' } }
        }
      }
      bridge.sdkSessionEvent(target, {
        type: 'compaction/summary',
        data: { summary: [{ type: 'text', text: 'remote summary' }], provider: 'remote', model: 'remote', shadowedTokenCount: 50 }
      })
      bridge.sdkSessionEvent(target, {
        type: 'user/message',
        data: { role: 'user', content: [{ type: 'text', text: 'checkpoint' }], source: { kind: 'compact-checkpoint', compactionId: 'r2', sourceCommandId: 'r2' } }
      })
      return { kind: 'command', execution: { commandId: 'r2', result: { kind: 'success', text: 'Compacted 1 history items (~50 tokens).', sourceEventSeq: 88 } } }
    }
    const returned = await bridge.compactBridgedNow(state.agent, undefined, 'command-1')
    assert.equal(attempts, 2)
    assert.ok(returned.summarySeq)
    assert.equal(state.compacting, false)
    assert.equal(state.remoteCompaction, null)
    assert.equal(state.compactForwarding, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a permanent remote compaction failure surfaces the provider reason once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-compact-'))
  const bridge = createBridge(root)
  try {
    const session = createSession()
    appendSurface(session, [user('first'), assistant([{ type: 'text', text: 'tail' }])])
    const state = createState(bridge, session)
    let attempts = 0
    bridge.sdkCall = async (target) => {
      attempts += 1
      bridge.sdkSessionEvent(target, { type: 'compaction/end', data: { compactionId: 'r', error: 'context length exceeded' } })
      return {
        kind: 'command',
        execution: { commandId: 'r', result: { kind: 'error', text: 'Compaction could not produce a useful summary.' } }
      }
    }
    await assert.rejects(
      () => bridge.compactBridgedNow(state.agent, undefined, 'command-1'),
      (error) => /Remote compaction failed: context length exceeded/u.test(error.message)
        && !/could not produce a useful summary/u.test(error.message)
    )
    assert.equal(attempts, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
