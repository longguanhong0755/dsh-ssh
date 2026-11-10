// The sidebar row for a remote workspace is a native workspace whose
// membership the DSH registry re-validates on every read: a session whose
// header cannot be read at that moment is filtered out of the projection and
// pruned from the record by the next write, which leaves the remote chat under
// "Ungrouped" while its log is still on disk. These tests pin the recovery the
// plugin performs when it owns the anchor directory.

import assert from 'node:assert/strict'
import test from 'node:test'

import { attachAnchorSessions } from '../lib/native.js'

const ANCHOR = 'C:\\Users\\Administrator\\.dsh\\ssh-remote\\anchors\\ws-one'

/** Mirrors @deepseek-ai/dsh-workspace's entity: record + validated projection. */
function makeEntity({ path = ANCHOR, sessionIds = [], headers = new Map(), paths = new Map() } = {}) {
  const host = { sessionPaths: paths, headers }
  return {
    path,
    sessionIdsRecord: [...sessionIds],
    get sessionIds() {
      return this.sessionIdsRecord.filter((id) => !host.sessionPaths.has(id) || host.sessionPaths.get(id) === this.path)
    },
    async attachSession(id) {
      if (!this.sessionIdsRecord.includes(id)) {
        const header = headers.get(id)
        if (!header) throw new Error(`no such session '${id}'`)
        if (header.cwd !== this.path) throw new Error(`its cwd resolves to '${header.cwd}'`)
        host.sessionPaths.set(id, header.cwd)
      }
      if (this.sessionIdsRecord.includes(id)) return
      this.sessionIdsRecord = [id, ...this.sessionIdsRecord]
    }
  }
}

function makeRegistry(headers, entity) {
  return {
    calls: [],
    async listStoredHeaders() {
      this.calls.push('listStoredHeaders')
      return [...headers.values()].map((header) => ({ ...header }))
    },
    async indexHeaders(rows) {
      this.calls.push(`indexHeaders:${rows.length}`)
    },
    entity
  }
}

const ctx = { get: () => undefined }
const quiet = () => {}

test('an anchor session the registry dropped is re-attached to its row', async () => {
  const headers = new Map([
    ['session-dropped', { id: 'session-dropped', cwd: ANCHOR, createdAt: '2026-11-09T01:00:00.000Z' }],
    ['session-other', { id: 'session-other', cwd: 'C:\\elsewhere', createdAt: '2026-11-09T02:00:00.000Z' }]
  ])
  const entity = makeEntity({ headers })
  const registry = makeRegistry(headers, entity)

  const result = await attachAnchorSessions({ registry, ctx, entity, path: ANCHOR, log: quiet })

  assert.deepEqual(result, { attached: 1, wanted: 1 })
  assert.deepEqual(entity.sessionIds, ['session-dropped'])
})

test('sessions that run in another directory are never pulled into a row', async () => {
  const headers = new Map([
    ['session-other', { id: 'session-other', cwd: 'C:\\elsewhere' }],
    ['session-no-cwd', { id: 'session-no-cwd' }]
  ])
  const entity = makeEntity({ headers })
  const registry = makeRegistry(headers, entity)

  const result = await attachAnchorSessions({ registry, ctx, entity, path: ANCHOR, log: quiet })

  assert.deepEqual(result, { attached: 0, wanted: 0 })
  assert.deepEqual(entity.sessionIds, [])
})

test('a second pass is a no-op instead of duplicating members', async () => {
  const headers = new Map([['session-one', { id: 'session-one', cwd: ANCHOR }]])
  const entity = makeEntity({ headers, sessionIds: ['session-one'] })
  const registry = makeRegistry(headers, entity)

  const first = await attachAnchorSessions({ registry, ctx, entity, path: ANCHOR, log: quiet })
  const second = await attachAnchorSessions({ registry, ctx, entity, path: ANCHOR, log: quiet })

  assert.equal(first.attached, 0)
  assert.equal(second.attached, 0)
  assert.deepEqual(entity.sessionIds, ['session-one'])
})

test('re-attached sessions keep the newest-first order the sidebar expects', async () => {
  const headers = new Map([
    ['session-old', { id: 'session-old', cwd: ANCHOR, createdAt: '2026-11-01T00:00:00.000Z' }],
    ['session-new', { id: 'session-new', cwd: ANCHOR, createdAt: '2026-11-09T00:00:00.000Z' }],
    ['session-mid', { id: 'session-mid', cwd: ANCHOR, createdAt: '2026-11-05T00:00:00.000Z' }]
  ])
  const entity = makeEntity({ headers })
  const registry = makeRegistry(headers, entity)

  const result = await attachAnchorSessions({ registry, ctx, entity, path: ANCHOR, log: quiet })

  assert.equal(result.attached, 3)
  assert.deepEqual(entity.sessionIds, ['session-new', 'session-mid', 'session-old'])
})

test('one unwritable membership never strands the rest of the row', async () => {
  const headers = new Map([
    ['session-bad', { id: 'session-bad', cwd: ANCHOR, createdAt: '2026-11-01T00:00:00.000Z' }],
    ['session-good', { id: 'session-good', cwd: ANCHOR, createdAt: '2026-11-02T00:00:00.000Z' }]
  ])
  const warnings = []
  const entity = makeEntity({ headers })
  const attach = entity.attachSession
  entity.attachSession = async (id) => {
    if (id === 'session-bad') throw new Error('its cwd resolves to somewhere else')
    return attach.call(entity, id)
  }
  const registry = makeRegistry(headers, entity)

  const result = await attachAnchorSessions({
    registry,
    ctx,
    entity,
    path: ANCHOR,
    log: (level, message) => warnings.push(`${level}: ${message}`)
  })

  assert.deepEqual(result, { attached: 1, wanted: 2 })
  assert.deepEqual(entity.sessionIds, ['session-good'])
  assert.ok(warnings.some((line) => line.includes('session-bad')))
})

test('the header index is refreshed before the first write', async () => {
  const headers = new Map([['session-one', { id: 'session-one', cwd: ANCHOR }]])
  const entity = makeEntity({ headers })
  const registry = makeRegistry(headers, entity)

  await attachAnchorSessions({ registry, ctx, entity, path: ANCHOR, log: quiet })

  assert.deepEqual(registry.calls, ['listStoredHeaders', 'indexHeaders:1'])
})
