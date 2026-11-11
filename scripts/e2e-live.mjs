// Live stability harness for real SSH hosts.
//
// Drives the plugin's own classes (SSH pool -> RemoteManager), not the desktop
// UI, so a run exercises exactly the code under test and never touches the
// hosts/workspaces saved in the user's `~/.dsh`. Each run gets a throwaway DSH
// home (with cloned host records and no workspaces) and a unique remote
// directory, then walks one workspace through its whole lifecycle:
//
//   connect -> create -> 5x probe -> stop -> start -> restart -> logs -> remove
//
// Every step records its wall time, the status snapshot and the remote log tail
// under `analysis/e2e/<stamp>/<host>/`, and a failing step still runs cleanup.
//
//   node scripts/e2e-live.mjs --hosts home130,home132
//   node scripts/e2e-live.mjs --hosts home130 --parallel --keep
//
// `--keep` leaves the remote workspace in place for inspection (the summary
// prints the exact `systemctl` / `rm -rf` pair to clean it up).
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { RemoteStore } from '../lib/store.js'
import { SSHPool } from '../lib/ssh.js'
import { TargetPool } from '../lib/targets.js'
import { RemoteManager } from '../lib/remote.js'
import { buildHealth } from '../lib/health.js'
import { q } from '../lib/util.js'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Map()
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i]
  if (!arg.startsWith('--')) continue
  const next = process.argv[i + 1]
  args.set(arg.slice(2), next && !next.startsWith('--') ? next : true)
}

const stamp = new Date().toISOString().replace(/[:.]/gu, '-').replace('T', '_').slice(0, 19)
const outRoot = resolve(String(args.get('out') || join(repo, '..', 'analysis', 'e2e', stamp)))
const sourceHome = String(args.get('dsh-home') || process.env.DSH_HOME || join(homedir(), '.dsh'))
const tempHome = join(outRoot, 'home')
const wantedHosts = String(args.get('hosts') || 'home130,home132').split(',').map((name) => name.trim()).filter(Boolean)
const keep = args.has('keep')
const parallel = args.has('parallel')
const verbose = args.has('verbose')
const remoteBase = String(args.get('remote-base') || `/root/dsh-ssh-e2e-${stamp}`)

const startedAt = Date.now()
const results = []

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

function note(host, step, outcome, ms, detail = '') {
  results.push({ host: host.name, step, outcome, ms, detail })
  const tag = outcome === 'PASS' ? 'PASS' : outcome === 'FAIL' ? 'FAIL' : 'INFO'
  console.log(`[${tag}] ${host.name} ${step} ${(ms / 1000).toFixed(1)}s${detail ? ` ${detail}` : ''}`)
}

async function step(host, name, fn) {
  const started = Date.now()
  try {
    const detail = await fn()
    note(host, name, 'PASS', Date.now() - started, detail ? summarize(detail) : '')
    return { ok: true, value: detail }
  } catch (error) {
    note(host, name, 'FAIL', Date.now() - started, error?.message || String(error))
    return { ok: false, error }
  }
}

function summarize(value) {
  if (!value || typeof value !== 'object') return String(value ?? '')
  if (value.state) {
    return `state=${value.state} pid=${value.pid ?? '-'} http=${value.httpStatus} up=${value.uptimeSec ?? '-'}s` +
      (value.cpuPercent != null ? ` cpu=${value.cpuPercent}% rss=${Math.round((value.rssBytes || 0) / 1048576)}MB` : '')
  }
  if (value.workspace) return `id=${value.workspace.id} service=${value.workspace.serviceKind} port=${value.workspace.port}`
  if (typeof value.summary === 'string') return value.summary
  return JSON.stringify(value).slice(0, 160)
}

async function waitForState(host, manager, workspace, wanted, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await manager.status(host, workspace, { fresh: true, skipLog: true })
    if (wanted(last)) return last
    await sleep(1000)
  }
  throw new Error(`state never matched; last=${summarize(last)}`)
}

/** A status is sane when the PID is a plausible Linux pid and the probe agrees. */
function checkStatusShape(status, { expectRunning = true } = {}) {
  const problems = []
  if (expectRunning && status.state !== 'running') problems.push(`state=${status.state}`)
  if (status.pid != null && (!Number.isInteger(status.pid) || status.pid <= 0 || status.pid > 4194304)) {
    problems.push(`pid=${status.pid} is not a plausible Linux pid`)
  }
  if (expectRunning && status.pid == null) problems.push('pid missing while running')
  if (!/^\d{3}$/u.test(String(status.httpStatus))) problems.push(`httpStatus=${status.httpStatus}`)
  if (expectRunning && String(status.httpStatus).startsWith('5')) problems.push(`httpStatus=${status.httpStatus}`)
  if (status.uptimeSec != null && (!Number.isFinite(status.uptimeSec) || status.uptimeSec < 0 || status.uptimeSec > 10 * 365 * 86400)) {
    problems.push(`uptimeSec=${status.uptimeSec}`)
  }
  if (problems.length) throw new Error(problems.join('; '))
  return status
}

async function readState(home) {
  const store = new RemoteStore({ dshHome: home })
  await store.load()
  return store
}

async function cloneHosts() {
  const source = await readState(sourceHome)
  const chosen = source.hosts.filter((host) => wantedHosts.includes(host.name))
  const missing = wantedHosts.filter((name) => !chosen.some((host) => host.name === name))
  if (missing.length) throw new Error(`host(s) not found in ${sourceHome}: ${missing.join(', ')}`)
  await mkdir(join(tempHome, 'ssh-remote'), { recursive: true })
  const state = {
    version: 1,
    settings: { ...source.settings, pluginSync: 'off', startupAutoReconnect: false, pollIntervalMs: 5000 },
    // Keep the credentials (`auth`) but drop runtime noise from the user's app.
    hosts: chosen.map((host) => ({
      id: host.id,
      kind: host.kind,
      name: host.name,
      host: host.host,
      port: host.port,
      username: host.username,
      auth: host.auth,
      hostKeyMode: host.hostKeyMode,
      assetInstallMode: host.assetInstallMode,
      defaultPath: host.defaultPath,
      createdAt: host.createdAt,
      updatedAt: host.updatedAt
    })),
    workspaces: []
  }
  await writeFile(join(tempHome, 'ssh-remote', 'state.json'), `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  return chosen
}

async function makeManager(hostList) {
  const store = await readState(tempHome)
  const knownHostsPath = join(store.root, 'known_hosts.json')
  const sshPool = new SSHPool({
    knownHostsPath,
    log: (level, message) => {
      if (verbose) console.log(`[ssh:${level}] ${message}`)
    },
    saveKnownHosts: async (value) => {
      await mkdir(dirname(knownHostsPath), { recursive: true })
      await writeFile(knownHostsPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    }
  })
  const pool = new TargetPool({ sshPool, log: (level, message) => {
    if (verbose) console.log(`[pool:${level}] ${message}`)
  } })
  const manager = new RemoteManager({ dshHome: tempHome, pool, store, log: (level, message) => {
    if (verbose || level === 'error') console.log(`[manager:${level}] ${message}`)
  } })
  return { store, pool, manager }
}

async function saveStep(host, stepName, value) {
  const dir = join(outRoot, host.name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${stepName}.json`), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function runHost(host, manager, pool) {
  const logDir = join(outRoot, host.name)
  await mkdir(logDir, { recursive: true })
  const onLog = (line) => {
    if (verbose) console.log(`  ${line}`)
    ;(host._log ??= []).push(line)
  }
  const workspaceName = `e2e-${host.name}`
  const remotePath = `${remoteBase}-${host.name}`
  let workspace = null
  const keepRemote = () => {
    const cleanup = [
      workspace ? `systemctl stop ${workspace.unit} 2>/dev/null || true` : '',
      workspace ? `systemctl disable ${workspace.unit} 2>/dev/null || true` : '',
      workspace ? `rm -f /etc/systemd/system/${workspace.unit}.service` : '',
      'systemctl daemon-reload 2>/dev/null || true',
      workspace ? `rm -rf ${workspace.wsRoot}` : '',
      `rm -rf ${remotePath}`
    ].filter(Boolean).join('\n')
    console.log(`[INFO] ${host.name} kept for inspection:\n${cleanup}`)
  }

  // 1. connectivity: one SSH round trip that also proves the asset directory
  //    is reachable before any deploy work starts.
  const connect = await step(host, 'connect', async () => {
    const started = Date.now()
    const result = await pool.exec(host, 'uname -s; id -un; node -v 2>/dev/null || true', { timeoutMs: 30000 })
    if (!result.stdout.includes('Linux')) throw new Error(`unexpected uname: ${result.stdout.trim()}`)
    return { summary: `${result.stdout.trim().replace(/\n/gu, ' / ')} ${Date.now() - started}ms` }
  })
  if (!connect.ok) return

  try {
    // 2. create one workspace from scratch (runtime reuse, service install,
    //    credentials off, health wait inside create).
    const created = await step(host, 'create', async () => {
      const started = Date.now()
      workspace = await manager.create(host, {
        name: workspaceName,
        remotePath,
        createIfMissing: true,
        syncCredentials: false
      }, onLog)
      await saveStep(host, 'create', workspace)
      const status = checkStatusShape(await manager.status(host, workspace, { fresh: true, includeMetrics: true, skipLog: true }))
      await saveStep(host, 'create-status', status)
      return {
        workspace: { id: workspace.id, serviceKind: workspace.serviceKind, port: workspace.port, dshVersion: workspace.dshVersion },
        state: status.state, pid: status.pid, httpStatus: status.httpStatus, uptimeSec: status.uptimeSec,
        cpuPercent: status.cpuPercent, rssBytes: status.rssBytes, createMs: Date.now() - started
      }
    })
    if (!created.ok) return

    // 3. five back-to-back probes: the same pid, sane numbers every time.
    await step(host, 'probe x5', async () => {
      const seen = []
      for (let i = 0; i < 5; i += 1) {
        const status = checkStatusShape(await manager.status(host, workspace, { fresh: true, skipLog: true }))
        seen.push({ at: new Date().toISOString(), pid: status.pid, http: status.httpStatus, state: status.state, uptimeSec: status.uptimeSec })
        await sleep(900)
      }
      const pids = new Set(seen.map((item) => item.pid))
      if (pids.size !== 1) throw new Error(`pid changed across idle probes: ${[...pids].join(', ')}`)
      await saveStep(host, 'probe-x5', seen)
      return { summary: `pid=${seen[0].pid} stable, http=${seen.map((item) => item.http).join('/')}` }
    })

    // 3b. health self-check: the same report `/ssh-remote/health?deep=1`
    //     serves must see this workspace running, without a bridge session.
    await step(host, 'health', async () => {
      const report = await buildHealth({
        store: manager.store,
        bridge: null,
        ctx: null,
        pool,
        manager,
        deep: true,
        deepTimeoutMs: 20000
      })
      await saveStep(host, 'health', report)
      const runtime = report.checks.find((item) => item.id === 'runtime')
      const row = runtime?.workspaces?.find((item) => item.workspaceId === workspace.id)
      if (!row || row.state !== 'running') throw new Error(`health runtime row=${JSON.stringify(row)}`)
      if (!report.ok) throw new Error(`health not ok: ${JSON.stringify(report.checks.filter((item) => item.state === 'error'))}`)
      return { summary: `ok=${report.ok} checks=${report.checks.map((item) => item.state).join('/')} http=${row.httpStatus}` }
    })

    // 3c. batched status: one tagged exec must report the live workspace and a
    //     missing one in the same round trip, without confusing their sections.
    await step(host, 'status batch', async () => {
      const ghost = {
        id: `${workspace.id}-ghost`,
        name: 'ghost',
        serviceKind: workspace.serviceKind,
        pidFile: `${remotePath}/.no-such-ghost.pid`,
        port: workspace.port,
        desiredState: 'stopped',
        nodeBin: workspace.nodeBin
      }
      const [live, absent] = await manager.statusMany(host, [workspace, ghost], { fresh: true, skipLog: true })
      await saveStep(host, 'status-batch', [live, absent])
      if (live.state !== 'running') throw new Error(`live workspace state=${live.state}`)
      if (absent.state !== 'stopped') throw new Error(`absent workspace state=${absent.state}`)
      return { summary: `live=${live.state}/${live.httpStatus} absent=${absent.state}` }
    })

    // 4. connection drop: a command in flight must settle when the socket dies
    //    (an unsettled ssh2 close used to hang create forever), and the next
    //    probe must reconnect on its own.
    await step(host, 'ssh drop', async () => {
      const pending = pool.exec(host, 'sleep 6; echo done', { timeoutMs: 30000 })
        .then(() => 'resolved', () => 'rejected')
      await sleep(400)
      pool.closeHost(host.id)
      const settled = await Promise.race([
        pending,
        sleep(15000).then(() => 'hung')
      ])
      if (settled === 'hung') throw new Error('in-flight exec never settled after the connection closed')
      // It must also fail, not "succeed" with empty stdout: callers branch on
      // the output of `test -d` and port probes.
      if (settled !== 'rejected') throw new Error('in-flight exec resolved after the connection closed')
      const status = checkStatusShape(await manager.status(host, workspace, { fresh: true, skipLog: true }))
      return { summary: `in-flight ${settled}, reconnected pid=${status.pid}` }
    })

    // 5. stop: the probe must stop reporting a live pid.
    const stopped = await step(host, 'stop', async () => {
      await manager.stopWorkspace(host, workspace)
      const status = await waitForState(host, manager, workspace, (value) => value.state === 'stopped' || value.httpStatus === '000', 60000)
      if (status.active) throw new Error(`service still active after stop: ${summarize(status)}`)
      await saveStep(host, 'stop', status)
      return status
    })

    // 6. start again, on a new pid.
    const oldPid = created.value.pid
    const started = await step(host, 'start', async () => {
      const status = checkStatusShape(await manager.startWorkspace(host, workspace, { onLog }))
      if (status.pid === oldPid) throw new Error(`pid did not change across stop/start: ${status.pid}`)
      await saveStep(host, 'start', status)
      return status
    })

    // 7. restart: systemd/setsid must replace the process and come back healthy.
    await step(host, 'restart', async () => {
      const before = started.value?.pid
      const status = checkStatusShape(await manager.restartWorkspace(host, workspace, { onLog }))
      if (before && status.pid === before) throw new Error(`pid did not change across restart: ${status.pid}`)
      await saveStep(host, 'restart', status)
      return status
    })

    // 8. logs: a running service must have something to show in the panel.
    await step(host, 'logs', async () => {
      const text = await manager.logs(host, workspace, 40)
      if (!text.trim()) throw new Error('remote log tail is empty')
      await writeFile(join(logDir, 'logs.txt'), text, 'utf8')
      return { summary: `${text.split(/\r?\n/u).filter(Boolean).length} lines` }
    })

    // 9. plugin profile diff is informational: a fresh workspace home has no
    //    remote profile until first boot seeds it, and drift is not a
    //    stability failure here.
    if (args.has('plugins')) {
      await step(host, 'plugin-diff', async () => {
        const plan = await manager.planPluginSync(host, workspace)
        await saveStep(host, 'plugin-diff', plan)
        return { summary: `profiles=${(plan.profiles || []).length} changes=${(plan.changes || plan.diff || []).length ?? '?'}` }
      })
    }

    // 10. remove: the service unit and the workspace root go away; the project
    //    directory itself is intentionally preserved by the plugin.
    await step(host, 'remove', async () => {
      await manager.removeWorkspace(host, workspace, { onLog })
      const unit = workspace.unitPath || `/etc/systemd/system/${workspace.unit}.service`
      const probe = await pool.exec(host, [
        `test -e ${q(unit)} && echo unit-present || echo unit-gone`,
        `test -d ${q(workspace.wsRoot)} && echo root-present || echo root-gone`
      ].join('\n'), { timeoutMs: 20000 })
      if (probe.stdout.includes('unit-present')) throw new Error(`unit file still present: ${unit}`)
      if (probe.stdout.includes('root-present')) throw new Error(`workspace root still present: ${workspace.wsRoot}`)
      const listed = await manager.status(host, workspace, { fresh: true, skipLog: true }).catch(() => null)
      await saveStep(host, 'remove', { probe: probe.stdout, statusAfterRemove: listed })
      if (!keep) await pool.exec(host, `rm -rf ${q(remotePath)}`, { timeoutMs: 30000 }).catch(() => {})
      workspace = null
      return { summary: 'unit and workspace root removed' }
    })
  } finally {
    if (workspace) {
      const still = manager.store.workspaces.some((item) => item.id === workspace.id)
      if (!keep) {
        await manager.removeWorkspace(host, workspace, { onLog }).catch((error) => {
          console.log(`[INFO] ${host.name} cleanup remove failed: ${error.message}`)
        })
      } else if (still) keepRemote()
    }
    // A create that failed after making the directory (or before returning a
    // workspace) leaves nothing in the store to clean up; remove by path.
    if (!keep) await pool.exec(host, `rm -rf ${q(remotePath)}`, { timeoutMs: 30000 }).catch(() => {})
    if (host._log?.length) await writeFile(join(logDir, 'manager.log'), `${host._log.join('\n')}\n`, 'utf8')
  }
}

async function runParallel(hosts, manager, pool) {
  // Same-host concurrency: two creates race for ports and service slots. The
  // pool must multiplex two shell channels without cross-talk.
  const host = hosts[0]
  const made = []
  try {
    await step(host, 'parallel create x2', async () => {
      const inputs = [1, 2].map((index) => manager.create(host, {
        name: `e2e-par-${index}`,
        remotePath: `${remoteBase}-par-${index}`,
        createIfMissing: true,
        syncCredentials: false
      }, () => {}))
      const workspaces = await Promise.all(inputs)
      made.push(...workspaces)
      const statuses = await Promise.all(workspaces.map((workspace) => manager.status(host, workspace, { fresh: true, skipLog: true })))
      await saveStep(host, 'parallel-status', workspaces.map((workspace, index) => ({
        id: workspace.id,
        port: workspace.port,
        serviceKind: workspace.serviceKind,
        status: statuses[index]
      })))
      for (const status of statuses) checkStatusShape(status)
      const ports = new Set(workspaces.map((workspace) => workspace.port))
      if (ports.size !== workspaces.length) throw new Error(`port collision: ${[...ports].join(', ')}`)
      return { summary: `ports=${[...ports].join(',')} pids=${statuses.map((status) => status.pid).join(',')}` }
    })
  } finally {
    for (const workspace of made) {
      await manager.removeWorkspace(host, workspace, () => {}).catch(() => {})
    }
    // Also remove anything a failed create left behind before it returned.
    for (const index of [1, 2]) {
      await pool.exec(host, `rm -rf ${q(`${remoteBase}-par-${index}`)}`, { timeoutMs: 30000 }).catch(() => {})
    }
  }
}

async function main() {
  console.log(`e2e: ${stamp}`)
  console.log(`e2e: artifacts ${outRoot}`)
  console.log(`e2e: temp dsh home ${tempHome}`)
  const hosts = await cloneHosts()
  console.log(`e2e: hosts ${hosts.map((host) => host.name).join(', ')}`)
  const { manager, pool } = await makeManager(hosts)
  try {
    if (parallel) await runParallel(hosts, manager, pool)
    for (const host of hosts) {
      // One host at a time: the run must not hide a single-host regression
      // behind cross-host parallelism, and 130/132 share no state.
      await runHost(host, manager, pool)
    }
  } finally {
    // The pool keeps keepalive sockets and retry timers alive by design (the
    // app wants them); a one-shot harness must close them or Node never exits.
    pool.dispose()
    const report = {
      stamp,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      sourceHome,
      tempHome,
      remoteBase,
      keep,
      results,
      pass: results.filter((item) => item.outcome === 'PASS').length,
      fail: results.filter((item) => item.outcome === 'FAIL').length
    }
    await writeFile(join(outRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.log(`\ne2e: ${report.pass} passed, ${report.fail} failed in ${(report.elapsedMs / 1000).toFixed(1)}s`)
    console.log(`e2e: report ${join(outRoot, 'report.json')}`)
    if (report.fail) process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(`e2e fatal: ${error?.stack || error}`)
  process.exitCode = 1
})
