// Native workspace projection.
//
// DSH's workspace registry only owns local directories, so a remote workspace
// is projected into the native sidebar with a local "anchor" directory. The
// anchor holds no project files: it is the handle the registry (and therefore
// the left sidebar) needs in order to show the remote workspace as a
// first-class row. The local agent for an anchor session is bridged to the
// remote dsh by lib/bridge.js, so all work still happens on the server.

import { mkdir, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { errorText, safeId } from './util.js'

// Store workspace id -> the native workspace id this process created or saw.
//
// The registry only reports what exists *now*; it cannot say why a row is
// missing. Remembering what this process projected is what makes "the user
// deleted the row in the sidebar" a distinguishable event: the row was there
// when it was created, and now it is gone while the store record is not.
const projected = new Map()

export function anchorRoot(store) {
  return join(store.root, 'anchors')
}

export function anchorPath(store, workspace) {
  return join(anchorRoot(store), safeId(workspace.id))
}

function normalizeLocal(path) {
  const value = resolve(String(path ?? ''))
  return process.platform === 'win32' ? value.toLowerCase() : value
}

/** Resolve the remote workspace whose native anchor owns this session cwd. */
export function workspaceForAnchor(store, cwd) {
  const target = normalizeLocal(cwd)
  for (const workspace of store.workspaces) {
    const anchor = workspace.nativePath || anchorPath(store, workspace)
    if (normalizeLocal(anchor) === target) return workspace
  }
  return null
}

async function registryOf(ctx, log, timeoutMs = 8000) {
  const current = ctx.get?.('workspaceRegistry')
  if (current) return current
  return await new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const timer = setTimeout(() => {
      log('warn', 'workspaceRegistry did not become available; native projection skipped')
      finish(null)
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
    try {
      ctx.inject(['workspaceRegistry'], (inner) => {
        clearTimeout(timer)
        finish(inner.get('workspaceRegistry') || null)
      })
    } catch (error) {
      clearTimeout(timer)
      log('warn', `workspaceRegistry injection failed: ${errorText(error)}`)
      finish(null)
    }
  })
}

async function exists(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Resolve a native row that this process projected earlier.
 *
 * `known: false` means the registry could not answer (no synchronous accessor,
 * or one that throws while the workspace service reloads). The caller must not
 * read that as a deletion; only an authoritative "this id is not there" is
 * evidence that the row was removed on purpose.
 */
function lookUpNativeRow(registry, id) {
  const target = String(id || '')
  if (!target) return { known: false, row: null }
  if (typeof registry.get === 'function') {
    try {
      return { known: true, row: registry.get(target) || null }
    } catch {
      return { known: false, row: null }
    }
  }
  if (typeof registry.list === 'function') {
    try {
      const row = (registry.list() || []).find((item) => String(item?.id || '') === target) || null
      return { known: true, row }
    } catch {
      return { known: false, row: null }
    }
  }
  return { known: false, row: null }
}

const SESSION_TIME_KEYS = ['createdAt', 'startedAt', 'time', 'updatedAt']

function sessionStamp(header) {
  for (const key of SESSION_TIME_KEYS) {
    const value = header?.[key]
    if (typeof value === 'string' && value) return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value).padStart(20, '0')
  }
  return ''
}

/** Every session header dsh knows about: stored artifacts plus live sessions. */
async function sessionHeaders({ registry, ctx, log }) {
  const headers = new Map()
  try {
    for (const header of (await registry.listStoredHeaders?.()) || []) {
      if (header && header.id !== undefined) headers.set(String(header.id), header)
    }
  } catch (error) {
    log('warn', `stored session headers unavailable: ${errorText(error)}`)
  }
  try {
    for (const session of ctx.get?.('sessions')?.list?.() || []) {
      const header = session?.header
      if (header && header.id !== undefined) headers.set(String(header.id), header)
    }
  } catch (error) {
    log('warn', `live session headers unavailable: ${errorText(error)}`)
  }
  return [...headers.values()]
}

/**
 * Put anchor sessions back into their projection row.
 *
 * The registry treats a record's `sessionIds` as a cache it re-validates: a
 * session whose header cannot be read at that moment is filtered out of the
 * projection and pruned from the record by the next write, which is how an
 * anchor session ends up under "Ungrouped" with its log still on disk. Anchor
 * directories are plugin-owned, so the membership can always be rebuilt from
 * the cwd each session header carries. Attaching oldest first keeps the
 * sidebar's newest-first order.
 */
export async function attachAnchorSessions({ registry, ctx, entity, path, headers, log = () => {} }) {
  if (typeof entity?.attachSession !== 'function') return { attached: 0, wanted: 0 }
  const rows = headers ?? (await sessionHeaders({ registry, ctx, log }))
  const target = normalizeLocal(path)
  const wanted = rows
    .filter((header) => typeof header?.cwd === 'string' && header.cwd && normalizeLocal(header.cwd) === target)
    .map((header) => ({ id: String(header.id), stamp: sessionStamp(header) }))
    .sort((left, right) => left.stamp.localeCompare(right.stamp))
  if (!wanted.length) return { attached: 0, wanted: 0 }
  // `mutate` prunes every id it cannot place, so the path index must know all of
  // these headers before the first write; `indexHeaders` only ever adds.
  try {
    await registry.indexHeaders?.(rows)
  } catch (error) {
    log('warn', `session path index refresh failed: ${errorText(error)}`)
  }
  const have = new Set(entity.sessionIds || [])
  let attached = 0
  for (const { id } of wanted) {
    if (have.has(id)) continue
    try {
      await entity.attachSession(id)
      have.add(id)
      attached += 1
      log('info', `re-attached anchor session ${id} to ${path}`)
    } catch (error) {
      log('warn', `anchor session re-attach failed for ${id}: ${errorText(error)}`)
    }
  }
  return { attached, wanted: wanted.length }
}

/**
 * Ensure every remote workspace has a native workspace row.
 * Idempotent: the registry reuses a workspace for the same canonical path.
 *
 * A row this process created is also tracked (`projected`): if it disappears
 * from the registry while the store record still exists, the user deleted it in
 * the sidebar. That is persisted as `nativeHidden` so the row stays gone.
 */
export async function reconcileNativeWorkspaces({ ctx, store, log = () => {} }) {
  const registry = await registryOf(ctx, log)
  if (!registry) return { available: false, rows: [] }
  const rows = []
  // 从侧栏隐藏 keeps the store record (remote service, tasks) but must not own
  // a row. Excluding hidden records from `known` also lets the stale scan below
  // delete a row that survived a failed hide, so the sidebar agrees with the
  // flag instead of keeping a ghost project.
  const visible = store.workspaces.filter((workspace) => workspace.nativeHidden !== true)
  const known = new Set(visible.map((workspace) => normalizeLocal(anchorPath(store, workspace))))
  // Anchors are plugin-owned handles. Drop rows whose store record is gone
  // (state reset, workspace removed on another machine) so the sidebar never
  // keeps a ghost remote project.
  const root = `${normalizeLocal(anchorRoot(store))}${sep}`
  try {
    for (const entity of registry.list?.() || []) {
      const path = normalizeLocal(String(entity?.path || ''))
      if (!path.startsWith(root) || known.has(path)) continue
      try {
        await registry.delete(String(entity.id))
        log('info', `removed stale native workspace ${entity.id} (${entity.path})`)
      } catch (error) {
        log('warn', `stale native workspace delete failed for ${entity.id}: ${errorText(error)}`)
      }
    }
  } catch (error) {
    log('warn', `native workspace scan failed: ${errorText(error)}`)
  }
  // A record removed through the plugin (op:'remove', cascade device removal)
  // cannot be a user deletion: forget its id so the tracking map never keeps a
  // row alive for a project that no longer exists.
  for (const id of projected.keys()) {
    if (!store.workspace(id)) projected.delete(id)
  }
  let headers
  try {
    headers = await sessionHeaders({ registry, ctx, log })
  } catch (error) {
    log('warn', `session header listing failed: ${errorText(error)}`)
  }
  let reattached = 0
  for (const workspace of store.workspaces) {
    const path = anchorPath(store, workspace)
    if (workspace.nativeHidden === true) {
      // Hidden once, hidden forever (until 在侧栏显示 is used): the record must
      // never be projected again, so skip before `mkdir` as well -- a hidden
      // project leaves no anchor directory behind for a later pass to find.
      projected.delete(workspace.id)
      continue
    }
    const tracked = projected.get(workspace.id)
    if (tracked) {
      // The row is gone although this process put it there and the record is
      // still in the store: the user deleted it in the sidebar. Persist that as
      // a tombstone instead of re-creating the row on this or any later pass.
      //
      // The *first* pass of a process must never take this branch: `projected`
      // starts empty, and a registry reset (new DSH profile, workspace service
      // reload) leaves every persisted `nativeWorkspaceId` pointing at nothing.
      // Reading that absence as a deletion would hide every project instead of
      // rebuilding the rows a restart is supposed to rebuild.
      const lookup = lookUpNativeRow(registry, tracked)
      if (lookup.known && !lookup.row) {
        projected.delete(workspace.id)
        await store.patchWorkspace(workspace.id, { nativeHidden: true, nativeWorkspaceId: '' })
        log('info', `native workspace ${tracked} was deleted in the sidebar; hiding ${workspace.name || workspace.id} until 在侧栏显示 is used`)
        continue
      }
    }
    try {
      await mkdir(path, { recursive: true })
      const title = workspace.name || workspace.remotePath || workspace.id
      const entity = await registry.create(path, title)
      // Remember what this process projected: the next pass uses the id to tell
      // a user deletion from a registry that simply does not know the row yet.
      projected.set(workspace.id, entity.id)
      // `create` keeps the title of an already-registered path, so a renamed
      // remote project would otherwise keep its old sidebar label forever.
      if (typeof entity.setTitle === 'function' && entity.title !== title) {
        try {
          await entity.setTitle(title)
        } catch (error) {
          log('warn', `native workspace retitle failed for ${workspace.id}: ${errorText(error)}`)
        }
      }
      let members = entity.sessionIds?.length || 0
      let attached = 0
      try {
        const sessions = await attachAnchorSessions({ registry, ctx, entity, path, headers, log })
        attached = sessions.attached
        reattached += attached
        members = entity.sessionIds?.length || members
      } catch (error) {
        log('warn', `anchor session re-attach failed for ${workspace.name || workspace.id}: ${errorText(error)}`)
      }
      const changed = workspace.nativeWorkspaceId !== entity.id || workspace.nativePath !== path
      if (changed) {
        await store.patchWorkspace(workspace.id, {
          nativeWorkspaceId: entity.id,
          nativePath: path
        })
      }
      rows.push({
        id: workspace.id,
        name: workspace.name,
        nativeId: entity.id,
        nativePath: path,
        sessions: members,
        attached
      })
      if (changed) log('info', `native workspace ${entity.id} <- ${workspace.name} (${path})`)
    } catch (error) {
      log('warn', `native projection failed for ${workspace.name || workspace.id}: ${errorText(error)}`)
      rows.push({ id: workspace.id, name: workspace.name, error: errorText(error) })
    }
  }
  return { available: true, rows, attached: reattached }
}

/** Retitle a projected row in place without touching its registration. */
export async function renameNativeWorkspace({ ctx, store, workspace, log = () => {} }) {
  const registry = await registryOf(ctx, log)
  if (!registry) return false
  const desired = String(workspace.name || workspace.remotePath || workspace.id)
  let entity = workspace.nativeWorkspaceId ? registry.get?.(String(workspace.nativeWorkspaceId)) : undefined
  if (!entity) {
    const target = normalizeLocal(workspace.nativePath || anchorPath(store, workspace))
    entity = (registry.list?.() || []).find((row) => normalizeLocal(String(row?.path || '')) === target)
  }
  if (!entity) return false
  if (entity.title === desired) return true
  try {
    if (typeof entity.setTitle !== 'function') return false
    await entity.setTitle(desired)
    return true
  } catch (error) {
    log('warn', `native workspace rename failed for ${workspace.id}: ${errorText(error)}`)
    return false
  }
}

/** Remove a projection without touching the remote side. */
export async function forgetNativeWorkspace({ ctx, store, workspace, log = () => {} }) {
  const registry = await registryOf(ctx, log)
  if (!registry) return false
  let removed = false
  if (workspace.nativeWorkspaceId) {
    try {
      removed = Boolean(await registry.delete(workspace.nativeWorkspaceId))
    } catch (error) {
      log('warn', `native workspace delete failed: ${errorText(error)}`)
    }
  }
  const path = workspace.nativePath || anchorPath(store, workspace)
  if (!removed && (await exists(path))) {
    try {
      const entity = await registry.resolveByPath(path)
      if (entity) removed = Boolean(await registry.delete(entity.id))
    } catch {
      // best effort
    }
  }
  // The row was removed on purpose by this process (hide, remove, cascade). If
  // the id stayed tracked, the next pass would see its absence and treat it as
  // a deletion in the sidebar -- which would immediately hide a project that
  // `op:'reveal'` is trying to bring back.
  projected.delete(workspace.id)
  return removed
}
