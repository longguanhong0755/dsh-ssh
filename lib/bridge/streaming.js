// SessionBridge methods: stdout tailing, live preview chunks and the polling fallback.
//
// Moved verbatim out of lib/bridge.js (the bodies still use `this`) and assigned
// onto SessionBridge.prototype at the end of that module.

import { randomUUID } from 'node:crypto'
import { errorText, nowIso, q } from '../util.js'
import { MAX_BRIDGE_LINE_BYTES, STREAM_RETRY_MS, STREAM_WATCHDOG_MS, runnerFailureMessage } from './shared.js'

export const streamMethods = {
  buildTailCommand(state) {
    const start = Math.max(0, Number(state.offset) || 0) + 1
    const tailPidFile = `${state.eventsFile}.tail.pid`
    return [
      `pid=$(cat ${q(state.pidFile)} 2>/dev/null || echo 0)`,
      'if [ -z "$pid" ] || [ "$pid" = "0" ]; then exit 3; fi',
      // A local app restart drops the SSH channel but the remote tail keeps
      // reading until the runner exits. Retire the previous watcher first so
      // one session never accumulates tail processes across restarts.
      `old=$(cat ${q(tailPidFile)} 2>/dev/null || echo 0)`,
      `if [ "$old" != "0" ] && [ -r "/proc/$old/cmdline" ] && grep -qF ${q(state.eventsFile)} "/proc/$old/cmdline" 2>/dev/null; then kill "$old" 2>/dev/null || true; fi`,
      'n=0',
      `while [ ! -f ${q(state.eventsFile)} ] && [ "$n" -lt 250 ] && kill -0 "$pid" 2>/dev/null; do sleep 0.02; n=$((n+1)); done`,
      // A relaunched runner recreates out.jsonl, so a byte offset saved from
      // the previous one points past its end; `tail -c +N` would then print
      // "file truncated" and skip the new turn. Read from the start instead
      // and tell the bridge to drop the stale offset.
      `size=$(stat -c %s ${q(state.eventsFile)} 2>/dev/null || echo 0)`,
      `if [ "$size" -lt ${start - 1} ]; then start=1; printf '%s\\n' '{"__bridge":"tail-reset"}'; else start=${start}; fi`,
      'if command -v stdbuf >/dev/null 2>&1; then',
      `  stdbuf -oL tail -c +$start -f ${q(state.eventsFile)} & tp=$!`,
      'else',
      `  tail -c +$start -f ${q(state.eventsFile)} & tp=$!`,
      'fi',
      `echo "$tp" > ${q(tailPidFile)} 2>/dev/null || true`,
      'while kill -0 "$pid" 2>/dev/null; do sleep 0.1; done',
      'sleep 0.2',
      'kill "$tp" 2>/dev/null || true',
      'wait "$tp" 2>/dev/null || true',
      `rm -f ${q(tailPidFile)} 2>/dev/null || true`,
      'exit 0'
    ].join('\n')
  },

  /**
   * One long-lived SSH channel follows the detached runner's JSONL file.
   * The runner itself stays detached, so closing the local app only drops this
   * channel; the next attach resumes from the saved byte offset.
   */
  async startTail(state) {
    if (state.stream) return
    if (!state.running && !state.sdk) return
    const generation = state.generation
    const resident = Boolean(state.sdk)
    const ownerSdk = state.sdk || null
    const handle = await this.pool.execStream(state.host, this.buildTailCommand(state), {
      onStdout: (chunk) => {
        if (resident || state.generation === generation) this.consumeBytes(state, chunk)
      },
      onStderr: (chunk) => {
        const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
        state.tailStderr = `${state.tailStderr || ''}${text}`.slice(-4000)
      }
    })
    if ((!state.running && !state.sdk) || (!resident && state.generation !== generation)) {
      try {
        handle.close()
      } catch {
        // ignore
      }
      return
    }
    state.stream = handle
    state.streamClosed = false
    state.streamDone = handle.done
      .then((result) => this.onStreamClosed(state, result, generation, resident, ownerSdk))
      .catch((error) => this.onStreamError(state, error, generation, resident))
  },

  consumeBytes(state, chunk) {
    if (!chunk || chunk.length === 0) return
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    state.offset += buffer.length
    state.byteBuffer = state.byteBuffer.length === 0 ? buffer : Buffer.concat([state.byteBuffer, buffer])
    if (state.byteBuffer.length > MAX_BRIDGE_LINE_BYTES) {
      // Dropping the partial line silently loses events, which then surfaces
      // as an unexplained hang. A line this large is a transport failure, so
      // say so and fail the turn instead of mirroring a truncated transcript.
      const bytes = state.byteBuffer.length
      state.byteBuffer = Buffer.alloc(0)
      const message = `远端事件行超过 ${MAX_BRIDGE_LINE_BYTES} 字节（${bytes}），桥接无法完整读取本回合；请减小单条消息或调高 DSH_SSH_MAX_LINE_BYTES`
      this.log('error', `bridge line buffer overflow for ${state.localSessionId}: ${message}`)
      if (state.running) this.failTurn(state, message)
      return
    }
    let index = state.byteBuffer.indexOf(10)
    while (index >= 0) {
      const line = state.byteBuffer.subarray(0, index).toString('utf8').trim()
      state.byteBuffer = state.byteBuffer.subarray(index + 1)
      if (line) {
        let event
        try {
          event = JSON.parse(line)
        } catch {
          event = null
        }
        if (event) this.consumeFrame(state, event)
      }
      index = state.byteBuffer.indexOf(10)
    }
    // Persist the offset whenever mirrored bytes belong to an open turn, even
    // if the bridge has not adopted it as running yet: replaying those bytes
    // on the next attach would duplicate steps the anchor already published.
    if (state.running || state.turnOpen) this.rememberActive(state)
    this.saveSoon()
  },

  async readStderrTail(state) {
    try {
      const tail = await this.pool.exec(
        state.host,
        `tail -30 ${q(state.stderrFile)} 2>/dev/null || true`,
        { timeoutMs: 10000 }
      )
      return String(tail.stdout || '').trim()
    } catch {
      return ''
    }
  },

  async processAlive(state) {
    try {
      const alive = await this.pool.exec(
        state.host,
        `if [ -f ${q(state.pidFile)} ]; then p=$(cat ${q(state.pidFile)}); kill -0 $p 2>/dev/null && echo alive || echo dead; else echo dead; fi`,
        { timeoutMs: 10000 }
      )
      return String(alive.stdout || '').trim() === 'alive'
    } catch {
      return true
    }
  },

  async onStreamClosed(state, result, generation, resident = false, ownerSdk = null) {
    if (!resident && state.generation !== generation) return
    state.stream = null
    state.streamClosed = true
    if (!state.running) {
      // An idle resident runtime may have been reaped by its TTL watchdog.
      // Drop the stale handle so the next prompt boots a fresh one instead of
      // writing into a dead FIFO.
      if (resident && ownerSdk && state.sdk === ownerSdk) {
        const alive = await this.processAlive(state)
        if (!alive && state.sdk === ownerSdk) {
          state.sdk = null
          this.log('info', `bridge: sdk runtime exited for ${state.localSessionId}; next turn will resume`)
        }
      }
      return
    }
    // Drain bytes written between tail's last read and the process exit.
    try {
      const drain = await this.pool.execStream(
        state.host,
        `tail -c +${Math.max(0, Number(state.offset) || 0) + 1} ${q(state.eventsFile)} 2>/dev/null || true`,
        {
          onStdout: (chunk) => {
            if (resident || state.generation === generation) this.consumeBytes(state, chunk)
          }
        }
      )
      await drain.done
    } catch {
      // best effort
    }
    if ((!resident && state.generation !== generation) || !state.running) return
    if (state.final) {
      this.finish(state)
      return
    }
    const alive = await this.processAlive(state)
    if ((!resident && state.generation !== generation) || !state.running) return
    if (alive) {
      // tail disappeared but the runner is still alive (missing tail, channel
      // reset): fall back to the polling transport.
      this.log('warn', `bridge stream closed early for ${state.localSessionId}; falling back to polling`)
      this.switchToPoll(state)
      return
    }
    // `tail -f` reports "file truncated" when the runner replaced out.jsonl,
    // then exits; the turn itself can still be running. Re-attach from byte 0
    // instead of declaring the runtime dead. Bounded so a broken file cannot
    // spin here.
    if (/file truncated/iu.test(state.tailStderr || '') && (state.tailResets || 0) < 2) {
      state.tailResets = (state.tailResets || 0) + 1
      state.offset = 0
      state.byteBuffer = Buffer.alloc(0)
      state.tailStderr = ''
      this.log('warn', `bridge: remote event log was recreated for ${state.localSessionId}; re-attaching the tail from the start`)
      await this.startTail(state)
      if (state.stream) return
    }
    const detail = (await this.readStderrTail(state)) || state.tailStderr || ''
    if ((!resident && state.generation !== generation) || !state.running) return
    if (state.cancelled) {
      this.finish(state)
      return
    }
    if (!resident && await this.retryWithoutStream(state, detail)) return
    if (resident && ownerSdk && state.sdk === ownerSdk) state.sdk = null
    const fallback = resident
      ? 'the remote dsh SDK runtime exited before finishing this turn'
      : 'the remote dsh runner exited before finishing this turn'
    this.failTurn(state, runnerFailureMessage(detail, fallback))
    this.log('warn', `bridge: remote turn ended without final for ${state.localSessionId}${detail ? `: ${detail.slice(0, 300)}` : ''}`)
  },

  onStreamError(state, error, generation, resident = false) {
    if (!resident && state.generation !== generation) return
    state.stream = null
    state.streamClosed = true
    if (!state.running) return
    this.log('warn', `bridge stream failed for ${state.localSessionId}: ${errorText(error)}`)
    this.switchToPoll(state)
  },

  /**
   * The remote profile's stream plugin is a convenience projection. If it
   * cannot load, rewrite the profile without it and relaunch the same turn
   * once so the feature degrades instead of killing the session.
   */
  async retryWithoutStream(state, detail) {
    if (state.retriedStream) return false
    if (!/dsh-ssh-stream|ERR_MODULE_NOT_FOUND|Cannot find package|failed to resolve/iu.test(String(detail))) return false
    state.retriedStream = true
    // Cooldown, not a permanent kill switch: another turn (after the retry
    // window) probes the stream plugin again and recovers automatically.
    this.streamRetryAt.set(state.workspace.id, Date.now() + STREAM_RETRY_MS)
    for (const key of [...this.profiles.keys()]) {
      if (key.startsWith(`${state.workspace.id}:`)) this.profiles.delete(key)
    }
    this.log('warn', `bridge: remote stream plugin failed to load for ${state.workspace.name}; retrying in ${Math.round(STREAM_RETRY_MS / 1000)}s`)
    try {
      await this.ensureProfile(state)
    } catch (error) {
      this.log('warn', `bridge: plain profile rewrite failed: ${errorText(error)}`)
      return false
    }
    if (!state.lastEnvelope) return false
    state.running = false
    if (state.timer) {
      clearTimeout(state.timer)
      state.timer = null
    }
    try {
      state.stream?.close()
    } catch {
      // ignore
    }
    state.stream = null
    void this.startTurn(state, state.lastEnvelope, { retry: true })
    return true
  },

  switchToPoll(state) {
    if (state.byteBuffer.length > 0) {
      state.buffer += state.byteBuffer.toString('utf8')
      state.byteBuffer = Buffer.alloc(0)
    }
    this.schedulePoll(state)
  },

  schedulePoll(state) {
    if (state.timer || !state.running) return
    state.timer = setTimeout(() => {
      state.timer = null
      void this.poll(state)
    }, this.pollMs)
    if (typeof state.timer.unref === 'function') state.timer.unref()
  },

  async poll(state) {
    if (!state.running || state.polling) return
    state.polling = true
    try {
      // One exec for both the file size and the runner's liveness: a polling
      // turn already pays one SSH round trip per interval, so halving the
      // probes halves the latency/noise on the target.
      const probe = await this.pool.exec(
        state.host,
        [
          `if [ -f ${q(state.eventsFile)} ]; then s=$(wc -c < ${q(state.eventsFile)}); else s=0; fi`,
          `if [ -f ${q(state.pidFile)} ]; then p=$(cat ${q(state.pidFile)} 2>/dev/null); kill -0 "$p" 2>/dev/null && a=alive || a=dead; else a=dead; fi`,
          'printf "@@SIZE %s\\n@@ALIVE %s\\n" "$s" "$a"'
        ].join('\n'),
        { timeoutMs: 15000 }
      )
      const probeOut = String(probe.stdout || '')
      const size = Number((probeOut.match(/@@SIZE\s+(\d+)/u) || [])[1]) || 0
      const alive = (probeOut.match(/@@ALIVE\s+(\w+)/u) || [])[1] || 'alive'
      if (size < state.offset) {
        // The runner was relaunched and recreated out.jsonl: the saved offset
        // points past the new file, so waiting for it to grow would hang the
        // turn forever. Re-read from the start, exactly like the tail does.
        this.log('warn', `bridge: remote event log was recreated for ${state.localSessionId}; polling from the start`)
        state.offset = 0
        state.byteBuffer = Buffer.alloc(0)
        state.buffer = ''
      }
      if (size > state.offset) {
        const chunkResult = await this.pool.exec(
          state.host,
          `tail -c +${state.offset + 1} ${q(state.eventsFile)}`,
          { timeoutMs: 25000 }
        )
        const chunk = chunkResult.stdout || ''
        if (chunk) {
          state.offset += Buffer.byteLength(chunk, 'utf8')
          state.buffer += chunk
          this.consume(state)
          if (state.running) this.rememberActive(state)
          this.saveSoon()
        }
      }
      if (!state.final && !state.running) {
        // finished by cancel
      } else if (!state.final && state.running) {
        if (alive === 'dead' && !state.final) {
          state.deadPolls = (state.deadPolls || 0) + 1
          if (state.deadPolls >= 2) {
            const tail = await this.pool.exec(
              state.host,
              `tail -20 ${q(state.stderrFile)} 2>/dev/null || true`,
              { timeoutMs: 10000 }
            ).catch(() => ({ stdout: '' }))
            const detail = String(tail.stdout || '').trim()
            if (!state.cancelled) {
              const fallback = state.sdk
                ? 'the remote dsh SDK runtime exited before finishing this turn'
                : 'the remote dsh runner exited before finishing this turn'
              this.failTurn(state, runnerFailureMessage(detail, fallback))
            } else {
              this.finish(state)
            }
            this.log('warn', `bridge: remote turn ended without final for ${state.localSessionId}${detail ? `: ${detail.slice(0, 300)}` : ''}`)
          }
        } else {
          state.deadPolls = 0
        }
      }
    } catch (error) {
      this.log('warn', `bridge poll failed for ${state.localSessionId}: ${errorText(error)}`)
      state.deadPolls = (state.deadPolls || 0) + 1
      if (state.deadPolls >= 6) {
        this.failTurn(state, errorText(error))
      }
    } finally {
      state.polling = false
    }
    if (state.running) this.schedulePoll(state)
  },

  consume(state) {
    const lines = state.buffer.split('\n')
    state.buffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let event
      try {
        event = JSON.parse(trimmed)
      } catch {
        continue
      }
      // Same dispatcher as the tail: the SDK runtime writes JSON-RPC
      // `session.event` notifications, which only consumeFrame can unwrap.
      // Dispatching these lines with consumeEvent dropped every durable
      // record during a polling turn (assistant message, step/end, turn/end),
      // so the turn hung forever while the live preview kept streaming.
      this.consumeFrame(state, event)
    }
  },

  append(state, type, data, options) {
    try {
      return state.agent.session.append(type, data, options)
    } catch (error) {
      this.log('warn', `bridge: append ${type} failed for ${state.localSessionId}: ${errorText(error)}`)
      return null
    }
  },

  emitStream(state, frame) {
    const agent = state.agent
    try {
      if (agent?.dispatch && typeof agent.dispatch.emit === 'function') {
        agent.dispatch.emit('agent/assistant-stream', { frame })
        state.streamEmitted = (state.streamEmitted || 0) + 1
        return true
      }
      if (agent?.ctx && typeof agent.ctx.emit === 'function') {
        agent.ctx.emit('agent/assistant-stream', { agent, frame })
        state.streamEmitted = (state.streamEmitted || 0) + 1
        return true
      }
      if (this.ctx && typeof this.ctx.emit === 'function') {
        this.ctx.emit('agent/assistant-stream', { agent, frame })
        state.streamEmitted = (state.streamEmitted || 0) + 1
        return true
      }
    } catch (error) {
      if (!state.streamEmitWarned) {
        state.streamEmitWarned = true
        this.log('warn', `bridge: assistant-stream emit failed for ${state.localSessionId}: ${errorText(error)}`)
      }
      return false
    }
    if (!state.streamEmitWarned) {
      state.streamEmitWarned = true
      this.log('warn', `bridge: no assistant-stream emitter for ${state.localSessionId}; live preview disabled`)
    }
    return false
  },

  /**
   * Mirror the bridge's turn state onto the local Agent status.
   *
   * Intercepting followup() bypasses the stock agent loop, so its phase never
   * leaves idle: the native UI would render a remote turn as finished (no live
   * turn, no stop button) even though the runner is still working. The session
   * controller forwards `agent/status` to the client as api-session/status,
   * which is what drives the running state and the stop control.
   */
  emitAgentStatus(state, status) {
    const agent = state.agent
    const payload = { agent, status }
    try {
      if (agent?.dispatch && typeof agent.dispatch.emit === 'function') {
        agent.dispatch.emit('agent/status', { status })
        return
      }
      if (agent?.ctx && typeof agent.ctx.emit === 'function') {
        agent.ctx.emit('agent/status', payload)
        return
      }
      if (this.ctx && typeof this.ctx.emit === 'function') this.ctx.emit('agent/status', payload)
    } catch (error) {
      this.log('warn', `bridge: agent status emit failed for ${state.localSessionId}: ${errorText(error)}`)
    }
  },

  /**
   * Allocate the next assistant-stream revision for this agent.
   *
   * The renderer's follow connection enforces a single strictly increasing
   * revision sequence per agent (it drops the whole carrier with
   * `skipped revision N` otherwise) and resumes from the accumulator's last
   * revision. AssistantStreamAttempt advances the agent's own counter once per
   * frame; bridged frames are forged locally, so they must advance the very
   * same counter instead of restarting at 1 for every attempt.
   */
  nextStreamRevision(state) {
    const agent = state.agent
    const current = Number(agent?.assistantStreamRevision)
    const previous = Number.isFinite(current) && current >= 0 ? current : (Number(state.streamRevision) || 0)
    const next = previous + 1
    state.streamRevision = next
    if (agent && typeof agent === 'object') {
      try {
        agent.assistantStreamRevision = next
      } catch {
        // A frozen agent still gets the bridge-local counter, which is
        // continuous across attempts; only a mixed real/forged stream breaks.
      }
    }
    return next
  },

  ensureLive(state, remoteAttemptId = '') {
    if (state.liveAttempt) {
      const current = state.liveAttempt.remoteId || ''
      const incoming = remoteAttemptId ? String(remoteAttemptId) : ''
      if (!incoming || !current || incoming === current) return state.liveAttempt
      // A provider retry starts a new attempt for the same step. Retire the
      // failed preview before opening the next one.
      this.settleLive(state, null)
    }
    this.ensureStep(state)
    const attempt = { id: randomUUID(), remoteId: remoteAttemptId ? String(remoteAttemptId) : '', revision: 0, index: 0 }
    state.liveAttempt = attempt
    const revision = this.nextStreamRevision(state)
    attempt.revision = revision
    this.emitStream(state, {
      type: 'start',
      attemptId: attempt.id,
      revision,
      turn: state.remoteTurn || state.turn,
      step: state.remoteStep || 1
    })
    return attempt
  },

  pushLive(state, chunk, time, remoteAttemptId = '') {
    if (!chunk || typeof chunk !== 'object' || typeof chunk.type !== 'string') return
    const attempt = this.ensureLive(state, remoteAttemptId)
    // Buffer the streamed text too: if the turn is cancelled or fails before
    // the durable message arrives, the preview is rebuilt from these blocks
    // instead of being abandoned with the temporary row.
    const blockType = chunk.type === 'reasoning-delta' ? 'reasoning' : chunk.type === 'text-delta' ? 'text' : ''
    if (blockType) this.appendContentBlock(state.liveBlocks || (state.liveBlocks = []), blockType, chunk.text)
    const at = Number.isFinite(Number(time)) ? Number(time) : Date.now()
    const revision = this.nextStreamRevision(state)
    attempt.revision = revision
    const types = state.streamChunkTypes || (state.streamChunkTypes = {})
    types[chunk.type] = (types[chunk.type] || 0) + 1
    this.emitStream(state, {
      type: 'chunk',
      attemptId: attempt.id,
      revision,
      index: attempt.index,
      time: at,
      chunk
    })
    attempt.index += 1
  },

  /** Close the live attempt, pointing a committed end at the durable message. */
  settleLive(state, event) {
    const attempt = state.liveAttempt
    if (!attempt) return
    state.liveAttempt = null
    const seq = Number(event?.seq)
    if (event?.type === 'assistant/message' && Number.isSafeInteger(seq)) {
      const revision = this.nextStreamRevision(state)
      this.emitStream(state, {
        type: 'end',
        attemptId: attempt.id,
        revision,
        index: attempt.index,
        outcome: { kind: 'committed', eventType: 'assistant/message', seq }
      })
      return
    }
    const revision = this.nextStreamRevision(state)
    this.emitStream(state, {
      type: 'end',
      attemptId: attempt.id,
      revision,
      index: attempt.index,
      outcome: { kind: 'abandoned' }
    })
  },

  consumeStreamEvent(state, frame) {
    // Resumed turns replay the JSONL file; their transient frames are stale
    // once the local session already holds the durable events.
    if (!state.live || state.cancelled || !state.running || !frame) return
    const stats = state.streamStats || (state.streamStats = { frames: 0, chunks: 0, firstAt: 0, lastAt: 0 })
    stats.frames += 1
    stats.lastAt = Date.now()
    if (frame.type === 'start') {
      this.ensureLive(state, frame.attemptId)
      return
    }
    if (frame.type === 'chunk') {
      stats.chunks += 1
      if (!stats.firstAt) stats.firstAt = stats.lastAt
      this.pushLive(state, frame.chunk, frame.time, frame.attemptId)
    }
  },

  clearStreamWatchdog(state) {
    if (!state.streamWatchdog) return
    clearTimeout(state.streamWatchdog)
    state.streamWatchdog = null
  },

  /**
   * If the runtime accepted a prompt but never produced a transient frame, the
   * answer will only appear at step end. Record it loudly instead of leaving a
   * silent non-streaming session; the durable path still completes the turn.
   */
  armStreamWatchdog(state) {
    this.clearStreamWatchdog(state)
    if (!state.streamExpected) return
    state.streamWatchdog = setTimeout(() => {
      state.streamWatchdog = null
      if (!state.running) return
      if ((state.streamStats?.frames || 0) > 0) return
      this.log('warn', `bridge: no assistant-stream frames for ${state.localSessionId} after ${STREAM_WATCHDOG_MS}ms (transport=${state.sdk ? 'sdk' : 'headless'})`)
    }, STREAM_WATCHDOG_MS)
    if (typeof state.streamWatchdog.unref === 'function') state.streamWatchdog.unref()
  },

  noteStreamStats(state) {
    const stats = state.streamStats || {}
    const elapsed = state.turnStartedAt ? Date.now() - state.turnStartedAt : 0
    const seen = this.streamSeen.get(state.localSessionId) || {}
    this.traceStream({
      at: nowIso(),
      session: state.localSessionId,
      transport: state.sdk ? 'sdk' : 'headless',
      emitted: state.streamEmitted || 0,
      seenFrames: seen.frames || 0,
      seenChunks: seen.chunks || 0,
      lastRevision: seen.revision || 0,
      agentRevision: Number(state.agent?.assistantStreamRevision) || 0,
      probe: Boolean(this.streamProbe),
      frames: stats.frames || 0,
      chunks: stats.chunks || 0,
      types: state.streamChunkTypes || {},
      elapsed
    })
    if ((stats.frames || 0) > 0) {
      const first = stats.firstAt && state.turnStartedAt ? stats.firstAt - state.turnStartedAt : 0
      this.log('info', `bridge stream: ${state.localSessionId} frames=${stats.frames} chunks=${stats.chunks} first=${first}ms turn=${elapsed}ms`)
    } else if (state.streamExpected) {
      this.log('warn', `bridge: turn for ${state.localSessionId} produced no stream frames (transport=${state.sdk ? 'sdk' : 'headless'}, ${elapsed}ms)`)
    }
  }
}
