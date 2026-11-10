// Remote session bridge.
//
// The native DSH chat UI talks to a local Agent/Session. For an anchor
// workspace the local agent loop must not call the model locally: this bridge
// intercepts its prompt methods, runs the real agent on the SSH host with the
// stock `dsh --profile headless --json` runner, and mirrors the runner's JSONL
// events back into the local Session. The native UI therefore stays unchanged,
// while every model/tool call executes on the remote machine.

// Entry point of the bridge. This module keeps the class itself (constructor and
// the core accessors), the compaction route wrapper, and assembles the rest of the
// prototype from lib/bridge/*.js at the end, so `import { SessionBridge } from
// './bridge.js'` keeps working unchanged.

import { join } from 'node:path'
import { COMPACT_PROVIDER, COMPACT_MODEL, ROUTER_SLOT, ORIGINAL_STREAM, STREAM_WRAPPER_VERSION, STREAM_MODULE_SEQ, retryCompactionStream } from './bridge/shared.js'
import { lifecycleMethods } from './bridge/lifecycle.js'
import { compactionMethods } from './bridge/compaction.js'
import { modelMethods } from './bridge/model.js'
import { stateMethods } from './bridge/state.js'
import { sessionMethods } from './bridge/sessions.js'
import { sdkMethods } from './bridge/sdk.js'
import { sdkOwnerMethods } from './bridge/sdk-owner.js'
import { sdkHealMethods } from './bridge/sdk-heal.js'
import { sdkTurnMethods } from './bridge/sdk-turns.js'
import { turnMethods } from './bridge/turns.js'
import { warmMethods } from './bridge/warm.js'
import { streamMethods } from './bridge/streaming.js'
import { eventMethods } from './bridge/events.js'

// HMR evaluates this module again while the `llm` service keeps the wrapper
// from the previous evaluation. A per-evaluation sequence lets the newest
// module replace that wrapper; the wrapper always delegates to the method
// stored under ORIGINAL_STREAM, so replacements never stack.
const MODULE_SEQ = (Number(globalThis[STREAM_MODULE_SEQ]) || 0) + 1
globalThis[STREAM_MODULE_SEQ] = MODULE_SEQ

/**
 * Wrap `llm.stream` once so compaction calls from bridged sessions can be
 * re-routed without touching local chats. Returns false when the service or
 * its method is not available yet.
 */
function installLlmRouting(llm, router) {
  if (!llm || typeof llm.stream !== 'function') return false
  if (llm[ORIGINAL_STREAM] === undefined) {
    Object.defineProperty(llm, ORIGINAL_STREAM, { value: llm.stream, configurable: true })
  }
  // After HMR the service still holds the wrapper from the previous module
  // evaluation. Reinstall only when this evaluation is newer; the wrapper
  // always calls the original stored on the service, never the wrapper.
  if ((Number(llm[STREAM_WRAPPER_VERSION]) || 0) < MODULE_SEQ) {
    const original = llm[ORIGINAL_STREAM]
    llm.stream = function routedStream(options) {
      const route = globalThis[ROUTER_SLOT]
      const next = route ? route.routeCompactionOptions(options) : options
      if (!next || next.purpose !== 'compaction') return original.call(this, next)
      return retryCompactionStream(original, this, next)
    }
    Object.defineProperty(llm, STREAM_WRAPPER_VERSION, { value: MODULE_SEQ, configurable: true, writable: true })
    router?.log?.('info', `bridge: compaction retry wrapper installed (module ${MODULE_SEQ})`)
  }
  globalThis[ROUTER_SLOT] = router
  return true
}

export class SessionBridge {
  constructor({ pool, store, manager, log = () => {}, ctx = null }) {
    this.pool = pool
    this.store = store
    this.manager = manager
    this.log = log
    this.ctx = ctx
    this.sessions = new Map()
    this.profiles = new Map()
    this.streamRetryAt = new Map()
    // Per-workspace runtime checks: { at, promise } keyed by workspace id.
    this.runtimeSyncs = new Map()
    this.journalPath = join(store.root, 'bridge.json')
    this.journal = {}
    this.pollMs = 1000
    this.saveTimer = null
    this.warmEnabled = process.env.DSH_SSH_NO_PREWARM !== '1'
    this.sdkEnabled = process.env.DSH_SSH_NO_SDK !== '1'
    this.warmOrder = []
    this.disposed = false
    // Live-preview diagnosis: the renderer only accepts a strictly monotonic
    // assistant-stream revision per agent, so a silently dropped frame shows up
    // as a frozen answer. Track what the bridge emitted versus what the global
    // dispatcher actually delivered, and keep one bounded trace file.
    this.streamTracePath = join(store.root, 'stream-trace.log')
    this.streamSeen = new Map()
    this.streamProbe = this.armStreamProbe()
    // Load synchronously: persistSync() is called from dispose()/forgetHost()
    // and must never be able to write an empty journal over a real one.
    this.journal = this.loadJournalSync()
    this.compactionProvider = COMPACT_PROVIDER
    this.compactionModel = COMPACT_MODEL
    this.llmRoutingReady = false
  }

  get enabled() {
    return this.store.settings.bridgeEnabled !== false
  }

  get permissionMode() {
    return String(this.store.settings.remotePermissionMode || 'danger-full-access')
  }

  get busy() {
    for (const state of this.sessions.values()) {
      if (state.running) return true
    }
    return false
  }

  busyWorkspace(workspaceId) {
    for (const state of this.sessions.values()) {
      if (state.workspace?.id === workspaceId && state.running) return true
    }
    return false
  }

  status() {
    return [...this.sessions.values()].map((state) => ({
      localSessionId: state.localSessionId,
      remoteSessionId: state.remoteSessionId,
      workspaceId: state.workspace.id,
      workspaceName: state.workspace.name,
      running: state.running,
      turn: state.remoteTurn || state.turn,
      queued: state.queue.length
    }))
  }

  /** Whether this agent belongs to a session this bridge mirrors right now. */
  ownsAgent(agent) {
    const id = String(agent?.session?.id ?? '')
    if (!id) return false
    const state = this.sessions.get(id)
    return Boolean(state && state.agent === agent && !state.closed)
  }

  /** True while the planned span is still one contiguous run of the surface. */
  surfaceSpanCurrent(agent, span) {
    const nodes = Array.isArray(agent?.session?.surface?.nodes) ? agent.session.surface.nodes : []
    const first = nodes.indexOf(span.start)
    if (first < 0) return false
    for (let index = 0; index < span.seqs.length; index += 1) {
      if (nodes[first + index] !== span.seqs[index]) return false
    }
    return true
  }

  /**
   * Route compaction calls of bridged sessions onto a locally reachable model.
   * Local chats keep their own route: only session ids this bridge owns are
   * rewritten, and only for `purpose: 'compaction'` requests.
   */
  installLlmRouting() {
    const llm = this.ctx && typeof this.ctx.get === 'function' ? this.ctx.get('llm') : null
    this.llmRoutingReady = installLlmRouting(llm, this)
    return this.llmRoutingReady
  }
}

// Everything else lives in lib/bridge/*.js as plain objects of method entries,
// grouped by concern; assigning them keeps the same names on the prototype.
Object.assign(SessionBridge.prototype, lifecycleMethods, compactionMethods, modelMethods, stateMethods, sessionMethods, sdkMethods, sdkOwnerMethods, sdkHealMethods, sdkTurnMethods, turnMethods, warmMethods, streamMethods, eventMethods)

// A class body declares its methods non-enumerable; the objects above are plain
// literals, so restore the descriptor shape the pre-split class had.
for (const name of Object.keys(SessionBridge.prototype)) {
  Object.defineProperty(SessionBridge.prototype, name, { enumerable: false })
}

export { runnerFailureMessage, extractYamlBlock } from './bridge/shared.js'
