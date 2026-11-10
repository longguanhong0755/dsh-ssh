// SessionBridge methods: the SDK handshake, prompt delivery with self-healing,
// and the repair ladder used when a runtime stops answering.
//
// A bridged chat must survive every way its remote runtime can fail while the
// local app stays up: the runner is reaped by its idle watchdog, killed by an
// OOM, left over from a previous app process, duplicated by a second launch, or
// still alive but never handshaken. All of them end the same way for the user —
// "远程会话发送失败". Each failure is repaired here, in order, and only errors
// that prove the request was *not* accepted are retried, so a prompt is never
// delivered twice.

import { errorText } from '../util.js'

/**
 * Errors that prove the runtime never accepted the request, so replaying it is
 * safe. A timeout is deliberately absent: the prompt may be queued behind it.
 */
const SDK_HEAL_PATTERNS = [
  /SDK server is not initialized/u,
  /SDK server is shutting down/u,
  /sdk runtime is not running/u,
  /sdk-dead/u,
  /sdk-write-blocked/u,
  /sdk-owned/u,
  /sdk request failed \(exit 9\)/u,
  /sdk-pid-missing/u
]

export function sdkCallNeedsHeal(detail) {
  const text = String(detail || '')
  return SDK_HEAL_PATTERNS.some((pattern) => pattern.test(text))
}

export const sdkHealMethods = {
  /**
   * The handshake every runtime must complete before it accepts prompts: the
   * route is fixed for the whole process by `initialize`, and an existing
   * remote session is reopened with `session/resume`. `initialize` is
   * idempotent, so re-sending it is also the cheapest way to prove that the
   * process we hold is alive, listening and initialized.
   */
  async sdkHandshake(state, { resume = false, timeoutMs = 30000 } = {}) {
    // `/compact` reaches the runtime while the chat is idle, so no turn had run
    // `applyModel` yet. The route is part of the handshake and cannot be
    // guessed: adopt the anchor's selection instead of failing the command
    // with "no model selection resolved".
    if (!state.model) await this.adoptModel(state)
    const model = state.model
    if (!model) throw new Error('no model selection resolved for this bridged chat')
    await this.sdkCall(state, 'initialize', {
      cwd: state.workspace.remotePath,
      provider: model.provider,
      model: model.model,
      ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}),
      ...(model.maxTokens > 0 ? { maxTokens: model.maxTokens } : {})
    }, timeoutMs)
    if (state.sdk) state.sdk.modelKey = model.key
    if (resume && state.remoteSessionId && state.turn > 0) {
      try {
        await this.sdkCall(state, 'session/resume', { sessionId: state.remoteSessionId }, timeoutMs)
      } catch (error) {
        // A session that never committed a turn can still be created by the
        // first prompt; an occupied session is the real problem, and the next
        // prompt reports it.
        this.log('warn', `bridge sdk resume skipped for ${state.localSessionId}: ${errorText(error)}`)
      }
    }
    return true
  },

  /**
   * Adopt a runtime this process did not start (a live runner that holds the
   * chat's lock). The tail continues from the journaled offset, and the
   * handshake makes an uninitialized leftover usable instead of leaving it to
   * reject the next prompt.
   */
  async adoptSdk(state, reason = 'existing runtime') {
    const sdk = state.sdk || this.sdkPaths(state)
    const reused = Boolean(state.sdk)
    state.sdk = sdk
    Object.assign(sdk, this.sdkPaths(state), { reused, booting: null })
    state.eventsFile = sdk.outFile
    state.stderrFile = sdk.errFile
    state.pidFile = sdk.pidFile
    await this.startTail(state)
    await this.sdkHandshake(state, { resume: true })
    sdk.ready = true
    sdk.localReady = true
    sdk.dshVersion = sdk.dshVersion || state.workspace.dshVersion
    state.sdkFailed = false
    state.sdkRetryAt = 0
    this.log('info', `bridge: adopted the running sdk runtime for ${state.localSessionId} (${reason})`)
    return sdk
  },

  /**
   * Send one request, repairing the runtime once when the error proves the
   * request was refused before it was queued. Used for every method that
   * starts work (`session/prompt`, `session/query`).
   */
  async sdkRequest(state, method, params, timeoutMs = 20000) {
    try {
      return await this.sdkCall(state, method, params, timeoutMs)
    } catch (error) {
      const detail = errorText(error)
      if (!sdkCallNeedsHeal(detail)) throw error
      const healed = await this.healSdk(state, detail)
      if (!healed) throw error
      return await this.sdkCall(state, method, params, timeoutMs)
    }
  },

  /** Deliver one prompt to the remote agent. */
  async sdkPrompt(state, params, timeoutMs = 20000) {
    return await this.sdkRequest(state, 'session/prompt', params, timeoutMs)
  },

  /**
   * The repair ladder: reuse a single live runtime that answers the handshake,
   * otherwise stop everything attached to this chat and boot exactly one
   * runner. Concurrent callers share one repair.
   */
  async healSdk(state, reason) {
    if (this.disposed || state.closed) return false
    if (state.sdkHealing) return await state.sdkHealing
    const label = state.localSessionId
    const run = (async () => {
      this.log('warn', `bridge: healing the sdk runtime for ${label} (${reason})`)
      let owners = []
      try {
        owners = await this.sdkOwnerPids(state)
        const sdk = state.sdk
        const alive = sdk?.ready ? await this.processAlive(state) : false
        if (alive && owners.length <= 1) {
          try {
            await this.sdkHandshake(state, { resume: true })
            sdk.ready = true
            sdk.localReady = true
            state.sdkFailed = false
            state.sdkRetryAt = 0
            this.log('info', `bridge: sdk runtime for ${label} answered the handshake again`)
            return true
          } catch (error) {
            this.log('warn', `bridge: re-handshake failed for ${label}: ${errorText(error)}`)
          }
        }
        await this.killSdk(state)
        await this.bootSdk(state)
        this.log('info', `bridge: sdk runtime for ${label} rebooted (${owners.length} process(es) before)`)
        return true
      } catch (error) {
        state.sdkFailed = true
        state.sdkRetryAt = Date.now() + 60000
        this.log('warn', `bridge: healing the sdk runtime for ${label} failed: ${errorText(error)}`)
        return false
      }
    })()
    state.sdkHealing = run
    try {
      return await run
    } finally {
      if (state.sdkHealing === run) state.sdkHealing = null
    }
  }
}
