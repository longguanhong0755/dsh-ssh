import test from 'node:test'
import assert from 'node:assert/strict'
import { ViewService } from '../lib/view.js'

const BANNER = 'dsh web: http://127.0.0.1:45123/?token=old-token'

function harness({ log = '', status = { active: true, httpStatus: '200' }, hostExtra = {} } = {}) {
  const calls = { start: 0, restart: 0, patches: [], logs: 0 }
  let currentLog = log
  const host = { id: 'h1', name: 'dev', host: '10.0.0.9', port: 22, ...hostExtra }
  const workspace = { id: 'w1', name: 'api', hostId: 'h1', port: 45123, viewPort: 0 }
  const manager = {
    async logs() { calls.logs += 1; return currentLog },
    async status() { return status },
    async startWorkspace() { calls.start += 1; return status },
    async restartWorkspace() {
      calls.restart += 1
      currentLog = `${currentLog}\ndsh web: http://127.0.0.1:45123/?token=new-token`
      return status
    }
  }
  const store = {
    host: (id) => (id === host.id ? host : null),
    workspace: (id) => (id === workspace.id ? workspace : null),
    async patchWorkspace(id, patch) { calls.patches.push({ id, patch }); Object.assign(workspace, patch); return workspace }
  }
  const forwarder = {
    entries: new Map(),
    async ensure(id, options) {
      const port = options.preferred || 39180
      const entry = { port, remotePort: options.remotePort }
      this.entries.set(id, entry)
      return entry
    },
    get: (id) => this.entries.get(id) || null,
    async close(id) { return this.entries.delete(id) }
  }
  const service = new ViewService({ manager, pool: {}, store, forwarder, log: () => {} })
  return { service, calls, workspace, forwarder, manager }
}

test('the launch URL comes from the last banner in the log', async () => {
  const { service } = harness({
    log: [
      '[info] booting',
      'dsh web: http://127.0.0.1:45123/?token=first',
      '[info] reloading plugins',
      '\u001b[32mdsh web: http://127.0.0.1:45123/?token=second\u001b[0m'
    ].join('\n')
  })
  assert.equal(await service.launchUrlOf({ id: 'h1' }, {}), 'http://127.0.0.1:45123/?token=second')
})

test('a missing banner restarts the service once', async () => {
  const { service, calls } = harness({ log: 'nothing useful here' })
  assert.equal(await service.launchUrlOf({ id: 'h1' }, {}), '')
  const url = await service.restartForUrl({ id: 'h1' }, {})
  assert.match(url, /token=new-token$/u)
  assert.equal(calls.restart, 1)
})

test('opening keeps the token but swaps the authority for the fixed local port', async () => {
  const { service, calls, workspace } = harness({ log: BANNER })
  service.introspect = async (url) => ({ ok: true, status: 200, url })
  const result = await service.open('w1')
  assert.equal(result.url, 'http://127.0.0.1:39180/?token=old-token')
  assert.equal(result.port, 39180)
  assert.equal(result.remotePort, 45123)
  assert.deepEqual(calls.patches, [{ id: 'w1', patch: { viewPort: 39180 } }])
  assert.equal(workspace.viewPort, 39180)
  assert.equal(calls.restart, 0)
  assert.equal(calls.start, 0)
})

test('a stopped workspace is started before the mirror is created', async () => {
  const { service, calls } = harness({ log: BANNER, status: { active: false, httpStatus: '' } })
  let probes = 0
  service.introspect = async () => ({ ok: true, status: 200 })
  service.healthy = async () => { probes += 1; return probes > 1 }
  const result = await service.open('w1')
  assert.equal(calls.start, 1)
  assert.match(result.url, /token=old-token/u)
})

test('a stale token triggers one restart and the new URL is used', async () => {
  const { service, calls } = harness({ log: BANNER })
  const seen = []
  service.introspect = async (url) => {
    seen.push(url)
    return { ok: seen.length > 1, status: seen.length > 1 ? 200 : 401 }
  }
  const result = await service.open('w1')
  assert.equal(calls.restart, 1)
  assert.match(result.url, /token=new-token/u)
  assert.equal(seen.length, 2)
})

test('an unreachable target reports a coded failure and closes the mirror', async () => {
  const { service, forwarder } = harness({ log: BANNER })
  service.introspect = async () => ({ ok: false, status: 0 })
  await assert.rejects(service.open('w1'), (error) => error.code === 'view-target-offline')
  assert.equal(forwarder.entries.size, 0)
})

test('a WSL workspace opens its own loopback without a mirror', async () => {
  const { service, forwarder } = harness({ log: BANNER, hostExtra: { kind: 'wsl', distro: 'Ubuntu' } })
  service.introspect = async () => ({ ok: true, status: 200 })
  const result = await service.open('w1')
  // The workspace port, not a local mirror port, and no channel was created.
  assert.equal(result.port, 45123)
  assert.equal(result.url, 'http://127.0.0.1:45123/?token=old-token')
  assert.equal(forwarder.entries.size, 0)
})

test('a Docker workspace explains that its port must be published', async () => {
  const { service } = harness({ log: BANNER, hostExtra: { kind: 'docker', container: 'dsh' } })
  await assert.rejects(service.open('w1'), (error) => error.code === 'view-docker-port-unpublished'
    && /发布/u.test(error.message))
})