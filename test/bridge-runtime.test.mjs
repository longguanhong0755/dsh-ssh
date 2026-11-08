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
