// SessionBridge methods: one mirrored turn: start, step boundaries and failure.
//
// Moved verbatim out of lib/bridge.js (the bodies still use `this`) and assigned
// onto SessionBridge.prototype at the end of that module.

import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { posix as remotePath } from 'node:path'
import { errorText, joinRemote, q, safeId, shq } from '../util.js'
import { TOOL_OUTCOME_UNKNOWN_TEXT } from './shared.js'

export const turnMethods = {
  /**
   * Adopt a turn the remote agent started on its own.
   *
   * A prompt submitted while the remote was still busy is queued in its inbox
   * and starts when the previous turn ends. By then the bridge may already
   * report idle: a stream failure fails the turn locally while the remote
   * keeps working, and a resumed runtime replays its log from a saved offset
   * that can sit in the middle of the turn. Without adopting it the turn
   * streams while the bridge believes nothing is running — no watchdog
   * heartbeat is sent (a long one gets killed) and the byte offset is never
   * persisted (so the next reload replays it), while the UI stays idle until
   * the turn ends. The local numbering continues after the last closed turn;
   * no user message is invented because the prompt already belongs to the
   * local turn the bridge submitted.
   *
   * `event` is the durable event that revealed the turn. When it is a
   * `turn/start` the turn begins at step 1; any other event may be a resume
   * in the middle of the turn, whose remote steps are renumbered so the
   * anchor's turn still starts at step 1.
   */
  beginRemoteTurn(state, event = {}) {
    if (state.running || state.closed) return false
    state.running = true
    state.cancelled = false
    state.final = false
    state.buffer = ''
    state.reasoning = ''
    state.text = ''
    state.pendingTools = []
    state.assistantForStep = false
    state.assistantEvent = null
    state.toolSeqs = new Map()
    state.liveAttempt = null
    state.deadPolls = 0
    // A journal-restored runtime replays its log; those transient stream frames
    // are stale, so only a runtime booted by this process starts live.
    state.live = !state.sdk?.reused
    state.turnStartedAt = Date.now()
    state.streamStats = { frames: 0, chunks: 0, firstAt: 0, lastAt: 0 }
    state.streamChunkTypes = {}
    state.streamEmitted = 0
    const rawStep = Number(event.step) || 0
    if (event.type === 'turn/start') {
      // A new remote turn begins; an open anchor turn can only belong to an
      // earlier one whose end was never mirrored.
      this.closeOrphanTurn(state)
      state.turn += 1
      state.remoteTurn = state.turn
      state.remoteStep = 0
      state.stepBase = 0
      state.stepOpen = false
      state.stepOptimistic = false
    } else if (state.turnOpen) {
      // The anchor's turn is still open: keep its numbering, including an open
      // step the replay is about to continue. `stepBase` was restored from the
      // journal so the step counter picks up where it stopped.
      state.remoteTurn = state.turn
      if (rawStep > 0) {
        state.remoteStep = Math.max(state.remoteStep || 0, Math.max(1, rawStep - (state.stepBase || 0)))
      }
    } else {
      state.turn += 1
      state.remoteTurn = state.turn
      state.stepBase = rawStep > 0 ? rawStep - 1 : 0
      state.remoteStep = rawStep > 0 ? 1 : 0
      state.stepOpen = false
      state.stepOptimistic = false
    }
    state.idlePromise = new Promise((resolve) => {
      state.idleResolve = resolve
    })
    this.emitAgentStatus(state, 'running')
    this.startSdkHeartbeat(state)
    this.rememberActive(state)
    this.log('info', `bridge: adopting remote-started turn ${state.turn} for ${state.localSessionId}`)
    return true
  },

  /** Forget everything accumulated for the step that just closed. */
  resetStepBuffers(state) {
    state.reasoning = ''
    state.text = ''
    state.blocks = []
    state.liveBlocks = []
    state.authoritativeContent = null
    state.pendingTools = []
    state.assistantForStep = false
    state.assistantEvent = null
  },

  /**
   * Close a turn the anchor left open when a new turn has to begin.
   *
   * The remote's real end was never mirrored (the bridge was idle when it
   * arrived, or the app stopped first). Appending a second `turn/start` on top
   * of the open turn makes the log invalid, so the orphan is closed as
   * interrupted; unresolved tool calls get the native outcome-unknown result
   * first so the step can be closed without breaking tool pairing.
   */
  closeOrphanTurn(state, reason = { kind: 'interrupted' }) {
    if (!state.turnOpen) return false
    const turn = state.remoteTurn || state.turn
    // Preserve whatever the user already saw before the step closes: an
    // interrupted answer otherwise loses the reasoning streamed so far.
    if (state.stepOpen) this.closeStep(state, turn, state.remoteStep || 1)
    this.append(state, 'turn/end', { turn, reason })
    state.turnOpen = false
    state.stepOptimistic = false
    return true
  },

  async startTurn(state, envelope, { retry = false } = {}) {
    // A warm runner is bound to the profile (and model) it booted with, so it
    // is taken only after this turn's route is settled. Retries never reuse it:
    // the failed attempt may have written a partial transcript.
    let warm = null
    // The previous turn may still be open in the anchor: the bridge was idle
    // when the remote ended it, or the app stopped before the end was mirrored.
    // Close it now — a new turn/start on top of it would invalidate the log.
    if (!retry) this.closeOrphanTurn(state)
    state.generation += 1
    const generation = state.generation
    state.running = true
    this.emitAgentStatus(state, 'running')
    state.cancelled = false
    state.final = false
    state.buffer = ''
    // A resident SDK runtime keeps appending to one file across turns; its
    // stream offset is continuous and must not be rewound per turn. A closed
    // tail (TTL expired, channel reset) still points at the same file, and any
    // fresh boot resets the offset itself in bootSdk().
    if (!state.sdk) {
      state.byteBuffer = Buffer.alloc(0)
      state.offset = 0
    }
    state.reasoning = ''
    state.text = ''
    state.blocks = []
    state.liveBlocks = []
    state.authoritativeContent = null
    state.pendingTools = []
    state.assistantForStep = false
    state.assistantEvent = null
    state.stepOpen = false
    state.turnOpen = false
    state.toolSeqs = new Map()
    state.liveAttempt = null
    state.lastEnvelope = envelope
    state.streamStats = { frames: 0, chunks: 0, firstAt: 0, lastAt: 0 }
    state.streamChunkTypes = {}
    state.streamEmitted = 0
    state.turnStartedAt = Date.now()
    state.streamExpected = this.streamEnabled(state.workspace)
    this.startSdkHeartbeat(state)
    if (!retry) state.retriedStream = false
    this.clearStreamWatchdog(state)
    if (!retry) state.turn += 1
    state.remoteTurn = retry ? state.remoteTurn : 0
    state.remoteStep = 0
    state.stepBase = 0
    state.deadPolls = 0
    state.streamClosed = false
    state.idlePromise = new Promise((resolve) => {
      state.idleResolve = resolve
    })

    const input = envelope.input
    if (!retry) {
      const message = {
        role: 'user',
        content: Array.isArray(input?.content) ? input.content : [{ type: 'text', text: envelope.text }],
        source: input?.source?.kind === 'user' ? input.source : { kind: 'user' },
        id: input?.id || randomUUID()
      }
      this.append(state, 'user/message', message, { surfaceOp: 'append' })
      // Start the turn marker immediately instead of waiting for the remote
      // process to boot; the remote turn_start event is idempotent.
      this.ensureTurn(state, state.turn)
    }

    try {
      // The previous turn's tail/drain channels close asynchronously. Wait for
      // them before opening the next exec channel; busy sshd hosts with a low
      // MaxSessions reject the new request otherwise ("Unable to exec").
      if (state.streamDone) {
        await Promise.race([
          state.streamDone.catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, 400))
        ])
        state.streamDone = null
      }
      if (this.turnInvalid(state, generation)) return
      if (!retry) {
        // A session restored from the journal can boot its runner before any
        // workspace start/restart retargets the runtime. Switch now (bounded,
        // one round trip, throttled per workspace) so this turn does not run on
        // a build that cannot forward `/compact`.
        const switched = await this.syncWorkspaceRuntime(state)
        if (switched) await this.retireRunners(state)
        else await this.retireStaleRunners(state)
        if (this.turnInvalid(state, generation)) return
        // The remote must use the model this chat's picker shows. A changed
        // route retires the old runners and rebuilds their profile; failing to
        // resolve it fails the turn instead of silently using another model.
        try {
          await this.applyModel(state)
        } catch (error) {
          if (this.turnInvalid(state, generation)) return
          this.failTurn(state, `远程模型不可用：${errorText(error)}`)
          return
        }
        if (this.turnInvalid(state, generation)) return
        this.mirrorResolvedModel(state)
        if (!this.sdkUsable(state)) warm = this.takeWarm(state)
      }
      if (this.sdkUsable(state) && !retry) {
        // The persistent runtime keeps the agent/session in memory; only the
        // very first prompt of a session can pay a process start.
        const handled = await this.sdkTurn(state, envelope)
        if (handled) {
          if (this.turnInvalid(state, generation)) return
          this.armStreamWatchdog(state)
          return
        }
      }
      // Headless/warm only: the SDK runtime maintains its own profile, so this
      // round trip must not happen on the SDK path.
      await this.ensureProfile(state)
      if (this.turnInvalid(state, generation)) return
      if (warm) {
        state.eventsFile = warm.eventsFile
        state.stderrFile = warm.stderrFile
        state.pidFile = warm.pidFile
        this.rememberActive(state)
        const submitted = await this.submitWarm(state, warm, envelope.text)
        if (this.turnInvalid(state, generation)) {
          // The prompt may already have reached the warm runner; stop it
          // instead of leaving an orphan that writes into a closed session.
          await this.killTurnProcess(state)
          return
        }
        if (submitted) {
          state.live = true
          this.armStreamWatchdog(state)
          try {
            await this.startTail(state)
          } catch (error) {
            this.log('warn', `bridge stream unavailable for ${state.localSessionId}: ${errorText(error)}`)
            this.switchToPoll(state)
          }
          return
        }
        // The idle runner died before the prompt arrived (TTL, dropped SSH
        // channel, boot error): fall through to the stock cold launch.
        this.log('warn', `bridge warm runner missing for ${state.localSessionId}; cold launch`)
      }
      const bridgeDir = joinRemote(state.workspace.wsRoot, 'bridge', safeId(state.localSessionId))
      state.eventsFile = joinRemote(bridgeDir, `turn-${state.turn}.jsonl`)
      state.stderrFile = joinRemote(bridgeDir, `turn-${state.turn}.err`)
      state.pidFile = joinRemote(bridgeDir, `turn-${state.turn}.pid`)
      this.rememberActive(state)
      await this.launch(state, envelope.text)
      if (this.turnInvalid(state, generation)) {
        // A cancel during the cold start could not see the pid file yet; stop
        // the runner now that launch() has written it.
        await this.killTurnProcess(state)
        return
      }
      state.live = true
      this.armStreamWatchdog(state)
      try {
        await this.startTail(state)
      } catch (error) {
        this.log('warn', `bridge stream unavailable for ${state.localSessionId}: ${errorText(error)}`)
        this.switchToPoll(state)
      }
    } catch (error) {
      if (this.turnInvalid(state, generation)) return
      this.log('warn', `bridge launch failed for ${state.localSessionId}: ${errorText(error)}`)
      this.failTurn(state, `远程会话启动失败：${errorText(error)}`)
    }
  },

  /** True once a turn has been cancelled, detached, or superseded. */
  turnInvalid(state, generation) {
    return this.disposed || state.closed || state.cancelled || state.generation !== generation
  },

  async killTurnProcess(state) {
    if (!state.pidFile) return
    try {
      await this.pool.exec(state.host, [
        `p=$(cat ${q(state.pidFile)} 2>/dev/null || echo 0)`,
        '[ -n "$p" ] && [ "$p" != "0" ] && { kill -TERM "-$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null || true; }',
        'true'
      ].join('\n'), { timeoutMs: 10000 })
    } catch {
      // best effort: the runner is already gone or the host is unreachable
    }
  },

  async launch(state, text) {
    const workspace = state.workspace
    const remoteDir = remotePath.dirname(state.eventsFile)
    const args = ['--profile', 'headless', '--json']
    if (state.remoteSessionId) args.push('--session-id', state.remoteSessionId)
    args.push(text)
    const inner = [
      `cd ${q(workspace.remotePath)}`,
      `exec env DSH_HOME=${q(workspace.dshHome)} NODE_COMPILE_CACHE=${q(joinRemote(workspace.dshHome, '.node-compile-cache'))} DSH_PERMISSION_MODE=${q(this.permissionMode)} ${q(workspace.nodeBin)} ${q(workspace.dshBin)} ${args.map((value) => shq(value)).join(' ')}`
    ].join(' && ')
    const command = [
      `mkdir -p ${q(remoteDir)}`,
      `rm -f ${q(state.eventsFile)} ${q(state.stderrFile)} ${q(state.pidFile)}`,
      'if command -v setsid >/dev/null 2>&1; then',
      `  setsid nohup sh -c ${q(inner)} > ${q(state.eventsFile)} 2> ${q(state.stderrFile)} < /dev/null &`,
      'else',
      `  nohup sh -c ${q(inner)} > ${q(state.eventsFile)} 2> ${q(state.stderrFile)} < /dev/null &`,
      'fi',
      `echo $! > ${q(state.pidFile)}`
    ].join('\n')
    const result = await this.pool.exec(state.host, command, { timeoutMs: 15000 })
    if (result.code !== 0) {
      throw new Error(`remote headless launch failed (exit ${result.code}): ${(result.stderr || result.stdout || '').trim().slice(0, 400)}`)
    }
    this.log('info', `bridge: launched remote turn ${state.turn} for ${state.localSessionId} (${workspace.name})`)
  },

  ensureTurn(state, turn = state.remoteTurn || state.turn) {
    if (state.turnOpen) return
    this.append(state, 'turn/start', { turn })
    state.turnOpen = true
  },

  ensureStep(state) {
    this.ensureTurn(state)
    if (state.stepOpen) return
    const turn = state.remoteTurn || state.turn
    // The next local step, not the one that just closed: re-using a closed
    // number would emit a duplicate step/start the anchor rejects.
    const step = (state.remoteStep || 0) + 1
    state.remoteStep = step
    this.append(state, 'step/start', { turn, step })
    state.stepOpen = true
    state.stepOptimistic = true
  },

  /**
   * Close tool calls that a mirrored step leaves without a result.
   *
   * The remote agent writes its own interrupted `tool/result` when a turn
   * stops, but that notification can be lost when the runtime process exits
   * mid-step. dsh's v4 validator then rejects the whole anchor for a `step/end`
   * with an unresolved call, which makes the chat's history unreadable. The
   * record written here is the native "outcome unknown" shape, so the local
   * transcript stays faithful instead of dropping the call.
   */
  settleDanglingTools(state, turn, step) {
    if (!state.toolSeqs || state.toolSeqs.size === 0) return 0
    let closed = 0
    for (const [callId, seq] of [...state.toolSeqs]) {
      const event = this.append(state, 'tool/result', {
        turn,
        step,
        message: {
          id: `interrupted-tool-result-${callId}-${seq}`,
          role: 'tool',
          toolCallId: callId,
          isError: true,
          source: { kind: 'tool', callId },
          content: [{ type: 'text', text: TOOL_OUTCOME_UNKNOWN_TEXT }]
        },
        error: { name: 'ToolOutcomeUnknownError', code: 'TOOL_OUTCOME_UNKNOWN' }
      }, { surfaceOp: 'append', sourceEventSeqs: [seq] })
      if (!event) continue
      state.toolSeqs.delete(callId)
      closed += 1
    }
    if (closed > 0) {
      this.log('info', `bridge: closed ${closed} interrupted tool call(s) for ${state.localSessionId}`)
    }
    return closed
  },

  closeStep(state, turn = state.remoteTurn || state.turn, step = state.remoteStep || 1) {
    if (!state.stepOpen) return
    const assistant = this.flushAssistant(state)
    this.settleLive(state, assistant)
    // Must run before the step boundary: a tool/result cannot be appended
    // after its step/end.
    this.settleDanglingTools(state, turn, step)
    this.append(state, 'step/end', { turn, step })
    state.stepOpen = false
    state.rawOpenStep = 0
    state.stepOptimistic = false
    this.resetStepBuffers(state)
  },

  /**
   * Fail the open turn with one assistant message that keeps the reasoning and
   * text streamed before the failure. The old path abandoned the preview and
   * then wrote a separate error row, so the thinking disappeared and the step
   * ended up with two assistant messages.
   */
  failTurn(state, message) {
    const turn = state.remoteTurn || state.turn
    this.ensureStep(state)
    const step = state.remoteStep || 1
    if (!state.assistantForStep) {
      const content = this.stepContent(state)
      const errorBlock = { type: 'text', text: message }
      // Tool calls stay last, as the native loop writes them.
      const toolAt = content.findIndex((block) => block?.type === 'tool-call')
      if (toolAt < 0) content.push(errorBlock)
      else content.splice(toolAt, 0, errorBlock)
      const appended = this.append(state, 'assistant/message', {
        turn,
        step,
        stream: [],
        message: {
          role: 'assistant',
          content,
          source: this.assistantSource(state),
          id: randomUUID()
        }
      }, { surfaceOp: 'append' })
      state.assistantForStep = true
      state.assistantEvent = appended
      this.settleLive(state, appended)
      this.publishToolCalls(state, content, turn, step)
    } else {
      // The step already has its committed answer; the error belongs to the
      // turn, not to a second assistant row.
      const flushed = this.flushAssistant(state)
      this.settleLive(state, state.assistantEvent || flushed)
    }
    this.closeStep(state, turn, step)
    this.append(state, 'turn/end', { turn, reason: { kind: 'error', error: { message } } })
    state.turnOpen = false
    this.finish(state)
  }
}
