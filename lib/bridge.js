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

// A tiny out-of-tree profile plugin projects the remote agent's live
// assistant-stream frames onto stdout. The stock `--json` projection only
// emits text after the step's assistant/message commits, which is why remote
// answers used to appear in one block at step end.
const STREAM_PLUGIN_NAME = 'dsh-ssh-stream'
const STREAM_PLUGIN_PACKAGE = `${JSON.stringify({
  name: STREAM_PLUGIN_NAME,
  version: '1.0.0',
  private: true,
  type: 'module',
  main: 'index.js'
}, null, 2)}\n`
const STREAM_PLUGIN_SOURCE = `// dsh-ssh bridge: forward live assistant frames as JSONL on stdout.
export const name = '${STREAM_PLUGIN_NAME}'

function write(frame) {
  try {
    process.stdout.write(JSON.stringify({ type: 'stream', frame }) + '\\n')
  } catch {
    // never break the remote run because the projection failed
  }
}

export function apply(ctx) {
  ctx.on('agent/assistant-stream', ({ frame }) => {
    if (!frame || typeof frame !== 'object') return
    if (frame.type === 'start') {
      write({ type: 'start', attemptId: String(frame.attemptId), turn: frame.turn, step: frame.step })
      return
    }
    if (frame.type === 'end') {
      write({ type: 'end', attemptId: String(frame.attemptId) })
      return
    }
    if (frame.type !== 'chunk' || !frame.chunk || typeof frame.chunk !== 'object') return
    const chunk = frame.chunk
    // Bound one line so a pathological provider chunk cannot overflow the
    // bridge's line buffer. Never mutate the agent's frozen chunk.
    const outChunk = typeof chunk.text === 'string' && chunk.text.length > 8192
      ? { ...chunk, text: chunk.text.slice(0, 8192) }
      : chunk
    write({ type: 'chunk', attemptId: String(frame.attemptId), index: frame.index, time: frame.time, chunk: outChunk })
  })
}
`
const STREAM_PATCH = [
  '- insert:',
  `    - id: ${STREAM_PLUGIN_NAME}`,
  `      name: '${STREAM_PLUGIN_NAME}'`,
  ''
].join('\n')

// A headless runner needs 4-5 s to boot before it can accept a task. The
// bridge therefore boots the next turn's runner while the workspace is idle:
// the runner reads its task from a FIFO, so it can be fully initialised before
// the user presses send. The holder keeps the FIFO open; killing it at submit
// time turns into the EOF the CLI waits for. The TTL bounds the idle process
// if no prompt ever arrives; a refresh timer keeps replacing it while the
// workspace stays open (DSH_SSH_PREWARM_TTL overrides it for tests).
const PREWARM_TTL_SECONDS = Math.max(5, Number(process.env.DSH_SSH_PREWARM_TTL) || 300)

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
  constructor({ pool, store, manager, log = () => {}, ctx = null }) {
    this.pool = pool
    this.store = store
    this.manager = manager
    this.log = log
    this.ctx = ctx
    this.sessions = new Map()
    this.profiles = new Map()
    this.streamSupport = new Map()
    this.journalPath = join(store.root, 'bridge.json')
    this.journal = {}
    this.pollMs = 300
    this.saveTimer = null
    this.warmEnabled = process.env.DSH_SSH_NO_PREWARM !== '1'
    this.disposed = false
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
    }, 200)
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
      byteBuffer: Buffer.alloc(0),
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
      stepOptimistic: false,
      turnOpen: false,
      cancelled: false,
      final: false,
      timer: null,
      idlePromise: Promise.resolve(),
      idleResolve: null,
      live: false,
      liveAttempt: null,
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
      closed: false,
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
      }
    }
    this.log('info', `bridge: attached ${localSessionId} -> ${workspace.name}`)
    void this.ensureProfile(host, workspace).then(() => {
      if (!state.running) this.schedulePrewarm(state)
    }).catch((error) => {
      this.log('warn', `bridge profile warm-up failed for ${workspace.name}: ${errorText(error)}`)
    })
  }

  async submit(state, input) {
    if (state.closed) return
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
    const stream = this.streamSupport.get(workspace.id) !== false
    const key = `${workspace.id}:${stream ? 'stream' : 'plain'}`
    if (this.profiles.has(key)) return await this.profiles.get(key)
    const promise = (async () => {
      const profileDir = joinRemote(workspace.dshHome, 'profiles', 'headless')
      await this.pool.run(host, `mkdir -p ${q(profileDir)}`, { timeoutMs: 20000 })
      await this.pool.writeFile(host, joinRemote(profileDir, 'package.json'), `${JSON.stringify(HEADLESS_PACKAGE, null, 2)}\n`)
      await this.pool.writeFile(host, joinRemote(profileDir, 'cordis.yml'), '[]\n')
      await this.pool.writeFile(
        host,
        joinRemote(profileDir, 'cordis.patch.yml'),
        `${HEADLESS_PATCH}${stream ? STREAM_PATCH : ''}`
      )
      if (stream) {
        const moduleDir = joinRemote(profileDir, 'node_modules', STREAM_PLUGIN_NAME)
        await this.pool.run(host, `mkdir -p ${q(moduleDir)}`, { timeoutMs: 20000 })
        await this.pool.writeFile(host, joinRemote(moduleDir, 'package.json'), STREAM_PLUGIN_PACKAGE)
        await this.pool.writeFile(host, joinRemote(moduleDir, 'index.js'), STREAM_PLUGIN_SOURCE)
      }
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

  async startTurn(state, envelope, { retry = false } = {}) {
    const warm = retry ? null : this.takeWarm(state)
    state.generation += 1
    state.running = true
    state.cancelled = false
    state.final = false
    state.buffer = ''
    state.byteBuffer = Buffer.alloc(0)
    state.offset = 0
    state.reasoning = ''
    state.text = ''
    state.pendingTools = []
    state.assistantForStep = false
    state.assistantEvent = null
    state.stepOpen = false
    state.turnOpen = false
    state.toolSeqs = new Map()
    state.liveAttempt = null
    state.lastEnvelope = envelope
    if (!retry) state.turn += 1
    state.remoteTurn = retry ? state.remoteTurn : 0
    state.remoteStep = 0
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
      await this.ensureProfile(state.host, state.workspace)
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
      if (warm) {
        state.eventsFile = warm.eventsFile
        state.stderrFile = warm.stderrFile
        state.pidFile = warm.pidFile
        this.rememberActive(state)
        const submitted = await this.submitWarm(state, warm, envelope.text)
        if (submitted) {
          state.live = true
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
      state.live = true
      try {
        await this.startTail(state)
      } catch (error) {
        this.log('warn', `bridge stream unavailable for ${state.localSessionId}: ${errorText(error)}`)
        this.switchToPoll(state)
      }
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

  schedulePrewarm(state) {
    if (!this.warmEnabled || !this.enabled || this.disposed || state.closed) return
    if (state.warmTimer) clearTimeout(state.warmTimer)
    // Give the previous tail channel time to close; sshd counts it as a session.
    state.warmTimer = setTimeout(() => {
      state.warmTimer = null
      void this.prewarm(state)
    }, 300)
    if (typeof state.warmTimer.unref === 'function') state.warmTimer.unref()
  }

  warmPaths(state, turn, tag) {
    const bridgeDir = joinRemote(state.workspace.wsRoot, 'bridge', safeId(state.localSessionId))
    // Give every warm runner its own files: a refresh or a newer prewarm may
    // coexist with the old runner while it shuts down, and killWarm must not
    // read a pid/holder file that a newer runner already overwrote.
    const prefix = `turn-${turn}.w${tag}`
    return {
      turn,
      remoteSessionId: '',
      eventsFile: joinRemote(bridgeDir, `${prefix}.jsonl`),
      stderrFile: joinRemote(bridgeDir, `${prefix}.err`),
      pidFile: joinRemote(bridgeDir, `${prefix}.pid`),
      promptFile: joinRemote(bridgeDir, `${prefix}.prompt`),
      holderFile: joinRemote(bridgeDir, `${prefix}.holder`)
    }
  }

  buildWarmCommand(state, warm, remoteSessionId, waitPidFile = '') {
    const workspace = state.workspace
    const remoteDir = remotePath.dirname(warm.eventsFile)
    const args = ['--profile', 'headless', '--json']
    if (remoteSessionId) args.push('--session-id', remoteSessionId)
    // `-` reads the task from stdin, so the process can boot before the prompt
    // exists. The FIFO keeps stdin open until submit time.
    args.push('-')
    const inner = [
      `cd ${q(workspace.remotePath)}`,
      `exec env DSH_HOME=${q(workspace.dshHome)} DSH_PERMISSION_MODE=${q(this.permissionMode)} ${q(workspace.nodeBin)} ${q(workspace.dshBin)} ${args.map((value) => shq(value)).join(' ')}`
    ].join(' && ')
    const reader = `${inner} < ${q(warm.promptFile)}`
    // The holder opens the FIFO read-write so neither open() blocks and the
    // runner only sees EOF when the holder is killed at submit time.
    const holder = `exec 3<>${q(warm.promptFile)}; echo $$ > ${q(warm.holderFile)}; exec sleep ${PREWARM_TTL_SECONDS}`
    // The warm runner loads the session at boot. Starting it only after the
    // previous runner exited guarantees that snapshot contains the finished
    // turn; otherwise a fast follow-up would resume from a stale transcript.
    const wait = waitPidFile
      ? [
          `prev=$(cat ${q(waitPidFile)} 2>/dev/null || echo 0)`,
          'n=0',
          'while [ -n "$prev" ] && [ "$prev" != "0" ] && [ "$n" -lt 100 ] && kill -0 "$prev" 2>/dev/null; do sleep 0.05; n=$((n+1)); done'
        ]
      : []
    return [
      `mkdir -p ${q(remoteDir)}`,
      `rm -f ${q(warm.eventsFile)} ${q(warm.stderrFile)} ${q(warm.pidFile)} ${q(warm.promptFile)} ${q(warm.holderFile)}`,
      'if ! command -v mkfifo >/dev/null 2>&1; then echo no-mkfifo >&2; exit 7; fi',
      `mkfifo ${q(warm.promptFile)}`,
      ...wait,
      'if command -v setsid >/dev/null 2>&1; then',
      `  setsid sh -c ${q(holder)} </dev/null >/dev/null 2>&1 &`,
      `  setsid sh -c ${q(reader)} > ${q(warm.eventsFile)} 2> ${q(warm.stderrFile)} </dev/null &`,
      'else',
      `  nohup sh -c ${q(holder)} </dev/null >/dev/null 2>&1 &`,
      `  nohup sh -c ${q(reader)} > ${q(warm.eventsFile)} 2> ${q(warm.stderrFile)} </dev/null &`,
      'fi',
      `echo $! > ${q(warm.pidFile)}`
    ].join('\n')
  }

  async prewarm(state) {
    if (!this.warmEnabled || !this.enabled || this.disposed || state.closed) return
    if (state.running || state.warm || state.queue.length > 0) return
    const turn = state.turn + 1
    const remoteSessionId = state.remoteSessionId || ''
    // The runner that served the previous turn holds the session lock/snapshot
    // until it exits; the warm boot has to wait for it (bounded, in the remote
    // shell) to resume from a complete transcript.
    const waitPidFile = state.pidFile
    const serial = ++state.warmSerial
    const generation = state.generation
    try {
      // Do not open the warm channel while the previous tail is still counted
      // against sshd's MaxSessions.
      if (state.streamDone) {
        await Promise.race([
          state.streamDone.catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, 1000))
        ])
        if (state.running || state.warm || state.warmSerial !== serial) return
      }
      await this.ensureProfile(state.host, state.workspace)
      if (state.running || state.warm || state.warmSerial !== serial) return
      const warm = this.warmPaths(state, turn, serial)
      const result = await this.pool.exec(
        state.host,
        this.buildWarmCommand(state, warm, remoteSessionId, waitPidFile),
        { timeoutMs: 20000 }
      )
      if (result.code !== 0) {
        this.log('warn', `bridge prewarm failed for ${state.localSessionId}: ${(result.stderr || result.stdout || '').trim().slice(0, 200)}`)
        return
      }
      if (state.running || state.warm || state.warmSerial !== serial || state.generation !== generation) {
        // A real turn (or a newer prewarm) won the race; discard this runner.
        void this.killWarm(state, warm)
        return
      }
      warm.remoteSessionId = remoteSessionId
      state.warm = warm
      // The holder exits at TTL, which turns into EOF and a clean "task
      // required" exit for the runner. Refresh it so an open workspace keeps
      // a warm runner instead of silently falling back to a cold start.
      if (state.warmRefresh) clearTimeout(state.warmRefresh)
      state.warmRefresh = setTimeout(() => {
        void this.refreshWarm(state, warm)
      }, (PREWARM_TTL_SECONDS + 5) * 1000)
      if (typeof state.warmRefresh.unref === 'function') state.warmRefresh.unref()
      this.log('info', `bridge: prewarmed turn ${turn} for ${state.localSessionId}`)
    } catch (error) {
      this.log('warn', `bridge prewarm failed for ${state.localSessionId}: ${errorText(error)}`)
    }
  }

  async refreshWarm(state, warm) {
    state.warmRefresh = null
    if (state.warm !== warm) return
    state.warm = null
    // Wait for the old runner to die before the next prewarm reuses the turn
    // number; otherwise its cleanup could race the new runner's files.
    await this.killWarm(state, warm)
    this.schedulePrewarm(state)
  }

  takeWarm(state) {
    const warm = state.warm
    if (!warm) return null
    state.warm = null
    if (state.warmRefresh) {
      clearTimeout(state.warmRefresh)
      state.warmRefresh = null
    }
    if (warm.turn !== state.turn + 1 || (warm.remoteSessionId || '') !== (state.remoteSessionId || '')) {
      // Bound to another turn or remote session (retry / newly adopted
      // session): discard it instead of feeding the wrong task.
      void this.killWarm(state, warm)
      return null
    }
    return warm
  }

  async submitWarm(state, warm, text) {
    const token = `DSH_PROMPT_${randomUUID().replace(/-/g, '')}`
    const command = [
      `p=$(cat ${q(warm.pidFile)} 2>/dev/null || echo 0)`,
      `h=$(cat ${q(warm.holderFile)} 2>/dev/null || echo 0)`,
      'if [ "$p" = "0" ] || ! kill -0 "$p" 2>/dev/null; then',
      '  [ "$h" != "0" ] && kill "$h" 2>/dev/null',
      '  echo cold',
      '  exit 0',
      'fi',
      `cat > ${q(warm.promptFile)} <<'${token}'`,
      text,
      token,
      `kill "$h" 2>/dev/null || true`,
      'echo warm'
    ].join('\n')
    try {
      const result = await this.pool.exec(state.host, command, { timeoutMs: 8000 })
      return String(result.stdout || '').includes('warm')
    } catch (error) {
      this.log('warn', `bridge warm submit failed for ${state.localSessionId}: ${errorText(error)}`)
      void this.killWarm(state, warm)
      return false
    }
  }

  async killWarm(state, warm) {
    if (!warm) return
    const command = [
      `h=$(cat ${q(warm.holderFile)} 2>/dev/null || echo 0)`,
      `p=$(cat ${q(warm.pidFile)} 2>/dev/null || echo 0)`,
      '[ "$h" != "0" ] && kill "$h" 2>/dev/null || true',
      '[ "$p" != "0" ] && { kill -TERM -"$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null || true; }',
      'true'
    ].join('\n')
    try {
      await this.pool.exec(state.host, command, { timeoutMs: 8000 })
    } catch {
      // best effort
    }
  }

  buildTailCommand(state) {
    const start = Math.max(0, Number(state.offset) || 0) + 1
    return [
      `pid=$(cat ${q(state.pidFile)} 2>/dev/null || echo 0)`,
      'if [ -z "$pid" ] || [ "$pid" = "0" ]; then exit 3; fi',
      'n=0',
      `while [ ! -f ${q(state.eventsFile)} ] && [ "$n" -lt 250 ] && kill -0 "$pid" 2>/dev/null; do sleep 0.02; n=$((n+1)); done`,
      'if command -v stdbuf >/dev/null 2>&1; then',
      `  stdbuf -oL tail -c +${start} -f ${q(state.eventsFile)} & tp=$!`,
      'else',
      `  tail -c +${start} -f ${q(state.eventsFile)} & tp=$!`,
      'fi',
      'while kill -0 "$pid" 2>/dev/null; do sleep 0.1; done',
      'sleep 0.2',
      'kill "$tp" 2>/dev/null || true',
      'wait "$tp" 2>/dev/null || true',
      'exit 0'
    ].join('\n')
  }

  /**
   * One long-lived SSH channel follows the detached runner's JSONL file.
   * The runner itself stays detached, so closing the local app only drops this
   * channel; the next attach resumes from the saved byte offset.
   */
  async startTail(state) {
    if (!state.running || state.stream) return
    const generation = state.generation
    const handle = await this.pool.execStream(state.host, this.buildTailCommand(state), {
      onStdout: (chunk) => {
        if (state.generation === generation) this.consumeBytes(state, chunk)
      },
      onStderr: (chunk) => {
        const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
        state.tailStderr = `${state.tailStderr || ''}${text}`.slice(-4000)
      }
    })
    if (!state.running || state.generation !== generation) {
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
      .then((result) => this.onStreamClosed(state, result, generation))
      .catch((error) => this.onStreamError(state, error, generation))
  }

  consumeBytes(state, chunk) {
    if (!chunk || chunk.length === 0) return
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    state.offset += buffer.length
    state.byteBuffer = state.byteBuffer.length === 0 ? buffer : Buffer.concat([state.byteBuffer, buffer])
    if (state.byteBuffer.length > 2 * 1024 * 1024) {
      this.log('warn', `bridge line buffer overflow for ${state.localSessionId}; dropping partial line`)
      state.byteBuffer = Buffer.alloc(0)
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
        if (event) this.consumeEvent(state, event)
      }
      index = state.byteBuffer.indexOf(10)
    }
    if (state.running) this.rememberActive(state)
    this.saveSoon()
  }

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
  }

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
  }

  async onStreamClosed(state, result, generation) {
    if (state.generation !== generation) return
    state.stream = null
    state.streamClosed = true
    if (!state.running) return
    // Drain bytes written between tail's last read and the process exit.
    try {
      const drain = await this.pool.execStream(
        state.host,
        `tail -c +${Math.max(0, Number(state.offset) || 0) + 1} ${q(state.eventsFile)} 2>/dev/null || true`,
        {
          onStdout: (chunk) => {
            if (state.generation === generation) this.consumeBytes(state, chunk)
          }
        }
      )
      await drain.done
    } catch {
      // best effort
    }
    if (state.generation !== generation || !state.running) return
    if (state.final) {
      this.finish(state)
      return
    }
    const alive = await this.processAlive(state)
    if (state.generation !== generation || !state.running) return
    if (alive) {
      // tail disappeared but the runner is still alive (missing tail, channel
      // reset): fall back to the polling transport.
      this.log('warn', `bridge stream closed early for ${state.localSessionId}; falling back to polling`)
      this.switchToPoll(state)
      return
    }
    const detail = (await this.readStderrTail(state)) || state.tailStderr || ''
    if (state.generation !== generation || !state.running) return
    if (state.cancelled) {
      this.finish(state)
      return
    }
    if (await this.retryWithoutStream(state, detail)) return
    this.failTurn(state, detail || 'remote headless exited without a final event')
    this.log('warn', `bridge: remote turn ended without final for ${state.localSessionId}${detail ? `: ${detail.slice(0, 300)}` : ''}`)
  }

  onStreamError(state, error, generation) {
    if (state.generation !== generation) return
    state.stream = null
    state.streamClosed = true
    if (!state.running) return
    this.log('warn', `bridge stream failed for ${state.localSessionId}: ${errorText(error)}`)
    this.switchToPoll(state)
  }

  /**
   * The remote profile's stream plugin is a convenience projection. If it
   * cannot load, rewrite the profile without it and relaunch the same turn
   * once so the feature degrades instead of killing the session.
   */
  async retryWithoutStream(state, detail) {
    if (state.retriedStream) return false
    if (!/dsh-ssh-stream|ERR_MODULE_NOT_FOUND|Cannot find package|failed to resolve/iu.test(String(detail))) return false
    state.retriedStream = true
    this.streamSupport.set(state.workspace.id, false)
    for (const key of [...this.profiles.keys()]) {
      if (key.startsWith(`${state.workspace.id}:`)) this.profiles.delete(key)
    }
    this.log('warn', `bridge: disabling remote stream plugin for ${state.workspace.name} after a load failure`)
    try {
      await this.ensureProfile(state.host, state.workspace)
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
  }

  switchToPoll(state) {
    if (state.byteBuffer.length > 0) {
      state.buffer += state.byteBuffer.toString('utf8')
      state.byteBuffer = Buffer.alloc(0)
    }
    this.schedulePoll(state)
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

  emitStream(state, frame) {
    const agent = state.agent
    try {
      if (agent?.dispatch && typeof agent.dispatch.emit === 'function') {
        agent.dispatch.emit('agent/assistant-stream', { frame })
        return true
      }
      if (agent?.ctx && typeof agent.ctx.emit === 'function') {
        agent.ctx.emit('agent/assistant-stream', { agent, frame })
        return true
      }
      if (this.ctx && typeof this.ctx.emit === 'function') {
        this.ctx.emit('agent/assistant-stream', { agent, frame })
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
  }

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
    this.emitStream(state, {
      type: 'start',
      attemptId: attempt.id,
      revision: ++attempt.revision,
      turn: state.remoteTurn || state.turn,
      step: state.remoteStep || 1
    })
    return attempt
  }

  pushLive(state, chunk, time, remoteAttemptId = '') {
    if (!chunk || typeof chunk !== 'object' || typeof chunk.type !== 'string') return
    const attempt = this.ensureLive(state, remoteAttemptId)
    const at = Number.isFinite(Number(time)) ? Number(time) : Date.now()
    this.emitStream(state, {
      type: 'chunk',
      attemptId: attempt.id,
      revision: ++attempt.revision,
      index: attempt.index,
      time: at,
      chunk
    })
    attempt.index += 1
  }

  /** Close the live attempt, pointing a committed end at the durable message. */
  settleLive(state, event) {
    const attempt = state.liveAttempt
    if (!attempt) return
    state.liveAttempt = null
    const seq = Number(event?.seq)
    if (event?.type === 'assistant/message' && Number.isSafeInteger(seq)) {
      this.emitStream(state, {
        type: 'end',
        attemptId: attempt.id,
        revision: ++attempt.revision,
        index: attempt.index,
        outcome: { kind: 'committed', eventType: 'assistant/message', seq }
      })
      return
    }
    this.emitStream(state, {
      type: 'end',
      attemptId: attempt.id,
      revision: ++attempt.revision,
      index: attempt.index,
      outcome: { kind: 'abandoned' }
    })
  }

  consumeStreamEvent(state, frame) {
    // Resumed turns replay the JSONL file; their transient frames are stale
    // once the local session already holds the durable events.
    if (!state.live || state.cancelled || !state.running || !frame) return
    if (frame.type === 'start') {
      this.ensureLive(state, frame.attemptId)
      return
    }
    if (frame.type === 'chunk') {
      this.pushLive(state, frame.chunk, frame.time, frame.attemptId)
    }
  }

  ensureTurn(state, turn = state.remoteTurn || state.turn) {
    if (state.turnOpen) return
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
    state.stepOptimistic = true
  }

  closeStep(state) {
    if (!state.stepOpen) return
    const turn = state.remoteTurn || state.turn
    const step = state.remoteStep || 1
    const assistant = this.flushAssistant(state)
    this.settleLive(state, assistant)
    this.append(state, 'step/end', { turn, step })
    state.stepOpen = false
    state.stepOptimistic = false
    state.reasoning = ''
    state.text = ''
    state.pendingTools = []
    state.assistantForStep = false
    state.assistantEvent = null
  }

  failTurn(state, message) {
    const turn = state.remoteTurn || state.turn
    this.settleLive(state, null)
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
      const previousTurn = state.remoteTurn
      const previousStep = state.remoteStep
      state.remoteTurn = turn
      state.remoteStep = step
      this.ensureTurn(state)
      // A live chunk may have opened the step before its durable status line
      // arrived; keep that step instead of splitting the stream.
      const sameStep = state.stepOpen && state.stepOptimistic
        && (previousTurn === 0 || previousTurn === turn)
        && (previousStep === 0 || previousStep === step)
      if (state.stepOpen && !sameStep) this.closeStep(state)
      state.liveAttempt = null
      state.reasoning = ''
      state.text = ''
      state.pendingTools = []
      state.assistantForStep = false
      state.assistantEvent = null
      this.append(state, 'step/start', { turn, step })
      state.stepOpen = true
      state.stepOptimistic = false
      return
    }
    if (phase === 'step_end') {
      state.remoteTurn = turn
      state.remoteStep = step
      this.ensureStep(state)
      const assistant = this.flushAssistant(state)
      this.settleLive(state, assistant)
      this.append(state, 'step/end', { turn, step })
      state.stepOpen = false
      state.reasoning = ''
      state.text = ''
      state.pendingTools = []
      state.assistantForStep = false
      state.assistantEvent = null
      return
    }
    if (phase === 'turn_end') {
      state.remoteTurn = turn
      this.ensureTurn(state)
      if (state.stepOpen) this.closeStep(state)
      this.settleLive(state, null)
      this.append(state, 'turn/end', { turn, reason: reasonOf(event) })
      state.turnOpen = false
      state.final = true
    }
  }

  flushAssistant(state) {
    if (!state.stepOpen) return null
    if (!state.reasoning && !state.text && state.pendingTools.length === 0) return null
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
    let appended = null
    if (content.length > 0 && !state.assistantForStep) {
      appended = this.append(state, 'assistant/message', {
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
      state.assistantEvent = appended
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
    return appended
  }

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
        eventsFile: state.eventsFile,
        stderrFile: state.stderrFile,
        pidFile: state.pidFile,
        offset: Math.max(0, (Number(state.offset) || 0) - pendingBytes),
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
    } else {
      this.settleLive(state, null)
    }
    state.running = false
    state.live = false
    // Do not force-close the tail here: the shell watchdog exits when the
    // runner exits and the server acknowledges the channel. Forcing it while
    // the remote shell is still alive keeps the session counted against
    // sshd's MaxSessions and delays the next turn.
    state.stream = null
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
    } else {
      // Boot the next turn's runner while the workspace is idle, so the next
      // prompt skips the 4-5 s headless startup.
      this.schedulePrewarm(state)
    }
  }

  async cancel(state, cause, options) {
    if (!state.running) {
      state.original.cancel?.(cause, options)
      return
    }
    state.cancelled = true
    state.live = false
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
    this.settleLive(state, null)
    this.append(state, 'turn/end', { turn: state.remoteTurn || state.turn, reason: { kind: 'error', error: { message: 'cancelled' } } })
    state.turnOpen = false
    try {
      state.stream?.close()
    } catch {
      // ignore
    }
    state.stream = null
    this.finish(state)
  }

  async cancelWorkspace(workspaceId) {
    for (const state of [...this.sessions.values()]) {
      if (state.workspace.id !== workspaceId) continue
      // The workspace is being removed: stop every remote process and never
      // boot the next turn's warm runner into a directory that is going away.
      state.closed = true
      state.warmSerial += 1
      if (state.warmTimer) {
        clearTimeout(state.warmTimer)
        state.warmTimer = null
      }
      if (state.warmRefresh) {
        clearTimeout(state.warmRefresh)
        state.warmRefresh = null
      }
      const warm = state.warm
      if (warm) {
        state.warm = null
        await this.killWarm(state, warm)
      }
      if (!state.running) {
        this.sessions.delete(state.localSessionId)
        continue
      }
      try {
        await this.cancel(state, { kind: 'user' }, {})
      } catch (error) {
        this.log('warn', `bridge cancel before remove failed for ${state.localSessionId}: ${errorText(error)}`)
      }
      this.sessions.delete(state.localSessionId)
    }
  }

  get busy() {
    for (const state of this.sessions.values()) {
      if (state.running) return true
    }
    return false
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
    this.disposed = true
    for (const state of this.sessions.values()) {
      state.generation += 1
      state.running = false
      state.live = false
      if (state.timer) clearTimeout(state.timer)
      if (state.warmTimer) clearTimeout(state.warmTimer)
      if (state.warmRefresh) clearTimeout(state.warmRefresh)
      if (state.warm) {
        const warm = state.warm
        state.warm = null
        void this.killWarm(state, warm)
      }
      try {
        state.stream?.close()
      } catch {
        // ignore
      }
      state.stream = null
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
