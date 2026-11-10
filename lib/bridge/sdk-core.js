// SessionBridge methods: remote profile setup and the SDK runtime boot/launch
// handshake. Split out of lib/bridge/sdk.js (bodies verbatim); the channel and
// lifecycle half lives in ./sdk-io.js.
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  errorText,
  joinRemote,
  q,
  safeId
} from '../util.js'
import { sdkOwnerKillCommand } from './sdk-owner.js'
import {
  HEADLESS_PACKAGE,
  HEADLESS_PATCH,
  SDK_PACKAGE,
  SDK_TTL_SECONDS,
  STREAM_PLUGIN_NAME,
  STREAM_PLUGIN_PACKAGE,
  STREAM_PLUGIN_SOURCE,
  STREAM_PATCH,
  PROFILE_VERSION,
  RUNTIME_SYNC_TTL_MS
} from './shared.js'

export const sdkCoreMethods = {
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
      lockFile: joinRemote(dir, 'runner.lock'),
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
    // A runtime object restored from the journal says "ready" because it was
    // ready when the local app last wrote that journal — the process itself is
    // long gone. Trust it only when this app process verified it.
    if (state.sdk?.ready) {
      if (state.sdk.localReady) {
        // A fresh app process has no tail yet; without it the response frames
        // are never read and every request would sit until its timeout.
        if (!state.stream) await this.startTail(state)
        return state.sdk
      }
      const alive = await this.processAlive(state)
      const owners = alive ? await this.sdkOwnerPids(state) : []
      if (alive && owners.length === 1) {
        state.sdk.localReady = true
        if (!state.stream) await this.startTail(state)
        // The runner may predate this app process and never got a handshake;
        // `initialize` is idempotent, so a single attempt saves the first
        // prompt a failed round-trip.
        try {
          await this.sdkHandshake(state, { resume: true })
          return state.sdk
        } catch (error) {
          this.log('warn', `bridge: live sdk runtime for ${state.localSessionId} did not handshake (${errorText(error)}); replacing it`)
          state.sdk.ready = false
          state.sdk.localReady = false
        }
      }
      this.log('warn', `bridge: journaled sdk runtime for ${state.localSessionId} is unusable (alive=${alive}, owners=${owners.length}); booting one`)
      state.sdk.ready = false
    }
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
      await this.sdkHandshake(state, { resume: true })
      sdk.ready = true
      sdk.localReady = true
      sdk.booting = null
      state.sdkFailed = false
      state.sdkRetryAt = 0
      this.log('info', `bridge: sdk runtime ready for ${state.localSessionId} (${state.workspace.name})`)
      return sdk
    })().catch(async (error) => {
      sdk.booting = null
      if (state.sdk === sdk) state.sdk = null
      // The chat's runtime lock refused this launch because a live runner
      // already owns the FIFO. Talk to that one instead of fighting over the
      // pipe: two readers split the requests between them and every second
      // method fails.
      if (/sdk-owned/u.test(errorText(error))) {
        return await this.adoptSdk(state, 'another process owns this chat')
      }
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
    // What the runner itself does: wait on the FIFO, then become the node
    // process. `$$` is written first because that pid leads the runner's
    // process group, which cancel and the idle watchdog signal.
    const inner = [
      `echo $$ > ${q(sdk.pidFile)}`,
      `cd ${q(workspace.remotePath)}`,
      `exec 3<>${q(sdk.inFile)}`,
      `exec env DSH_HOME=${q(workspace.dshHome)} NODE_COMPILE_CACHE=${q(joinRemote(workspace.dshHome, '.node-compile-cache'))} DSH_PERMISSION_MODE=${q(this.permissionMode)} DSH_SSH_STREAM_FILE=${q(sdk.outFile)} ${q(workspace.nodeBin)} ${q(workspace.dshBin)} --profile sdk <&3 >> ${q(sdk.outFile)} 2>> ${q(sdk.errFile)}`
    ].join('\n')
    const watchdog = `sh ${q(sdk.watchdogScript)} ${SDK_TTL_SECONDS} ${q(sdk.pidFile)} ${q(sdk.watchdogFile)} ${q(sdk.errFile)}`
    const setup = [
      `mkdir -p ${q(sdk.dir)}`,
      // Claim the chat before deleting any of its files. The lock is inherited
      // by the runner, so a second launch for the same chat stops here instead
      // of unlinking the live runner's FIFO and splitting the conversation
      // between two processes.
      'if command -v flock >/dev/null 2>&1; then',
      `  exec 9>${q(sdk.lockFile)}`,
      '  flock -n 9 || { echo sdk-owned >&2; exit 11; }',
      'fi',
      'if ! command -v mkfifo >/dev/null 2>&1; then echo no-mkfifo >&2; exit 7; fi',
      // Retire the previous idle watchdog and every process still attached to
      // this chat. A leftover watchdog re-reads the pid file when it fires and
      // would otherwise kill the runner started below.
      `w=$(cat ${q(sdk.watchdogFile)} 2>/dev/null || echo 0)`,
      'case "$w" in ""|*[!0-9]*) w=0;; esac',
      '[ "$w" != "0" ] && { kill -TERM "-$w" 2>/dev/null || kill -TERM "$w" 2>/dev/null || true; }',
      sdkOwnerKillCommand(sdk),
      `rm -f ${q(sdk.outFile)} ${q(sdk.errFile)} ${q(sdk.pidFile)} ${q(sdk.watchdogFile)} ${q(sdk.inFile)}`,
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
      `chmod 700 ${q(sdk.watchdogScript)}`
    ]
    const outer = [
      ...setup,
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
}
