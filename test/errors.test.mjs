import test from 'node:test'
import assert from 'node:assert/strict'
import { ERROR_CATALOG, classifyMessage, describeError, enrichFailure } from '../lib/errors.js'

test('every catalog entry carries a next step in both languages', () => {
  for (const [code, entry] of Object.entries(ERROR_CATALOG)) {
    assert.ok(entry.hint, `${code} has no hint`)
    assert.ok(entry.hintEn, `${code} has no English hint`)
    assert.equal(typeof entry.retryable, 'boolean', `${code} has no retryable flag`)
  }
})

test('a thrown code keeps its message and gains the hint', () => {
  const error = Object.assign(new Error('认证失败'), { code: 'remote-authentication-failed' })
  const described = describeError(error)
  assert.equal(described.message, '认证失败')
  assert.equal(described.retryable, true)
  assert.match(described.hint, /私钥|密码/u)
})

test('an uncoded failure is classified by its message', () => {
  assert.equal(classifyMessage('npm ERR! network timeout'), 'runtime-install-failed')
  assert.equal(classifyMessage('EACCES: permission denied'), 'runtime-permission')
  assert.equal(classifyMessage('connect ETIMEDOUT 10.0.0.1:22'), 'remote-connection-timeout')
  assert.equal(classifyMessage('something odd happened'), '')
})

test('enrichFailure adds code and hint to a plain failed payload', () => {
  const payload = enrichFailure({ ok: false, error: 'ENOSPC: no space left on device' })
  assert.equal(payload.code, 'runtime-disk-low')
  assert.match(payload.hint, /300 MB/u)
  assert.equal(payload.retryable, true)
  // Success payloads are untouched.
  const ok = { ok: true, hosts: [] }
  assert.equal(enrichFailure(ok), ok)
  assert.equal(ok.code, undefined)
})

test('an explicit code is never overwritten and unknown failures stay bare', () => {
  const explicit = enrichFailure({ ok: false, error: 'x', code: 'runtime-port-in-use' })
  assert.equal(explicit.code, 'runtime-port-in-use')
  assert.match(explicit.hint, /端口/u)
  const unknown = enrichFailure({ ok: false, error: 'weird' })
  assert.equal(unknown.code, undefined)
  assert.equal(unknown.hint, undefined)
})