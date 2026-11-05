// Remote session bridge.
//
// The native DSH chat UI talks to a local Agent/Session. For an anchor
// workspace the local agent loop must not call the model locally: this bridge
// intercepts its prompt methods, runs the real agent on the SSH host with the
// stock `dsh --profile headless --json` runner, and mirrors the runner's JSONL
// events back into the local Session. The native UI therefore stays unchanged,
// while every model/tool call executes on the remote machine.

import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
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

// The `sdk` profile serves the same agent over stdio JSON-RPC and keeps the
// runtime (and every session it owns) alive between turns. It is the preferred
// transport: the process boots once, then each prompt is enqueued without
// starting Node again.
const SDK_PACKAGE = {
  name: 'dsh-profile-sdk',
  private: true,
  dependencies: {},
  dsh: {
    profile: {
      bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-sdk-app']
    }
  }
}

// Idle SDK runtimes are killed by a detached watchdog after this many seconds
// without a prompt; every submitted turn restarts the watchdog.
const SDK_TTL_SECONDS = Math.max(30, Number(process.env.DSH_SSH_SDK_TTL) || 1800)
const SDK_PROVIDER = String(process.env.DSH_SSH_SDK_PROVIDER || 'deepseek-official')
const SDK_MODEL = String(process.env.DSH_SSH_SDK_MODEL || 'deepseek-chat')

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
const STREAM_PLUGIN_SOURCE = `// dsh-ssh bridge: forward live assistant frames as JSONL.
// Headless redirects stdout to the event file; the SDK profile reserves stdout
// for JSON-RPC, so it points DSH_SSH_STREAM_FILE at a shared append-only file.
import { appendFileSync } from 'node:fs'

export const name = '${STREAM_PLUGIN_NAME}'

const file = process.env.DSH_SSH_STREAM_FILE || ''

function write(frame) {
  const line = JSON.stringify({ type: 'stream', frame }) + '\\n'
  try {
    if (file) appendFileSync(file, line)
    else process.stdout.write(line)
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

// The SDK runtime is persistent: a runner booted by an older build can still be
// alive when the app (and this plugin) restarts. It then serves turns without
// the current stream plugin, which looks exactly like a non-streaming model.
// Every profile carries this stamp; a reused runtime whose stamp differs is
// retired instead of being trusted.
const PROFILE_VERSION = createHash('sha256')
  .update(STREAM_PLUGIN_SOURCE)
  .update(STREAM_PATCH)
  .update(SDK_PACKAGE.name)
  .digest('hex')
  .slice(0, 16)

function profileStamp(stream) {
  return `${PROFILE_VERSION}:${stream ? 'stream' : 'plain'}`
}

// A profile rewrite disables streaming for a while, not forever. Retry later so
// one transient module-resolution error cannot hide live output for the whole
// app process.
const STREAM_RETRY_MS = Math.max(60_000, Number(process.env.DSH_SSH_STREAM_RETRY_MS) || 10 * 60_000)
const STREAM_WATCHDOG_MS = Math.max(5_000, Number(process.env.DSH_SSH_STREAM_WATCHDOG_MS) || 12_000)

// A headless runner needs 4-5 s to boot before it can accept a task. The
// bridge therefore boots the next turn's runner while the workspace is idle:
// the runner reads its task from a FIFO, so it can be fully initialised before
// the user presses send. The holder keeps the FIFO open; killing it at submit
// time turns into the EOF the CLI waits for. The TTL bounds the idle process
// if no prompt ever arrives; a refresh timer keeps replacing it while the
// workspace stays open (DSH_SSH_PREWARM_TTL overrides it for tests).
const PREWARM_TTL_SECONDS = Math.max(5, Number(process.env.DSH_SSH_PREWARM_TTL) || 300)
// A booted headless runner holds about 200 MB RSS on the target. Keep warmth
// for the most recently used workspaces only; the rest fall back to cold
// starts rather than keeping one process per open session.
const MAX_WARM_RUNNERS = Math.max(0, Number(process.env.DSH_SSH_MAX_WARM ?? 2))

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
    this.streamRetryAt = new Map()
    this.journalPath = join(store.root, 'bridge.json')
    this.journal = {}
    this.pollMs = 300
    this.saveTimer = null
    this.warmEnabled = process.env.DSH_SSH_NO_PREWARM !== '1'
    this.sdkEnabled = process.env.DSH_SSH_NO_SDK !== '1'
    this.warmOrder = []
    this.disposed = false
    // Live-preview diagnosis: the renderer only accepts a strictly monotonic
    // assistant-stream revision per agent, so a silently dropped frame shows up
    // as a frozen answer. Track what the bridge emitted versus what the global
    // dispatcher actually delivered, and keep one bounded trace file.
    this.streamTracePath = join(store.root, 'stream-trace.log')
    this.streamSeen = new Map()
    this.streamProbe = this.armStreamProbe()
    this.loaded = this.loadJournal()
  }

  armStreamProbe() {
    try {
      const register = this.ctx?.on
      if (typeof register !== 'function') return null
      return register.call(this.ctx, 'agent/assistant-stream', ({ agent, frame } = {}) => {
        const id = String(agent?.session?.id ?? '')
        if (!id || !frame) return
        const row = this.streamSeen.get(id) || { frames: 0, chunks: 0, revision: 0, lastType: '' }
        row.frames += 1
        if (frame.type === 'chunk') row.chunks += 1
        row.revision = Number(frame.revision) || row.revision
        row.lastType = String(frame.type)
        this.streamSeen.set(id, row)
      }, { global: true })
    } catch {
      return null
    }
  }

  traceStream(record) {
    try {
      mkdirSync(dirname(this.streamTracePath), { recursive: true })
      try {
        if (statSync(this.streamTracePath).size > 512 * 1024) writeFileSync(this.streamTracePath, '')
      } catch {
        // file does not exist yet
      }
      appendFileSync(this.streamTracePath, `${JSON.stringify(record)}\n`)
    } catch {
      // diagnostics must never break a turn
    }
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

  /**
   * Synchronous flush for turn end / shutdown. Without it the 200 ms debounce
   * can lose the last offset and bytes, so the next attach replays the final
   * assistant message and turn/end into the restored local session.
   */
  persistSync() {
    try {
      mkdirSync(dirname(this.journalPath), { recursive: true })
      const temp = `${this.journalPath}.${process.pid}.sync.tmp`
      writeFileSync(temp, `${JSON.stringify({ version: 1, sessions: this.journal }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      renameSync(temp, this.journalPath)
    } catch (error) {
      this.log('warn', `bridge journal sync write failed: ${errorText(error)}`)
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
      streamStats: { frames: 0, chunks: 0, firstAt: 0, lastAt: 0 },
      streamWatchdog: null,
      turnStartedAt: 0,
      sdkStale: false,
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
      // Persistent SDK runtime: one detached stdio JSON-RPC process per local
      // session, kept alive across turns. See bootSdk().
      sdk: null,
      sdkFailed: false,
      sdkPending: new Map(),
      sdkSendChain: Promise.resolve(),
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
        if (saved.active.mode === 'sdk') {
          // A previous local process owned the same persistent runtime. Reuse
          // it when it is still alive (it is already initialized and holds the
          // session); otherwise boot a fresh one and resume the session.
          state.sdk = { reused: true, ready: false, inTurn: Boolean(saved.active.inTurn), watchdogFile: String(saved.active.watchdogFile || '') }
          state.running = Boolean(saved.active.inTurn)
          state.live = false
          if (state.running) {
            state.idlePromise = new Promise((resolve) => {
              state.idleResolve = resolve
            })
          }
          this.log('info', `bridge: reattaching sdk runtime for ${localSessionId} (${workspace.name}, offset ${state.offset})`)
          const resumingSdk = state.sdk
          resumingSdk.pendingResume = this.resumeSdk(state)
            .catch((error) => {
              this.log('warn', `bridge sdk reattach failed for ${localSessionId}: ${errorText(error)}`)
            })
            .finally(() => {
              resumingSdk.pendingResume = null
            })
        } else if (state.eventsFile) {
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
    if (state.sdk) return
    void this.ensureProfile(host, workspace).then(() => {
      if (!state.running) this.schedulePrewarm(state)
      if (this.sdkEnabled && !state.sdkFailed && !this.disposed && !state.closed) {
        void this.bootSdk(state).catch((error) => {
          this.log('warn', `bridge sdk runtime unavailable for ${workspace.name}: ${errorText(error)}`)
        })
      }
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

  /**
   * Streaming is retried after a cooldown instead of staying disabled for the
   * rest of the process. The profile cache key still separates stream/plain
   * variants so the fallback profile can be reused in the meantime.
   */
  streamEnabled(workspace) {
    const retryAt = this.streamRetryAt.get(workspace.id) || 0
    if (retryAt && retryAt <= Date.now()) {
      this.streamRetryAt.delete(workspace.id)
      this.log('info', `bridge: re-enabling remote stream plugin for ${workspace.name}`)
    }
    return !(this.streamRetryAt.get(workspace.id) > Date.now())
  }

  async ensureProfile(host, workspace) {
    const stream = this.streamEnabled(workspace)
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
      await this.pool.writeFile(
        host,
        joinRemote(profileDir, 'bridge-profile.json'),
        `${JSON.stringify({ version: PROFILE_VERSION, stream }, null, 2)}\n`
      )
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

  async ensureSdkProfile(host, workspace) {
    const stream = this.streamEnabled(workspace)
    const key = `${workspace.id}:sdk:${stream ? 'stream' : 'plain'}`
    if (this.profiles.has(key)) return await this.profiles.get(key)
    const promise = (async () => {
      const profileDir = joinRemote(workspace.dshHome, 'profiles', 'sdk')
      await this.pool.run(host, `mkdir -p ${q(profileDir)}`, { timeoutMs: 20000 })
      await this.pool.writeFile(host, joinRemote(profileDir, 'package.json'), `${JSON.stringify(SDK_PACKAGE, null, 2)}\n`)
      await this.pool.writeFile(host, joinRemote(profileDir, 'cordis.yml'), '[]\n')
      await this.pool.writeFile(host, joinRemote(profileDir, 'cordis.patch.yml'), stream ? STREAM_PATCH : '[]\n')
      if (stream) {
        const moduleDir = joinRemote(profileDir, 'node_modules', STREAM_PLUGIN_NAME)
        await this.pool.run(host, `mkdir -p ${q(moduleDir)}`, { timeoutMs: 20000 })
        await this.pool.writeFile(host, joinRemote(moduleDir, 'package.json'), STREAM_PLUGIN_PACKAGE)
        await this.pool.writeFile(host, joinRemote(moduleDir, 'index.js'), STREAM_PLUGIN_SOURCE)
      }
      await this.pool.writeFile(
        host,
        joinRemote(profileDir, 'bridge-profile.json'),
        `${JSON.stringify({ version: PROFILE_VERSION, stream }, null, 2)}\n`
      )
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

  sdkPaths(state) {
    const dir = joinRemote(state.workspace.wsRoot, 'bridge', safeId(state.localSessionId), 'sdk')
    return {
      dir,
      inFile: joinRemote(dir, 'in.fifo'),
      outFile: joinRemote(dir, 'out.jsonl'),
      errFile: joinRemote(dir, 'err.log'),
      pidFile: joinRemote(dir, 'runner.pid'),
      watchdogFile: joinRemote(dir, 'watchdog.pid'),
      watchdogScript: joinRemote(dir, 'watchdog.sh')
    }
  }

  /**
   * Boot the persistent SDK runtime for this local session: a detached
   * `dsh --profile sdk` process that reads JSON-RPC requests from a FIFO and
   * appends frames to out.jsonl. It stays alive between turns, so only the
   * first prompt pays the Node/profile startup.
   */
  async bootSdk(state) {
    if (!this.sdkEnabled || state.sdkFailed || this.disposed || state.closed) throw new Error('sdk runtime disabled')
    if (state.sdk?.pendingResume) {
      await state.sdk.pendingResume
    }
    // A reused runtime object comes from the journal and has no remote paths
    // yet; without them sdkWrite/killSdk would read an undefined pid file.
    if (state.sdk) Object.assign(state.sdk, this.sdkPaths(state))
    if (state.sdk?.ready) return state.sdk
    if (state.sdk?.booting) return await state.sdk.booting
    const sdk = state.sdk || { reused: false, ready: false, booting: null }
    state.sdk = sdk
    Object.assign(sdk, this.sdkPaths(state))
    if (state.stream) {
      try {
        state.stream.close()
      } catch {
        // ignore
      }
      state.stream = null
    }
    state.streamDone = null
    state.streamClosed = false
    state.offset = 0
    state.byteBuffer = Buffer.alloc(0)
    state.eventsFile = sdk.outFile
    state.stderrFile = sdk.errFile
    state.pidFile = sdk.pidFile
    sdk.booting = (async () => {
      await this.ensureSdkProfile(state.host, state.workspace)
      await this.launchSdk(state, sdk)
      this.rememberActive(state)
      await this.startTail(state)
      await this.sdkCall(state, 'initialize', {
        cwd: state.workspace.remotePath,
        provider: SDK_PROVIDER,
        model: SDK_MODEL
      }, 30000)
      if (state.remoteSessionId && state.turn > 0) {
        try {
          await this.sdkCall(state, 'session/resume', { sessionId: state.remoteSessionId }, 30000)
        } catch (error) {
          // A session that never committed a turn can still be created by the
          // first prompt; only an occupied session is a real problem, and the
          // caller falls back to the headless transport in that case.
          this.log('warn', `bridge sdk resume skipped for ${state.localSessionId}: ${errorText(error)}`)
        }
      }
      sdk.ready = true
      sdk.booting = null
      this.log('info', `bridge: sdk runtime ready for ${state.localSessionId} (${state.workspace.name})`)
      return sdk
    })().catch((error) => {
      sdk.booting = null
      if (state.sdk === sdk) state.sdk = null
      throw error
    })
    return await sdk.booting
  }

  async launchSdk(state, sdk) {
    const workspace = state.workspace
    const command = [
      `mkdir -p ${q(sdk.dir)}`,
      `rm -f ${q(sdk.outFile)} ${q(sdk.errFile)} ${q(sdk.pidFile)} ${q(sdk.watchdogFile)} ${q(sdk.inFile)}`,
      'if ! command -v mkfifo >/dev/null 2>&1; then echo no-mkfifo >&2; exit 7; fi',
      `mkfifo ${q(sdk.inFile)}`,
      `cat > ${q(sdk.watchdogScript)} <<'DSH_WATCHDOG'
#!/bin/sh
pg=$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')
[ -n "$pg" ] || pg=$$
echo "$pg" > "$3"
sleep "$1"
p=$(cat "$2" 2>/dev/null || echo 0)
[ -n "$p" ] && [ "$p" != "0" ] && kill -0 "$p" 2>/dev/null || exit 0
kill -TERM "-$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null || true
DSH_WATCHDOG`,
      `chmod 700 ${q(sdk.watchdogScript)}`,
      `cd ${q(workspace.remotePath)}`,
      `exec 3<>${q(sdk.inFile)}`,
      `exec env DSH_HOME=${q(workspace.dshHome)} NODE_COMPILE_CACHE=${q(joinRemote(workspace.dshHome, '.node-compile-cache'))} DSH_PERMISSION_MODE=${q(this.permissionMode)} DSH_SSH_STREAM_FILE=${q(sdk.outFile)} ${q(workspace.nodeBin)} ${q(workspace.dshBin)} --profile sdk <&3 >> ${q(sdk.outFile)} 2>> ${q(sdk.errFile)}`
    ]
    // The shell that opens the FIFO and execs node must publish its own pid
    // first; that pid is the runner's process-group leader for cancel/TTL.
    const inner = [
      `echo $$ > ${q(sdk.pidFile)}`,
      ...command.slice(6)
    ].join('\n')
    const watchdog = `sh ${q(sdk.watchdogScript)} ${SDK_TTL_SECONDS} ${q(sdk.pidFile)} ${q(sdk.watchdogFile)}`
    const outer = [
      ...command.slice(0, 6),
      'if command -v setsid >/dev/null 2>&1; then',
      `  setsid sh -c ${q(inner)} </dev/null >/dev/null 2>&1 &`,
      'else',
      `  nohup sh -c ${q(inner)} </dev/null >/dev/null 2>&1 &`,
      'fi',
      'n=0',
      `while [ ! -s ${q(sdk.pidFile)} ] && [ "$n" -lt 100 ]; do sleep 0.02; n=$((n+1)); done`,
      `if [ ! -s ${q(sdk.pidFile)} ]; then echo sdk-pid-missing >&2; exit 8; fi`,
      'if command -v setsid >/dev/null 2>&1; then',
      `  setsid sh -c ${q(watchdog)} </dev/null >/dev/null 2>&1 &`,
      'else',
      `  nohup sh -c ${q(watchdog)} </dev/null >/dev/null 2>&1 &`,
      'fi'
    ].join('\n')
    const result = await this.pool.exec(state.host, outer, { timeoutMs: 25000 })
    if (result.code !== 0) {
      throw new Error(`remote sdk launch failed (exit ${result.code}): ${(result.stderr || result.stdout || '').trim().slice(0, 400)}`)
    }
    this.log('info', `bridge: sdk runtime launched for ${state.localSessionId} (${workspace.name})`)
  }

  sdkCall(state, method, params, timeoutMs = 30000) {
    const sdk = state.sdk
    if (!sdk) return Promise.reject(new Error('sdk runtime is not running'))
    const id = randomUUID()
    const line = JSON.stringify({ jsonrpc: '2.0', id, method, params })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        state.sdkPending.delete(id)
        reject(new Error(`${method} timed out after ${Math.round(timeoutMs / 1000)}s`))
      }, timeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
      state.sdkPending.set(id, { resolve, reject, timer, method })
      this.sdkWrite(state, line).catch((error) => {
        const pending = state.sdkPending.get(id)
        if (!pending) return
        state.sdkPending.delete(id)
        clearTimeout(pending.timer)
        pending.reject(error)
      })
    })
  }

  sdkWrite(state, line) {
    const run = async () => {
      const sdk = state.sdk
      if (!sdk) throw new Error('sdk runtime is not running')
      const command = [
        `p=$(cat ${q(sdk.pidFile)} 2>/dev/null || echo 0)`,
        '[ -n "$p" ] && [ "$p" != "0" ] && kill -0 "$p" 2>/dev/null || { echo sdk-dead >&2; exit 9; }',
        `printf '%s\\n' ${q(line)} > ${q(sdk.inFile)}`,
        `w=$(cat ${q(sdk.watchdogFile)} 2>/dev/null || echo 0)`,
        // The watchdog is a setsid session leader; kill its group so the
        // sleeping child does not linger after the shell is gone.
        '[ -n "$w" ] && [ "$w" != "0" ] && { kill -TERM "-$w" 2>/dev/null || kill -TERM "$w" 2>/dev/null || true; }',
        `watchdog="sh ${q(sdk.watchdogScript)} ${SDK_TTL_SECONDS} ${q(sdk.pidFile)} ${q(sdk.watchdogFile)}"`,
        'if command -v setsid >/dev/null 2>&1; then',
        '  setsid sh -c "$watchdog" </dev/null >/dev/null 2>&1 &',
        'else',
        '  nohup sh -c "$watchdog" </dev/null >/dev/null 2>&1 &',
        'fi'
      ].join('\n')
      const result = await this.pool.exec(state.host, command, { timeoutMs: 15000 })
      if (result.code === 9) throw new Error('sdk runtime is not running')
      if (result.code !== 0) {
        throw new Error(`sdk request failed (exit ${result.code}): ${(result.stderr || result.stdout || '').trim().slice(0, 300)}`)
      }
    }
    const next = state.sdkSendChain.then(run, run)
    state.sdkSendChain = next.catch(() => {})
    return next
  }

  /**
   * Read the stamp of the profile the live runtime was booted from. A missing
   * file (older build) answers `''` and counts as stale; an SSH error answers
   * `null` so a transient network problem never kills a healthy runner.
   */
  async readSdkProfileStamp(host, workspace) {
    const path = joinRemote(workspace.dshHome, 'profiles', 'sdk', 'bridge-profile.json')
    try {
      const result = await this.pool.exec(host, `cat ${q(path)} 2>/dev/null || true`, { timeoutMs: 10000 })
      if (result.code !== 0) return null
      const raw = String(result.stdout || '').trim()
      if (!raw) return ''
      const parsed = JSON.parse(raw)
      return `${String(parsed.version || '')}:${parsed.stream ? 'stream' : 'plain'}`
    } catch {
      return null
    }
  }

  /**
   * Reattach to a persistent runtime left by a previous local process. It is
   * already initialized, so no handshake is sent; the tail continues from the
   * journaled byte offset.
   */
  async resumeSdk(state) {
    try {
      const alive = await this.processAlive(state)
      if (state.closed || this.disposed) return
      if (!alive) {
        this.log('info', `bridge: sdk runtime gone for ${state.localSessionId}; booting a fresh one`)
        state.sdk = null
        state.eventsFile = ''
        state.stderrFile = ''
        state.pidFile = ''
        state.offset = 0
        if (state.running) {
          // The turn that was in flight cannot be recovered by a new process.
          state.running = false
          state.live = false
          state.idleResolve?.()
        }
        await this.bootSdk(state)
        return
      }
      // The runtime may predate the current stream plugin (or be the fallback
      // plain profile from an earlier app process). Retire it instead of
      // silently serving non-streaming turns. An in-flight turn is left alone
      // until it finishes so a remote task is never killed mid-run.
      const expected = profileStamp(this.streamEnabled(state.workspace))
      const stamp = await this.readSdkProfileStamp(state.host, state.workspace)
      if (stamp !== null && stamp !== expected) {
        if (state.running) {
          state.sdkStale = true
          this.log('warn', `bridge: sdk runtime for ${state.localSessionId} uses stale profile (${stamp || 'unversioned'}); refreshing after the active turn`)
        } else {
          this.log('info', `bridge: sdk runtime profile changed for ${state.localSessionId} (${stamp || 'unversioned'} -> ${expected}); rebooting`)
          Object.assign(state.sdk, this.sdkPaths(state))
          await this.killSdk(state)
          state.eventsFile = ''
          state.stderrFile = ''
          state.pidFile = ''
          state.offset = 0
          state.byteBuffer = Buffer.alloc(0)
          state.sdkFailed = false
          await this.bootSdk(state)
          return
        }
      }
      state.sdk.ready = true
      Object.assign(state.sdk, this.sdkPaths(state))
      await this.startTail(state)
      this.log('info', `bridge: sdk runtime reattached for ${state.localSessionId}`)
    } catch (error) {
      this.log('warn', `bridge sdk reattach failed for ${state.localSessionId}: ${errorText(error)}`)
      if (state.running) {
        state.running = false
        state.live = false
        state.idleResolve?.()
      }
    }
  }

  /**
   * Retire a runtime that was kept only to finish an in-flight turn. Called
   * after the turn settles; the next prompt boots the current profile.
   */
  async refreshStaleSdk(state) {
    if (!state.sdkStale || state.running || state.closed || this.disposed) return
    state.sdkStale = false
    this.log('info', `bridge: refreshing stale sdk runtime for ${state.localSessionId}`)
    try {
      Object.assign(state.sdk || {}, this.sdkPaths(state))
      await this.killSdk(state)
      state.eventsFile = ''
      state.stderrFile = ''
      state.pidFile = ''
      state.offset = 0
      state.byteBuffer = Buffer.alloc(0)
      await this.bootSdk(state)
    } catch (error) {
      this.log('warn', `bridge: stale sdk refresh failed for ${state.localSessionId}: ${errorText(error)}`)
    }
  }

  async sdkTurn(state, envelope) {
    let sdk = null
    try {
      sdk = await this.bootSdk(state)
    } catch (error) {
      this.log('warn', `bridge sdk boot failed for ${state.localSessionId}: ${errorText(error)}`)
      state.sdkFailed = true
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
          this.failTurn(state, `远程会话发送失败：${errorText(retryError)}`)
          return true
        }
      }
      this.failTurn(state, `远程会话发送失败：${detail}`)
      await this.killSdk(state)
      return true
    }
  }

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
  }

  consumeSdkNotification(state, frame) {
    if (frame.method !== 'session.event') return
    const params = frame.params || {}
    if (!state.remoteSessionId || params.sessionId !== state.remoteSessionId) return
    this.sdkSessionEvent(state, params.event || {})
  }

  sdkSessionEvent(state, event) {
    const data = event.data || {}
    const step = Number(data.step) || state.remoteStep || 1
    switch (event.type) {
      case 'turn/start': {
        state.remoteTurn = state.turn
        this.ensureTurn(state, state.turn)
        break
      }
      case 'step/start': {
        this.consumeStatus(state, { phase: 'step_start', turn: state.turn, step })
        break
      }
      case 'assistant/message': {
        const content = Array.isArray(data.message?.content) ? data.message.content : []
        state.reasoning = content.filter((block) => block?.type === 'reasoning').map((block) => block.text || '').join('')
        state.text = content.filter((block) => block?.type === 'text').map((block) => block.text || '').join('')
        break
      }
      case 'tool/call': {
        state.pendingTools.push({ type: 'tool_call', callId: data.callId, tool: data.name, input: data.arguments })
        break
      }
      case 'tool/result': {
        const message = data.message || {}
        const content = Array.isArray(message.content) ? message.content : []
        this.consumeEvent(state, {
          type: 'tool_result',
          callId: data.toolCallId || message.toolCallId || message.source?.callId,
          result: content.filter((block) => block?.type === 'text').map((block) => block.text || '').join('\n'),
          status: message.isError ? 'failed' : 'completed'
        })
        break
      }
      case 'step/end': {
        this.consumeStatus(state, { phase: 'step_end', turn: state.turn, step })
        break
      }
      case 'turn/end': {
        this.consumeStatus(state, { phase: 'turn_end', turn: state.turn, reason: data.reason })
        break
      }
      default:
        break
    }
    if (state.final) this.finish(state)
  }

  async killSdk(state) {
    const sdk = state.sdk
    if (!sdk) return
    state.sdk = null
    for (const [id, pending] of state.sdkPending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('sdk runtime stopped'))
      state.sdkPending.delete(id)
    }
    if (!sdk.pidFile) return
    const command = [
      `w=$(cat ${q(sdk.watchdogFile)} 2>/dev/null || echo 0)`,
      '[ -n "$w" ] && [ "$w" != "0" ] && { kill -TERM "-$w" 2>/dev/null || kill -TERM "$w" 2>/dev/null || true; }',
      `p=$(cat ${q(sdk.pidFile)} 2>/dev/null || echo 0)`,
      '[ -n "$p" ] && [ "$p" != "0" ] && { kill -TERM "-$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null || true; }',
      // Wait briefly for the old runtime to release the session write lock;
      // an immediate boot would otherwise resume a session that is still owned.
      'n=0',
      'while [ -n "$p" ] && [ "$p" != "0" ] && kill -0 "$p" 2>/dev/null && [ "$n" -lt 20 ]; do sleep 0.1; n=$((n+1)); done',
      'exit 0'
    ].join('\n')
    await this.pool.exec(state.host, command, { timeoutMs: 15000 }).catch(() => {})
  }

  async startTurn(state, envelope, { retry = false } = {}) {
    const warm = retry || this.sdkEnabled ? null : this.takeWarm(state)
    state.generation += 1
    state.running = true
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
    if (!retry) state.retriedStream = false
    this.clearStreamWatchdog(state)
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
      if (this.sdkEnabled && !state.sdkFailed && !retry) {
        // The persistent runtime keeps the agent/session in memory; only the
        // very first prompt of a session can pay a process start.
        const handled = await this.sdkTurn(state, envelope)
        if (handled) {
          this.armStreamWatchdog(state)
          return
        }
      }
      if (warm) {
        state.eventsFile = warm.eventsFile
        state.stderrFile = warm.stderrFile
        state.pidFile = warm.pidFile
        this.rememberActive(state)
        const submitted = await this.submitWarm(state, warm, envelope.text)
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
      state.live = true
      this.armStreamWatchdog(state)
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
  }

  schedulePrewarm(state) {
    if (this.sdkEnabled && !state.sdkFailed) return
    if (!this.warmEnabled || !this.enabled || this.disposed || state.closed) return
    if (MAX_WARM_RUNNERS <= 0) return
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
      // Publish the runner's own pid before exec: `$!` from the launching shell
      // can point at a short-lived setsid parent on some hosts.
      `echo $$ > ${q(warm.pidFile)}`,
      `exec env DSH_HOME=${q(workspace.dshHome)} NODE_COMPILE_CACHE=${q(joinRemote(workspace.dshHome, '.node-compile-cache'))} DSH_PERMISSION_MODE=${q(this.permissionMode)} ${q(workspace.nodeBin)} ${q(workspace.dshBin)} ${args.map((value) => shq(value)).join(' ')}`
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
      // Wait (bounded) for the runner to publish its pid so an immediate
      // prompt never sees a half-started warm runner.
      'n=0',
      `while [ ! -s ${q(warm.pidFile)} ] && [ "$n" -lt 50 ]; do sleep 0.02; n=$((n+1)); done`,
      `if [ ! -s ${q(warm.pidFile)} ]; then echo warm-pid-missing >&2; exit 8; fi`
    ].join('\n')
  }

  async prewarm(state) {
    if (this.sdkEnabled && !state.sdkFailed) return
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
      this.claimWarmSlot(state)
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

  claimWarmSlot(state) {
    this.dropWarmOrder(state)
    this.warmOrder.push(state)
    while (this.warmOrder.length > MAX_WARM_RUNNERS) {
      const oldest = this.warmOrder.shift()
      if (!oldest) break
      if (oldest === state) {
        this.warmOrder.push(oldest)
        break
      }
      if (oldest.warmRefresh) {
        clearTimeout(oldest.warmRefresh)
        oldest.warmRefresh = null
      }
      const warm = oldest.warm
      if (!warm) continue
      oldest.warm = null
      this.log('info', `bridge: evicting warm runner for ${oldest.localSessionId} (limit ${MAX_WARM_RUNNERS})`)
      void this.killWarm(oldest, warm)
    }
  }

  dropWarmOrder(state) {
    const index = this.warmOrder.indexOf(state)
    if (index >= 0) this.warmOrder.splice(index, 1)
  }

  async refreshWarm(state, warm) {
    state.warmRefresh = null
    if (state.warm !== warm) return
    state.warm = null
    this.dropWarmOrder(state)
    // Wait for the old runner to die before the next prewarm reuses the turn
    // number; otherwise its cleanup could race the new runner's files.
    await this.killWarm(state, warm)
    this.schedulePrewarm(state)
  }

  takeWarm(state) {
    const warm = state.warm
    if (!warm) return null
    state.warm = null
    this.dropWarmOrder(state)
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
      'if command -v stdbuf >/dev/null 2>&1; then',
      `  stdbuf -oL tail -c +${start} -f ${q(state.eventsFile)} & tp=$!`,
      'else',
      `  tail -c +${start} -f ${q(state.eventsFile)} & tp=$!`,
      'fi',
      `echo "$tp" > ${q(tailPidFile)} 2>/dev/null || true`,
      'while kill -0 "$pid" 2>/dev/null; do sleep 0.1; done',
      'sleep 0.2',
      'kill "$tp" 2>/dev/null || true',
      'wait "$tp" 2>/dev/null || true',
      `rm -f ${q(tailPidFile)} 2>/dev/null || true`,
      'exit 0'
    ].join('\n')
  }

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
        if (event) this.consumeFrame(state, event)
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
    const detail = (await this.readStderrTail(state)) || state.tailStderr || ''
    if ((!resident && state.generation !== generation) || !state.running) return
    if (state.cancelled) {
      this.finish(state)
      return
    }
    if (!resident && await this.retryWithoutStream(state, detail)) return
    if (resident && ownerSdk && state.sdk === ownerSdk) state.sdk = null
    this.failTurn(state, detail || 'remote headless exited without a final event')
    this.log('warn', `bridge: remote turn ended without final for ${state.localSessionId}${detail ? `: ${detail.slice(0, 300)}` : ''}`)
  }

  onStreamError(state, error, generation, resident = false) {
    if (!resident && state.generation !== generation) return
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
    // Cooldown, not a permanent kill switch: another turn (after the retry
    // window) probes the stream plugin again and recovers automatically.
    this.streamRetryAt.set(state.workspace.id, Date.now() + STREAM_RETRY_MS)
    for (const key of [...this.profiles.keys()]) {
      if (key.startsWith(`${state.workspace.id}:`)) this.profiles.delete(key)
    }
    this.log('warn', `bridge: remote stream plugin failed to load for ${state.workspace.name}; retrying in ${Math.round(STREAM_RETRY_MS / 1000)}s`)
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
  }

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
  }

  pushLive(state, chunk, time, remoteAttemptId = '') {
    if (!chunk || typeof chunk !== 'object' || typeof chunk.type !== 'string') return
    const attempt = this.ensureLive(state, remoteAttemptId)
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
  }

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
  }

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
  }

  clearStreamWatchdog(state) {
    if (!state.streamWatchdog) return
    clearTimeout(state.streamWatchdog)
    state.streamWatchdog = null
  }

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
  }

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
      if (sameStep) {
        // A stream chunk opened this exact step before the durable status line.
        // Keep the preview and just mark the step confirmed: appending another
        // step/start here would split one step into two.
        state.stepOptimistic = false
        return
      }
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
        mode: state.sdk ? 'sdk' : 'headless',
        eventsFile: state.eventsFile,
        stderrFile: state.stderrFile,
        pidFile: state.pidFile,
        watchdogFile: state.sdk?.watchdogFile || '',
        inTurn: Boolean(state.running),
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
    this.clearStreamWatchdog(state)
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
          inTurn: false,
          offset: Math.max(0, Number(state.offset) || 0),
          turn: state.turn,
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
        void staleRefresh.then(() => this.startTurn(state, next))
      }, 50)
    } else if (!state.sdk) {
      // Boot the next turn's runner while the workspace is idle, so the next
      // prompt skips the 4-5 s headless startup. The SDK runtime is already
      // resident, so it needs no prewarm.
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
    if (state.sdk) await this.killSdk(state)
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
      this.dropWarmOrder(state)
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
      if (state.sdk) await this.killSdk(state)
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
  }

  hostStates(hostId) {
    return [...this.sessions.values()].filter((state) => !hostId || state.host?.id === hostId)
  }

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
      if (state.timer) {
        clearTimeout(state.timer)
        state.timer = null
      }
      state.idleResolve?.()
      state.idleResolve = null
    }
  }

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
        if (state.closed || this.disposed || state.sdkFailed) continue
        state.retriedStream = false
        await this.bootSdk(state).catch((error) => {
          this.log('warn', `bridge restart failed for ${state.localSessionId}: ${errorText(error)}`)
        })
      }
    }
  }

  /** Reconnect/auto-start: boot runtimes for this device without a prompt. */
  async bootHostServices(hostId) {
    for (const state of this.hostStates(hostId)) {
      if (state.closed || this.disposed || state.sdkFailed) continue
      state.detached = false
      await this.bootSdk(state).catch((error) => {
        this.log('warn', `bridge connect failed for ${state.localSessionId}: ${errorText(error)}`)
      })
    }
  }

  /**
   * ZCode 移除设备 is local-only: forget sessions and the journal, close the
   * local channels, but never kill a remote task or delete remote data.
   */
  forgetHost(hostId) {
    for (const state of this.hostStates(hostId)) {
      state.closed = true
      state.generation += 1
      this.clearStreamWatchdog(state)
      if (state.timer) clearTimeout(state.timer)
      if (state.warmTimer) clearTimeout(state.warmTimer)
      if (state.warmRefresh) clearTimeout(state.warmRefresh)
      for (const [, pending] of state.sdkPending) {
        clearTimeout(pending.timer)
        pending.reject(new Error('workspace removed'))
      }
      state.sdkPending.clear()
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
      this.sessions.delete(state.localSessionId)
      delete this.journal[state.localSessionId]
    }
    this.persistSync()
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
      if (state.running) this.rememberActive(state)
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
      // The SDK runtime is detached and keeps the in-flight turn alive, like a
      // headless runner; only the local stdio channel and pending calls stop.
      for (const [, pending] of state.sdkPending) {
        clearTimeout(pending.timer)
        pending.reject(new Error('bridge disposed'))
      }
      state.sdkPending.clear()
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
    this.saveTimer = null
    this.persistSync()
  }
}
