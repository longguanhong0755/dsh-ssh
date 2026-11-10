// SessionBridge methods: turns and events served by the persistent SDK runtime.
//
// Moved verbatim out of lib/bridge.js (the bodies still use `this`) and assigned
// onto SessionBridge.prototype at the end of that module.

import { randomUUID } from 'node:crypto'
import { errorText } from '../util.js'
import { ADOPTING_EVENT_TYPES, SDK_RETRY_MS } from './shared.js'

export const sdkTurnMethods = {
  async sdkTurn(state, envelope) {
    let sdk = null
    try {
      sdk = await this.bootSdk(state)
    } catch (error) {
      this.log('warn', `bridge sdk boot failed for ${state.localSessionId}: ${errorText(error)}`)
      state.sdkFailed = true
      state.sdkRetryAt = Date.now() + SDK_RETRY_MS
      try {
        state.stream?.close()
      } catch {
        // ignore
      }
      state.stream = null
      state.streamDone = null
      state.byteBuffer = Buffer.alloc(0)
      state.offset = 0
      await this.killSdk(state)
      return false
    }
    if (!sdk || state.closed || !state.running) return false
    const sessionId = state.remoteSessionId || randomUUID()
    if (!state.remoteSessionId) {
      state.remoteSessionId = sessionId
      this.rememberActive(state)
    }
    if (!state.stream) {
      try {
        await this.startTail(state)
      } catch (error) {
        // A tail failure is transient (channel limit, dropped connection);
        // let this turn use the headless transport and retry SDK next turn.
        this.log('warn', `bridge sdk stream unavailable for ${state.localSessionId}: ${errorText(error)}`)
        await this.killSdk(state)
        return false
      }
    }
    state.live = true
    try {
      await this.sdkCall(state, 'session/prompt', {
        sessionId,
        contentBlocks: [{ type: 'text', text: envelope.text }]
      }, 20000)
      return true
    } catch (error) {
      const detail = errorText(error)
      // A dead process rejected the write before the prompt was queued, so it
      // is safe to boot once more and retry. A timeout may have a queued
      // prompt behind it: never replay that through another runner.
      if (/not running|sdk-dead/u.test(detail)) {
        await this.killSdk(state)
        try {
          await this.bootSdk(state)
          await this.sdkCall(state, 'session/prompt', {
            sessionId,
            contentBlocks: [{ type: 'text', text: envelope.text }]
          }, 20000)
          return true
        } catch (retryError) {
          if (state.cancelled || !state.running) return true
          this.failTurn(state, `远程会话发送失败：${errorText(retryError)}`)
          return true
        }
      }
      // cancel() kills the runtime while a prompt is queued; that rejection is
      // the expected outcome of the user stopping, not a turn failure.
      if (state.cancelled || !state.running) return true
      this.failTurn(state, `远程会话发送失败：${detail}`)
      await this.killSdk(state)
      return true
    }
  },

  consumeFrame(state, frame) {
    if (frame?.jsonrpc) {
      if (frame.method) {
        this.consumeSdkNotification(state, frame)
        return
      }
      if (frame.id !== undefined) {
        const pending = state.sdkPending.get(frame.id)
        if (!pending) return
        state.sdkPending.delete(frame.id)
        clearTimeout(pending.timer)
        if (frame.error) pending.reject(new Error(`${pending.method}: ${frame.error.message || 'request failed'}`))
        else pending.resolve(frame.result)
      }
      return
    }
    if (frame?.type === 'event' && frame.event) {
      this.consumeEvent(state, frame.event)
      return
    }
    this.consumeEvent(state, frame)
  },

  consumeSdkNotification(state, frame) {
    if (frame.method !== 'session.event') return
    const params = frame.params || {}
    if (!state.remoteSessionId || params.sessionId !== state.remoteSessionId) return
    this.sdkSessionEvent(state, params.event || {})
  },

  sdkSessionEvent(state, event) {
    const data = event.data || {}
    const rawStep = Number(data.step) || 0
    // While `/compact` is in flight the remote only writes command and
    // compaction records. If a remote build without the compact command ever
    // treated the text as a prompt, its turn-shaped events must not be mirrored
    // into the anchor: the local log has no matching turn markers and would
    // become invalid.
    if (state.compactForwarding) {
      switch (event.type) {
        case 'turn/start':
        case 'turn/end':
        case 'step/start':
        case 'step/end':
        case 'assistant/message':
        case 'tool/call':
        case 'tool/result':
        case 'request/header':
        case 'request/context':
          return
        default:
          break
      }
    }
    // The remote agent keeps working independently of this process: an inbox
    // prompt starts after the previous turn ends, a stream failure settles the
    // turn locally while the remote continues, and a resumed runtime replays
    // the log from a saved offset. Any durable event then means a turn is
    // live, even when no `turn/start` is left to read (the resume point can be
    // in the middle of that turn). Adopt it before mirroring anything so the
    // turn gets its watchdog heartbeat, a persisted byte offset and a local
    // turn number that keeps the anchor valid.
    if (!state.running && !state.closed && ADOPTING_EVENT_TYPES.has(event.type)) {
      this.beginRemoteTurn(state, { type: event.type, step: rawStep })
    }
    // Remote step numbers are renumbered when a turn is adopted mid-way (the
    // anchor's turn must start at step 1), so every event of that turn maps
    // through the same base.
    const step = rawStep > 0
      ? Math.max(1, rawStep - (state.stepBase || 0))
      : (state.remoteStep || 1)
    switch (event.type) {
      case 'turn/start': {
        // Adopted above when the bridge reported idle (queued prompt, replay,
        // or a turn still running after a stream failure); otherwise this is
        // the expected start of the turn startTurn() already opened.
        state.remoteTurn = state.turn
        this.ensureTurn(state, state.turn)
        break
      }
      case 'step/start': {
        this.consumeStatus(state, { phase: 'step_start', turn: state.turn, step, local: true })
        break
      }
      case 'assistant/message': {
        const content = Array.isArray(data.message?.content) ? data.message.content : []
        state.reasoning = content.filter((block) => block?.type === 'reasoning').map((block) => block.text || '').join('')
        state.text = content.filter((block) => block?.type === 'text').map((block) => block.text || '').join('')
        this.appendSdkAssistant(state, data.message || {}, content, data)
        break
      }
      case 'request/header':
      case 'request/context': {
        // The footer reads stats from the anchor's own log: token totals need
        // the usage sample, the context meter needs the window, and model
        // labels read the header. Mirroring these request records is what makes
        // a bridged chat report the same numbers as its remote counterpart.
        this.mirrorRequestRecord(state, event)
        break
      }
      case 'tool/call': {
        // The settled assistant message already published this call's block
        // and its tool/call row; only calls that arrive without one (a stream
        // fallback) still need the lazy flush path.
        if (data.callId && state.toolSeqs.has(data.callId)) break
        state.pendingTools.push({ type: 'tool_call', callId: data.callId, tool: data.name, input: data.arguments })
        break
      }
      case 'tool/result': {
        const message = data.message || {}
        const content = Array.isArray(message.content) ? message.content : []
        const callId = data.toolCallId || message.toolCallId || message.source?.callId
        const flushed = this.flushAssistant(state)
        this.settleLive(state, flushed)
        // A result for a call the bridge never published (or already closed at
        // the step boundary) would be an unpaired record and invalidate the
        // whole log, so it is dropped instead of appended.
        const known = Boolean(callId)
          && (state.toolSeqs.has(callId) || state.pendingTools.some((item) => item.callId === callId))
        if (!known) {
          this.log('warn', `bridge: dropped tool/result for ${callId || 'an unknown call'} without a mirrored call`)
          break
        }
        this.consumeEvent(state, {
          type: 'tool_result',
          callId,
          result: content.filter((block) => block?.type === 'text').map((block) => block.text || '').join('\n'),
          status: message.isError ? 'failed' : 'completed'
        })
        break
      }
      case 'step/end': {
        this.consumeStatus(state, { phase: 'step_end', turn: state.turn, step, local: true })
        break
      }
      case 'turn/end': {
        this.consumeStatus(state, { phase: 'turn_end', turn: state.turn, reason: data.reason })
        break
      }
      case 'compaction/summary': {
        // Captured only while /compact is forwarded: the remote summary is the
        // text the local checkpoint must show, so both transcripts agree.
        const capture = state.remoteCompaction
        if (capture && Array.isArray(data.summary)) {
          capture.summary = {
            blocks: data.summary.filter((block) => block?.type === 'text' && typeof block.text === 'string'),
            rawOutput: Array.isArray(data.rawOutput) ? data.rawOutput : null,
            provider: String(data.provider || ''),
            model: String(data.model || ''),
            maxTokens: Number(data.maxTokens),
            usage: data.usage && typeof data.usage === 'object' ? data.usage : null,
            tokenCount: Number(data.shadowedTokenCount) || 0
          }
        }
        break
      }
      case 'compaction/end': {
        // The command result only says "could not produce a useful summary";
        // the provider's own reason (timeout, rate limit, ...) is here.
        const capture = state.remoteCompaction
        if (capture && typeof data.error === 'string' && data.error.trim().length > 0) {
          capture.failure = data.error.trim()
        }
        break
      }
      case 'user/message': {
        const capture = state.remoteCompaction
        if (capture && data.source?.kind === 'compact-checkpoint' && Array.isArray(data.content)) {
          capture.checkpoint = { content: data.content }
        }
        break
      }
      default:
        break
    }
    if (state.final) this.finish(state)
  }
}
