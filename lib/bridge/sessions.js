// SessionBridge methods: session bookkeeping, host services and session teardown.
//
// Moved verbatim out of lib/bridge.js (the bodies still use `this`) and assigned
// onto SessionBridge.prototype at the end of that module.

import { errorText, nowIso, q } from '../util.js'
import { workspaceForAnchor } from '../native.js'

export const sessionMethods = {
  rememberActive(state) {
    // Persist the start of the last incomplete line, not the raw byte count:
    // a resume must replay that line from its first byte or the first event
    // after a restart is lost.
    const pendingBytes = state.byteBuffer?.length
      ? state.byteBuffer.length
      : Buffer.byteLength(state.buffer || '', 'utf8')
    this.journal[state.localSessionId] = {
      workspaceId: state.workspace.id,
      remoteSessionId: state.remoteSessionId,
      updatedAt: nowIso(),
      active: {
        mode: state.sdk ? 'sdk' : 'headless',
        eventsFile: state.eventsFile,
        stderrFile: state.stderrFile,
        pidFile: state.pidFile,
        watchdogFile: state.sdk?.watchdogFile || '',
        dshVersion: state.sdk?.dshVersion || '',
        inTurn: Boolean(state.running),
        offset: Math.max(0, (Number(state.offset) || 0) - pendingBytes),
        turn: state.turn,
        // Step coordinates let a reattach continue an open turn instead of
        // opening a second one (and renumbering a mid-turn resume correctly).
        step: state.remoteStep || 0,
        stepBase: state.stepBase || 0,
        modelKey: String(state.modelKey || ''),
        startedAt: nowIso()
      }
    }
    this.saveSoon()
  },

  /**
   * Last turn number and open state already present in the local session log.
   *
   * Only used when the bridge attaches, so the (deprecated but synchronous)
   * snapshot read is acceptable: it is a one-off scan over the log.
   */
  lastLocalTurn(agent) {
    let last = 0
    let open = false
    let step = 0
    let stepOpen = false
    // Tool calls the open turn published without a matching result, keyed by
    // call id. Their seq is what a late result must cite as its source.
    const calls = new Map()
    try {
      const events = agent?.session?.snapshotEvents?.() || []
      for (const event of events) {
        const type = event?.type
        if (type !== 'turn/start' && type !== 'turn/end') {
          if (!open) continue
          const data = event?.data || {}
          const current = Number(data.step)
          if (Number.isInteger(current) && current > step) step = current
          if (type === 'step/start') stepOpen = true
          else if (type === 'step/end') {
            stepOpen = false
            // The bridge always writes outcome-unknown results before closing
            // a step, so calls of a closed step cannot still be unresolved.
            for (const [callId, call] of calls) {
              if (call.step === Number(data.step)) calls.delete(callId)
            }
          } else if (type === 'tool/call' && data.callId) {
            calls.set(String(data.callId), { seq: event.seq, step: Number(data.step) || current || step })
          } else if (type === 'tool/result') {
            const callId = data.message?.toolCallId || data.message?.source?.callId
            if (callId) calls.delete(String(callId))
          }
          continue
        }
        const turn = Number(event.data?.turn)
        if (!Number.isInteger(turn) || turn < last) continue
        if (type === 'turn/start') {
          last = turn
          open = true
          step = 0
          stepOpen = false
          calls.clear()
        } else if (turn === last) {
          open = false
          step = 0
          stepOpen = false
          calls.clear()
        }
      }
    } catch (error) {
      this.log('warn', `bridge: could not read local turn counter: ${errorText(error)}`)
    }
    return { turn: last, open, step, stepOpen, calls }
  },

  async handleAgentCreated({ agent } = {}) {
    if (!agent?.session || !this.enabled) return
    const cwd = agent.session.header?.cwd ?? agent.session.header?.meta?.cwd
    if (!cwd) return
    const workspace = workspaceForAnchor(this.store, cwd)
    if (!workspace) return
    await this.attach(agent, workspace)
  },

  finish(state) {
    if (!state.running) return
    if (state.turnOpen) {
      this.closeStep(state)
      this.append(state, 'turn/end', { turn: state.remoteTurn || state.turn, reason: { kind: 'completed' } })
      state.turnOpen = false
    } else {
      this.settleLive(state, null)
    }
    state.running = false
    state.live = false
    this.emitAgentStatus(state, 'idle')
    this.clearStreamWatchdog(state)
    this.stopSdkHeartbeat(state)
    this.noteStreamStats(state)
    // Do not force-close the tail here: the shell watchdog exits when the
    // runner exits and the server acknowledges the channel. Forcing it while
    // the remote shell is still alive keeps the session counted against
    // sshd's MaxSessions and delays the next turn. The persistent SDK runtime
    // keeps its tail open across turns (the same channel serves the next one).
    if (!state.sdk) state.stream = null
    if (state.timer) {
      clearTimeout(state.timer)
      state.timer = null
    }
    const entry = this.journal[state.localSessionId]
    if (entry) {
      entry.remoteSessionId = state.remoteSessionId
      entry.updatedAt = nowIso()
      if (state.sdk) {
        entry.active = {
          mode: 'sdk',
          eventsFile: state.eventsFile,
          stderrFile: state.stderrFile,
          pidFile: state.pidFile,
          watchdogFile: state.sdk.watchdogFile || '',
          dshVersion: state.sdk.dshVersion || '',
          inTurn: false,
          offset: Math.max(0, Number(state.offset) || 0),
          turn: state.turn,
          modelKey: String(state.modelKey || ''),
          startedAt: entry.active?.startedAt || nowIso()
        }
      } else {
        delete entry.active
      }
      if (!entry.remoteSessionId) delete this.journal[state.localSessionId]
    }
    this.persistSync()
    const resolve = state.idleResolve
    state.idleResolve = null
    if (resolve) resolve()
    // A runtime kept alive only for the in-flight turn is retired now that no
    // turn is running; the next prompt must boot the current profile.
    const staleRefresh = state.sdkStale ? this.refreshStaleSdk(state) : Promise.resolve()
    if (state.queue.length > 0) {
      const next = state.queue.shift()
      setTimeout(() => {
        void staleRefresh.then(() => {
          // The remote may have started a queued inbox turn in the meantime;
          // beginning that turn would be lost, so wait for it to settle.
          if (state.running || state.closed) {
            state.queue.unshift(next)
            return
          }
          void this.startTurn(state, next)
        })
      }, 50)
    } else if (!state.sdk) {
      // Boot the next turn's runner while the workspace is idle, so the next
      // prompt skips the 4-5 s headless startup. The SDK runtime is already
      // resident, so it needs no prewarm.
      this.schedulePrewarm(state)
    }
  },

  /** Drop cached profile writes so the next boot reinstalls them remotely. */
  invalidateProfiles(hostId) {
    const ids = new Set(this.store.workspaces.filter((row) => row.hostId === hostId).map((row) => row.id))
    for (const key of [...this.profiles.keys()]) {
      for (const id of ids) {
        if (key.startsWith(`${id}:`)) {
          this.profiles.delete(key)
          break
        }
      }
    }
  },

  hostStates(hostId) {
    return [...this.sessions.values()].filter((state) => !hostId || state.host?.id === hostId)
  },

  /**
   * ZCode 断开: stop relaying this device locally while its remote processes
   * keep running. A later prompt (or 连接) reopens the tail from the journaled
   * offset, so already-committed output is not lost.
   */
  disconnectHost(hostId) {
    for (const state of this.hostStates(hostId)) {
      state.generation += 1
      try {
        state.stream?.close()
      } catch {
        // ignore
      }
      state.stream = null
      state.streamDone = null
      state.streamClosed = true
      state.live = false
      state.running = false
      state.detached = true
      this.clearStreamWatchdog(state)
      this.stopSdkHeartbeat(state)
      if (state.timer) {
        clearTimeout(state.timer)
        state.timer = null
      }
      state.idleResolve?.()
      state.idleResolve = null
    }
  },

  /**
   * 停止/重启远端服务: interrupt the bridge-owned remote processes (SDK runtime
   * and one-shot runners) and settle any open turn. With `restart`, warm the
   * runtimes again immediately, which is the remote-service restart.
   */
  async stopHostServices(hostId, { restart = false } = {}) {
    const states = this.hostStates(hostId)
    for (const state of states) {
      state.generation += 1
      state.queue = []
      this.clearStreamWatchdog(state)
      this.stopSdkHeartbeat(state)
      if (state.timer) {
        clearTimeout(state.timer)
        state.timer = null
      }
      if (state.running) {
        await this.cancel(state, { kind: 'user' }, {})
      }
      if (state.warmTimer) {
        clearTimeout(state.warmTimer)
        state.warmTimer = null
      }
      if (state.warmRefresh) {
        clearTimeout(state.warmRefresh)
        state.warmRefresh = null
      }
      if (state.warm) {
        const warm = state.warm
        state.warm = null
        await this.killWarm(state, warm).catch(() => {})
      }
      try {
        state.stream?.close()
      } catch {
        // ignore
      }
      state.stream = null
      state.streamDone = null
      state.streamClosed = true
      await this.killSdk(state)
      if (state.pidFile) {
        await this.pool.exec(
          state.host,
          `p=$(cat ${q(state.pidFile)} 2>/dev/null || echo 0); [ -n "$p" ] && [ "$p" != "0" ] && { kill -TERM "-$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null || true; }`,
          { timeoutMs: 10000 }
        ).catch(() => {})
      }
      state.eventsFile = ''
      state.stderrFile = ''
      state.pidFile = ''
      state.offset = 0
      state.byteBuffer = Buffer.alloc(0)
      state.detached = false
    }
    if (restart) {
      for (const state of states) {
        if (state.closed || this.disposed || !this.sdkUsable(state)) continue
        state.retriedStream = false
        await this.bootSdk(state).catch((error) => {
          this.log('warn', `bridge restart failed for ${state.localSessionId}: ${errorText(error)}`)
        })
      }
    }
  },

  /** Reconnect/auto-start: boot runtimes for this device without a prompt. */
  async bootHostServices(hostId) {
    for (const state of this.hostStates(hostId)) {
      if (state.closed || this.disposed || !this.sdkUsable(state)) continue
      state.detached = false
      await this.bootSdk(state).catch((error) => {
        this.log('warn', `bridge connect failed for ${state.localSessionId}: ${errorText(error)}`)
      })
    }
  },

  /**
   * ZCode 移除设备 is local-only: forget sessions and the journal, close the
   * local channels, but never kill a remote task or delete remote data.
   */
  forgetHost(hostId) {
    for (const state of this.hostStates(hostId)) {
      this.runtimeSyncs.delete(state.workspace?.id)
      this.detach(state, { close: true, killWarm: true, killSdk: false, reason: 'workspace removed' })
      this.sessions.delete(state.localSessionId)
      delete this.journal[state.localSessionId]
    }
    this.persistSync()
  }
}
