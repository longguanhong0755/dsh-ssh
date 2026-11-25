// Regression coverage for the Desktop carrier adapter.
//
// `connectionRoute()` is the only code that survives both carriers (`webServer`
// in the browser, `connection.fetch` in the desktop app), so it reaches for names
// that live in other modules: `MAX_BODY_BYTES` from ./routes/support.js and
// `Readable` from node:stream. That distance is exactly how the `Readable`
// import went missing when routes.js was split into lib/routes/*: the adapter
// kept calling `Readable.from` while the import stayed behind. With it missing,
// every desktop API call rejected and the client only showed a plain HTTP 400.
// These tests drive the adapter with real Request objects, so a dangling
// identifier fails here with its own error instead of a blank 400 in the app.

import test from 'node:test'
import assert from 'node:assert/strict'
import { connectionRoute } from '../lib/routes.js'
import { MAX_BODY_BYTES } from '../lib/routes/support.js'

const PATH = '/ssh-remote/x'

// connectionRoute() only reads `path` and `handler`; the real carrier object
// carries the rest (methods, requestBody), so a bare route is enough here.
function adapter(handler) {
  return connectionRoute({ path: PATH, handler })
}

async function drain(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

// A route that hangs would otherwise stall the whole run without naming the
// test that hung, so every fetch is raced against a deadline.
function within(promise, ms = 2000) {
  let timer
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`route did not settle within ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function get() {
  return new Request(`http://host${PATH}?q=1`, { method: 'GET' })
}

test('the handler sees req.method and the path+query, not the full url', async () => {
  let seen
  const route = adapter(async (req, res) => {
    seen = { method: req.method, url: req.url }
    res.end('ok')
  })
  const response = await within(route.fetch(get()))
  assert.equal(seen.method, 'GET')
  assert.equal(seen.url, '/ssh-remote/x?q=1')
  assert.equal(await response.text(), 'ok')
})

test('a POST body is readable from req and arrives byte-identical', async () => {
  const payload = Buffer.from(JSON.stringify({ a: 1 }), 'utf8')
  let received
  const route = adapter(async (req, res) => {
    received = await drain(req)
    res.end('{}')
  })
  await within(route.fetch(new Request(`http://host${PATH}`, { method: 'POST', body: payload })))
  assert.ok(received.equals(payload), 'the adapter must not re-encode the body')
  assert.deepEqual(JSON.parse(received.toString('utf8')), { a: 1 })
})

test('a GET with no body leaves req empty and the route settles', async () => {
  let length = -1
  const route = adapter(async (req, res) => {
    length = (await drain(req)).length
    res.end('empty')
  })
  const response = await within(route.fetch(new Request(`http://host${PATH}`, { method: 'GET' })))
  assert.equal(length, 0, 'a bodyless request must still end its stream')
  assert.equal(await response.text(), 'empty')
})

test('statusCode, setHeader and end() become the returned Response', async () => {
  const route = adapter(async (req, res) => {
    res.statusCode = 201
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('x-trace', 'carrier')
    res.end(JSON.stringify({ ok: true }))
  })
  const response = await within(route.fetch(get()))
  assert.equal(response.status, 201)
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.equal(response.headers.get('x-trace'), 'carrier')
  assert.deepEqual(await response.json(), { ok: true })
})

test('a handler that throws rejects fetch() with its own error', async () => {
  const route = adapter(async () => {
    throw new Error('handler exploded')
  })
  await assert.rejects(within(route.fetch(get())), /handler exploded/u)
})

test('a handler that never calls end() rejects as an unfinished response', async () => {
  const route = adapter(async () => {})
  await assert.rejects(within(route.fetch(get())), /route handler did not finish its response/u)
})

test('a body over MAX_BODY_BYTES answers 413 and never reaches the handler', async () => {
  let called = false
  const route = adapter(async (req, res) => {
    called = true
    res.end('{}')
  })
  const body = new Uint8Array(MAX_BODY_BYTES + 1)
  const response = await within(route.fetch(new Request(`http://host${PATH}`, { method: 'POST', body })))
  assert.equal(response.status, 413)
  assert.deepEqual(await response.json(), { ok: false, error: 'request body too large' })
  assert.equal(called, false)
})

test('the desktop route keeps the /api prefix and the verbs the route declares', () => {
  // Both carriers serve the same route table: the app mounts it under /api and
  // the web server mounts it at the root. If the adapter kept its own verb list,
  // a route the browser serves would silently 404 in the app.
  const route = connectionRoute({ path: PATH, methods: ['DELETE'], handler: async (req, res) => res.end('') })
  assert.equal(route.path, '/api/ssh-remote/x')
  assert.deepEqual(route.methods, ['DELETE'])
  assert.equal(route.requestBody, 'buffered')
  assert.deepEqual(adapter(async (req, res) => res.end('')).methods, ['GET', 'POST'], 'no declared verbs falls back to the two the plugin uses')
})