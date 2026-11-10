// Part of lib/routes.js. Route bodies moved verbatim; this module registers
// one group and shares the request helpers through ./support.js.
// settings, live bridge snapshot, native sync, health
import {
  clampPollInterval,
  errorText
} from '../util.js'
import { reconcileNativeWorkspaces } from '../native.js'
import { SSH_TRANSPORT_REVISION } from '../ssh.js'
import {
  BRIDGE_REVISION,
  NATIVE_REVISION,
  readBody,
  sendJson
} from './support.js'

export function registerMiscRoutes({ route, ctx, store, pool, manager, jobs, bridge, log }) {
  route('/ssh-remote/settings', async (req, res) => {
    if (req.method === 'GET') return sendJson(res, 200, { ok: true, settings: store.settings })
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const body = await readBody(req)
      const incoming = body.settings || {}
      const next = { ...store.settings }
      if (typeof incoming.dshVersion === 'string' && /^\d+\.\d+\.\d+(?:-[\w.]+)?$/u.test(incoming.dshVersion)) next.dshVersion = incoming.dshVersion
      if (typeof incoming.nodeVersion === 'string' && /^\d+\.\d+\.\d+$/u.test(incoming.nodeVersion)) next.nodeVersion = incoming.nodeVersion
      if (typeof incoming.npmRegistry === 'string' && /^https?:\/\//u.test(incoming.npmRegistry)) next.npmRegistry = incoming.npmRegistry
      const pollIntervalMs = Number(incoming.pollIntervalMs)
      if (Number.isFinite(pollIntervalMs)) next.pollIntervalMs = clampPollInterval(pollIntervalMs)
      if (typeof incoming.syncCredentials === 'boolean') next.syncCredentials = incoming.syncCredentials
      if (typeof incoming.createIfMissing === 'boolean') next.createIfMissing = incoming.createIfMissing
      if (typeof incoming.bridgeEnabled === 'boolean') next.bridgeEnabled = incoming.bridgeEnabled
      if (typeof incoming.hideProjectDeviceNames === 'boolean') next.hideProjectDeviceNames = incoming.hideProjectDeviceNames
      if (typeof incoming.startupAutoReconnect === 'boolean') next.startupAutoReconnect = incoming.startupAutoReconnect
      if (incoming.remotePermissionMode === 'danger-full-access') next.remotePermissionMode = incoming.remotePermissionMode
      store.state.settings = next
      await store.save()
      return sendJson(res, 200, { ok: true, settings: next })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: errorText(error) })
    }
  })

  route('/ssh-remote/bridge', async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    return sendJson(res, 200, { ok: true, revision: BRIDGE_REVISION, sessions: bridge?.status?.() || [], enabled: store.settings.bridgeEnabled !== false })
  })

  route('/ssh-remote/native/sync', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    try {
      const result = await reconcileNativeWorkspaces({ ctx, store, log })
      if (!result.available) return sendJson(res, 503, { ok: false, error: 'workspaceRegistry unavailable' })
      return sendJson(res, 200, { ok: true, revision: NATIVE_REVISION, attached: result.attached || 0, rows: result.rows })
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: errorText(error) })
    }
  })

  route('/ssh-remote/health', async (req, res) => {
    return sendJson(res, 200, {
      ok: true,
      plugin: 'dsh-ssh-remote',
      workspaces: store.workspaces.length,
      hosts: store.hosts.length,
      transport: SSH_TRANSPORT_REVISION,
      bridge: BRIDGE_REVISION,
      native: NATIVE_REVISION
    })
  })

}
