// SessionBridge methods: the SDK JSON-RPC channel (write, call, watchdog,
// resume, refresh, kill). Split out of lib/bridge/sdk.js (bodies verbatim).
import { randomUUID } from 'node:crypto'
import {
  join,
  resolve
} from 'node:path'
import {
  errorText,
  joinRemote,
  q
} from '../util.js'
import { sdkReapCommand } from './sdk-owner.js'
import {
  SDK_TTL_SECONDS,
  SDK_HEARTBEAT_MS,
  profileStamp
} from './shared.js'

export const sdkIoMethods = {

  /**
   * Shell lines that replace the idle watchdog: kill the previous one, then
   * start a fresh detached watchdog for the current TTL. Shared by the prompt
   * path (every submitted turn re-arms it) and the heartbeat that keeps a long
   * turn alive.
   */
  sdkWatchdogCommand(sdk) {
    return [
      `w=$(cat ${q(sdk.watchdogFile)} 2>/dev/null || echo 0)`,
      // The watchdog is a setsid session leader; kill its group so the
      // sleeping child does not linger after the shell is gone.
      '[ -n "$w" ] && [ "$w" != "0" ] && { kill -TERM "-$w" 2>/dev/null || kill -TERM "$w" 2>/dev/null || true; }',
      `watchdog="sh ${q(sdk.watchdogScript)} ${SDK_TTL_SECONDS} ${q(sdk.pidFile)} ${q(sdk.watchdogFile)} ${q(sdk.errFile)}"`,
      'if command -v setsid >/dev/null 2>&1; then',
      '  setsid sh -c "$watchdog" </dev/null >/dev/null 2>&1 &',
      'else',
      '  nohup sh -c "$watchdog" </dev/null >/dev/null 2>&1 &',
      'fi'
    ].join('\n')
  },

  async armSdkWatchdog(state) {
    const sdk = state.sdk
    if (!sdk?.watchdogScript || !sdk.pidFile) return
    const result = await this.pool.exec(state.host, this.sdkWatchdogCommand(sdk), { timeoutMs: 15000 })
    if (result.code !== 0) throw new Error(`watchdog refresh failed (exit ${result.code})`)
  },

  /**
   * A turn may legitimately stream for hours (long tool calls, browser
   * captures). The remote watchdog measures idle time, not turn duration, so
   * refresh it from here until the turn settles. Without this a turn longer
   * than SDK_TTL_SECONDS was killed mid-flight and surfaced as "the runner
   * exited" with an empty stderr.
   */
  startSdkHeartbeat(state) {
    this.stopSdkHeartbeat(state)
    if (!this.sdkEnabled || this.disposed || state.closed) return
    state.sdkHeartbeat = setInterval(() => {
      if (!state.running || !state.sdk || state.closed || this.disposed) return
      this.armSdkWatchdog(state).catch((error) => {
        this.log('warn', `bridge: sdk watchdog refresh failed for ${state.localSessionId}: ${errorText(error)}`)
      })
    }, SDK_HEARTBEAT_MS)
    if (typeof state.sdkHeartbeat.unref === 'function') state.sdkHeartbeat.unref()
  },

  stopSdkHeartbeat(state) {
    if (state.sdkHeartbeat) clearInterval(state.sdkHeartbeat)
    state.sdkHeartbeat = null
  },

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
  },

  sdkWrite(state, line) {
    const run = async () => {
      const sdk = state.sdk
      if (!sdk) throw new Error('sdk runtime is not running')
      const command = [
        `p=$(cat ${q(sdk.pidFile)} 2>/dev/null || echo 0)`,
        '[ -n "$p" ] && [ "$p" != "0" ] && kill -0 "$p" 2>/dev/null || { echo sdk-dead >&2; exit 9; }',
        // A FIFO with no reader blocks the writer forever, which used to stall
        // the turn until the request timed out with nothing to report. Bound it
        // so the failure is immediate, named, and repairable.
        'if command -v timeout >/dev/null 2>&1; then',
        `  timeout 10 sh -c ${q(`printf '%s\\n' ${q(line)} > ${q(sdk.inFile)}`)} || { echo sdk-write-blocked >&2; exit 10; }`,
        'else',
        `  printf '%s\\n' ${q(line)} > ${q(sdk.inFile)}`,
        'fi',
        this.sdkWatchdogCommand(sdk)
      ].join('\n')
      const result = await this.pool.exec(state.host, command, { timeoutMs: 15000 })
      if (result.code === 9) throw new Error('sdk runtime is not running (sdk-dead)')
      if (result.code === 10) throw new Error('sdk runtime is not reading its queue (sdk-write-blocked)')
      if (result.code !== 0) {
        throw new Error(`sdk request failed (exit ${result.code}): ${(result.stderr || result.stdout || '').trim().slice(0, 300)}`)
      }
    }
    const next = state.sdkSendChain.then(run, run)
    state.sdkSendChain = next.catch(() => {})
    return next
  },

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
  },

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
      // A runtime left by an earlier app process may also predate a workspace
      // runtime switch on this host. Its command line names the build it runs;
      // if that is not the current one, retire it before resuming. An in-flight
      // turn is left alone (and refreshed once it settles).
      if (!(await this.sdkRunsWorkspaceRuntime(state))) {
        if (state.running) {
          state.sdkStale = true
          this.log('warn', `bridge: sdk runtime for ${state.localSessionId} uses an older dsh build; refreshing after the active turn`)
        } else {
          this.log('info', `bridge: sdk runtime for ${state.localSessionId} uses an older dsh build; rebooting`)
          Object.assign(state.sdk, this.sdkPaths(state))
          await this.killSdk(state)
          state.eventsFile = ''
          state.stderrFile = ''
          state.pidFile = ''
          state.offset = 0
          state.byteBuffer = Buffer.alloc(0)
          await this.bootSdk(state)
          return
        }
      } else {
        if (state.sdk) state.sdk.dshVersion = state.workspace.dshVersion
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
          state.sdkRetryAt = 0
          await this.bootSdk(state)
          return
        }
      }
      Object.assign(state.sdk, this.sdkPaths(state))
      // More than one process on this chat's FIFO means the kernel splits the
      // requests between them: the handshake lands on one runtime and the next
      // prompt on the other. Replace the set with a single runner.
      const owners = await this.sdkOwnerPids(state)
      if (owners.length > 1) {
        this.log('warn', `bridge: ${owners.length} sdk processes share ${state.localSessionId} (${owners.join(', ')}); rebooting one`)
        await this.killSdk(state)
        await this.bootSdk(state)
        return
      }
      state.sdk.ready = true
      state.sdk.localReady = true
      state.sdkFailed = false
      state.sdkRetryAt = 0
      await this.startTail(state)
      // A runner left by an earlier app process may have started but never
      // received its handshake. `initialize` is idempotent, so re-sending it
      // turns such a leftover into a usable runtime instead of leaving it to
      // reject the next prompt with "SDK server is not initialized".
      try {
        await this.sdkHandshake(state, { resume: true })
        this.log('info', `bridge: sdk runtime reattached for ${state.localSessionId}`)
      } catch (error) {
        this.log('warn', `bridge: reattached sdk runtime is mute for ${state.localSessionId}: ${errorText(error)}; booting a fresh one`)
        await this.killSdk(state)
        await this.bootSdk(state)
      }
    } catch (error) {
      this.log('warn', `bridge sdk reattach failed for ${state.localSessionId}: ${errorText(error)}`)
      if (state.running) {
        state.running = false
        state.live = false
        state.idleResolve?.()
      }
    }
  },

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
  },

  /**
   * Stop every process attached to this chat and release its runtime lock.
   *
   * The recorded pid is not enough: a duplicate launch, or a runner started by
   * an earlier app process, is invisible in the pid file yet still reads the
   * FIFO. Both are found by the descriptor scan and killed here, and the wait
   * covers the session write lock so a boot that follows can resume.
   */
  async killSdk(state) {
    const sdk = state.sdk
    if (sdk) {
      state.sdk = null
      for (const [id, pending] of state.sdkPending) {
        clearTimeout(pending.timer)
        pending.reject(new Error('sdk runtime stopped'))
        state.sdkPending.delete(id)
      }
    }
    const target = sdk || this.sdkPaths(state)
    if (!target?.pidFile) return
    const pids = new Set(await this.sdkOwnerPids(state, target))
    const listed = await this.pool.exec(state.host, `cat ${q(target.pidFile)} 2>/dev/null || true`, { timeoutMs: 10000 }).catch(() => null)
    const recorded = Number(String(listed?.stdout || '').trim())
    if (Number.isSafeInteger(recorded) && recorded > 0) pids.add(recorded)
    await this.pool.exec(state.host, sdkReapCommand(target, [...pids]), { timeoutMs: 20000 }).catch(() => {})
    await this.pool.exec(state.host, `rm -f ${q(target.lockFile)}; exit 0`, { timeoutMs: 10000 }).catch(() => {})
  }
}
