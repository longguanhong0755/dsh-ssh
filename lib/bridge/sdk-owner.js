// SessionBridge methods: who owns a chat's remote SDK runtime.
//
// One remote SDK runtime per chat is a hard requirement: the runtime reads its
// JSON-RPC requests from a single FIFO, and the kernel hands each line to
// exactly one reader. Two runtimes on the same FIFO therefore split the
// conversation between them — `initialize` reaches one process and the next
// `session/prompt` reaches the other, which answers "SDK server is not
// initialized" (or "already owned by an active write handle" for the session
// lock). That is invisible in the log, so this module makes ownership
// observable and enforceable:
//
// - `flock` on `<sdk>/runner.lock` is acquired by `launchSdk` before anything
//   is deleted, and inherited by the runner, so a second launch refuses
//   instead of hijacking a live chat.
// - A `/proc` scan finds every process still attached to this chat's FIFO or
//   holding its lock, including runtimes and watchdogs left over from an
//   earlier app process that the pid file no longer names.

import { q } from '../util.js'

/**
 * Pids from the output of `sdkOwnerScanCommand`: one pid per line, anything
 * else ignored. Pure so the parsing rules are unit-testable.
 */
export function parseSdkOwnerPids(text) {
  const seen = new Set()
  for (const line of String(text || '').split(/\r?\n/u)) {
    const pid = Number(line.trim())
    if (Number.isSafeInteger(pid) && pid > 0) seen.add(pid)
  }
  return [...seen].sort((left, right) => left - right)
}

/**
 * Shell that prints one line per process whose open descriptors name this
 * chat's FIFO (and, with `lock`, its runtime lock). `find` reports the
 * directory holding each link (`/proc/<pid>/fd`), which is the only place the
 * pid appears — `ls -l` shows the fd number and the target, never the owner, so
 * the earlier pipeline turned link lines into `kill root` and `kill 0`. Only
 * numeric pids survive the final filter.
 *
 * The FIFO alone counts runtimes: helpers started by a launch (the watchdog
 * shell and its `sleep`) inherit the lock but never open the FIFO.
 */
export function sdkOwnerScanCommand(sdk, { lock = false } = {}) {
  const targets = [sdk.inFile, lock ? sdk.lockFile : null].filter(Boolean).map((path) => q(path))
  if (!targets.length) return 'exit 0'
  return [
    `for target in ${targets.join(' ')}; do`,
    '  find /proc/[0-9]*/fd -maxdepth 1 -lname "$target*" -printf "%h\\n" 2>/dev/null',
    `done | sed -E 's#^/proc/([0-9]+)/fd$#\\1#' | grep -E '^[0-9]+$' | sort -un`
  ].join('\n')
}

/**
 * Shell that stops every process attached to this chat, sparing the calling
 * shell (it holds the chat lock while a launch prepares the runtime).
 */
export function sdkOwnerKillCommand(sdk) {
  return [
    `for p in $(${sdkOwnerScanCommand(sdk, { lock: true })}); do`,
    '  [ "$p" = "$$" ] && continue',
    '  kill -TERM "-$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null || true',
    'done'
  ].join('\n')
}

/**
 * Shell that stops every process recorded for this chat: the idle watchdog
 * (which would otherwise wake up later and kill the *new* runner, because it
 * re-reads the pid file at fire time) and anything attached to the FIFO.
 * `keep` protects a pid that must survive, which lets a heal inspect before it
 * replaces.
 */
export function sdkReapCommand(sdk, pids = [], keep = 0) {
  const lines = []
  if (sdk.watchdogFile) {
    lines.push(`w=$(cat ${q(sdk.watchdogFile)} 2>/dev/null || echo 0)`)
    lines.push('case "$w" in ""|*[!0-9]*) w=0;; esac')
    lines.push('[ "$w" != "0" ] && { kill -TERM "-$w" 2>/dev/null || kill -TERM "$w" 2>/dev/null || true; }')
  }
  for (const pid of pids) {
    if (!pid || pid === keep) continue
    lines.push(`kill -TERM -${pid} 2>/dev/null || kill -TERM ${pid} 2>/dev/null || true`)
  }
  const live = pids.filter((pid) => pid && pid !== keep)
  if (live.length) {
    lines.push('n=0')
    lines.push('while [ "$n" -lt 20 ]; do')
    lines.push('  alive=0')
    for (const pid of live) lines.push(`  kill -0 ${pid} 2>/dev/null && alive=1`)
    lines.push('  [ "$alive" = "1" ] || break')
    lines.push('  sleep 0.1; n=$((n+1))')
    lines.push('done')
    for (const pid of live) lines.push(`kill -KILL -${pid} 2>/dev/null || kill -KILL ${pid} 2>/dev/null || true`)
  }
  lines.push('exit 0')
  return lines.join('\n')
}

export const sdkOwnerMethods = {
  /**
   * Pids of every runtime reading this chat's FIFO, best effort. Helpers that
   * only inherited the lock are not counted, so "one owner" really means one
   * runtime; pass `{ lock: true }` to include everything attached.
   */
  async sdkOwnerPids(state, sdk = null, { lock = false } = {}) {
    const target = sdk || state.sdk || this.sdkPaths(state)
    if (!target?.inFile) return []
    try {
      const result = await this.pool.exec(state.host, sdkOwnerScanCommand(target, { lock }), { timeoutMs: 20000 })
      return parseSdkOwnerPids(result.stdout)
    } catch {
      return []
    }
  },

  /** Stop every process attached to this chat, optionally sparing one pid. */
  async reapSdkOwners(state, { keep = 0, quiet = false } = {}) {
    const sdk = state.sdk || this.sdkPaths(state)
    const owners = await this.sdkOwnerPids(state, sdk, { lock: true })
    const targets = owners.filter((pid) => pid !== keep)
    if (!targets.length) {
      if (sdk.watchdogFile) {
        await this.pool.exec(state.host, sdkReapCommand(sdk, [], 0), { timeoutMs: 15000 }).catch(() => {})
      }
      return []
    }
    if (!quiet) {
      this.log('warn', `bridge: stopping ${targets.length} stale sdk process(es) for ${state.localSessionId}: ${targets.join(', ')}`)
    }
    await this.pool.exec(state.host, sdkReapCommand(sdk, targets, keep), { timeoutMs: 20000 }).catch(() => {})
    return targets
  }
}
