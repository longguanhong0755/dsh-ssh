// Live check for the remote install lock against real SSH hosts.
//
// Two desktops pointing at the same host share `~/.dsh-remote/runtime`, so an
// install must be serialized remotely, and the loser must receive ZCode's
// `source-server-update-in-progress` semantics instead of corrupting the tree.
// This harness proves the shell protocol (`mkdir` -> holder -> `rm -rf`) on the
// host itself, using a throwaway runtime root so the deployed runtime is never
// touched:
//
//   acquire -> contend -> release -> stale takeover -> concurrent race
//
//   node scripts/e2e-lock.mjs --hosts home130
//   node scripts/e2e-lock.mjs --hosts home130,home132 --verbose
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { RemoteStore } from '../lib/store.js'
import { SSHPool } from '../lib/ssh.js'
import { TargetPool } from '../lib/targets.js'
import { RemoteManager } from '../lib/remote.js'
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
const outRoot = resolve(String(args.get('out') || join(repo, '..', 'analysis', 'e2e-lock', stamp)))
const sourceHome = String(args.get('dsh-home') || process.env.DSH_HOME || join(homedir(), '.dsh'))
const tempHome = join(outRoot, 'home')
const wantedHosts = String(args.get('hosts') || 'home130').split(',').map((name) => name.trim()).filter(Boolean)
const verbose = args.has('verbose')
const version = 'lock-e2e'

const results = []
const failures = []

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

function note(host, name, outcome, detail = '') {
  results.push({ host: host.name, step: name, outcome, detail })
  const tag = outcome === 'PASS' ? 'PASS' : outcome === 'FAIL' ? 'FAIL' : 'INFO'
  console.log(`[${tag}] ${host.name} ${name}${detail ? ` ${detail}` : ''}`)
}

async function step(host, name, fn) {
  const started = Date.now()
  try {
    const detail = await fn()
    note(host, name, 'PASS', `${((Date.now() - started) / 1000).toFixed(1)}s${detail ? ` ${detail}` : ''}`)
    return { ok: true, value: detail }
  } catch (error) {
    note(host, name, 'FAIL', error?.message || String(error))
    failures.push({ host: host.name, step: name, error: error?.message || String(error) })
    return { ok: false, error }
  }
}

function expectTypedError(error) {
  if (error?.code !== 'source-server-update-in-progress') throw new Error(`code=${error?.code} (wanted source-server-update-in-progress)`)
  if (error?.message !== '远程设备正在更新远端服务') throw new Error(`message=${error?.message}`)
  if (error?.reason !== '这次连接没有发起。等更新完成后点击重试。') throw new Error(`reason=${error?.reason}`)
  return error
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

async function makeManager() {
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
  const pool = new TargetPool({ sshPool })
  const manager = new RemoteManager({ dshHome: tempHome, pool, store, log: (level, message) => {
    if (verbose || level === 'error') console.log(`[manager:${level}] ${message}`)
  } })
  return { store, pool, manager }
}

async function runHost(host, pool, manager) {
  // Throwaway runtime root per run: the deployed `~/.dsh-remote/runtime` is
  // never part of this test.
  const runtimeRoot = `/root/dsh-lock-e2e-${stamp}`
  const lockDir = `${runtimeRoot}/install.lock`
  let firstLock = null
  const readHolder = async () => (await pool.exec(host, `cat ${q(`${lockDir}/holder`)} 2>/dev/null || true`, { timeoutMs: 20000 })).stdout.trim()

  await step(host, 'cleanup-old', async () => {
    await pool.exec(host, `rm -rf ${q(runtimeRoot)}`, { timeoutMs: 20000 })
    return runtimeRoot
  })

  const first = await step(host, 'acquire', async () => {
    firstLock = await manager.acquireInstallLock(host, runtimeRoot, version)
    const entry = manager.installing.get(host.id)
    if (entry?.version !== version) throw new Error(`installing map missing version (${entry?.version})`)
    const holder = await readHolder()
    if (!holder.includes(`version=${version}`)) throw new Error(`holder=${JSON.stringify(holder)}`)
    // The lock directory must exist on the host itself, not just in memory.
    const probe = await pool.exec(host, `test -d ${q(lockDir)} && echo dir-present || echo dir-gone`, { timeoutMs: 20000 })
    if (!probe.stdout.includes('dir-present')) throw new Error('lock dir absent on host')
    return holder.replace(/\n/gu, ' ')
  })
  if (!first.ok) return

  await step(host, 'contend', async () => {
    try {
      await manager.acquireInstallLock(host, runtimeRoot, '0.3.0')
    } catch (error) {
      const typed = expectTypedError(error)
      if (typed.hostVersion !== version) throw new Error(`hostVersion=${typed.hostVersion}`)
      if (!(typed.ageSec >= 0)) throw new Error(`ageSec=${typed.ageSec}`)
      return `code=${typed.code} age=${typed.ageSec}s hostVersion=${typed.hostVersion}`
    }
    throw new Error('a second acquire succeeded while the first was held')
  })

  await step(host, 'release', async () => {
    await firstLock.release()
    if (manager.installing.has(host.id)) throw new Error('installing map still holds the host')
    const probe = await pool.exec(host, `test -d ${q(lockDir)} && echo dir-present || echo dir-gone`, { timeoutMs: 20000 })
    if (!probe.stdout.includes('dir-gone')) throw new Error('lock dir survived release')
    return 'map cleared, dir removed'
  })

  await step(host, 'stale takeover', async () => {
    // A crashed desktop leaves the holder behind; after 30 minutes the next
    // client may take it over instead of blocking forever.
    await pool.exec(host, [
      `mkdir -p ${q(lockDir)}`,
      `printf 'started=%s\\nversion=%s\\n' "$(( $(date +%s) - 4000 ))" lock-e2e > ${q(`${lockDir}/holder`)}`
    ].join('\n'), { timeoutMs: 20000 })
    const lock = await manager.acquireInstallLock(host, runtimeRoot, version)
    const holder = await readHolder()
    if (!holder.includes(`version=${version}`)) throw new Error(`holder after takeover=${JSON.stringify(holder)}`)
    await lock.release()
    return 'stale holder replaced'
  })

  await step(host, 'concurrent race', async () => {
    // Two desktops clicking install at the same instant: exactly one winner,
    // the other must receive the typed error. Both use the same manager here,
    // which is fine because the guard is the remote mkdir, not local state.
    const attempts = await Promise.allSettled([
      manager.acquireInstallLock(host, runtimeRoot, '0.3.0'),
      manager.acquireInstallLock(host, runtimeRoot, '0.3.0')
    ])
    const winners = attempts.filter((item) => item.status === 'fulfilled')
    const losers = attempts.filter((item) => item.status === 'rejected')
    if (winners.length !== 1) throw new Error(`winners=${winners.length} (wanted exactly 1)`)
    if (losers.length !== 1) throw new Error(`losers=${losers.length} (wanted exactly 1)`)
    expectTypedError(losers[0].reason)
    await winners[0].value.release()
    if (manager.installing.has(host.id)) throw new Error('installing map still holds the host')
    return 'one winner, one typed rejection'
  })

  await step(host, 'cleanup', async () => {
    await pool.exec(host, `rm -rf ${q(runtimeRoot)}`, { timeoutMs: 20000 })
    return 'removed'
  })
}

async function main() {
  await mkdir(outRoot, { recursive: true })
  const hosts = await cloneHosts()
  const { pool, manager } = await makeManager()
  try {
    for (const host of hosts) {
      await step(host, 'connect', async () => {
        const result = await pool.exec(host, 'uname -s; id -un', { timeoutMs: 30000 })
        if (!result.stdout.includes('Linux')) throw new Error(`unexpected uname: ${result.stdout.trim()}`)
        return result.stdout.trim().replace(/\n/gu, ' / ')
      })
      if (failures.some((item) => item.host === host.name && item.step === 'connect')) continue
      await runHost(host, pool, manager)
    }
  } finally {
    for (const host of hosts) {
      try {
        pool.closeHost(host.id)
      } catch {
        // Already gone.
      }
    }
    await writeFile(join(outRoot, 'summary.json'), `${JSON.stringify({ stamp, results, failures }, null, 2)}\n`, 'utf8')
    console.log(`\n${failures.length ? 'FAILED' : 'OK'}: ${results.length} steps, ${failures.length} failure(s); logs in ${outRoot}`)
    if (failures.length) process.exitCode = 1
  }
  // Unused here but kept symmetrical with the other harnesses for debugging.
  void sleep
}

await main()
