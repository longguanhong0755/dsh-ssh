// SessionBridge methods: remote profile setup, SDK runtime boot/watchdog and its JSON-RPC channel.
//
// Moved verbatim out of lib/bridge.js (the bodies still use `this`) and assigned
// onto SessionBridge.prototype at the end of that module.

import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { errorText, joinRemote, q, safeId } from '../util.js'
import { HEADLESS_PACKAGE, HEADLESS_PATCH, SDK_PACKAGE, SDK_TTL_SECONDS, SDK_HEARTBEAT_MS, STREAM_PLUGIN_NAME, STREAM_PLUGIN_PACKAGE, STREAM_PLUGIN_SOURCE, STREAM_PATCH, PROFILE_VERSION, profileStamp, RUNTIME_SYNC_TTL_MS } from './shared.js'

export const sdkMethods = {
  /**
   * SDK availability with a retry cooldown. A failed boot marks the session
   * `sdkFailed` and keeps using the headless/warm transport, but after the
   * cooldown the next turn probes the runtime again instead of staying on the
   * slow path for the rest of the process.
   */
  sdkUsable(state) {
    if (!this.sdkEnabled) return false
    if (!state.sdkFailed) return true
    if (state.sdkRetryAt && state.sdkRetryAt <= Date.now()) {
      state.sdkFailed = false
      state.sdkRetryAt = 0
      this.log('info', `bridge: retrying sdk runtime for ${state.localSessionId}`)
      return true
    }
    return false
  },

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
  },

  /**
   * Retarget the workspace to the configured runtime when that build is
   * already installed on the host, and report whether it changed.
   *
   * A workspace record embeds absolute node/dsh paths, and its start scripts
   * and systemd unit bake them in too. Installing a build on the host is not
   * enough: a session restored from the journal boots its SDK runner straight
   * from the stored paths, so it keeps speaking the old JSON-RPC dialect and
   * `/compact` (which needs `session/query`) cannot be forwarded. The normal
   * workspace start handles this; this covers sessions that never go through
   * it. Repeated checks are throttled per workspace, and a workspace whose
   * target build is missing is retried after the cooldown instead of probing
   * the host on every turn.
   */
  async syncWorkspaceRuntime(state) {
    const wanted = String(this.store?.settings?.dshVersion || '')
    const workspace = state?.workspace
    if (!wanted || !workspace?.dshVersion || workspace.dshVersion === wanted) return false
    if (typeof this.manager?.refreshWorkspaceRuntime !== 'function') return false
    const cached = this.runtimeSyncs.get(workspace.id)
    if (cached && Date.now() - cached.at < RUNTIME_SYNC_TTL_MS) return await cached.promise
    const record = { at: Date.now(), promise: null }
    record.promise = (async () => {
      try {
        const changed = await this.manager.refreshWorkspaceRuntime(state.host, workspace, {
          onLog: (line) => this.log('info', `bridge: ${line}`)
        })
        if (changed) this.log('info', `bridge: ${workspace.name} switched to dsh ${workspace.dshVersion}`)
        return changed === true
      } catch (error) {
        this.log('warn', `bridge: runtime check failed for ${workspace.name}: ${errorText(error)}`)
        return false
      }
    })()
    this.runtimeSyncs.set(workspace.id, record)
    return await record.promise
  },

  /**
   * Retreat every process this chat owns: used right after the workspace was
   * retargeted, when any runner started before the switch speaks the old
   * dialect (or runs the old CLI).
   */
  async retireRunners(state) {
    const warm = state.warm
    if (warm) {
      state.warm = null
      this.dropWarmOrder(state)
      if (state.warmRefresh) {
        clearTimeout(state.warmRefresh)
        state.warmRefresh = null
      }
      void this.killWarm(state, warm)
    }
    if (state.sdk) await this.killSdk(state)
  },

  /**
   * Retire this chat's runners when they were started from a build other than
   * the workspace's current one.
   *
   * A workspace runtime switch is shared by every bridged chat, but each chat
   * owns its own SDK/warm process. The chat that performed the switch retires
   * its processes directly; the others notice here on their next turn instead
   * of keeping an old runner (and its old JSON-RPC dialect) for the rest of the
   * app process.
   */
  async retireStaleRunners(state) {
    const version = state.workspace?.dshVersion || ''
    if (!version) return false
    let retired = false
    if (state.sdk && state.sdk.dshVersion && state.sdk.dshVersion !== version) {
      this.log('info', `bridge: retiring sdk runtime ${state.sdk.dshVersion} for ${state.localSessionId} (workspace runs ${version})`)
      await this.killSdk(state)
      retired = true
    }
    const warm = state.warm
    if (warm && warm.dshVersion && warm.dshVersion !== version) {
      state.warm = null
      this.dropWarmOrder(state)
      if (state.warmRefresh) {
        clearTimeout(state.warmRefresh)
        state.warmRefresh = null
      }
      void this.killWarm(state, warm)
      retired = true
    }
    return retired
  },

  /**
   * A journal-restored runner was launched by an earlier app process, so its
   * build is not in memory. Its command line names the dsh path it runs; treat
   * a mismatch with the workspace's current path as stale. When the command
   * line cannot be read, keep the runner (the next turn still has the version
   * recorded at launch).
   */
  async sdkRunsWorkspaceRuntime(state) {
    const expected = state.workspace?.dshBin
    if (!expected || !state.pidFile) return true
    try {
      const result = await this.pool.exec(state.host, [
        `p=$(cat ${q(state.pidFile)} 2>/dev/null || echo 0)`,
        'if [ -n "$p" ] && [ "$p" != "0" ]; then',
        '  ps -o args= -p "$p" 2>/dev/null | tr -d "\\r" || true',
        'fi'
      ].join('\n'), { timeoutMs: 10000 })
      const args = String(result.stdout || '').trim()
      if (!args) return true
      return args.includes(expected)
    } catch {
      return true
    }
  },

  /** Retarget the runtime before forwarding a remote command. */
  async prepareRemoteCommands(state) {
    if (await this.syncWorkspaceRuntime(state)) {
      await this.retireRunners(state)
      return
    }
    await this.retireStaleRunners(state)
  },

  async ensureProfile(state) {
    const host = state.host
    const workspace = state.workspace
    const stream = this.streamEnabled(workspace)
    const modelKey = state.model?.key || 'default'
    const providersTag = this.providersTag()
    // The profile directory itself is shared by every chat of this workspace,
    // so the only cache entry that may survive is the one describing the bytes
    // just written. A later chat with another model rewrites the file and
    // invalidates this one; its own next turn rewrites it back.
    const key = `${workspace.id}:${stream ? 'stream' : 'plain'}:${providersTag}:${modelKey}`
    if (this.profiles.has(key)) return await this.profiles.get(key)
    const promise = (async () => {
      for (const other of [...this.profiles.keys()]) {
        if (other !== key && other.startsWith(`${workspace.id}:`)) this.profiles.delete(other)
      }
      const profileDir = joinRemote(workspace.dshHome, 'profiles', 'headless')
      await this.pool.run(host, `mkdir -p ${q(profileDir)}`, { timeoutMs: 20000 })
      await this.pool.writeFile(host, joinRemote(profileDir, 'package.json'), `${JSON.stringify(HEADLESS_PACKAGE, null, 2)}\n`)
      await this.pool.writeFile(host, joinRemote(profileDir, 'cordis.yml'), '[]\n')
      await this.pool.writeFile(
        host,
        joinRemote(profileDir, 'cordis.patch.yml'),
        `${HEADLESS_PATCH}${this.localProvidersPatch()}${this.modelPatch(state.model)}${stream ? STREAM_PATCH : ''}`
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
        `${JSON.stringify({ version: PROFILE_VERSION, stream, providers: providersTag, model: modelKey }, null, 2)}\n`
      )
      await this.syncProfileCredentials(state)
      return true
    })().catch((error) => {
      this.profiles.delete(key)
      throw error
    })
    this.profiles.set(key, promise)
    return await promise
  },

  async ensureSdkProfile(state) {
    const host = state.host
    const workspace = state.workspace
    const stream = this.streamEnabled(workspace)
    const providersTag = this.providersTag()
    // The SDK profile only carries provider routes and the stream plugin; the
    // model is set by `initialize`, so it stays out of the key.
    const key = `${workspace.id}:sdk:${stream ? 'stream' : 'plain'}:${providersTag}`
    if (this.profiles.has(key)) return await this.profiles.get(key)
    const promise = (async () => {
      const profileDir = joinRemote(workspace.dshHome, 'profiles', 'sdk')
      await this.pool.run(host, `mkdir -p ${q(profileDir)}`, { timeoutMs: 20000 })
      await this.pool.writeFile(host, joinRemote(profileDir, 'package.json'), `${JSON.stringify(SDK_PACKAGE, null, 2)}\n`)
      await this.pool.writeFile(host, joinRemote(profileDir, 'cordis.yml'), '[]\n')
      await this.pool.writeFile(
        host,
        joinRemote(profileDir, 'cordis.patch.yml'),
        `${this.localProvidersPatch()}${stream ? STREAM_PATCH : '[]\n'}`
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
        `${JSON.stringify({ version: PROFILE_VERSION, stream, providers: providersTag }, null, 2)}\n`
      )
      await this.syncProfileCredentials(state)
      return true
    })().catch((error) => {
      this.profiles.delete(key)
      throw error
    })
    this.profiles.set(key, promise)
    return await promise
  },

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
  },

  /**
   * Boot the persistent SDK runtime for this local session: a detached
   * `dsh --profile sdk` process that reads JSON-RPC requests from a FIFO and
   * appends frames to out.jsonl. It stays alive between turns, so only the
   * first prompt pays the Node/profile startup.
   */
  async bootSdk(state) {
    if (!this.sdkEnabled || !this.sdkUsable(state) || this.disposed || state.closed) throw new Error('sdk runtime disabled')
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
      await this.ensureSdkProfile(state)
      await this.launchSdk(state, sdk)
      this.rememberActive(state)
      await this.startTail(state)
      // The SDK runtime fixes the route for every session it creates; it must
      // be the route the anchor picker shows, with the adapter defaults the
      // local machine already materialized.
      const model = state.model
      if (!model) throw new Error('no model selection resolved for this bridged chat')
      await this.sdkCall(state, 'initialize', {
        cwd: state.workspace.remotePath,
        provider: model.provider,
        model: model.model,
        ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}),
        ...(model.maxTokens > 0 ? { maxTokens: model.maxTokens } : {})
      }, 30000)
      sdk.modelKey = model.key
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
      state.sdkFailed = false
      state.sdkRetryAt = 0
      this.log('info', `bridge: sdk runtime ready for ${state.localSessionId} (${state.workspace.name})`)
      return sdk
    })().catch((error) => {
      sdk.booting = null
      if (state.sdk === sdk) state.sdk = null
      throw error
    })
    return await sdk.booting
  },

  async launchSdk(state, sdk) {
    const workspace = state.workspace
    // Remember which build this process runs so a later workspace switch can
    // tell the runner is stale without inspecting the host.
    sdk.dshVersion = workspace.dshVersion
    sdk.dshBin = workspace.dshBin
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
echo "dsh-ssh watchdog: no client heartbeat for \${1}s; stopping the remote sdk runtime" >> "$4"
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
    const watchdog = `sh ${q(sdk.watchdogScript)} ${SDK_TTL_SECONDS} ${q(sdk.pidFile)} ${q(sdk.watchdogFile)} ${q(sdk.errFile)}`
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
  },

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
        `printf '%s\\n' ${q(line)} > ${q(sdk.inFile)}`,
        this.sdkWatchdogCommand(sdk)
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
      state.sdk.ready = true
      state.sdkFailed = false
      state.sdkRetryAt = 0
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
}
