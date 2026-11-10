// The exact failure the user hit: `/compact` in a bridged chat, right after the
// app (or the plugin) restarted, reported
//   Remote compaction failed: no model selection resolved for this bridged chat
// because no turn had run `applyModel` yet. This walks the real entry point
// (`runRemoteCompact` → `forwardRemoteCompact` → `bootSdk` → `sdkHandshake`)
// with a chat that starts without a route and proves the command still runs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionBridge } from '../lib/bridge.js'

function createBridge(root, { selection = { provider: 'deepseek', model: 'deepseek-v4.1-flash' } } = {}) {
  const bridge = new SessionBridge({ pool: {}, store: { root, settings: {} }, manager: {}, log: () => {} })
  bridge.ctx = {
    get(name) {
      if (name === 'agentDefaultModel') return { currentSelection: () => selection }
      return null
    }
  }
  return bridge
}

function createState(overrides = {}) {
  return {
    localSessionId: 'session-local',
    agent: { session: { id: 'session-local', log: [] } },
    workspace: { id: 'ws', remotePath: '/root/ui-showcase', dshVersion: '0.2.2-rc.1' },
    host: { id: 'host' },
    remoteSessionId: 'session-remote',
    running: false,
    compacting: false,
    compactForwarding: false,
    remoteCompaction: null,
    sdk: null,
    stream: null,
    sdkPending: new Map(),
    queue: [],
    closed: false,
    turn: 7,
    model: null,
    modelKey: '',
    ...overrides
  }
}

test('a bridged /compact after a restart resolves the route instead of failing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-compact-route-'))
  const bridge = createBridge(root)
  try {
    const state = createState()
    bridge.sessions.set(state.localSessionId, state)
    const calls = []
    bridge.syncWorkspaceRuntime = async () => false
    bridge.retireStaleRunners = async () => false
    bridge.startTail = async () => { state.stream = { close() {} } }
    bridge.bootSdk = async (target) => {
      // The real boot writes the headless profile from the adopted route, so a
      // missing model must already be resolved at this point.
      calls.push(`boot:${target.model ? target.model.model : 'no-model'}`)
      await bridge.sdkHandshake(target)
      target.sdk = { ready: true, localReady: true }
      return target.sdk
    }
    bridge.sdkCall = async (target, method, params) => {
      calls.push(`${method}:${params.provider || ''}/${params.model || ''}`)
      if (method === 'session/query') {
        return {
          kind: 'command',
          execution: { commandId: 'c', result: { kind: 'success', text: 'No compactable history yet.' } }
        }
      }
      return { kind: 'ready' }
    }
    const returned = await bridge.runRemoteCompact(state)
    assert.equal(returned, null)
    assert.equal(state.model?.model, 'deepseek-v4.1-flash')
    assert.deepEqual(calls, [
      'boot:deepseek-v4.1-flash',
      'initialize:deepseek/deepseek-v4.1-flash',
      'session/query:/'
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a command that has no route names the picker instead of a raw handshake error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-compact-route-'))
  const bridge = createBridge(root)
  try {
    bridge.ctx = { get: () => null }
    const state = createState()
    bridge.sessions.set(state.localSessionId, state)
    bridge.syncWorkspaceRuntime = async () => false
    bridge.retireStaleRunners = async () => false
    // `compactBridgedNow` is what the `/compact` command calls and it adds the
    // `Remote compaction failed:` prefix the user sees.
    await assert.rejects(
      () => bridge.runRemoteCompact(state),
      /模型选择/u
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
