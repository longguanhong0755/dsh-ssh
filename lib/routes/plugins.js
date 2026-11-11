// Part of lib/routes.js: local <-> remote plugin manifest sync.
//
// Two routes only:
//   GET  /ssh-remote/plugins/diff  — read-only comparison, safe while busy
//   POST /ssh-remote/plugins/sync  — reconcile one workspace, or all of them
//
// A remote workspace composes three profiles (headless / sdk / web), each with
// its own bundle list, so both responses report per-profile rows. The heavy
// lifting is in lib/remote/plugins.js; this module validates input and keeps the
// shape stable for the panel.

import { errorText } from '../util.js'
import { PLUGIN_SYNC_REVISION } from '../sync/plugins.js'
import { readBody, sendJson } from './support.js'

function profileRow(profile) {
  return {
    name: profile.name,
    dir: profile.dir,
    remoteBundles: profile.remoteBundles,
    same: profile.same,
    summary: profile.diff.summary,
    add: profile.diff.add,
    update: profile.diff.update,
    drop: profile.diff.drop,
    skipped: profile.skipped || profile.diff.skipped,
    bundlesAdded: profile.diff.bundlesAdded,
    bundlesDropped: profile.diff.bundlesDropped
  }
}

export function registerPluginRoutes({ route, store, manager, log }) {
  const hostOf = (workspace) => store.hosts.find((item) => item.id === workspace.hostId) || null
  const pick = (workspaceId) => (workspaceId ? store.workspaces.filter((item) => item.id === workspaceId) : store.workspaces)

  route('/ssh-remote/plugins/diff', async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    const workspaceId = new URL(req.url, 'http://127.0.0.1').searchParams.get('workspaceId') || ''
    const workspaces = pick(workspaceId)
    if (workspaceId && workspaces.length === 0) return sendJson(res, 404, { ok: false, error: `no workspace ${workspaceId}` })
    const rows = []
    for (const workspace of workspaces) {
      const host = hostOf(workspace)
      if (!host) {
        rows.push({ workspaceId: workspace.id, name: workspace.name, error: 'workspace has no host' })
        continue
      }
      try {
        const plan = await manager.planPluginSync(host, workspace)
        rows.push({
          workspaceId: workspace.id,
          name: workspace.name,
          localDir: plan.localDir,
          localBundles: plan.localBundles,
          same: plan.same,
          summary: plan.summary,
          profiles: plan.profiles.map(profileRow)
        })
      } catch (error) {
        rows.push({ workspaceId: workspace.id, name: workspace.name, error: errorText(error) })
      }
    }
    return sendJson(res, 200, { ok: true, revision: PLUGIN_SYNC_REVISION, rows })
  })

  route('/ssh-remote/plugins/sync', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    let body
    try {
      body = await readBody(req)
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
    const workspaceId = String(body.workspaceId || '')
    const dryRun = body.dryRun === true
    const prune = body.prune === true
    const workspaces = pick(workspaceId)
    if (workspaceId && workspaces.length === 0) return sendJson(res, 404, { ok: false, error: `no workspace ${workspaceId}` })
    const rows = []
    for (const workspace of workspaces) {
      const host = hostOf(workspace)
      if (!host) {
        rows.push({ workspaceId: workspace.id, name: workspace.name, error: 'workspace has no host' })
        continue
      }
      try {
        const result = await manager.syncPlugins(host, workspace, { dryRun, prune, onLog: log })
        rows.push({
          workspaceId: workspace.id,
          name: workspace.name,
          changed: result.changed,
          applied: result.applied,
          summary: result.summary,
          rolledBack: result.rolledBack === true,
          error: result.error || '',
          profiles: result.rows || []
        })
      } catch (error) {
        rows.push({ workspaceId: workspace.id, name: workspace.name, changed: false, applied: false, error: errorText(error) })
      }
    }
    const failed = rows.filter((row) => row.error).length
    return sendJson(res, failed && failed === rows.length ? 500 : 200, { ok: failed === 0, revision: PLUGIN_SYNC_REVISION, dryRun, prune, rows })
  })
}
