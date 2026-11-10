// SessionBridge methods: JSONL event projection into the local session.
//
// Moved verbatim out of lib/bridge.js (the bodies still use `this`) and assigned
// onto SessionBridge.prototype at the end of that module.

import { randomUUID } from 'node:crypto'
import { resultText, reasonOf } from './shared.js'

export const eventMethods = {
  consumeEvent(state, event) {
    switch (event.type) {
      case 'session': {
        if (event.sessionId && event.sessionId !== state.remoteSessionId) {
          state.remoteSessionId = String(event.sessionId)
          this.rememberActive(state)
          this.saveSoon()
        }
        break
      }
      case 'assistant-content': {
        // The headless profile channel forwards the committed message without
        // the --json projection's 8 KiB string cap, so this is the only
        // complete copy of a long reasoning block.
        if (state.remoteSessionId && event.sessionId && String(event.sessionId) !== state.remoteSessionId) break
        const message = event.message || {}
        const content = Array.isArray(message.content) ? message.content : []
        if (content.length === 0) break
        state.authoritativeContent = {
          content: content.map((block) => ({ ...block })),
          usage: event.usage,
          stream: event.stream,
          source: message.source,
          id: message.id
        }
        // Keep the scalar aggregates in sync for other readers of the state.
        state.reasoning = content.filter((block) => block?.type === 'reasoning').map((block) => block.text || '').join('')
        state.text = content.filter((block) => block?.type === 'text').map((block) => block.text || '').join('')
        // The committed block list supersedes whatever deltas were streamed.
        state.liveBlocks = []
        break
      }
      case 'thinking': {
        if (typeof event.text === 'string' && event.text) {
          state.reasoning += event.text
          if (!state.authoritativeContent) this.appendContentBlock(state.blocks || (state.blocks = []), 'reasoning', event.text)
        }
        break
      }
      case 'text': {
        if (typeof event.text === 'string' && event.text) {
          state.text += event.text
          if (!state.authoritativeContent) this.appendContentBlock(state.blocks || (state.blocks = []), 'text', event.text)
        }
        break
      }
      case 'stream': {
        this.consumeStreamEvent(state, event.frame)
        break
      }
      case 'status': {
        this.consumeStatus(state, event)
        break
      }
      case 'tool_call': {
        state.pendingTools.push(event)
        break
      }
      case 'tool_result': {
        const flushed = this.flushAssistant(state)
        this.settleLive(state, flushed)
        const call = state.pendingTools.find((item) => item.callId === event.callId)
        const seq = state.toolSeqs.get(event.callId)
        const text = resultText(event.result)
        this.append(state, 'tool/result', {
          turn: state.remoteTurn || state.turn,
          step: state.remoteStep || 1,
          message: {
            role: 'tool',
            source: { kind: 'tool', callId: event.callId },
            toolCallId: event.callId,
            content: [{ type: 'text', text }],
            isError: event.status !== 'completed',
            id: randomUUID()
          },
          meta: { cwd: state.workspace.remotePath }
        }, { ...(seq === undefined ? {} : { sourceEventSeqs: [seq] }), surfaceOp: 'append' })
        state.pendingTools = state.pendingTools.filter((item) => item.callId !== event.callId)
        state.toolSeqs.delete(event.callId)
        if (call === undefined) state.pendingTools = []
        break
      }
      case 'final': {
        state.final = true
        break
      }
      default:
        break
    }
    if (state.final) this.finish(state)
  },

  /**
   * Mirror one remote lifecycle status frame.
   *
   * A status frame carries the *remote* session's own coordinates, and those are
   * not the anchor's. The remote numbers turns for its whole session and keeps
   * its step counter running across a resume, so a bridged turn once inherited
   * `step/end 37/51` -- which made the whole anchor unreadable ("step/end does
   * not match an open turn and step"). The anchor numbers steps per turn and
   * requires step N, then exactly N+1, so the local counters here are
   * authoritative: the remote numbers are only used to recognise a duplicate
   * frame for the step that is already open.
   */
  consumeStatus(state, event) {
    const phase = event.phase
    const rawStep = Number(event.step) || 0
    // The durable-event path already mapped this step onto the anchor's own
    // numbering; a raw status frame carries the remote's counter, which is not
    // the anchor's, so it is derived locally instead.
    const localStep = event.local === true ? Number(event.step) || 0 : 0
    const turn = state.turn || state.remoteTurn || 1
    state.remoteTurn = turn
    if (phase === 'turn_start') {
      if (!state.turnOpen) {
        this.append(state, 'turn/start', { turn })
        state.turnOpen = true
      }
      return
    }
    if (phase === 'step_start') {
      if (state.stepOpen) {
        // A replayed status line for the step that is already open: opening a
        // second step with the same number is exactly the duplicated
        // `step/start 2/1` that invalidated another anchor.
        if (rawStep > 0 && rawStep === state.rawOpenStep) return
        if (localStep > 0 && localStep === state.remoteStep) return
        if (state.stepOptimistic) {
          // A stream chunk opened this step before its durable status line:
          // keep the preview instead of splitting one step into two.
          state.stepOptimistic = false
          state.rawOpenStep = rawStep
          return
        }
        // The remote moved on while this step stayed open: close what was
        // previewed under its own number, then open the next local step.
        this.closeStep(state, turn, state.remoteStep || 1)
      }
      const step = localStep > 0 ? localStep : (state.remoteStep || 0) + 1
      state.remoteStep = step
      state.rawOpenStep = rawStep
      this.ensureTurn(state, turn)
      this.resetStepBuffers(state)
      this.append(state, 'step/start', { turn, step })
      state.stepOpen = true
      state.stepOptimistic = false
      return
    }
    if (phase === 'step_end') {
      if (!state.stepOpen) {
        // The end of a step whose start was never mirrored (adopted mid-turn or
        // after a stream failure). Open it under the next local number so the
        // close pairs with a start instead of breaking the turn.
        const step = localStep > 0 ? localStep : (state.remoteStep || 0) + 1
        state.remoteStep = step
        state.rawOpenStep = rawStep
        this.ensureTurn(state, turn)
        this.resetStepBuffers(state)
        this.append(state, 'step/start', { turn, step })
        state.stepOpen = true
        state.stepOptimistic = false
      }
      // One path for every step boundary: flush the settled assistant, close
      // interrupted tool calls, then write step/end.
      this.closeStep(state, turn, state.remoteStep || 1)
      return
    }
    if (phase === 'turn_end') {
      // A turn end observed while the bridge is idle belongs to a turn that is
      // already closed locally (a replay, or the remote finishing a turn the
      // bridge failed earlier). Opening a turn just to close it would append a
      // second turn/start for an ended turn and invalidate the whole anchor.
      if (!state.running && !state.turnOpen) return
      this.ensureTurn(state, turn)
      if (state.stepOpen) this.closeStep(state, turn, state.remoteStep || 1)
      this.settleLive(state, null)
      this.append(state, 'turn/end', { turn, reason: reasonOf(event) })
      state.turnOpen = false
      state.final = true
    }
  },
  /**
   * Mirror one remote `request/header` or `request/context` record. Both carry
   * a whole request observation, so a repeat with the same identity is skipped
   * instead of duplicated on every step.
   */
  mirrorRequestRecord(state, event) {
    const data = event?.data || {}
    if (event.type === 'request/header') {
      const header = data.header
      if (!header) return
      const key = this.requestHeaderKey(header)
      if (state.headerKey === key) return
      // The native reader requires every mirrored header to declare why the
      // request series starts or changes; a header without `reason` makes the
      // whole anchor log unloadable after a restart.
      const reason = data.reason === 'initial' || data.reason === 'resume' || data.reason === 'change' || data.reason === 'series'
        ? data.reason
        : state.headerKey === undefined ? 'initial' : 'change'
      state.headerKey = key
      const payload = { header, reason }
      if (data.startsSeries === true) payload.startsSeries = true
      this.append(state, 'request/header', payload)
      return
    }
    const key = this.requestContextKey(data)
    if (state.contextKey === key) return
    state.contextKey = key
    this.append(state, 'request/context', data)
  },

  /**
   * Mirror a durable SDK assistant message exactly as the remote recorded it.
   *
   * The SDK settles the whole assistant response — reasoning, text and every
   * tool-call block — before it reports the matching `tool/call` events. The
   * lazy {@link flushAssistant} path can only see the calls that started
   * before the first `tool/result`, so it would leave later calls without
   * their blocks and break dsh's tool-call/tool-result pairing (compaction
   * rejects such a transcript). Emitting the durable message here, then its
   * `tool/call` rows, reproduces the native event order.
   */
  appendSdkAssistant(state, message, content, data = {}) {
    if (state.assistantForStep || content.length === 0) return null
    this.ensureStep(state)
    const turn = state.remoteTurn || state.turn
    const step = state.remoteStep || 1
    const payload = {
      turn,
      step,
      stream: Array.isArray(data.stream) ? data.stream : [],
      message: {
        role: 'assistant',
        content,
        source: message.source || this.assistantSource(state),
        id: message.id || randomUUID()
      }
    }
    // Provider-reported totals and the compact stream records are what the
    // stats/token/context projections fold; without them a bridged chat can
    // only show turns and steps.
    if (data.usage !== undefined) payload.usage = data.usage
    const appended = this.append(state, 'assistant/message', payload, { surfaceOp: 'append' })
    state.assistantForStep = true
    state.assistantEvent = appended
    // Publish the calls now: the result that follows must find its pair, and
    // the assistant message already carries the blocks for all of them.
    this.publishToolCalls(state, content, turn, step)
    this.settleLive(state, appended)
    return appended
  },

  /** Append one delta to the trailing block of the same kind, preserving order. */
  appendContentBlock(blocks, type, text) {
    if (!Array.isArray(blocks) || typeof text !== 'string' || text.length === 0) return
    const last = blocks[blocks.length - 1]
    if (last && last.type === type) last.text = `${last.text || ''}${text}`
    else blocks.push({ type, text })
  },

  /** The route that produced this turn's assistant messages. */
  assistantSource(state) {
    const model = state.model
    if (model?.provider && model?.model) {
      return { kind: 'model', provider: model.provider, model: model.model }
    }
    return { kind: 'model', provider: 'remote', model: 'remote' }
  },

  /**
   * One step's assistant content, most faithful source first: the committed
   * message forwarded by the headless profile channel, then the richer of the
   * ordered thinking/text blocks and live deltas streamed before a failure,
   * and only as a last resort the legacy reasoning→text scalars. Pending tool
   * calls are merged by call id so a committed block and its live echo do not
   * produce two rows.
   */
  stepContent(state) {
    let content
    const authoritative = state.authoritativeContent
    if (authoritative && Array.isArray(authoritative.content) && authoritative.content.length > 0) {
      content = authoritative.content.map((block) => ({ ...block }))
    } else {
      // The --json projection's thinking/text events are capped at 8 KiB each;
      // the live stream usually carries the full text. Prefer whichever block
      // list holds more characters, keeping that list's original order.
      const projected = Array.isArray(state.blocks) ? state.blocks : []
      const live = Array.isArray(state.liveBlocks) ? state.liveBlocks : []
      const chars = (blocks) => blocks.reduce((sum, block) => sum + (typeof block?.text === 'string' ? block.text.length : 0), 0)
      const blocks = live.length > 0 && chars(live) > chars(projected) ? live : projected
      content = blocks.map((block) => ({ ...block }))
      if (content.length === 0) {
        if (state.reasoning) content.push({ type: 'reasoning', text: state.reasoning })
        if (state.text) content.push({ type: 'text', text: state.text })
      }
    }
    const seen = new Set()
    for (const block of content) {
      if (block?.type === 'tool-call' && block.id) seen.add(block.id)
    }
    for (const call of state.pendingTools || []) {
      if (call.callId && seen.has(call.callId)) continue
      content.push({
        type: 'tool-call',
        id: call.callId,
        name: call.tool,
        arguments: resultText(call.input ?? {})
      })
      if (call.callId) seen.add(call.callId)
    }
    return content
  },

  /** Publish the tool/call row of every block that does not have one yet. */
  publishToolCalls(state, content, turn = state.remoteTurn || state.turn, step = state.remoteStep || 1) {
    for (const block of content) {
      if (block?.type !== 'tool-call' || !block.id || state.toolSeqs.has(block.id)) continue
      const event = this.append(state, 'tool/call', {
        turn,
        step,
        callId: block.id,
        name: block.name,
        arguments: typeof block.arguments === 'string' ? block.arguments : resultText(block.arguments ?? {})
      })
      if (event) state.toolSeqs.set(block.id, event.seq)
    }
  },

  flushAssistant(state) {
    if (!state.stepOpen) return null
    const turn = state.remoteTurn || state.turn
    const step = state.remoteStep || 1
    const content = this.stepContent(state)
    const authoritative = state.authoritativeContent
    let appended = null
    if (content.length > 0 && !state.assistantForStep) {
      const payload = {
        turn,
        step,
        stream: Array.isArray(authoritative?.stream) ? authoritative.stream : [],
        message: {
          role: 'assistant',
          content,
          source: authoritative?.source || this.assistantSource(state),
          id: authoritative?.id || randomUUID()
        }
      }
      // Provider-reported totals and compact stream records are what the
      // stats/token/context projections fold; the headless projection used to
      // cap and drop them.
      if (authoritative?.usage !== undefined) payload.usage = authoritative.usage
      appended = this.append(state, 'assistant/message', payload, { surfaceOp: 'append' })
      state.assistantForStep = true
      state.assistantEvent = appended
    }
    this.publishToolCalls(state, content, turn, step)
    state.pendingTools = []
    return appended
  }
}
