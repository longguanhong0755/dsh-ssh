import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHostExtraRoutes } from '../lib/routes/hosts-extra.js'

// The wizard asks for environment checks before it saves a device, so the route
// has to accept an unsaved draft as well as a stored id.
function harness({ hosts = [], preflight = null } = {}) {
  const routes = new Map()
  const seen = { hosts: [], preflights: [] }
  const store = {
    settings: {},
    host: (id) => hosts.find((row) => row.id === id) || null,
    workspaces: []
  }
  const manager = {
    store,
    preflight: async (host) => {
      seen.preflights.push(host)
      return preflight || { ok: true, checks: [{ id: 'platform', state: 'ok', title: '操作系统' }] }
    }
  }
  registerHostExtraRoutes({
    route: (path, handler) => routes.set(path, handler),
    ctx: {},
    store,
    pool: {},
    manager,
    jobs: {},
    bridge: {},
    log: () => {}
  })
  seen.route = routes.get('/ssh-remote/hosts/preflight')
  return seen
}

function post(body) {
  return {
    method: 'POST',
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body), 'utf8')
    }
  }
}

function response() {
  const out = { status: 0, body: null }
  return {
    out,
    res: {
      set statusCode(value) { out.status = value },
      get statusCode() { return out.status },
      setHeader() {},
      end(text) { out.body = JSON.parse(text) }
    }
  }
}

test('a stored device is checked by id', async () => {
  const seen = harness({ hosts: [{ id: 'h1', name: 'dev-1' }] })
  const { out, res } = response()
  await seen.route(post({ hostId: 'h1' }), res)
  assert.equal(out.status, 200)
  assert.equal(out.body.ok, true)
  assert.equal(seen.preflights[0].id, 'h1')
  assert.equal(seen.preflights[0].name, 'dev-1')
})

test('an unsaved draft is checked without being stored', async () => {
  const seen = harness()
  const { out, res } = response()
  await seen.route(post({
    host: {
      kind: 'ssh',
      host: '192.168.3.9',
      port: 22,
      username: 'deploy',
      auth: { kind: 'password', password: 'x' }
    }
  }), res)
  assert.equal(out.status, 200)
  const draft = seen.preflights[0]
  assert.equal(draft.host, '192.168.3.9')
  assert.equal(draft.username, 'deploy')
  assert.ok(draft.id, 'draft needs a temporary id')
  assert.equal(seen.preflights.length, 1)
})

test('a draft for a saved device keeps the saved id and its stored fields', async () => {
  const seen = harness({ hosts: [{ id: 'h1', name: 'dev-1', host: '10.0.0.1', port: 22, username: 'root' }] })
  const { out, res } = response()
  await seen.route(post({ host: { id: 'h1', username: 'deploy', auth: { kind: 'key', privateKeyPath: '~/.ssh/id_ed25519' } } }), res)
  assert.equal(out.status, 200)
  assert.equal(seen.preflights[0].id, 'h1')
  assert.equal(seen.preflights[0].host, '10.0.0.1')
  assert.equal(seen.preflights[0].username, 'deploy')
})

test('nothing to check answers 400 with a code the client can translate', async () => {
  const seen = harness()
  const { out, res } = response()
  await seen.route(post({}), res)
  assert.equal(out.status, 400)
  assert.equal(out.body.ok, false)
  assert.ok(out.body.error)
})

test('a blocking check is returned verbatim, ok:false included', async () => {
  const blocked = {
    ok: false,
    checks: [{ id: 'disk', state: 'error', title: '剩余空间不足', titleEn: 'Not enough free space', hint: '清理', hintEn: 'Free space' }]
  }
  const seen = harness({ preflight: blocked })
  const { out, res } = response()
  await seen.route(post({ host: { kind: 'ssh', host: '1.2.3.4', port: 22, username: 'x' } }), res)
  // 200: the request worked; the verdict lives in `preflight.ok`.
  assert.equal(out.status, 200)
  assert.equal(out.body.preflight.ok, false)
  assert.equal(out.body.preflight.checks[0].titleEn, 'Not enough free space')
})