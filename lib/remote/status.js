// Workspace state derivation and RemoteManager status/log methods.
//
// Moved verbatim out of lib/remote.js (the bodies still use `this`) and assigned
// onto RemoteManager.prototype at the end of that module.

import { nowIso, q, stripAnsi } from '../util.js'
import { httpProbeCommand } from './shared.js'

// The remote dsh answers on 127.0.0.1; a 5xx means the process is up but the
// service is broken, while any 2xx/3xx/4xx proves it accepted the request.
export function deriveWorkspaceState({ active, httpStatus, desiredState, uptimeSec, subState } = {}) {
  const code = String(httpStatus ?? '000').replace(/[^0-9]/gu, '').slice(-3) || '000'
  let state = 'stopped'
  if (active) {
    if (code !== '000' && !code.startsWith('5')) state = 'running'
    else if (desiredState === 'running' && uptimeSec != null && uptimeSec < 90 && code === '000') state = 'starting'
    else state = 'error'
  } else if (desiredState === 'running') {
    state = 'error'
  }
  if (subState === 'failed') state = 'error'
  return state
}

export const statusMethods = {
  /**
   * Shell fragment that puts the real dsh pid in `$pid`: the pidfile is
   * authoritative for setsid runs, systemd's MainPID for services (a pidfile
   * left over from an earlier setsid deployment is ignored once it is dead).
   */
  pidCommand(workspace, { svcPrefix, systemctl, isSystemd }) {
    const lines = [`pid=$(cat ${q(workspace.pidFile)} 2>/dev/null || true)`]
    if (isSystemd) {
      lines.push(
        'if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then',
        `  pid=$(${svcPrefix}${systemctl}show ${q(workspace.unit)} --property=MainPID --value 2>/dev/null || true)`,
        'fi'
      )
    }
    lines.push('printf %s "${pid:-0}"')
    return lines.join('\n')
  },

  async status(host, workspace, options = {}) {
    // The sidebar refresh and the background poll often ask for the same
    // workspace at the same time; share one remote probe instead of queueing
    // two shell channels on the same host.
    const key = `${workspace.id}|${options.skipLog ? 'l' : 'f'}|${options.includeMetrics ? 'm' : 'n'}`
    const inflight = this.statusPromises.get(key)
    if (inflight) return inflight
    const promise = this.statusUncached(host, workspace, options)
    this.statusPromises.set(key, promise)
    try {
      return await promise
    } finally {
      if (this.statusPromises.get(key) === promise) this.statusPromises.delete(key)
    }
  },

  /**
   * Shell script that reports one workspace. `tag` suffixes every section
   * marker so several scripts can share one exec (see statusMany).
   */
  statusScript(workspace, { includeMetrics = false, skipLog = false, tag = '' } = {}) {
    const marker = (name) => `@@${name}${tag}@@`
    const isSystemd = workspace.serviceKind === 'systemd' || workspace.serviceKind === 'systemd-user'
    const svcPrefix = workspace.serviceKind === 'systemd-user'
      ? `export XDG_RUNTIME_DIR=\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}; export DBUS_SESSION_BUS_ADDRESS=\${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}; `
      : ''
    const systemctl = `systemctl ${workspace.serviceKind === 'systemd-user' ? '--user ' : ''}`
    const svcCommand = isSystemd
      ? `${svcPrefix}${systemctl}show ${q(workspace.unit)} --property=ActiveState,SubState,MainPID,NRestarts --no-pager 2>/dev/null || true`
      : [
          `pid=$(cat ${q(workspace.pidFile)} 2>/dev/null || true)`,
          'if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then',
          `  echo 'ActiveState=active'; echo 'SubState=running'; echo "MainPID=$pid"; echo 'NRestarts=0'`,
          'else',
          `  echo 'ActiveState=inactive'; echo 'SubState=dead'; echo 'MainPID=0'; echo 'NRestarts=0'`,
          'fi'
        ].join('\n')
    // Real per-process numbers, sampled from /proc. `ps -o pcpu` is a lifetime
    // average (a fresh server often reads 100%), so CPU is measured over 0.5s.
    const metricsCommand = [
      'if [ -n "$pid" ] && [ "$pid" != "0" ] && kill -0 "$pid" 2>/dev/null; then',
      '  clk=$(getconf CLK_TCK 2>/dev/null || echo 100)',
      `  t0=$(awk '{print $14 + $15}' "/proc/$pid/stat" 2>/dev/null || echo 0)`,
      '  sleep 0.5',
      `  t1=$(awk '{print $14 + $15}' "/proc/$pid/stat" 2>/dev/null || echo 0)`,
      `  cpu=$(awk -v a="$t0" -v b="$t1" -v c="$clk" 'BEGIN { printf "%.1f", (b - a) / c / 0.5 * 100 }')`,
      `  rss=$(awk '/^VmRSS:/ { print $2 }' "/proc/$pid/status" 2>/dev/null || true)`,
      `  [ -n "$rss" ] || rss=$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ' || true)`,
      `  etimes=$(ps -o etimes= -p "$pid" 2>/dev/null | tr -d ' ' || true)`,
      '  echo "cpu=$cpu"',
      '  echo "rssKb=$rss"',
      '  echo "etimes=$etimes"',
      'fi'
    ].join('\n')
    const script = [
      `echo '${marker('SVC')}'`,
      svcCommand,
      `echo '${marker('PID')}'`,
      this.pidCommand(workspace, { svcPrefix, systemctl, isSystemd }),
      // Age of the process, needed to tell "still binding its port" from
      // "running but not serving". /proc gives it without the 0.5 s CPU
      // sample, so the cheap status path can compute `starting` too.
      `echo '${marker('UPTIME')}'`,
      `if [ -n "$pid" ] && [ "$pid" != "0" ] && kill -0 "$pid" 2>/dev/null; then`,
      `  clk=$(getconf CLK_TCK 2>/dev/null || echo 100)`,
      `  start=$(awk '{print $22}' "/proc/$pid/stat" 2>/dev/null || echo 0)`,
      `  up=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0)`,
      `  [ "\${start:-0}" -gt 0 ] 2>/dev/null && printf 'uptime=%s\\n' $((up - start / clk)) || true`,
      `fi`,
      `echo '${marker('HTTP')}'`,
      `if [ -n "$pid" ] && [ "$pid" != "0" ] && kill -0 "$pid" 2>/dev/null; then`,
      httpProbeCommand(workspace.port, workspace.nodeBin).split('\n').map((line) => `  ${line}`).join('\n'),
      `else`,
      `  echo 000`,
      `fi`
    ]
    // CPU is a 0.5 s delta; only pay for it when the caller renders metrics.
    if (includeMetrics) script.push(`echo '${marker('METRICS')}'`, metricsCommand)
    // skipLog must skip the journalctl/tail round trip entirely, not fetch and
    // discard it: the background poll runs this for every workspace.
    if (!skipLog) script.push(`echo '${marker('LOG')}'`, this.logsCommand(workspace, 80))
    return script.filter(Boolean).join('\n')
  },

  /** Inverse of statusScript: one status object from its output. */
  parseStatusText(workspace, text, { includeMetrics = false, skipLog = false, tag = '' } = {}) {
    const marker = (name) => `@@${name}${tag}@@`
    const section = (name, next) => {
      const start = text.indexOf(marker(name))
      if (start < 0) return ''
      const from = start + marker(name).length
      const end = next ? text.indexOf(marker(next), from) : text.length
      return text.slice(from, end < 0 ? text.length : end).trim()
    }
    const svc = new Map(section('SVC', 'HTTP').split(/\r?\n/u).map((line) => {
      const index = line.indexOf('=')
      return index > 0 ? [line.slice(0, index), line.slice(index + 1)] : ['', '']
    }))
    const active = svc.get('ActiveState') === 'active'
    const restarts = svc.get('NRestarts') || ''
    const subState = svc.get('SubState') || ''
    // `pidCommand` deliberately prints no trailing newline (it is a shell
    // fragment shared by other callers), so the PID section must stop at the
    // UPTIME marker. Reading through HTTP swallowed the uptime digits and
    // produced impossible PIDs like 3996629338153.
    const pid = Number((section('PID', 'UPTIME') || '0').replace(/[^0-9]/gu, '')) || 0
    const quickUptime = Number((section('UPTIME', 'HTTP') || '').replace(/[^0-9]/gu, '')) || null
    // Always delimit the HTTP section: without the metrics section the log
    // tail would otherwise be read as part of the status code.
    const httpEnd = includeMetrics ? 'METRICS' : skipLog ? null : 'LOG'
    const httpStatus = ((section('HTTP', httpEnd).split(/\r?\n/u).pop() || '000').trim().slice(-3) || '000')
    const metrics = new Map(section('METRICS', 'LOG').split(/\r?\n/u).map((line) => {
      const index = line.indexOf('=')
      return index > 0 ? [line.slice(0, index), line.slice(index + 1)] : ['', '']
    }))
    const cpuPercent = metrics.has('cpu') ? Number(metrics.get('cpu')) : null
    const rssKb = Number(metrics.get('rssKb')) || 0
    const rssBytes = rssKb > 0 ? rssKb * 1024 : null
    const uptimeSec = metrics.has('etimes') ? Number(metrics.get('etimes')) || null : quickUptime
    const logTail = skipLog ? '' : section('LOG', null)
    const state = deriveWorkspaceState({
      active,
      httpStatus,
      desiredState: workspace.desiredState,
      uptimeSec,
      subState
    })
    return {
      id: workspace.id,
      state,
      active,
      pid: pid > 0 ? pid : null,
      restarts: restarts ? Number(restarts) : null,
      subState,
      httpStatus,
      uptimeSec,
      rssBytes,
      cpuPercent,
      logTail,
      serviceKind: workspace.serviceKind,
      port: workspace.port,
      checkedAt: nowIso()
    }
  },

  async statusUncached(host, workspace, { fresh = false, skipLog = false, includeMetrics = false } = {}) {
    const now = Date.now()
    if (!fresh && workspace.lastStatus && now - (workspace.lastStatusAt || 0) < 2500) return workspace.lastStatus
    const command = this.statusScript(workspace, { includeMetrics, skipLog })
    const result = await this.pool.exec(host, command, { timeoutMs: 30000 })
    const status = this.parseStatusText(workspace, stripAnsi(result.stdout), { includeMetrics, skipLog })
    workspace.lastStatus = status
    workspace.lastStatusAt = now
    return status
  },

  /** Workspace status marked unreachable, kept on the record for the sidebar. */
  unreachableStatus(workspace, error) {
    const status = {
      id: workspace.id,
      state: 'unreachable',
      active: false,
      pid: null,
      httpStatus: '000',
      error: error?.message || String(error),
      checkedAt: nowIso()
    }
    workspace.lastStatus = status
    workspace.lastStatusAt = Date.now()
    return status
  },

  /**
   * Status for every workspace on one host in a single exec.
   *
   * The background poll used to pay one shell channel per workspace; with a
   * handful of projects that dominated a 5 s cycle. Each workspace's sections
   * are tagged (`@@SVC:1@@`) so the same parser reads the combined output. A
   * host-level failure marks every workspace unreachable and returns, so one
   * dead device cannot abort the poll for the others.
   */
  async statusMany(host, workspaces, { fresh = false, includeMetrics = false, skipLog = true } = {}) {
    const list = [...workspaces]
    if (list.length === 0) return []
    const results = new Array(list.length)
    const pending = []
    const now = Date.now()
    list.forEach((workspace, index) => {
      if (!fresh && workspace.lastStatus && now - (workspace.lastStatusAt || 0) < 2500) {
        results[index] = workspace.lastStatus
      } else {
        pending.push({ workspace, index })
      }
    })
    if (pending.length === 0) return results
    if (pending.length === 1) {
      const { workspace, index } = pending[0]
      try {
        results[index] = await this.status(host, workspace, { fresh: true, skipLog, includeMetrics })
        await this.markHostConnected(host).catch(() => {})
      } catch (error) {
        results[index] = this.unreachableStatus(workspace, error)
        await this.markHostUnreachable(host, error).catch(() => {})
      }
      return results
    }
    const script = pending.map(({ workspace, index }) => [
      `echo '@@WSS:${index}@@'`,
      this.statusScript(workspace, { includeMetrics, skipLog, tag: `:${index}` }),
      `echo '@@WSE:${index}@@'`
    ].join('\n')).join('\n')
    const timeoutMs = Math.min(120000, 20000 + pending.length * 5000)
    let text = ''
    try {
      const result = await this.pool.exec(host, script, { timeoutMs })
      text = stripAnsi(result.stdout)
    } catch (error) {
      for (const { workspace, index } of pending) results[index] = this.unreachableStatus(workspace, error)
      await this.markHostUnreachable(host, error).catch(() => {})
      return results
    }
    for (const { workspace, index } of pending) {
      const start = text.indexOf(`@@WSS:${index}@@`)
      const end = text.indexOf(`@@WSE:${index}@@`, Math.max(0, start))
      const slice = start >= 0 ? text.slice(start, end < 0 ? text.length : end) : ''
      if (!slice.includes(`@@SVC:${index}@@`)) {
        results[index] = this.unreachableStatus(workspace, new Error('状态探针没有返回该工作区'))
        continue
      }
      const status = this.parseStatusText(workspace, slice, { includeMetrics, skipLog, tag: `:${index}` })
      workspace.lastStatus = status
      workspace.lastStatusAt = Date.now()
      results[index] = status
    }
    await this.markHostConnected(host).catch(() => {})
    return results
  },

  logsCommand(workspace, lines) {
    const count = Math.max(1, Math.min(2000, Number(lines) || 200))
    if (workspace.serviceKind === 'systemd') {
      return `journalctl -u ${q(workspace.unit)} -n ${count} --no-pager -o cat 2>/dev/null || true`
    }
    if (workspace.serviceKind === 'systemd-user') {
      return [
        `export XDG_RUNTIME_DIR=\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}`,
        `export DBUS_SESSION_BUS_ADDRESS=\${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}`,
        `journalctl --user -u ${q(workspace.unit)} -n ${count} --no-pager -o cat 2>/dev/null || true`
      ].join('; ')
    }
    return `tail -n ${count} ${q(workspace.logPath)} 2>/dev/null || true`
  },

  async logs(host, workspace, lines = 200) {
    const result = await this.pool.exec(host, this.logsCommand(workspace, lines), { timeoutMs: 20000 })
    return stripAnsi(result.stdout)
  }
}
