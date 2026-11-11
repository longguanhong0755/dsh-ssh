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

  async statusUncached(host, workspace, { fresh = false, skipLog = false, includeMetrics = false } = {}) {
    const now = Date.now()
    if (!fresh && workspace.lastStatus && now - (workspace.lastStatusAt || 0) < 2500) return workspace.lastStatus
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
      `echo '@@SVC@@'`,
      svcCommand,
      `echo '@@PID@@'`,
      this.pidCommand(workspace, { svcPrefix, systemctl, isSystemd }),
      // Age of the process, needed to tell "still binding its port" from
      // "running but not serving". /proc gives it without the 0.5 s CPU
      // sample, so the cheap status path can compute `starting` too.
      `echo '@@UPTIME@@'`,
      `if [ -n "$pid" ] && [ "$pid" != "0" ] && kill -0 "$pid" 2>/dev/null; then`,
      `  clk=$(getconf CLK_TCK 2>/dev/null || echo 100)`,
      `  start=$(awk '{print $22}' "/proc/$pid/stat" 2>/dev/null || echo 0)`,
      `  up=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0)`,
      `  [ "\${start:-0}" -gt 0 ] 2>/dev/null && printf 'uptime=%s\\n' $((up - start / clk)) || true`,
      `fi`,
      `echo '@@HTTP@@'`,
      `if [ -n "$pid" ] && [ "$pid" != "0" ] && kill -0 "$pid" 2>/dev/null; then`,
      httpProbeCommand(workspace.port, workspace.nodeBin).split('\n').map((line) => `  ${line}`).join('\n'),
      `else`,
      `  echo 000`,
      `fi`
    ]
    // CPU is a 0.5 s delta; only pay for it when the caller renders metrics.
    if (includeMetrics) script.push(`echo '@@METRICS@@'`, metricsCommand)
    // skipLog must skip the journalctl/tail round trip entirely, not fetch and
    // discard it: the background poll runs this for every workspace.
    if (!skipLog) script.push(`echo '@@LOG@@'`, this.logsCommand(workspace, 80))
    const command = script.filter(Boolean).join('\n')
    const result = await this.pool.exec(host, command, { timeoutMs: 30000 })
    const text = stripAnsi(result.stdout)
    const section = (name, next) => {
      const start = text.indexOf(`@@${name}@@`)
      if (start < 0) return ''
      const from = start + name.length + 4
      const end = next ? text.indexOf(`@@${next}@@`, from) : text.length
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
    const status = {
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
    workspace.lastStatus = status
    workspace.lastStatusAt = now
    return status
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
