// `/compact` in a bridged chat is registered inside that agent's own command
// layer (`agent.ctx.inject(['commands'])`). A host bundle is free to disable the
// preset command — billion-context does exactly that, which is how the slash
// menu lost `/compact` for local chats — and the command layer is also rebuilt
// when a profile reloads. A silently missing command looks like a deleted
// feature in the renderer, so the bridge re-registers it instead: on every
// prompt, on every status poll and on demand through the self-check route.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionBridge } from '../lib/bridge.js'

function createBridge(root) {
  const logs = []
  const bridge = new SessionBridge({
    pool: {},
    store: { root, settings: {} },
    manager: {},
    log: (level, message) => logs.push(`${level}: ${message}`)
  })
  bridge.logs = logs
  return bridge
}

/** An agent whose ctx exposes the command registry the bridge registers into. */
function createAgent({ stock = null, ctx = true } = {}) {
  const calls = { inject: 0, registers: 0, disposes: 0 }
  const agent = { session: { id: 'session-local' } }
  if (!ctx) return { agent, calls }
  agent.ctx = {
    inject(names, callback) {
      calls.inject += 1
      const commands = {
        find: () => stock,
        register(definition) {
          calls.registers += 1
          calls.lastDefinition = definition
          return () => {
            calls.disposes += 1
          }
        }
      }
      callback({ commands })
      return () => {
        calls.disposes += 1
      }
    }
  }
  return { agent, calls }
}

function createState(agent, overrides = {}) {
  return {
    localSessionId: 'session-local',
    agent,
    workspace: { id: 'ws', name: 'ui-showcase' },
    remoteSessionId: 'session-remote',
    running: false,
    compacting: false,
    queue: [],
    closed: false,
    turn: 3,
    compactCommand: null,
    ...overrides
  }
}

test('adopting a chat registers /compact inside its own command layer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-compact-self-'))
  const bridge = createBridge(root)
  try {
    const stock = { handler: () => ({ kind: 'success', text: 'stock' }) }
    const { agent, calls } = createAgent({ stock })
    const state = createState(agent)
    bridge.sessions.set(state.localSessionId, state)
    assert.equal(bridge.installRemoteCompactCommand(state), true)
    assert.equal(calls.registers, 1)
    assert.equal(calls.lastDefinition.name, 'compact')
    assert.equal(typeof calls.lastDefinition.handler, 'function')
    assert.equal(state.compactCommand.stock, stock)
    assert.ok(bridge.logs.some((line) => line.includes('runs on the remote agent')))

    const status = bridge.status.call({ sessions: new Map([['session-local', state]]) })
    assert.equal(status[0].compact, true)
    assert.equal(status[0].compactStock, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a command layer that dropped the registration is repaired on demand', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-compact-self-'))
  const bridge = createBridge(root)
  try {
    const { agent, calls } = createAgent()
    const state = createState(agent)
    bridge.sessions.set(state.localSessionId, state)
    bridge.installRemoteCompactCommand(state)
    // Simulate the recomposition: the registry entry is gone but the state still
    // believes it owns one.
    state.compactCommand.disposer = null

    assert.equal(bridge.ensureCompactCommand(state), true)
    assert.equal(calls.registers, 2)
    assert.ok(bridge.logs.some((line) => line.includes('re-registered /compact')))
    // The previous registration is disposed before the replacement is made.
    assert.ok(calls.disposes >= 1)

    // An intact registration is left alone.
    assert.equal(bridge.ensureCompactCommand(state), true)
    assert.equal(calls.registers, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a chat without a command layer reports the missing command instead of crashing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-compact-self-'))
  const bridge = createBridge(root)
  try {
    const { agent } = createAgent({ ctx: false })
    const state = createState(agent)
    assert.equal(bridge.installRemoteCompactCommand(state), false)
    assert.equal(bridge.ensureCompactCommand(state), false)

    const status = bridge.status.call({ sessions: new Map([['session-local', state]]) })
    assert.equal(status[0].compact, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('every prompt re-checks the command before the turn starts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-compact-self-'))
  const bridge = createBridge(root)
  try {
    const { agent, calls } = createAgent()
    const state = createState(agent)
    bridge.sessions.set(state.localSessionId, state)
    state.compactCommand = { stock: null, disposer: null, dispose: null }
    let turns = 0
    bridge.startTurn = async () => {
      turns += 1
    }
    await bridge.submit(state, { content: [{ type: 'text', text: 'hello' }] })
    assert.equal(turns, 1)
    assert.equal(calls.registers, 1)
    assert.equal(state.compactCommand.disposer !== null, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
