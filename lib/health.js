// Local self-check for the three moving parts of the plugin.
//
// `/ssh-remote/health` used to return only revision numbers, which say what
// code is running but nothing about whether it works. This module answers the
// operational question (anchor rows present? bridge sessions healthy? runtime
// reachable?) using local state only; `deep` additionally probes each
// workspace through its host. Nothing here writes.

import { stat } from 'node:fs/promises'
import { anchorPath, anchorRoot } from './native.js'
import { secretLabel } from './secrets.js'

const DEEP_TIMEOUT_MS = 8000
const STALE_ATTACH_MS = 10 * 60 * 1000

async function exists(path) {
  if (!path) return false
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function makeCheck(id, state, detail, extra = {}) {
  return { id, state, detail, ...extra }
}

/** Session state reduced to JSON-safe fields; the full state holds agents and buffers. */
function sessionRow(state) {
  return {
    sessionId: state.localSessionId,
    workspaceId: state.workspace?.id || '',
    workspace: state.workspace?.name || state.workspace?.remotePath || '',
    mode: state.sdk ? 'sdk' : 'headless',
    running: Boolean(state.running),
    turn: Number(state.turn) || 0,
    deadPolls: Number(state.deadPolls) || 0,
    sdkFailed: Boolean(state.sdkFailed),
    lastEventAt: Number(state.lastEnvelope?.at) || 0
  }
}

function sessionCheck(rows, staleJournal) {
  const failed = rows.filter((row) => row.sdkFailed)
  const running = rows.filter((row) => row.running)
  const parts = [`${rows.length} 个会话`]
  if (running.length) parts.push(`${running.length} 个进行中`)
  if (failed.length) parts.push(`${failed.length} 个 SDK 运行器失败`)
  if (staleJournal.length) parts.push(`${staleJournal.length} 条残留 journal`)
  const state = failed.length || staleJournal.length ? 'warn' : 'ok'
  return makeCheck('bridge', state, parts.join('，'), { sessions: rows.length })
}

/**
 * @param {object} options
 * @param {object} options.store      RemoteStore (hosts/workspaces/settings)
 * @param {object} [options.bridge]   SessionBridge, if the bridge is enabled
 * @param {object} [options.ctx]      plugin context, for workspaceRegistry
 * @param {object} [options.pool]     TargetPool, for connection counts
 * @param {object} [options.manager]  RemoteManager, required when `deep`
 * @param {boolean} [options.deep]    probe every workspace through its host
 * @param {number} [options.deepTimeoutMs]
 * @param {() => number} [options.now]
 */
export async function buildHealth({ store, bridge, ctx, pool, manager, deep = false, deepTimeoutMs = DEEP_TIMEOUT_MS, now = Date.now }) {
  const workspaces = store.workspaces || []
  const hosts = store.hosts || []
  const checks = []
  const anchors = []
  const registry = ctx?.get?.('workspaceRegistry') || null

  checks.push(makeCheck(
    'store',
    (hosts.length || !workspaces.length) ? 'ok' : 'warn',
    `${hosts.length} 个主机，${workspaces.length} 个工作区`
  ))

  // Credentials are the one part of the store that must not silently sit in a
  // file when the OS has a proper vault.
  const secrets = typeof store.secretStatusAsync === 'function'
    ? await store.secretStatusAsync().catch(() => null)
    : null
  if (secrets) {
    const backend = secrets.backend || ''
    const detail = backend
      ? `${secretLabel(backend)}，${secrets.keychain} 个设备的凭据`
      : secrets.plaintext > 0
        ? `系统凭据库不可用，${secrets.plaintext} 个设备的凭据保存在 state.json（0600）`
        : '没有可用的系统凭据库；新凭据将保存在 state.json（0600）'
    checks.push(makeCheck(
      'secrets',
      secrets.plaintext > 0 ? 'warn' : 'ok',
      detail,
      { backend: backend || 'file', keychain: secrets.keychain, plaintext: secrets.plaintext }
    ))
  }

  // Anchor rows are what the native sidebar shows. A row without its anchor
  // directory silently drops out of the projection, so check the directories
  // the bridge will actually use and whether this run can reach the registry.
  let missingAnchors = 0
  const root = anchorRoot(store)
  for (const workspace of workspaces) {
    const path = workspace.nativePath || anchorPath(store, workspace)
    const present = await exists(path)
    if (!present) missingAnchors += 1
    anchors.push({
      workspaceId: workspace.id,
      name: workspace.name || '',
      path,
      present,
      nativeId: workspace.nativeWorkspaceId || ''
    })
  }
  const anchorDetail = [
    registry ? 'registry 可用' : 'registry 未就绪',
    `${workspaces.length - missingAnchors}/${workspaces.length} 个 anchor 目录存在`
  ]
  if (missingAnchors) anchorDetail.push(`${missingAnchors} 个缺失`)
  checks.push(makeCheck(
    'anchor',
    !registry || missingAnchors ? 'warn' : 'ok',
    anchorDetail.join('，'),
    { root }
  ))

  const live = bridge ? [...bridge.sessions.values()].filter((state) => !state.closed).map(sessionRow) : []
  const journalRows = Object.entries(bridge?.journal || {})
  const known = new Set(workspaces.map((workspace) => workspace.id))
  const staleJournal = journalRows
    .filter(([, entry]) => entry?.workspaceId && !known.has(entry.workspaceId))
    .map(([sessionId, entry]) => ({ sessionId, workspaceId: entry.workspaceId }))
  checks.push(sessionCheck(live, staleJournal))

  // A bridge session is only useful if it attached recently; an old idle SDK
  // runner is normal, but a session that never got an envelope is suspicious.
  if (bridge) {
    const staleLive = live.filter((row) => row.lastEventAt && now() - row.lastEventAt > STALE_ATTACH_MS && !row.running)
    if (staleLive.length) {
      checks.push(makeCheck('bridge-idle', 'ok', `${staleLive.length} 个会话超过 10 分钟无事件（空闲运行器）`, { sessions: staleLive.length }))
    }
  }

  const entries = pool?.ssh?.entries
  if (entries instanceof Map) {
    const ready = [...entries.values()].filter((entry) => entry.state === 'ready').length
    checks.push(makeCheck('ssh', 'ok', `${ready}/${entries.size} 条连接就绪`, { ready, total: entries.size }))
  }

  if (deep) {
    const probed = []
    for (const workspace of workspaces) {
      const host = typeof store.host === 'function' ? store.host(workspace.hostId) : null
      const row = { workspaceId: workspace.id, name: workspace.name || '', state: 'unknown', httpStatus: '', pid: null, error: '' }
      if (!host || !manager?.status) {
        row.state = 'skipped'
        row.error = host ? 'manager unavailable' : 'host missing'
        probed.push(row)
        continue
      }
      try {
        const status = await Promise.race([
          manager.status(host, workspace, { fresh: true, skipLog: true }),
          new Promise((_, reject) => {
            const timer = setTimeout(() => reject(new Error(`probe timeout ${deepTimeoutMs}ms`)), deepTimeoutMs)
            if (typeof timer.unref === 'function') timer.unref()
          })
        ])
        row.state = String(status?.state || 'unknown')
        row.httpStatus = String(status?.httpStatus || '')
        row.pid = Number.isInteger(status?.pid) ? status.pid : null
      } catch (error) {
        row.state = 'error'
        row.error = error?.message || String(error)
      }
      probed.push(row)
    }
    const bad = probed.filter((row) => row.state !== 'running' && row.state !== 'skipped')
    checks.push(makeCheck(
      'runtime',
      bad.length ? 'warn' : 'ok',
      bad.length ? `${bad.length}/${probed.length} 个工作区未运行` : `${probed.length} 个工作区运行中`,
      { workspaces: probed }
    ))
  }

  const failedSessions = live.filter((row) => row.sdkFailed).length
  return {
    ok: checks.every((check) => check.state !== 'error') && !failedSessions,
    checks,
    counts: { hosts: hosts.length, workspaces: workspaces.length },
    anchors,
    bridge: { sessions: live, journal: journalRows.length, stale: staleJournal },
    generatedAt: new Date(now()).toISOString()
  }
}
