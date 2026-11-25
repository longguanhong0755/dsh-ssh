// A remote workspace is projected into DSH's sidebar as a native workspace
// whose anchor directory the plugin owns. The registry cannot say *why* a row
// is missing: it only reports what exists now. That makes a user deleting the
// row in the sidebar indistinguishable from a registry that never knew the row
// (app restart, new DSH profile, workspace service reload) -- trusting the
// registry alone resurrects deleted rows forever, exactly the reported "I
// delete it and it pops right back". The plugin therefore remembers the rows
// this process projected and turns a row that vanishes mid-process into a
// persistent tombstone (`nativeHidden`), which later passes honour instead of
// re-creating the row.
//
// The first pass of a process has no memory by construction, so it must not
// decide: `projected` starts empty, and every persisted `nativeWorkspaceId`
// points at nothing after a registry reset. Reading absence as a deletion there
// would hide every project instead of rebuilding the rows a restart is
// supposed to rebuild. Ambiguity on the first pass is therefore resolved by
// creating (or re-adopting) the row, not by hiding it.
//
// Each test imports a fresh copy of lib/native.js (ESM query string) so the
// process-lifetime `projected` map does not leak between cases.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { anchorPath } from '../lib/native.js'

async function freshNative(tag) {
  return await import(`../lib/native.js?case=${tag}`)
}

async function tempRoot() {
  return await mkdtemp(join(tmpdir(), 'dsh-ssh-native-hidden-'))
}

/** Store double: state.json shape, in-memory patches, no disk writes. */
function makeStore(root, workspaces = []) {
  const rows = workspaces.map((workspace) => ({ hostId: 'host-1', ...workspace }))
  const patches = []
  return {
    root,
    patches,
    get workspaces() {
      return rows
    },
    add(workspace) {
      rows.push({ hostId: 'host-1', ...workspace })
      return rows[rows.length - 1]
    },
    workspace(id) {
      return rows.find((workspace) => workspace.id === String(id)) || null
    },
    async patchWorkspace(id, patch) {
      const workspace = this.workspace(id)
      if (!workspace) return null
      Object.assign(workspace, patch)
      patches.push({ id: String(id), patch: { ...patch } })
      return workspace
    },
    async removeWorkspace(id) {
      const index = rows.findIndex((workspace) => workspace.id === String(id))
      if (index >= 0) rows.splice(index, 1)
    }
  }
}

function makeEntity(id, path, title) {
  return {
    id,
    path,
    title,
    sessionIds: [],
    async attachSession(sessionId) {
      this.sessionIds = [sessionId, ...this.sessionIds]
    },
    async setTitle(value) {
      this.title = value
    }
  }
}

/**
 * Registry double. `create` canonicalises by path like the real one (a second
 * create reuses the row); `delete` is what both the plugin and the sidebar's
 * own delete button call.
 */
function makeRegistry() {
  const rows = new Map()
  let nextId = 0
  return {
    createCalls: [],
    get(id) {
      return rows.get(String(id))
    },
    list() {
      return [...rows.values()]
    },
    async create(path, title) {
      const existing = [...rows.values()].find((row) => row.path === path)
      if (existing) {
        this.createCalls.push({ path, id: existing.id, reused: true })
        return existing
      }
      nextId += 1
      const entity = makeEntity(`native-${nextId}`, path, title)
      rows.set(entity.id, entity)
      this.createCalls.push({ path, id: entity.id, reused: false })
      return entity
    },
    async delete(id) {
      return rows.delete(String(id))
    },
    async resolveByPath(path) {
      return [...rows.values()].find((row) => row.path === path) || null
    },
    async listStoredHeaders() {
      return []
    },
    async indexHeaders() {}
  }
}

function makeCtx(registry) {
  return {
    get(name) {
      return name === 'workspaceRegistry' ? registry : undefined
    }
  }
}

function captureLog() {
  const lines = []
  return {
    lines,
    write: (level, message) => lines.push(`${level}: ${message}`),
    infos: () => lines.filter((line) => line.startsWith('info: ')),
    warns: () => lines.filter((line) => line.startsWith('warn: '))
  }
}

test('a row deleted in the sidebar mid-session is tombstoned and never re-created', async () => {
  const native = await freshNative('mid-session-delete')
  const root = await tempRoot()
  try {
    const store = makeStore(root, [{ id: 'ws-linuxdo', name: 'linuxdo', remotePath: '/srv/linuxdo' }])
    const registry = makeRegistry()
    const log = captureLog()
    const ctx = makeCtx(registry)

    const first = await native.reconcileNativeWorkspaces({ ctx, store, log: log.write })
    assert.equal(first.available, true)
    assert.equal(registry.createCalls.length, 1)
    const nativeId = registry.createCalls[0].id
    assert.equal(store.workspace('ws-linuxdo').nativeWorkspaceId, nativeId)

    // The user deletes the projected row from DSH's sidebar.
    await registry.delete(nativeId)

    const second = await native.reconcileNativeWorkspaces({ ctx, store, log: log.write })
    assert.equal(store.workspace('ws-linuxdo').nativeHidden, true)
    assert.equal(store.workspace('ws-linuxdo').nativeWorkspaceId, '')
    assert.equal(registry.createCalls.length, 1, 'the deleted row must not be created again')
    assert.deepEqual(second.rows, [])
    assert.equal(registry.list().length, 0)

    // Later passes must not undo the decision either.
    await native.reconcileNativeWorkspaces({ ctx, store, log: log.write })
    assert.equal(registry.createCalls.length, 1)
    assert.equal(registry.list().length, 0)

    const hides = log.infos().filter((line) => line.includes('deleted in the sidebar'))
    assert.equal(hides.length, 1, 'exactly one info line records the deletion decision')
    assert.deepEqual(log.warns(), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a record hidden in the sidebar is never projected again (and needs no anchor)', async () => {
  const native = await freshNative('hidden-never-created')
  const root = await tempRoot()
  try {
    const store = makeStore(root, [{
      id: 'ws-mail',
      name: 'mail',
      remotePath: '/srv/mail',
      nativeHidden: true,
      nativeWorkspaceId: ''
    }])
    const registry = makeRegistry()

    const result = await native.reconcileNativeWorkspaces({ ctx: makeCtx(registry), store, log: () => {} })

    assert.equal(registry.createCalls.length, 0)
    assert.deepEqual(result.rows, [])
    assert.equal(existsSync(anchorPath(store, store.workspace('ws-mail'))), false, 'hidden records skip mkdir as well')
    assert.equal(existsSync(join(root, 'anchors')), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reveal clears the flag and re-projects the row with a fresh native id', async () => {
  const native = await freshNative('hide-then-reveal')
  const root = await tempRoot()
  try {
    const store = makeStore(root, [{ id: 'ws-music', name: 'musicmarbles', remotePath: '/srv/music' }])
    const registry = makeRegistry()
    const ctx = makeCtx(registry)

    await native.reconcileNativeWorkspaces({ ctx, store, log: () => {} })
    const firstId = store.workspace('ws-music').nativeWorkspaceId
    const path = store.workspace('ws-music').nativePath
    assert.equal(registry.createCalls.length, 1)

    // op:'hide' -> tombstone, then drop the row.
    await store.patchWorkspace('ws-music', { nativeHidden: true, nativeWorkspaceId: '' })
    await native.forgetNativeWorkspace({ ctx, store, workspace: store.workspace('ws-music'), log: () => {} })
    assert.equal(registry.list().length, 0)

    // op:'reveal' -> clear the flag, reconcile, get the row back. No timer pass
    // runs in between on purpose: the row this process deleted on purpose must
    // not be mistaken for a user deletion when the immediate reveal reconciles.
    await store.patchWorkspace('ws-music', { nativeHidden: false })
    const revealed = await native.reconcileNativeWorkspaces({ ctx, store, log: () => {} })

    assert.equal(revealed.available, true)
    assert.equal(registry.createCalls.length, 2)
    const secondId = store.workspace('ws-music').nativeWorkspaceId
    assert.ok(secondId)
    assert.notEqual(secondId, firstId)
    assert.equal(store.workspace('ws-music').nativePath, path)
    assert.equal(store.workspace('ws-music').nativeHidden, false)
    assert.equal(registry.get(secondId).path, anchorPath(store, store.workspace('ws-music')))
    assert.equal(revealed.rows.length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a brand-new record still projects on the first pass and records its native id', async () => {
  const native = await freshNative('first-pass-new-record')
  const root = await tempRoot()
  try {
    const store = makeStore(root, [{ id: 'ws-ui', name: 'ui-showcase', remotePath: '/srv/ui' }])
    const registry = makeRegistry()

    const result = await native.reconcileNativeWorkspaces({ ctx: makeCtx(registry), store, log: () => {} })

    assert.equal(registry.createCalls.length, 1)
    assert.equal(result.rows.length, 1)
    assert.equal(result.rows[0].nativeId, registry.createCalls[0].id)
    assert.equal(store.workspace('ws-ui').nativeWorkspaceId, registry.createCalls[0].id)
    assert.equal(store.workspace('ws-ui').nativePath, anchorPath(store, store.workspace('ws-ui')))
    assert.equal(store.workspace('ws-ui').nativeHidden, undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the first pass rebuilds a row even when the persisted native id points at nothing', async () => {
  const native = await freshNative('first-pass-registry-reset')
  const root = await tempRoot()
  try {
    // A registry reset (new profile, service reload) leaves this id dangling.
    const store = makeStore(root, [{
      id: 'ws-reset',
      name: 'reset',
      remotePath: '/srv/reset',
      nativeWorkspaceId: 'native-from-last-run'
    }])
    const registry = makeRegistry()

    await native.reconcileNativeWorkspaces({ ctx: makeCtx(registry), store, log: () => {} })

    assert.equal(registry.createCalls.length, 1)
    assert.notEqual(store.workspace('ws-reset').nativeHidden, true, 'first-pass ambiguity must not hide the project')
    assert.equal(store.workspace('ws-reset').nativeWorkspaceId, registry.createCalls[0].id)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a record removed through the plugin forgets its tracked native id', async () => {
  const native = await freshNative('removed-record-forget')
  const root = await tempRoot()
  try {
    const store = makeStore(root, [{ id: 'ws-reuse', name: 'reuse', remotePath: '/srv/reuse' }])
    const registry = makeRegistry()
    const ctx = makeCtx(registry)

    await native.reconcileNativeWorkspaces({ ctx, store, log: () => {} })
    assert.equal(store.workspace('ws-reuse').nativeWorkspaceId, 'native-1')

    // op:'remove' drops the store record. Even if the row somehow outlives it,
    // the stale scan removes it, and the tracking map must not keep the dead id.
    await store.removeWorkspace('ws-reuse')
    await native.reconcileNativeWorkspaces({ ctx, store, log: () => {} })
    assert.equal(registry.list().length, 0)

    // A record that reuses the id is new, not the deleted one: project it.
    store.add({ id: 'ws-reuse', name: 'reuse again', remotePath: '/srv/reuse-again' })
    await native.reconcileNativeWorkspaces({ ctx, store, log: () => {} })

    assert.equal(registry.createCalls.length, 2)
    assert.notEqual(store.workspace('ws-reuse').nativeHidden, true)
    assert.equal(store.workspace('ws-reuse').nativeWorkspaceId, 'native-2')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})