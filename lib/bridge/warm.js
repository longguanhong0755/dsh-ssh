// SessionBridge methods: prewarmed headless runner pool.
//
// Moved verbatim out of lib/bridge.js (the bodies still use `this`) and assigned
// onto SessionBridge.prototype at the end of that module.

import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { posix as remotePath } from 'node:path'
import { errorText, joinRemote, q, safeId, shq } from '../util.js'
import { PREWARM_TTL_SECONDS, MAX_WARM_RUNNERS } from './shared.js'

export const warmMethods = {
  schedulePrewarm(state) {
    if (this.sdkUsable(state)) return
    if (!this.warmEnabled || !this.enabled || this.disposed || state.closed) return
    if (MAX_WARM_RUNNERS <= 0) return
    if (state.warmTimer) clearTimeout(state.warmTimer)
    // Give the previous tail channel time to close; sshd counts it as a session.
    state.warmTimer = setTimeout(() => {
      state.warmTimer = null
      void this.prewarm(state)
    }, 300)
    if (typeof state.warmTimer.unref === 'function') state.warmTimer.unref()
  },

  warmPaths(state, turn, tag) {
    const bridgeDir = joinRemote(state.workspace.wsRoot, 'bridge', safeId(state.localSessionId))
    // Give every warm runner its own files: a refresh or a newer prewarm may
    // coexist with the old runner while it shuts down, and killWarm must not
    // read a pid/holder file that a newer runner already overwrote.
    const prefix = `turn-${turn}.w${tag}`
    return {
      turn,
      remoteSessionId: '',
      // The build this runner is launched from; a workspace switch retires it
      // instead of letting the next turn run the old CLI.
      dshVersion: state.workspace.dshVersion,
      eventsFile: joinRemote(bridgeDir, `${prefix}.jsonl`),
      stderrFile: joinRemote(bridgeDir, `${prefix}.err`),
      pidFile: joinRemote(bridgeDir, `${prefix}.pid`),
      promptFile: joinRemote(bridgeDir, `${prefix}.prompt`),
      holderFile: joinRemote(bridgeDir, `${prefix}.holder`)
    }
  },

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
  },

  async prewarm(state) {
    if (this.sdkUsable(state)) return
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
      await this.ensureProfile(state)
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
  },

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
  },

  dropWarmOrder(state) {
    const index = this.warmOrder.indexOf(state)
    if (index >= 0) this.warmOrder.splice(index, 1)
  },

  async refreshWarm(state, warm) {
    state.warmRefresh = null
    if (state.warm !== warm) return
    state.warm = null
    this.dropWarmOrder(state)
    // Wait for the old runner to die before the next prewarm reuses the turn
    // number; otherwise its cleanup could race the new runner's files.
    await this.killWarm(state, warm)
    this.schedulePrewarm(state)
  },

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
  },

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
  },

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
}
