// SessionBridge methods: attach/detach and turn cancellation.
//
// Moved verbatim out of lib/bridge.js (the bodies still use `this`) and assigned
// onto SessionBridge.prototype at the end of that module.

import { errorText } from '../util.js'
import { textOf } from './shared.js'

export const lifecycleMethods = {
  async attach(agent, workspace) {
    const localSessionId = String(agent.session.id)
    if (this.sessions.has(localSessionId)) return
    const host = this.store.host(workspace.hostId)
    if (!host) {
      this.log('warn', `bridge: no host for workspace ${workspace.id}`)
      return
    }
    // Retarget before a journal-restored runner is resumed: the process may
    // have been started by the previous app process from an older dsh build.
    // The check is throttled and free when the record already matches settings.
    await this.syncWorkspaceRuntime({ workspace, host })
    // The sync awaits the host; another attach for the same session may have
    // finished in the meantime.
    if (this.sessions.has(localSessionId)) return
    const state = {
      localSessionId,
      agent,
      workspace,
      host,
      remoteSessionId: '',
      running: false,
      polling: false,
      queue: [],
      buffer: '',
      byteBuffer: Buffer.alloc(0),
      offset: 0,
      eventsFile: '',
      stderrFile: '',
      pidFile: '',
      turn: 0,
      remoteTurn: 0,
      remoteStep: 0,
      // The remote step number behind the currently open local step, used to
      // recognise a replayed status line instead of opening a duplicate step.
      rawOpenStep: 0,
      // Adopted mid-turn: remote step N becomes local step 1, so the anchor
      // still starts the turn at step 1 while the remote is at step N.
      stepBase: 0,
      // The anchor's current model selection, resolved at the start of every
      // turn (see resolveModel). The key decides whether remote runners and
      // their profiles still describe this route.
      model: null,
      modelKey: '',
      // Dedupe identities of the last mirrored request records, restored from
      // the anchor log on attach so a restart keeps writing change/resume
      // instead of a second initial header.
      headerKey: undefined,
      contextKey: undefined,
      reasoning: '',
      text: '',
      // Ordered assistant blocks accumulated from thinking/text or live
      // deltas; preferred over the two scalar aggregates above.
      blocks: [],
      liveBlocks: [],
      // The committed assistant message forwarded by the headless profile
      // channel. It is lossless, so it wins over every fallback.
      authoritativeContent: null,
      pendingTools: [],
      toolSeqs: new Map(),
      assistantForStep: false,
      stepOpen: false,
      stepOptimistic: false,
      turnOpen: false,
      cancelled: false,
      final: false,
      timer: null,
      idlePromise: Promise.resolve(),
      idleResolve: null,
      live: false,
      liveAttempt: null,
      streamStats: { frames: 0, chunks: 0, firstAt: 0, lastAt: 0 },
      streamWatchdog: null,
      turnStartedAt: 0,
      sdkStale: false,
      stream: null,
      streamDone: null,
      streamClosed: false,
      generation: 0,
      deadPolls: 0,
      retriedStream: false,
      lastEnvelope: null,
      streamEmitWarned: false,
      assistantEvent: null,
      warm: null,
      warmTimer: null,
      warmRefresh: null,
      warmSerial: 0,
      // Persistent SDK runtime: one detached stdio JSON-RPC process per local
      // session, kept alive across turns. See bootSdk().
      sdk: null,
      sdkFailed: false,
      sdkRetryAt: 0,
      sdkPending: new Map(),
      sdkSendChain: Promise.resolve(),
      // Refreshes the idle watchdog while a turn runs, so a multi-hour turn is
      // not mistaken for an abandoned idle runtime.
      sdkHeartbeat: null,
      // `/compact` forwarding: the remote snapshot session is busy while the
      // command runs, and compaction records are captured from the tail.
      compacting: false,
      compactForwarding: false,
      remoteCompaction: null,
      // Per-agent `/compact` shadow installed through agent.ctx.
      compactCommand: null,
      closed: false,
      original: {
        followup: agent.followup,
        steer: agent.steer,
        cancel: agent.cancel,
        whenIdle: agent.whenIdle
      }
    }
    this.sessions.set(localSessionId, state)
    this.installRemoteCompactCommand(state)
    agent.followup = (input) => {
      void this.submit(state, input)
    }
    agent.steer = (input) => {
      void this.submit(state, input)
    }
    agent.cancel = (cause, options) => {
      void this.cancel(state, cause, options)
    }
    agent.whenIdle = () => state.idlePromise

    const saved = this.journal[localSessionId]
    if (saved) {
      state.remoteSessionId = String(saved.remoteSessionId || '')
      if (saved.active) {
        state.eventsFile = String(saved.active.eventsFile || '')
        state.stderrFile = String(saved.active.stderrFile || '')
        state.pidFile = String(saved.active.pidFile || '')
        state.offset = Number(saved.active.offset || 0)
        state.turn = Number(saved.active.turn || 0)
        state.remoteStep = Number(saved.active.step || 0)
        state.stepBase = Number(saved.active.stepBase || 0)
        // A runner left by the previous process was booted for this route; only
        // a changed selection forces a fresh boot.
        state.modelKey = String(saved.active.modelKey || '')
        if (saved.active.mode === 'sdk') {
          // A previous local process owned the same persistent runtime. Reuse
          // it when it is still alive (it is already initialized and holds the
          // session); otherwise boot a fresh one and resume the session.
          state.sdk = { reused: true, ready: false, inTurn: Boolean(saved.active.inTurn), watchdogFile: String(saved.active.watchdogFile || ''), dshVersion: String(saved.active.dshVersion || '') }
          state.running = Boolean(saved.active.inTurn)
          state.live = false
          if (state.running) {
            state.idlePromise = new Promise((resolve) => {
              state.idleResolve = resolve
            })
          }
          this.log('info', `bridge: reattaching sdk runtime for ${localSessionId} (${workspace.name}, offset ${state.offset})`)
          const resumingSdk = state.sdk
          resumingSdk.pendingResume = this.resumeSdk(state)
            .catch((error) => {
              this.log('warn', `bridge sdk reattach failed for ${localSessionId}: ${errorText(error)}`)
            })
            .finally(() => {
              resumingSdk.pendingResume = null
            })
        } else if (state.eventsFile) {
          state.running = true
          state.live = false
          state.idlePromise = new Promise((resolve) => {
            state.idleResolve = resolve
          })
          this.log('info', `bridge: resuming ${localSessionId} (${workspace.name}, offset ${state.offset})`)
          void this.startTail(state).catch((error) => {
            this.log('warn', `bridge resume stream failed for ${localSessionId}: ${errorText(error)}`)
            this.schedulePoll(state)
          })
        }
        // The local Agent is freshly attached and reports idle; restore the
        // running state for a turn that is still alive on the host.
        if (state.running) this.emitAgentStatus(state, 'running')
        if (state.running && state.sdk) this.startSdkHeartbeat(state)
      }
    }
    // The bridge's turn counter is local-session state, not remote state: after
    // the desktop app restarts (and the journal's active record is gone), a
    // resumed remote session must continue the turn numbering already stored in
    // the local log. Restarting at 1 makes the session log invalid
    // ("turn/start does not open the expected turn") and the thread unloadable.
    const localTurn = this.lastLocalTurn(agent)
    state.turn = Math.max(state.turn, localTurn.turn)
    if (localTurn.open) {
      // The anchor's last turn was never closed: the remote was still working
      // when the previous bridge process stopped mirroring. Keep writing into
      // that turn — opening a second turn/start for it makes the log invalid —
      // and restore the step numbering and unresolved calls so the replay of
      // the remaining events continues exactly where it stopped.
      state.turnOpen = true
      state.remoteTurn = state.turn
      state.remoteStep = Math.max(Number(state.remoteStep) || 0, localTurn.step || 0)
      // A step left open must stay open: the replay starts inside it, and a
      // second step/start would not match the open step.
      state.stepOpen = Boolean(localTurn.stepOpen)
      state.stepOptimistic = false
      for (const [callId, call] of localTurn.calls) {
        if (!state.toolSeqs.has(callId)) state.toolSeqs.set(callId, call.seq)
      }
    } else {
      // Nothing is open: the next turn starts at step 1 with no renumbering.
      state.remoteStep = 0
      state.stepBase = 0
    }
    this.log('info', `bridge: attached ${localSessionId} -> ${workspace.name}`)
    this.hydrateRequestKeys(state)
    if (state.sdk) return
    const useSdk = this.sdkUsable(state)
    void (async () => {
      // Resolve the anchor's model before anything boots. The headless profile
      // embeds it, so a warm runner started with another model would otherwise
      // have to be thrown away. Failure here is not fatal: the first real turn
      // resolves again and reports the problem in the chat.
      await this.resolveModelIfPossible(state)
      // Journal-restored sessions can reach this path before the workspace's
      // start/restart retargets its runtime. Boot the runner on the configured
      // build so `/compact` works from the first idle prewarm onward.
      const switched = await this.syncWorkspaceRuntime(state)
      if (switched) await this.retireRunners(state)
      else await this.retireStaleRunners(state)
      // The SDK runtime writes its own profile; only the headless/warm
      // transport needs the extra profile round trip.
      if (!useSdk && !this.disposed && !state.closed) await this.ensureProfile(state)
      if (this.disposed || state.closed) return
      if (!state.running) this.schedulePrewarm(state)
      if (useSdk && !this.disposed && !state.closed) {
        void this.bootSdk(state).catch((error) => {
          this.log('warn', `bridge sdk runtime unavailable for ${workspace.name}: ${errorText(error)}`)
        })
      }
    })().catch((error) => {
      this.log('warn', `bridge profile warm-up failed for ${workspace.name}: ${errorText(error)}`)
    })
  },

  async submit(state, input) {
    if (state.closed) return
    // Cheap self-heal: the scoped `/compact` lives in a command layer that the
    // host can recompose between turns, so re-check it on every prompt.
    this.ensureCompactCommand?.(state)
    const text = textOf(input)
    if (!text) {
      this.log('warn', `bridge: empty text prompt for ${state.localSessionId}; delegating to local agent`)
      state.original.followup?.(input)
      return
    }
    const envelope = { input, text }
    // `/compact` holds the local session while the remote agent summarizes:
    // queue the prompt so the compaction records stay a contiguous transaction.
    if (state.compacting) {
      state.queue.push(envelope)
      return
    }
    if (state.running) {
      state.queue.push(envelope)
      return
    }
    await this.startTurn(state, envelope)
  },

  /**
   * Local-only teardown shared by remove/dispose. The remote task is left alive
   * unless `killSdk` is requested; idle warm runners are always reclaimed.
   */
  detach(state, { close = false, killWarm = true, killSdk = false, reason = 'bridge detached' } = {}) {
    state.generation += 1
    state.warmSerial += 1
    if (close) state.closed = true
    const wasRunning = state.running
    state.running = false
    state.live = false
    if (wasRunning) this.emitAgentStatus(state, 'idle')
    this.clearStreamWatchdog(state)
    this.stopSdkHeartbeat(state)
    if (state.timer) {
      clearTimeout(state.timer)
      state.timer = null
    }
    if (state.warmTimer) {
      clearTimeout(state.warmTimer)
      state.warmTimer = null
    }
    if (state.warmRefresh) {
      clearTimeout(state.warmRefresh)
      state.warmRefresh = null
    }
    for (const [, pending] of state.sdkPending) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
    }
    state.sdkPending.clear()
    const warm = state.warm
    state.warm = null
    this.dropWarmOrder(state)
    if (warm && killWarm) void this.killWarm(state, warm)
    if (killSdk && state.sdk) void this.killSdk(state)
    try {
      state.stream?.close()
    } catch {
      // ignore
    }
    state.stream = null
    state.streamDone = null
    state.compacting = false
    state.compactForwarding = false
    state.remoteCompaction = null
    const command = state.compactCommand
    state.compactCommand = null
    if (command) {
      try {
        command.disposer?.()
      } catch {
        // ignore
      }
      try {
        command.dispose?.()
      } catch {
        // ignore
      }
    }
    if (close) state.queue = []
    const resolve = state.idleResolve
    state.idleResolve = null
    if (resolve) resolve()
    try {
      state.agent.followup = state.original.followup
      state.agent.steer = state.original.steer
      state.agent.cancel = state.original.cancel
      state.agent.whenIdle = state.original.whenIdle
    } catch {
      // ignore
    }
  },

  async cancel(state, cause, options) {
    if (!state.running) {
      state.original.cancel?.(cause, options)
      return
    }
    state.cancelled = true
    // Invalidate any startTurn() that is still awaiting profile/launch work.
    state.generation += 1
    state.live = false
    if (state.sdk) await this.killSdk(state)
    await this.killTurnProcess(state)
    if (state.stepOpen) this.closeStep(state)
    else this.settleLive(state, null)
    // If the turn already settled while the kill was in flight (for example a
    // remote turn/end raced the stop), do not synthesize an empty turn just to
    // close it: the local log must keep exactly one opener per turn.
    if (!state.turnOpen) {
      this.finish(state)
      return
    }
    // A user stop is not a failure: the native loop records it as
    // `{ kind: 'aborted', reason: { kind: 'user' } }`, which the transcript
    // renders as "已停止". A generic error reason would surface "处理失败".
    const causeKind = cause && (cause.kind === 'parent' || cause.kind === 'disposed') ? cause.kind : 'user'
    this.append(state, 'turn/end', { turn: state.remoteTurn || state.turn, reason: { kind: 'aborted', reason: { kind: causeKind } } })
    state.turnOpen = false
    try {
      state.stream?.close()
    } catch {
      // ignore
    }
    state.stream = null
    this.finish(state)
  },

  async cancelWorkspace(workspaceId) {
    this.runtimeSyncs.delete(workspaceId)
    for (const state of [...this.sessions.values()]) {
      if (state.workspace.id !== workspaceId) continue
      // The workspace is being removed: stop every remote process and never
      // boot the next turn's warm runner into a directory that is going away.
      state.closed = true
      state.generation += 1
      if (state.running) {
        try {
          await this.cancel(state, { kind: 'user' }, {})
        } catch (error) {
          this.log('warn', `bridge cancel before remove failed for ${state.localSessionId}: ${errorText(error)}`)
        }
      }
      this.detach(state, { close: true, killWarm: true, killSdk: true, reason: 'workspace removed' })
      this.sessions.delete(state.localSessionId)
    }
  },

  dispose() {
    this.disposed = true
    for (const state of this.sessions.values()) {
      if (state.running) this.rememberActive(state)
      // The SDK runtime is detached and keeps the in-flight turn alive, like a
      // headless runner; only the local stdio channel and pending calls stop.
      this.detach(state, { close: false, killWarm: true, killSdk: false, reason: 'bridge disposed' })
    }
    this.sessions.clear()
    this.runtimeSyncs.clear()
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.persistSync()
    try {
      this.streamProbe?.()
    } catch {
      // ignore
    }
  }
}
