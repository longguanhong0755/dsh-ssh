// SessionBridge methods: model/route selection and the profile patches it needs.
//
// Moved verbatim out of lib/bridge.js (the bodies still use `this`) and assigned
// onto SessionBridge.prototype at the end of that module.

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { errorText } from '../util.js'
import { yamlString, extractYamlBlock } from './shared.js'

export const modelMethods = {
  /** Dedupe identity of one request header: the whole config, not provider/model. */
  requestHeaderKey(header) {
    const config = header?.config || {}
    return JSON.stringify([
      config.provider ?? null,
      config.model ?? null,
      config.reasoningEffort ?? null,
      config.maxTokens ?? null,
      config.temperature ?? null,
      config.topP ?? null,
      config.stop ?? null,
      config.frequencyPenalty ?? null,
      config.presencePenalty ?? null,
      header?.adapterDefaults ?? null
    ])
  },

  requestContextKey(data) {
    return JSON.stringify([
      data?.provider ?? null,
      data?.model ?? null,
      data?.contextWindow ?? null,
      data?.systemPromptUpdate ?? null
    ])
  },

  /**
   * Seed request-record dedupe keys from the anchor's own log. Without this a
   * restarted bridge would write a second `initial` header for the same route
   * and duplicate the context record on every attach.
   */
  hydrateRequestKeys(state) {
    const log = Array.isArray(state.agent?.session?.log) ? state.agent.session.log : []
    for (let index = log.length - 1; index >= 0; index -= 1) {
      const event = log[index]
      if (event?.type === 'request/header' && state.headerKey === undefined) {
        state.headerKey = this.requestHeaderKey(event.data?.header)
      } else if (event?.type === 'request/context' && state.contextKey === undefined) {
        state.contextKey = this.requestContextKey(event.data)
      }
      if (state.headerKey !== undefined && state.contextKey !== undefined) break
    }
  },

  /**
   * The model the anchor chat currently uses. The live AgentModel is the same
   * fold the native picker writes, so it is the primary source; the
   * projection, the session log and the last request header cover hosts where
   * the agent object is not the running loop, and the configured default is
   * the last resort.
   */
  currentSelection(state) {
    const normalize = (value) => {
      if (!value || typeof value !== 'object') return null
      if (typeof value.provider !== 'string' || !value.provider) return null
      if (typeof value.model !== 'string' || !value.model) return null
      const selection = { provider: value.provider, model: value.model }
      if (typeof value.reasoningEffort === 'string' && value.reasoningEffort) {
        selection.reasoningEffort = value.reasoningEffort
      }
      return selection
    }
    try {
      const current = normalize(state.agent?.model?.current?.())
      if (current) return current
    } catch {
      // fall through to the read-only sources
    }
    try {
      const recorded = this.ctx?.get?.('sessionProjections')?.stateOf?.(state.agent?.session, 'modelSelection')
      for (const candidate of [recorded?.pending, recorded?.lastUsed]) {
        const current = normalize(candidate)
        if (current) return current
      }
    } catch {
      // the deprecated reader may be absent on a non-desktop host
    }
    try {
      const log = state.agent?.session?.log
      if (Array.isArray(log)) {
        for (let index = log.length - 1; index >= 0; index -= 1) {
          if (log[index]?.type !== 'model/selection') continue
          const current = normalize(log[index].data)
          if (current) return current
        }
      }
    } catch {
      // ignore
    }
    try {
      const current = normalize(state.agent?.session?.requestHeader?.()?.config)
      if (current) return current
    } catch {
      // ignore
    }
    try {
      const current = normalize(this.ctx?.get?.('agentDefaultModel')?.currentSelection?.())
      if (current) return current
    } catch {
      // ignore
    }
    return null
  },

  /**
   * Resolve the anchor's selection into the exact route the remote runtime must
   * use. Adapter defaults (maxTokens, default effort) are materialized so the
   * remote request and the mirrored header describe the same call. A route this
   * machine cannot resolve fails the turn instead of silently running on
   * another model.
   */
  async resolveModel(state) {
    const selection = this.currentSelection(state)
    if (!selection) throw new Error('当前会话还没有可用的模型选择，请先在模型选择器中选择一个模型')
    const llm = this.ctx && typeof this.ctx.get === 'function' ? this.ctx.get('llm') : null
    let config = { provider: selection.provider, model: selection.model }
    if (selection.reasoningEffort) config.reasoningEffort = selection.reasoningEffort
    if (llm && typeof llm.resolveCallConfig === 'function') {
      try {
        config = await llm.resolveCallConfig(config)
      } catch (error) {
        throw new Error(`模型 ${selection.provider}/${selection.model} 在本机不可用：${errorText(error)}`)
      }
    }
    let info = null
    if (llm && typeof llm.resolveModelInfo === 'function') {
      try {
        info = await llm.resolveModelInfo(config.provider, config.model)
      } catch (error) {
        // Context metadata is nice to have; the call itself was validated
        // above, so a catalog hiccup must not block the turn.
        this.log('warn', `bridge: no context metadata for ${config.provider}/${config.model}: ${errorText(error)}`)
      }
    }
    const maxTokens = Number.isSafeInteger(config.maxTokens) && config.maxTokens > 0
      ? config.maxTokens
      : (Number.isSafeInteger(info?.defaultMaxTokens) ? info.defaultMaxTokens : 0)
    const contextWindow = Number.isSafeInteger(info?.context?.contextWindow) ? info.context.contextWindow : 0
    const reasoningEffort = typeof config.reasoningEffort === 'string' ? config.reasoningEffort : ''
    const key = `${config.provider}\u0000${config.model}\u0000${reasoningEffort}\u0000${maxTokens}\u0000${contextWindow}`
    return {
      provider: config.provider,
      model: config.model,
      reasoningEffort,
      maxTokens,
      contextWindow,
      key,
      config
    }
  },

  /** Adopt the anchor's selection, or only log why it is not available yet. */
  async resolveModelIfPossible(state) {
    try {
      const model = await this.resolveModel(state)
      state.model = model
      state.modelKey = model.key
      return model
    } catch (error) {
      this.log('warn', `bridge: could not resolve the local model selection for ${state.localSessionId}: ${errorText(error)}`)
      return null
    }
  },

  /**
   * Resolve the route for work that runs outside a turn (`/compact`, a command
   * forwarded to the remote CLI). Nothing is running yet, so there is nothing
   * to retire and the failure has to reach the caller with the picker's own
   * message instead of being degraded to a warning.
   */
  async adoptModel(state) {
    if (state.model) return state.model
    const model = await this.resolveModel(state)
    state.model = model
    state.modelKey = model.key
    return model
  },

  /**
   * Resolve the model for an outgoing turn. A changed route invalidates this
   * workspace's cached profiles and retires the runners booted for the old
   * one; the next launch rebuilds both from the new selection.
   */
  async applyModel(state) {
    const model = await this.resolveModel(state)
    const previous = state.modelKey || ''
    state.model = model
    state.modelKey = model.key
    if (previous === model.key) return false
    this.invalidateProfiles(state)
    await this.retireRunners(state)
    this.log('info', `bridge: ${state.localSessionId} uses ${model.provider}/${model.model}${model.reasoningEffort ? ` (${model.reasoningEffort})` : ''}`)
    return true
  },

  /** Drop cached headless profiles of this workspace: their files are shared. */
  invalidateProfiles(state) {
    const prefix = `${state.workspace.id}:`
    for (const key of [...this.profiles.keys()]) {
      if (key.startsWith(prefix)) this.profiles.delete(key)
    }
  },

  /** The `agent-default-model` overlay that makes headless follow this chat. */
  modelPatch(model) {
    if (!model?.provider || !model?.model) return ''
    const lines = [
      '- id: agent-default-model',
      '  name: "@deepseek-ai/dsh-agent-default-model"',
      '  config:',
      `    provider: ${yamlString(model.provider)}`,
      `    model: ${yamlString(model.model)}`
    ]
    if (model.reasoningEffort) lines.push(`    reasoningEffort: ${yamlString(model.reasoningEffort)}`)
    return `${lines.join('\n')}\n`
  },

  /** Candidate local profile patch files, the running profile first. */
  localProfilePatchFiles() {
    const files = []
    try {
      const profile = this.ctx?.get?.('profileContext')
      const dir = profile?.dir || profile?.profileDir
      if (dir) files.push(join(String(dir), 'cordis.patch.yml'))
    } catch {
      // no profile service on this host
    }
    const homes = []
    if (process.env.DSH_HOME) homes.push(String(process.env.DSH_HOME))
    if (this.store?.root) homes.push(dirname(String(this.store.root)))
    for (const home of homes) {
      const profiles = join(home, 'profiles')
      try {
        for (const name of readdirSync(profiles)) files.push(join(profiles, name, 'cordis.patch.yml'))
      } catch {
        // missing profiles directory
      }
    }
    return [...new Set(files)]
  },

  /**
   * The local `llm-pi-ai` provider block, copied verbatim into every remote
   * profile so the anchor's routes resolve on the host with the same windows
   * and limits. Cached by file mtime: the desktop rewrites this file when the
   * Models page changes.
   */
  localProvidersPatch() {
    const cache = this.providerPatch || (this.providerPatch = { at: 0, file: '', text: '' })
    let newest = 0
    let newestFile = ''
    let newestText = ''
    for (const file of this.localProfilePatchFiles()) {
      try {
        const stat = statSync(file)
        const text = readFileSync(file, 'utf8')
        if (!text.includes('id: llm-pi-ai')) continue
        if (stat.mtimeMs >= newest) {
          newest = stat.mtimeMs
          newestFile = file
          newestText = text
        }
      } catch {
        // unreadable or missing candidates are skipped
      }
    }
    if (!newestFile) return ''
    if (cache.at === newest && cache.file === newestFile) return cache.text
    cache.at = newest
    cache.file = newestFile
    cache.text = extractYamlBlock(newestText, 'llm-pi-ai')
    return cache.text
  },

  /** Short identity of the provider block for cache keys and profile stamps. */
  providersTag() {
    const patch = this.localProvidersPatch()
    if (!patch) return 'none'
    return createHash('sha256').update(patch).digest('hex').slice(0, 12)
  },

  /**
   * Provider keys live in the host's credential store. The profile now names
   * routes the remote may not have seen, so refresh it on every rewrite
   * instead of only when the file is missing (a stale file silently loses the
   * new providers).
   */
  async syncProfileCredentials(state) {
    if (typeof this.manager?.syncCredentials !== 'function') return
    try {
      await this.manager.syncCredentials(state.host, state.workspace.dshHome)
    } catch (error) {
      this.log('warn', `bridge: could not sync credentials to ${state.workspace.name}: ${errorText(error)}`)
    }
  },

  /**
   * Record the resolved route in the anchor's own log. The footer, model label
   * and context meter read these records, so writing them at turn start keeps
   * the local view on the model the remote is about to use instead of showing
   * the previous turn's numbers until the remote reports its own.
   */
  mirrorResolvedModel(state) {
    const model = state.model
    if (!model) return
    const config = { ...(model.config || {}), provider: model.provider, model: model.model }
    this.mirrorRequestRecord(state, {
      type: 'request/header',
      data: { header: { config } }
    })
    if (model.contextWindow > 0) {
      this.mirrorRequestRecord(state, {
        type: 'request/context',
        data: { provider: model.provider, model: model.model, contextWindow: model.contextWindow }
      })
    }
  }
}
