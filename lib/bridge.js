// Remote session bridge.
//
// The native DSH chat UI talks to a local Agent/Session. For an anchor
// workspace the local agent loop must not call the model locally: this bridge
// intercepts its prompt methods, runs the real agent on the SSH host with the
// stock `dsh --profile headless --json` runner, and mirrors the runner's JSONL
// events back into the local Session. The native UI therefore stays unchanged,
// while every model/tool call executes on the remote machine.

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { posix as remotePath } from 'node:path'
import { dirname, join } from 'node:path'
import { errorText, joinRemote, nowIso, q, safeId, shq } from './util.js'
import { workspaceForAnchor } from './native.js'

const HEADLESS_PACKAGE = {
  name: 'dsh-profile-headless',
  private: true,
  dependencies: {},
  dsh: {
    profile: {
      bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless']
    }
  }
}

const HEADLESS_PATCH = [
  '# dsh-ssh bridge: one-shot runner with the DSH_HOME credential store enabled.',
  '- id: credentials',
  '  disabled: false',
  '- id: authorization',
  '  disabled: false',
  '- id: deepseek-account',
  '  disabled: false',
  ''
].join('\n')

function textOf(input) {
  const content = Array.isArray(input?.content) ? input.content : []
  const text = content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
  return text.trim()
}

function resultText(value) {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function reasonOf(event) {
  const reason = event?.reason
  if (reason && typeof reason === 'object' && typeof reason.kind === 'string') {
    return reason.kind === 'completed' ? { kind: 'completed' } : { kind: 'error', error: { message: reason.message || reason.kind } }
  }
  return { kind: 'completed' }
}

export class SessionBridge {
  constructor({ pool, store, manager, log = () => {} }) {
    this.pool = pool
    this.store = store
    this.manager = manager
    this.log = log
    this.sessions = new Map()
    this.profiles = new Map()
    this.journalPath = join(store.root, 'bridge.json')
    this.journal = {}
    this.pollMs = 450
    this.saveTimer = null
    this.loaded = this.loadJournal()
  }

  get enabled() {
    return this.store.settings.bridgeEnabled !== false
  }

  get permissionMode() {
    return String(this.store.settings.remotePermissionMode || 'danger-full-access')
  }

  async loadJournal() {
    try {
      const raw = await readFile(this.journalPath, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && parsed.sessions && typeof parsed.sessions === 'object') {
        this.journal = parsed.sessions
      }
    } catch {
      // absent or unreadable journal: start clean
    }
  }

  saveSoon() {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.persist()
    }, 500)
    if (typeof this.saveTimer.unref === 'function') this.saveTimer.unref()
  }

  async persist() {
    await this.loaded
    try {
      await mkdir(dirname(this.journalPath), { recursive: true })
      const temp = `${this.journalPath}.${process.pid}.tmp`
      await writeFile(temp, `${JSON.stringify({ version: 1, sessions: this.journal }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      await rename(temp, this.journalPath)
    } catch (error) {
      this.log('warn', `bridge journal write failed: ${errorText(error)}`)
    }
  }

  async handleAgentCreated({ agent } = {}) {
    if (!agent?.session || !this.enabled) return
    const cwd = agent.session.header?.cwd ?? agent.session.header?.meta?.cwd
    if (!cwd) return
    const workspace = workspaceForAnchor(this.store, cwd)
    if (!workspace) return
    await this.attach(agent, workspace)
  }

  async attach(agent, workspace) {
    const localSessionId = String(agent.session.id)
    if (this.sessions.has(localSessionId)) return
    const host = this.store.host(workspace.hostId)
    if (!host) {
      this.log('warn', `bridge: no host for workspace ${workspace.id}`)
      return
    }
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
      offset: 0,
      eventsFile: '',
      stderrFile: '',
      pidFile: '',
      turn: 0,
      remoteTurn: 0,
      remoteStep: 0,
      reasoning: '',
      text: '',
      pendingTools: [],
      toolSeqs: new Map(),
      assistantForStep: false,
      stepOpen: false,
      turnOpen: false,
      cancelled: false,
      final: false,
      timer: null,
      idlePromise: Promise.resolve(),
      idleResolve: null,
      original: {
        followup: agent.followup,
        steer: agent.steer,
        cancel: agent.cancel,
        whenIdle: agent.whenIdle
      }
    }
    this.sessions.set(localSessionId, state)
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

    await this.loaded
    const saved = this.journal[localSessionId]
    if (saved) {
      state.remoteSessionId = String(saved.remoteSessionId || '')
      if (saved.active) {
        state.eventsFile = String(saved.active.eventsFile || '')
        state.stderrFile = String(saved.active.stderrFile || '')
        state.pidFile = String(saved.active.pidFile || '')
        state.offset = Number(saved.active.offset || 0)
        state.turn = Number(saved.active.turn || 0)
        if (state.eventsFile) {
          state.running = true
          state.idlePromise = new Promise((resolve) => {
            state.idleResolve = resolve
          })
          this.log('info', `bridge: resuming ${localSessionId} (${workspace.name}, offset ${state.offset})`)
          this.schedulePoll(state)
        }
      }
    }
    this.log('info', `bridge: attached ${localSessionId} -> ${workspace.name}`)
  }

  async submit(state, input) {
    const text = textOf(input)
    if (!text) {
      this.log('warn', `bridge: empty text prompt for ${state.localSessionId}; delegating to local agent`)
      state.original.followup?.(input)
      return
    }
    const envelope = { input, text }
    if (state.running) {
      state.queue.push(envelope)
      return
    }
    await this.startTurn(state, envelope)
  }

  async ensureProfile(host, workspace) {
    const key = workspace.id
    if (this.profiles.has(key)) return await this.profiles.get(key)
    const promise = (async () => {
      const profileDir = joinRemote(workspace.dshHome, 'profiles', 'headless')
      await this.pool.run(host, `mkdir -p ${q(profileDir)}`, { timeoutMs: 20000 })
      await this.pool.writeFile(host, joinRemote(profileDir, 'package.json'), `${JSON.stringify(HEADLESS_PACKAGE, null, 2)}\n`)
      await this.pool.writeFile(host, joinRemote(profileDir, 'cordis.yml'), '[]\n')
      await this.pool.writeFile(host, joinRemote(profileDir, 'cordis.patch.yml'), HEADLESS_PATCH)
      const credentials = joinRemote(workspace.dshHome, '.credentials.yaml')
      const probe = await this.pool.exec(host, `test -f ${q(credentials)} && echo yes || echo no`, { timeoutMs: 10000 })
      if (probe.stdout.trim() !== 'yes' && this.manager?.syncCredentials) {
        await this.manager.syncCredentials(host, workspace.dshHome)
      }
      return true
    })().catch((error) => {
      this.profiles.delete(key)
      throw error
    })
    this.profiles.set(key, promise)
    return await promise
  }

  async startTurn(state, envelope) {
    state.running = true
    state.cancelled = false
    state.final = false
    state.buffer = ''
    state.offset = 0
    state.reasoning = ''
    state.text = ''
    state.pendingTools = []
    state.assistantForStep = false
    state.stepOpen = false
    state.turnOpen = false
    state.toolSeqs = new Map()
    state.turn += 1
    state.remoteTurn = 0
    state.remoteStep = 0
    state.idlePromise = new Promise((resolve) => {
      state.idleResolve = resolve
    })

    const input = envelope.input
    const message = {
      role: 'user',
      content: Array.isArray(input?.content) ? input.content : [{ type: 'text', text: envelope.text }],
      source: input?.source?.kind === 'user' ? input.source : { kind: 'user' },
      id: input?.id || randomUUID()
    }
    this.append(state, 'user/message', message, { surfaceOp: 'append' })

    try {
      await this.ensureProfile(state.host, state.workspace)
      const bridgeDir = joinRemote(state.workspace.wsRoot, 'bridge', safeId(state.localSessionId))
      state.eventsFile = joinRemote(bridgeDir, `turn-${state.turn}.jsonl`)
      state.stderrFile = joinRemote(bridgeDir, `turn-${state.turn}.err`)
      state.pidFile = joinRemote(bridgeDir, `turn-${state.turn}.pid`)
      this.rememberActive(state)
      await this.launch(state, envelope.text)
      this.schedulePoll(state)
    } catch (error) {
      this.log('warn', `bridge launch failed for ${state.localSessionId}: ${errorText(error)}`)
      this.failTurn(state, `远程会话启动失败：${errorText(error)}`)
    }
  }

  async launch(state, text) {
    const workspace = state.workspace
    const remoteDir = remotePath.dirname(state.eventsFile)
    const args = ['--profile', 'headless', '--json']
    if (state.remoteSessionId) args.push('--session-id', state.remoteSessionId)
    args.push(text)
    const inner = [
      `cd ${q(workspace.remotePath)}`,
      `exec env DSH_HOME=${q(workspace.dshHome)} DSH_PERMISSION_MODE=${q(this.permissionMode)} ${q(workspace.nodeBin)} ${q(workspace.dshBin)} ${args.map((value) => shq(value)).join(' ')}`
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
  }

  schedulePoll(state) {
    if (state.timer || !state.running) return
    state.timer = setTimeout(() => {
      state.timer = null
      void this.poll(state)
    }, this.pollMs)
    if (typeof state.timer.unref === 'function') state.timer.unref()
  }

  async poll(state) {
    if (!state.running || state.polling) return
    state.polling = true
    try {
      const sizeResult = await this.pool.exec(
        state.host,
        `if [ -f ${q(state.eventsFile)} ]; then wc -c < ${q(state.eventsFile)}; else echo 0; fi`,
        { timeoutMs: 15000 }
      )
      const size = Number(String(sizeResult.stdout || '0').trim()) || 0
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
        const alive = await this.pool.exec(
          state.host,
          `if [ -f ${q(state.pidFile)} ]; then p=$(cat ${q(state.pidFile)}); kill -0 $p 2>/dev/null && echo alive || echo dead; else echo dead; fi`,
          { timeoutMs: 10000 }
        ).catch(() => ({ stdout: 'alive' }))
        const status = String(alive.stdout || '').trim()
        if (status === 'dead' && !state.final) {
          state.deadPolls = (state.deadPolls || 0) + 1
          if (state.deadPolls >= 2) {
            const tail = await this.pool.exec(
              state.host,
              `tail -20 ${q(state.stderrFile)} 2>/dev/null || true`,
              { timeoutMs: 10000 }
            ).catch(() => ({ stdout: '' }))
            const detail = String(tail.stdout || '').trim()
            if (!state.cancelled) {
              this.failTurn(state, detail || 'remote headless exited without a final event')
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
  }

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
      this.consumeEvent(state, event)
    }
  }

  append(state, type, data, options) {
    try {
      return state.agent.session.append(type, data, options)
    } catch (error) {
      this.log('warn', `bridge: append ${type} failed for ${state.localSessionId}: ${errorText(error)}`)
      return null
    }
  }

  ensureTurn(state) {
    if (state.turnOpen) return
    const turn = state.remoteTurn || state.turn
    this.append(state, 'turn/start', { turn })
    state.turnOpen = true
  }

  ensureStep(state) {
    this.ensureTurn(state)
    if (state.stepOpen) return
    const turn = state.remoteTurn || state.turn
    const step = state.remoteStep || 1
    this.append(state, 'step/start', { turn, step })
    state.stepOpen = true
  }

  closeStep(state) {
    if (!state.stepOpen) return
    const turn = state.remoteTurn || state.turn
    const step = state.remoteStep || 1
    this.flushAssistant(state)
    this.append(state, 'step/end', { turn, step })
    state.stepOpen = false
    state.reasoning = ''
    state.text = ''
    state.pendingTools = []
    state.assistantForStep = false
  }

  failTurn(state, message) {
    const turn = state.remoteTurn || state.turn
    this.ensureStep(state)
    this.append(state, 'assistant/message', {
      turn,
      step: state.remoteStep || 1,
      stream: [],
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: message }],
        source: { kind: 'model', provider: 'remote', model: 'remote' },
        id: randomUUID()
      }
    }, { surfaceOp: 'append' })
    this.closeStep(state)
    this.append(state, 'turn/end', { turn, reason: { kind: 'error', error: { message } } })
    state.turnOpen = false
    this.finish(state)
  }

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
      case 'thinking': {
        if (typeof event.text === 'string' && event.text) state.reasoning += event.text
        break
      }
      case 'text': {
        if (typeof event.text === 'string' && event.text) state.text += event.text
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
        this.flushAssistant(state)
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
  }

  consumeStatus(state, event) {
    const phase = event.phase
    const turn = Number(event.turn) || state.remoteTurn || state.turn
    const step = Number(event.step) || state.remoteStep || 1
    if (phase === 'turn_start') {
      state.remoteTurn = turn
      if (!state.turnOpen) {
        this.append(state, 'turn/start', { turn })
        state.turnOpen = true
      }
      return
    }
    if (phase === 'step_start') {
      state.remoteTurn = turn
      state.remoteStep = step
      this.ensureTurn(state)
      if (state.stepOpen) this.closeStep(state)
      state.reasoning = ''
      state.text = ''
      state.pendingTools = []
      state.assistantForStep = false
      this.append(state, 'step/start', { turn, step })
      state.stepOpen = true
      return
    }
    if (phase === 'step_end') {
      state.remoteTurn = turn
      state.remoteStep = step
      this.ensureStep(state)
      this.flushAssistant(state)
      this.append(state, 'step/end', { turn, step })
      state.stepOpen = false
      state.reasoning = ''
      state.text = ''
      state.pendingTools = []
      state.assistantForStep = false
      return
    }
    if (phase === 'turn_end') {
      state.remoteTurn = turn
      this.ensureTurn(state)
      if (state.stepOpen) this.closeStep(state)
      this.append(state, 'turn/end', { turn, reason: reasonOf(event) })
      state.turnOpen = false
      state.final = true
    }
  }

  flushAssistant(state) {
    if (!state.stepOpen) return
    if (!state.reasoning && !state.text && state.pendingTools.length === 0) return
    const turn = state.remoteTurn || state.turn
    const step = state.remoteStep || 1
    const content = []
    if (state.reasoning) content.push({ type: 'reasoning', text: state.reasoning })
    if (state.text) content.push({ type: 'text', text: state.text })
    for (const call of state.pendingTools) {
      content.push({
        type: 'tool-call',
        id: call.callId,
        name: call.tool,
        arguments: resultText(call.input ?? {})
      })
    }
    if (content.length > 0 && !state.assistantForStep) {
      this.append(state, 'assistant/message', {
        turn,
        step,
        stream: [],
        message: {
          role: 'assistant',
          content,
          source: { kind: 'model', provider: 'remote', model: 'remote' },
          id: randomUUID()
        }
      }, { surfaceOp: 'append' })
      state.assistantForStep = true
    }
    for (const call of state.pendingTools) {
      const event = this.append(state, 'tool/call', {
        turn,
        step,
        callId: call.callId,
        name: call.tool,
        arguments: resultText(call.input ?? {})
      })
      if (event) state.toolSeqs.set(call.callId, event.seq)
    }
    state.pendingTools = []
  }

  rememberActive(state) {
    this.journal[state.localSessionId] = {
      workspaceId: state.workspace.id,
      remoteSessionId: state.remoteSessionId,
      updatedAt: nowIso(),
      active: {
        eventsFile: state.eventsFile,
        stderrFile: state.stderrFile,
        pidFile: state.pidFile,
        offset: state.offset,
        turn: state.turn,
        startedAt: nowIso()
      }
    }
    this.saveSoon()
  }

  finish(state) {
    if (!state.running) return
    if (state.turnOpen) {
      this.closeStep(state)
      this.append(state, 'turn/end', { turn: state.remoteTurn || state.turn, reason: { kind: 'completed' } })
      state.turnOpen = false
    }
    state.running = false
    if (state.timer) {
      clearTimeout(state.timer)
      state.timer = null
    }
    const entry = this.journal[state.localSessionId]
    if (entry) {
      entry.remoteSessionId = state.remoteSessionId
      entry.updatedAt = nowIso()
      delete entry.active
      if (!entry.remoteSessionId) delete this.journal[state.localSessionId]
    }
    this.saveSoon()
    const resolve = state.idleResolve
    state.idleResolve = null
    if (resolve) resolve()
    if (state.queue.length > 0) {
      const next = state.queue.shift()
      setTimeout(() => {
        void this.startTurn(state, next)
      }, 50)
    }
  }

  async cancel(state, cause, options) {
    if (!state.running) {
      state.original.cancel?.(cause, options)
      return
    }
    state.cancelled = true
    const pid = await this.pool.exec(
      state.host,
      `if [ -f ${q(state.pidFile)} ]; then cat ${q(state.pidFile)}; fi`,
      { timeoutMs: 10000 }
    ).catch(() => ({ stdout: '' }))
    const value = String(pid.stdout || '').trim()
    if (value) {
      await this.pool.exec(
        state.host,
        `kill -TERM -${value} 2>/dev/null || kill -TERM ${value} 2>/dev/null || true`,
        { timeoutMs: 10000 }
      ).catch(() => {})
    }
    this.ensureTurn(state)
    if (state.stepOpen) this.closeStep(state)
    this.append(state, 'turn/end', { turn: state.remoteTurn || state.turn, reason: { kind: 'error', error: { message: 'cancelled' } } })
    state.turnOpen = false
    this.finish(state)
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

  dispose() {
    for (const state of this.sessions.values()) {
      if (state.timer) clearTimeout(state.timer)
      try {
        state.agent.followup = state.original.followup
        state.agent.steer = state.original.steer
        state.agent.cancel = state.original.cancel
        state.agent.whenIdle = state.original.whenIdle
      } catch {
        // ignore
      }
    }
    this.sessions.clear()
    if (this.saveTimer) clearTimeout(this.saveTimer)
  }
}
