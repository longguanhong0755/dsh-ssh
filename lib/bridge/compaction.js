// SessionBridge methods: the `/compact` shadow command and remote summarization.
//
// Moved verbatim out of lib/bridge.js (the bodies still use `this`) and assigned
// onto SessionBridge.prototype at the end of that module.

import { randomUUID } from 'node:crypto'
import { errorText } from '../util.js'
import { SDK_PROVIDER, SDK_MODEL, REMOTE_COMPACT_TIMEOUT_MS, REMOTE_COMPACT_CAPTURE_MS, COMPACT_STREAM_BACKOFF_MS, REMOTE_COMPACT_ATTEMPTS, isTransientCompactionError, abortableDelay, COMPACT_COMMAND_ID, COMPACT_DESCRIPTION, COMPACT_USAGE, COMPACT_BUSY, COMPACT_EMPTY, COMPACT_UNAVAILABLE, COMPACT_NOT_AVAILABLE, surfaceToolDelta, textBlocks } from './shared.js'

export const compactionMethods = {
  /**
   * Shadow `/compact` inside one bridged agent's scope.
   *
   * The command registry resolves a per-agent layer through the agent's own
   * context, so registering through `agent.ctx.inject(['commands'])` replaces
   * the global command for this chat only. The stock definition is captured
   * first and answers every request the bridge cannot serve (closed agent, busy
   * runtime, no remote history), so behaviour outside the bridged path is
   * exactly the native one.
   */
  installRemoteCompactCommand(state) {
    const agent = state?.agent
    const ctx = agent?.ctx
    if (!ctx || typeof ctx.inject !== 'function') return false
    // The registration callback can run before or after `inject` returns, so
    // both write into the same record instead of replacing it.
    const record = { stock: null, disposer: null, dispose: null }
    state.compactCommand = record
    try {
      const dispose = ctx.inject(['commands'], (inner) => {
        const commands = inner?.commands
        if (!commands || typeof commands.register !== 'function') return
        if (state.closed || this.disposed || this.sessions.get(state.localSessionId) !== state) return
        let stock = null
        try {
          stock = commands.find(agent, 'compact') || null
        } catch {
          stock = null
        }
        try {
          record.disposer = commands.register({
            definitionId: COMPACT_COMMAND_ID,
            name: 'compact',
            description: COMPACT_DESCRIPTION,
            handler: (invocation) => this.handleCompactInvocation(state, invocation, stock)
          })
          record.stock = stock
          this.log('info', `bridge: /compact for ${state.localSessionId} runs on the remote agent`)
        } catch (error) {
          this.log('warn', `bridge: could not shadow /compact for ${state.localSessionId}: ${errorText(error)}`)
        }
      })
      record.dispose = typeof dispose === 'function' ? dispose : null
      return true
    } catch (error) {
      this.log('warn', `bridge: /compact shadow unavailable for ${state.localSessionId}: ${errorText(error)}`)
      return false
    }
  },

  /**
   * Whether `/compact` for this agent can run on the remote agent. Everything
   * that is not a live, idle, SDK-transported bridged session falls back to
   * the stock local compaction (which also reports the idle/`busy` error).
   */
  canCompactRemotely(agent) {
    const state = this.sessions.get(String(agent?.session?.id ?? ''))
    if (!state || state.agent !== agent || state.closed || this.disposed) return false
    if (state.running || state.compacting) return false
    if (!state.remoteSessionId || !this.sdkUsable(state)) return false
    return this.localCompactionSpan(agent) !== null
  },

  /**
   * The scoped `/compact` implementation: answer like the stock command, but
   * run the compaction on the remote agent when this chat can.
   */
  async handleCompactInvocation(state, invocation, stock) {
    const agent = invocation?.agent || state?.agent
    if (String(invocation?.rawInput ?? '').trim().length > 0) {
      return { kind: 'error', text: COMPACT_USAGE }
    }
    const fallback = () => {
      if (stock && typeof stock.handler === 'function') return stock.handler(invocation)
      return { kind: 'error', text: COMPACT_NOT_AVAILABLE }
    }
    if (!state || !agent || !this.ownsAgent(agent) || state.closed || this.disposed) return fallback()
    if (state.running || state.compacting) return { kind: 'error', text: COMPACT_BUSY }
    // No remote history has been produced yet: the anchor's own history is all
    // that exists, so hand the request to the stock command.
    if (!state.remoteSessionId) return fallback()
    if (!this.localCompactionSpan(agent)) return { kind: 'success', text: COMPACT_EMPTY }
    if (!this.sdkUsable(state)) return { kind: 'error', text: COMPACT_UNAVAILABLE }
    if (invocation?.signal?.aborted) return { kind: 'error', text: 'Compaction cancelled.' }
    try {
      const result = await this.compactBridgedNow(agent, invocation?.signal, invocation?.commandId)
      if (!result) return { kind: 'success', text: COMPACT_EMPTY }
      return {
        kind: 'success',
        text: `Compacted ${result.shadowedSeqs.length} history items (~${result.shadowedTokenCount} tokens).`,
        sourceEventSeq: result.summarySeq
      }
    } catch (error) {
      if (invocation?.signal?.aborted) return { kind: 'error', text: 'Compaction cancelled.' }
      return { kind: 'error', text: errorText(error) }
    }
  },

  routeCompactionOptions(options) {
    if (!options || options.purpose !== 'compaction') return options
    const sessionId = String(options.sessionId || '')
    if (!sessionId || !this.sessions.has(sessionId)) return options
    // A bridged chat summarizes with the route its own picker shows, so the
    // compaction request and the chat agree on the model. The resolved model
    // was validated by this machine at the last turn start; without one, keep
    // the configured fallback (which is also locally reachable).
    const state = this.sessions.get(sessionId)
    const provider = state?.model?.provider || this.compactionProvider
    const model = state?.model?.model || this.compactionModel
    if (!provider || !model) return options
    if (options.provider === provider && options.model === model) return options
    this.log('info', `bridge: compaction for ${sessionId} uses ${provider}/${model} (requested ${options.provider || '?'}/${options.model || '?'})`)
    return { ...options, provider, model }
  },

  /**
   * `/compact` for a bridged session: ask the remote agent to compact its own
   * context, then replace the same span in the anchor with the remote
   * checkpoint. Returns the shape the `/compact` command expects, or null when
   * the session has nothing to compact.
   */
  async compactBridgedNow(agent, signal, sourceCommandId) {
    const state = this.sessions.get(String(agent?.session?.id ?? ''))
    if (!state || state.agent !== agent) return null
    if (signal?.aborted) throw new Error('Compaction cancelled.')
    if (state.closed || this.disposed) throw new Error('Compaction is unavailable because this session is closed.')
    if (state.running || state.compacting) {
      throw new Error('Compaction is unavailable because this process has an active compaction, or the agent is not idle.')
    }
    // Nothing has been sent to a remote agent yet: the anchor's own history is
    // all that exists, so there is no remote context to compact.
    if (!state.remoteSessionId) return null
    const span = this.localCompactionSpan(agent)
    if (!span) return null
    if (!this.sdkUsable(state)) throw new Error('The remote SDK runtime is unavailable, so the remote context cannot be compacted.')
    state.compacting = true
    try {
      const captured = await this.runRemoteCompact(state, signal)
      if (!captured) return null
      if (!this.surfaceSpanCurrent(agent, span)) {
        throw new Error('The local session changed during remote compaction; the remote summary was not mirrored.')
      }
      return this.mirrorRemoteCompaction(agent, span, captured, sourceCommandId)
    } catch (error) {
      throw new Error(`Remote compaction failed: ${errorText(error)}`)
    } finally {
      state.compacting = false
      this.drainQueue(state)
    }
  },

  /**
   * Forward `/compact` to the persistent SDK runtime and collect the
   * compaction records the remote agent emits while it runs.
   *
   * `session/query` (not `session/prompt`) is what routes text through the
   * remote command registry; it resolves after `command/done`. The summary and
   * checkpoint arrive as ordinary `session.event` notifications on the tail,
   * before that response.
   *
   * A remote summarization failure is reported as a command error and its
   * `compaction/end` carries the provider's own message, so a transient one
   * (timeout, rate limit, 5xx) is retried here and the real reason is surfaced
   * instead of the command's generic "could not produce a useful summary".
   */
  async runRemoteCompact(state, signal) {
    let lastError
    for (let attempt = 1; attempt <= REMOTE_COMPACT_ATTEMPTS; attempt += 1) {
      if (signal?.aborted) throw new Error('Compaction cancelled.')
      const capture = { summary: null, checkpoint: null, failure: null }
      state.remoteCompaction = capture
      state.compactForwarding = true
      try {
        return await this.forwardRemoteCompact(state, capture)
      } catch (error) {
        lastError = error
        const retryable = attempt < REMOTE_COMPACT_ATTEMPTS
          && !state.closed
          && !signal?.aborted
          && error?.remoteCompactionTransient === true
        if (!retryable) throw error
        this.log('warn', `bridge: remote compaction attempt ${attempt}/${REMOTE_COMPACT_ATTEMPTS} failed (${errorText(error)}); retrying`)
        await abortableDelay(COMPACT_STREAM_BACKOFF_MS * 2 ** (attempt - 1), signal)
      } finally {
        state.compactForwarding = false
        state.remoteCompaction = null
      }
    }
    throw lastError || new Error('remote compaction failed')
  },

  async forwardRemoteCompact(state, capture) {
    // The runner restored from the journal may belong to an older build.
    // Retarget first, then retire it so `session/query` reaches the new one.
    await this.prepareRemoteCommands(state)
    await this.bootSdk(state)
    if (!state.stream) await this.startTail(state)
    let response
    try {
      response = await this.sdkRequest(state, 'session/query', {
        sessionId: state.remoteSessionId,
        contentBlocks: [{ type: 'text', text: '/compact' }]
      }, REMOTE_COMPACT_TIMEOUT_MS)
    } catch (error) {
      // 0.2.1-rc.5 and older expose only prompt/resume/wait, so the command
      // never leaves this machine. Name the stale build instead of surfacing
      // a bare JSON-RPC "unknown method".
      if (/unknown[^\n]*method[^\n]*session\/query/iu.test(errorText(error))) {
        const current = state.workspace?.dshVersion || 'an older build'
        const target = String(this.store?.settings?.dshVersion || '')
        const hint = target && target !== current
          ? `dsh ${target} is not installed on this host yet; reinstall the remote service from the device page and retry`
          : 'reinstall the remote service and retry'
        throw new Error(`this workspace still runs dsh ${current}, which cannot forward remote commands (/compact needs session/query); ${hint}`)
      }
      throw error
    }
    state.compactForwarding = false
    if (!response || response.kind !== 'command') {
      throw new Error('the remote agent did not recognize /compact (its profile has no compact command)')
    }
    const result = response.execution?.result || {}
    if (result.kind !== 'success') {
      // The command result text is generic; the provider's reason is on the
      // compaction/end record that precedes the response. Allow a short lag
      // before deciding whether this attempt is worth repeating.
      if (!capture.failure) {
        const deadline = Date.now() + 750
        while (!capture.failure && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
      }
      const detail = capture.failure || String(result.text || 'the remote compaction command failed').trim()
      const error = new Error(detail)
      if (isTransientCompactionError(detail)) error.remoteCompactionTransient = true
      throw error
    }
    // A success without a summary seq means the remote found no safe range
    // ("No compactable history yet.") and wrote nothing.
    if (result.sourceEventSeq === undefined) return null
    const deadline = Date.now() + REMOTE_COMPACT_CAPTURE_MS
    while ((!capture.summary || !capture.checkpoint) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    if (!capture.summary) throw new Error('the remote compaction summary never arrived')
    return capture
  },

  /** Price the local span with the same meter the native compaction uses. */
  priceSpan(agent, seqs, fallback) {
    try {
      const meter = this.ctx && typeof this.ctx.get === 'function' ? this.ctx.get('tokenMeter') : null
      const measured = meter && typeof meter.measure === 'function' ? meter.measure(agent.session) : null
      if (!Array.isArray(measured?.nodes) || measured.nodes.length === 0) return Number(fallback) || 0
      const prices = new Map(measured.nodes.map((node) => [node.seq, Number(node.heuristicTokens) || Number(node.tokens) || 0]))
      return seqs.reduce((total, seq) => total + (prices.get(seq) || 0), 0)
    } catch {
      return Number(fallback) || 0
    }
  },

  /**
   * The span a native idle compaction would replace: everything before the
   * retained tail (which is the last surface node, exactly like
   * `selectCompactableRange(..., 0)`), never a protected system head, and
   * never cutting an open tool-call/result pair.
   */
  localCompactionSpan(agent) {
    const session = agent?.session
    const nodes = Array.isArray(session?.surface?.nodes) ? session.surface.nodes : []
    if (nodes.length === 0) return null
    const balancedBefore = []
    let balance = 0
    for (const seq of nodes) {
      balancedBefore.push(balance === 0)
      balance += surfaceToolDelta(session.eventAt(seq))
    }
    const head = session.eventAt(nodes[0])
    const first = head?.type === 'system/message' ? 1 : 0
    let keepFrom = nodes.length - 1
    while (keepFrom > first && !balancedBefore[keepFrom]) keepFrom -= 1
    if (keepFrom <= first) return null
    return { start: nodes[first], end: nodes[keepFrom - 1], seqs: nodes.slice(first, keepFrom) }
  },

  /**
   * Replace the local span with the remote checkpoint using the exact record
   * sequence a native compaction writes. If a later append fails, close the
   * open compaction with an error so the log never keeps an unmatched start.
   */
  mirrorRemoteCompaction(agent, span, captured, sourceCommandId) {
    const state = this.sessions.get(String(agent?.session?.id ?? ''))
    if (!state) throw new Error('bridge state is gone')
    const summary = captured.summary || {}
    const blocks = textBlocks(summary.blocks)
    if (!blocks) throw new Error('the remote summary has no text content')
    const content = textBlocks(captured.checkpoint?.content) || blocks
    const compactionId = randomUUID()
    const lifecycle = { compactionId, sourceCommandId, turn: null }
    const start = this.append(state, 'compaction/start', lifecycle)
    if (!start?.seq) throw new Error('could not record compaction/start')
    let closed = false
    try {
      const data = {
        compactionId,
        sourceCommandId,
        summary: blocks,
        shadowedRange: { start: span.start, end: span.end },
        shadowedSeqs: [...span.seqs],
        shadowedTokenCount: this.priceSpan(agent, span.seqs, summary.tokenCount),
        provider: String(summary.provider || this.compactionProvider || SDK_PROVIDER),
        model: String(summary.model || this.compactionModel || SDK_MODEL)
      }
      const rawOutput = textBlocks(summary.rawOutput)
      if (rawOutput) data.rawOutput = rawOutput
      if (Number.isFinite(summary.maxTokens) && summary.maxTokens > 0) data.maxTokens = summary.maxTokens
      if (summary.usage && typeof summary.usage === 'object') data.usage = summary.usage
      const summaryEvent = this.append(state, 'compaction/summary', data)
      if (!summaryEvent?.seq) throw new Error('could not record compaction/summary')
      const checkpoint = this.append(state, 'user/message', {
        role: 'user',
        content,
        source: { kind: 'compact-checkpoint', compactionId, sourceCommandId },
        id: randomUUID()
      }, {
        surfaceOp: { op: 'replace', startSeq: span.start, endSeq: span.end },
        sourceEventSeqs: [start.seq, summaryEvent.seq, ...span.seqs]
      })
      if (!checkpoint?.seq) throw new Error('could not record the compaction checkpoint')
      const end = this.append(state, 'compaction/end', lifecycle)
      if (!end?.seq) throw new Error('could not record compaction/end')
      closed = true
      this.log('info', `bridge: mirrored remote compaction for ${state.localSessionId} (${span.seqs.length} items, ${data.shadowedTokenCount} tokens)`)
      return { shadowedSeqs: span.seqs, shadowedTokenCount: data.shadowedTokenCount, summarySeq: summaryEvent.seq }
    } catch (error) {
      if (!closed) {
        try {
          this.append(state, 'compaction/end', { ...lifecycle, error: errorText(error) })
        } catch {
          // Keep the original failure; the unmatched start is reported by the
          // next append if this close could not be written either.
        }
      }
      throw error
    }
  },

  /** Start a prompt that arrived while compaction held the session. */
  drainQueue(state) {
    if (state.running || state.compacting || state.closed || this.disposed) return
    if (state.queue.length === 0) return
    const next = state.queue.shift()
    setTimeout(() => {
      if (state.running || state.compacting || state.closed || this.disposed) {
        state.queue.unshift(next)
        return
      }
      void this.startTurn(state, next)
    }, 50)
  }
}
