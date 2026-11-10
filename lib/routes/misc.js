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
    // The renderer polls this. Re-register a `/compact` that a recomposed
    // command layer dropped, so the slash menu heals itself without a restart.
    for (const state of bridge?.sessions?.values?.() || []) {
      try {
        bridge.ensureCompactCommand?.(state)
      } catch {
        // never fail the status call
      }
    }
    return sendJson(res, 200, { ok: true, revision: BRIDGE_REVISION, sessions: bridge?.status?.() || [], enabled: store.settings.bridgeEnabled !== false })
  })

  // Bring one bridged chat up to the point where a command can run: retarget
  // the runner, resolve the model route, launch/attach the SDK runtime and shake
  // hands. This is what `/compact` does before it sends anything, so it proves a
  // chat can accept commands without compacting (or sending) a single message.
  route('/ssh-remote/bridge/probe', async (req, res) => {
    let sessionId = ''
    if (req.method === 'POST') {
      try {
        const body = await readBody(req)
        sessionId = String(body.sessionId || '')
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: errorText(error) })
      }
    } else if (req.method === 'GET') {
      sessionId = new URL(req.url, 'http://127.0.0.1').searchParams.get('sessionId') || ''
    } else {
      return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    }
    const state = bridge?.sessions?.get?.(sessionId)
    if (!state) return sendJson(res, 404, { ok: false, error: `no bridged session ${sessionId || '(missing sessionId)'}` })
    try {
      await bridge.prepareRemoteCommands(state)
      await bridge.bootSdk(state)
      return sendJson(res, 200, {
        ok: true,
        revision: BRIDGE_REVISION,
        sessionId,
        remoteSessionId: state.remoteSessionId || '',
        model: state.model?.key || '',
        provider: state.model?.provider || '',
        sdkReady: Boolean(state.sdk?.ready),
        sdkLocalReady: Boolean(state.sdk?.localReady),
        running: Boolean(state.running)
      })
    } catch (error) {
      return sendJson(res, 500, { ok: false, revision: BRIDGE_REVISION, sessionId, error: errorText(error) })
    }
  })

  // Self-check for the scoped `/compact` of a bridged chat. Without `run` it
  // only reports whether the command is registered (and re-registers it when
  // it is not); with `run:true` it executes the very handler the slash command
  // calls, so the remote path is provable without touching the renderer.
  route('/ssh-remote/bridge/compact', async (req, res) => {
    let sessionId = ''
    let run = false
    if (req.method === 'POST') {
      try {
        const body = await readBody(req)
        sessionId = String(body.sessionId || '')
        run = body.run === true
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: errorText(error) })
      }
    } else if (req.method === 'GET') {
      const params = new URL(req.url, 'http://127.0.0.1').searchParams
      sessionId = params.get('sessionId') || ''
      run = params.get('run') === 'true'
    } else {
      return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    }
    const state = bridge?.sessions?.get?.(sessionId)
    if (!state) return sendJson(res, 404, { ok: false, error: `no bridged session ${sessionId || '(missing sessionId)'}` })
    const installed = bridge.ensureCompactCommand(state)
    const base = {
      revision: BRIDGE_REVISION,
      sessionId,
      installed: Boolean(state.compactCommand?.disposer),
      stock: Boolean(state.compactCommand?.stock),
      reInstalled: Boolean(installed) && !run
    }
    if (!run) return sendJson(res, 200, { ok: true, ...base })
    try {
      const result = await bridge.handleCompactInvocation(state, {
        agent: state.agent,
        rawInput: '',
        commandId: 'compact'
      }, state.compactCommand?.stock || null)
      return sendJson(res, 200, { ok: true, ...base, result })
    } catch (error) {
      return sendJson(res, 500, { ok: false, ...base, error: errorText(error) })
    }
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
