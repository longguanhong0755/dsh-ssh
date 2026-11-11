// Live bridge harness: real SSH host, real remote dsh, fake local agent.
//
// Creates a throwaway workspace on a dedicated host, syncs the local
// credentials so the remote can answer, then drives the SessionBridge the way a
// native chat does: first turn, follow-up, and a cancelled turn. The local DSH
// store is never written (a temp home with cloned host records is used) and the
// remote workspace is removed afterwards unless `--keep` is passed.
//
//   node scripts/e2e-bridge.mjs --host home130
//   node scripts/e2e-bridge.mjs --host home132 --cancel --out analysis/bridge
//
// It fails on an unanswered turn, a missing stream, a cancel that never closes
// the turn, or a second turn that cannot start.
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { RemoteStore } from '../lib/store.js'
import { SSHPool } from '../lib/ssh.js'
import { TargetPool } from '../lib/targets.js'
import { RemoteManager } from '../lib/remote.js'
import { SessionBridge } from '../lib/bridge.js'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Map()
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i]
  if (!arg.startsWith('--')) continue
  const next = process.argv[i + 1]
  args.set(arg.slice(2), next && !next.startsWith('--') ? next : true)
}

const stamp = new Date().toISOString().replace(/[:.]/gu, '-').replace('T', '_').slice(0, 19)
const outRoot = resolve(String(args.get('out') || join(repo, '..', 'analysis', 'e2e', `${stamp}-bridge`)))
const sourceHome = String(args.get('dsh-home') || process.env.DSH_HOME || join(homedir(), '.dsh'))
const tempHome = join(outRoot, 'home')
const hostName = String(args.get('host') || 'home130')
const keep = args.has('keep')
const wantCancel = args.has('cancel')
const prompt = String(args.get('prompt') || '请只回复两个字：你好')
const followUp = String(args.get('followup') || '再用一句话说明你收到了。')
const turnTimeoutMs = Number(args.get('turn-timeout') || 180000)

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

function textOf(content) {
  return (content || []).filter((block) => block.type === 'text').map((block) => block.text || '').join('')
}

async function prepareHome() {
  const source = new RemoteStore({ dshHome: sourceHome })
  await source.load()
  const host = source.hosts.find((row) => row.name === hostName)
  if (!host) throw new Error(`host not found in ${sourceHome}: ${hostName}`)
  await mkdir(join(tempHome, 'ssh-remote'), { recursive: true })
  const state = {
    version: 1,
    settings: { ...source.settings, pluginSync: 'off', startupAutoReconnect: false },
    hosts: [{
      id: host.id,
      kind: host.kind,
      name: host.name,
      host: host.host,
      port: host.port,
      username: host.username,
      auth: host.auth,
      hostKeyMode: host.hostKeyMode,
      assetInstallMode: host.assetInstallMode,
      defaultPath: host.defaultPath
    }],
    workspaces: []
  }
  await writeFile(join(tempHome, 'ssh-remote', 'state.json'), `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  const store = new RemoteStore({ dshHome: tempHome })
  await store.load()
  const knownHostsPath = join(store.root, 'known_hosts.json')
  const sshPool = new SSHPool({
    knownHostsPath,
    log: () => {},
    saveKnownHosts: async (value) => {
      await mkdir(dirname(knownHostsPath), { recursive: true })
      await writeFile(knownHostsPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    }
  })
  const pool = new TargetPool({ sshPool, log: () => {} })
  const manager = new RemoteManager({ dshHome: tempHome, pool, store, log: () => {} })
  return { host: store.host(host.id), store, pool, manager }
}

async function main() {
  console.log(`bridge e2e: ${stamp}`)
  console.log(`bridge e2e: artifacts ${outRoot}`)
  const { host, store, pool, manager } = await prepareHome()
  const workspace = await manager.create(host, {
    name: `e2e-bridge-${stamp}`,
    remotePath: `/root/dsh-ssh-e2e-${stamp}-bridge`,
    createIfMissing: true,
    syncCredentials: true
  }, (line) => { if (args.has('verbose')) console.log(`  ${line}`) })
  console.log(`bridge e2e: workspace ${workspace.id} pid=${workspace.lastStatus?.pid} port=${workspace.port}`)
  await writeFile(join(outRoot, 'workspace.json'), `${JSON.stringify(workspace, null, 2)}\n`, 'utf8')

  const events = []
  const frames = []
  const startedAt = Date.now()
  let seq = 0
  let firstChunkAt = null
  const agent = {
    session: {
      id: `e2e-${Date.now()}`,
      header: { cwd: workspace.nativePath || workspace.remotePath },
      append(type, data) {
        const event = { type, data, seq: seq++ }
        events.push(event)
        if (type === 'turn/end') console.log(`[+${Date.now() - startedAt}ms] turn/end ${JSON.stringify(data?.reason || '')}`)
        return event
      }
    },
    // The bridge resolves the route from the anchor's live AgentModel first;
    // a bare fake agent must carry the same shape the native picker writes.
    model: {
      current: () => ({ provider: 'lingxi', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' })
    },
    dispatch: {
      emit(name, payload) {
        if (name !== 'agent/assistant-stream') return
        const frame = payload?.frame
        if (!frame) return
        frames.push(frame)
        if (frame.type === 'chunk' && firstChunkAt === null) firstChunkAt = Date.now()
      }
    },
    followup() {},
    steer() {},
    cancel(payload) {
      this.lastCancel = payload
    },
    whenIdle() { return Promise.resolve() }
  }

  const bridge = new SessionBridge({
    pool,
    store,
    manager,
    // The real host has the desktop services. The harness only needs the
    // running profile so the bridge can copy the local `llm-pi-ai` provider
    // block into the remote profile (without it the remote rejects every
    // provider as unregistered).
    ctx: {
      emit() {},
      get(name) {
        if (name === 'profileContext') return { dir: join(sourceHome, 'profiles', 'desktop') }
        return undefined
      }
    },
    log: (level, message) => {
      if (args.has('verbose') || level === 'error' || level === 'warn') console.log(`[bridge:${level}] ${message}`)
    }
  })

  const results = []
  const record = (name, ok, detail) => {
    results.push({ name, ok, detail })
    console.log(`[${ok ? 'PASS' : 'FAIL'}] bridge ${name} ${detail}`)
  }

  async function waitTurn(label, expectedEvents) {
    const timeout = sleep(turnTimeoutMs).then(() => { throw new Error(`${label} timed out after ${turnTimeoutMs}ms`) })
    await Promise.race([agent.whenIdle(), timeout])
    const turnEvents = events.slice(expectedEvents)
    const ends = turnEvents.filter((event) => event.type === 'turn/end')
    if (!ends.length) throw new Error(`${label} produced no turn/end`)
    const failed = ends.find((event) => event.data?.reason?.kind === 'error')
    if (failed) throw new Error(`${label} ended in error: ${failed.data.reason.error?.message || JSON.stringify(failed.data.reason)}`)
    const text = turnEvents.filter((event) => event.type === 'assistant/message')
      .map((event) => textOf(event.data.message?.content))
      .join('')
    if (!text.trim()) throw new Error(`${label} produced no assistant text`)
    return { text: text.slice(0, 400), events: turnEvents.map((event) => event.type) }
  }

  try {
    await bridge.attach(agent, workspace)
    console.log(`bridge e2e: attached after ${Date.now() - startedAt}ms`)

    const before = events.length
    agent.followup({ content: [{ type: 'text', text: prompt }] })
    const first = await waitTurn('first turn', before)
    record('first turn', true, `${Date.now() - startedAt}ms first-chunk=${firstChunkAt == null ? '-' : firstChunkAt - startedAt}ms text=${JSON.stringify(first.text.slice(0, 30))}`)

    const second = events.length
    agent.followup({ content: [{ type: 'text', text: followUp }] })
    const follow = await waitTurn('follow-up', second)
    record('follow-up', true, `text=${JSON.stringify(follow.text.slice(0, 30))}`)

    if (args.has('queue')) {
      // Two followups submitted together must be queued, not interleaved or
      // silently dropped: the bridge serializes turns per session.
      const queuedAt = events.length
      const queuedStarted = Date.now()
      agent.followup({ content: [{ type: 'text', text: '回复数字一。' }] })
      agent.followup({ content: [{ type: 'text', text: '回复数字二。' }] })
      const deadline = Date.now() + turnTimeoutMs
      let ends = []
      while (Date.now() < deadline) {
        ends = events.slice(queuedAt).filter((event) => event.type === 'turn/end')
        if (ends.length >= 2) break
        await sleep(500)
      }
      if (ends.length < 2) throw new Error(`queued turns: expected 2 turn/end, saw ${ends.length}`)
      const error = ends.find((event) => event.data?.reason?.kind === 'error')
      if (error) throw new Error(`queued turn ended in error: ${error.data.reason.error?.message || JSON.stringify(error.data.reason)}`)
      record('queued turns', true, `2 turns completed, ${Date.now() - queuedStarted}ms`)
    }

    if (args.has('drop')) {
      // Drop the SSH transport while the remote agent is answering. The tail
      // reconnects; the turn must still finish (or fail cleanly), never hang.
      const dropAt = events.length
      agent.followup({ content: [{ type: 'text', text: '请用三句话介绍你自己。' }] })
      await sleep(Number(args.get('drop-after') || 2500))
      pool.closeHost(host.id)
      const dropped = Date.now()
      const samples = []
      const sampler = setInterval(() => {
        const live = bridge.sessions.get(String(agent.session.id))
        if (!live) return
        samples.push({
          at: Date.now() - dropped,
          running: live.running,
          polling: live.polling,
          final: live.final,
          offset: live.offset,
          deadPolls: live.deadPolls,
          hasTimer: Boolean(live.timer),
          buffer: live.buffer?.length,
          generation: live.generation
        })
      }, 3000)
      try {
        const result = await waitTurn('turn after ssh drop', dropAt)
        record('ssh drop during turn', true, `${Date.now() - dropped}ms after drop, text=${JSON.stringify(result.text.slice(0, 30))}`)
      } finally {
        clearInterval(sampler)
        await writeFile(join(outRoot, 'poll-trace.json'), `${JSON.stringify(samples, null, 2)}\n`, 'utf8').catch(() => {})
      }
    }

    if (wantCancel) {
      const cancelStart = events.length
      agent.followup({ content: [{ type: 'text', text: '请从1数到500，每个数字单独一行。' }] })
      await sleep(Number(args.get('cancel-after') || 5000))
      agent.cancel({ kind: 'user' })
      const cancelledAt = Date.now()
      const deadline = Date.now() + 60000
      let end = null
      while (Date.now() < deadline) {
        end = events.slice(cancelStart).find((event) => event.type === 'turn/end')
        if (end) break
        await sleep(500)
      }
      if (!end) throw new Error('cancelled turn never produced turn/end')
      if (end.data?.reason?.kind === 'error') {
        throw new Error(`cancelled turn ended in error: ${end.data.reason.error?.message || JSON.stringify(end.data.reason)}`)
      }
      record('cancel closes the turn', true, `${Date.now() - cancelledAt}ms reason=${JSON.stringify(end.data?.reason || '')}`)
    }

    await writeFile(join(outRoot, 'events.json'), `${JSON.stringify({ events, frames }, null, 2)}\n`, 'utf8')
    const turns = events.filter((event) => event.type === 'turn/end').length
    const expectedTurns = 2 + (args.has('queue') ? 2 : 0) + (args.has('drop') ? 1 : 0) + (wantCancel ? 1 : 0)
    if (turns < expectedTurns) throw new Error(`expected ${expectedTurns} finished turns, saw ${turns}`)
  } catch (error) {
    const sessionState = bridge.sessions.get(String(agent.session.id))
    const snapshot = sessionState ? {
      running: sessionState.running,
      polling: sessionState.polling,
      final: sessionState.final,
      cancelled: sessionState.cancelled,
      offset: sessionState.offset,
      bufferBytes: sessionState.buffer?.length,
      byteBufferBytes: sessionState.byteBuffer?.length,
      deadPolls: sessionState.deadPolls,
      hasTimer: Boolean(sessionState.timer),
      hasStream: Boolean(sessionState.stream),
      hasSdk: Boolean(sessionState.sdk),
      remoteSessionId: sessionState.remoteSessionId,
      eventsFile: sessionState.eventsFile,
      stderrFile: sessionState.stderrFile
    } : null
    console.log(`[INFO] session state at failure: ${JSON.stringify(snapshot)}`)
    // The workspace is about to be removed: keep the remote evidence that
    // explains why the turn never ended.
    let remote = null
    if (snapshot) {
      const command = [
        `stat -c 'size=%s mtime=%y' ${snapshot.eventsFile} 2>/dev/null || echo no-events`,
        `echo @@OUT@@; tail -c 4000 ${snapshot.eventsFile} 2>/dev/null || true`,
        `echo @@ERR@@; tail -100 ${snapshot.stderrFile} 2>/dev/null || true`,
        `echo @@PID@@; cat ${snapshot.pidFile || `${dirname(snapshot.eventsFile)}/runner.pid`} 2>/dev/null || true`
      ].join('\n')
      remote = await pool.exec(host, command, { timeoutMs: 30000 }).then((r) => r.stdout).catch((e) => `probe failed: ${e.message}`)
      console.log(`[INFO] remote tail:\n${remote.slice(-1500)}`)
    }
    record('run', false, error?.message || String(error))
    await writeFile(join(outRoot, 'events.json'), `${JSON.stringify({ events, frames, error: error?.message, sessionState: snapshot, remote }, null, 2)}\n`, 'utf8').catch(() => {})
    process.exitCode = 1
  } finally {
    bridge.dispose()
    if (!keep) {
      await manager.removeWorkspace(host, workspace, () => {}).catch((error) => {
        console.log(`[INFO] cleanup remove failed: ${error.message}`)
      })
      await pool.exec(host, `rm -rf ${workspace.remotePath}`, { timeoutMs: 30000 }).catch(() => {})
    } else {
      console.log(`[INFO] kept ${workspace.id} at ${workspace.remotePath} (unit ${workspace.unit})`)
    }
    await writeFile(join(outRoot, 'report.json'), `${JSON.stringify({
      stamp, host: hostName, workspaceId: workspace.id, results,
      failed: results.filter((item) => !item.ok).length,
      elapsedMs: Date.now() - startedAt
    }, null, 2)}\n`, 'utf8')
    pool.dispose()
    console.log(`bridge e2e: ${results.filter((item) => item.ok).length} passed, ${results.filter((item) => !item.ok).length} failed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
  }
}

main().catch((error) => {
  console.error(`bridge e2e fatal: ${error?.stack || error}`)
  process.exitCode = 1
})
