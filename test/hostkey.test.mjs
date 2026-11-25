import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SSHPool } from '../lib/ssh.js'

function poolWith(knownHosts) {
  const saved = []
  const pool = new SSHPool({
    knownHostsPath: join(tmpdir(), 'dsh-ssh-remote-test', 'known_hosts.json'),
    saveKnownHosts: async (data) => { saved.push(JSON.parse(JSON.stringify(data))) }
  })
  pool.knownHosts = knownHosts
  return { pool, saved }
}

test('the learned fingerprint is reported per target', () => {
  const { pool } = poolWith({
    'example.com:22': { fingerprint: 'SHA256:abc', firstSeen: '2026-01-01T00:00:00.000Z' },
    'example.com:2222': { fingerprint: 'SHA256:def', firstSeen: '' }
  })
  assert.equal(pool.hostKeyFor({ host: 'example.com', port: 22 }).fingerprint, 'SHA256:abc')
  assert.equal(pool.hostKeyFor({ host: 'example.com', port: 2222 }).fingerprint, 'SHA256:def')
  // Port defaults to 22 when the record left it empty.
  assert.equal(pool.hostKeyFor({ host: 'example.com' }).fingerprint, 'SHA256:abc')
  assert.equal(pool.hostKeyFor({ host: 'unknown.example', port: 22 }), null)
})

test('forgetting one key leaves every other host alone and persists', async () => {
  const { pool, saved } = poolWith({
    'a.example:22': { fingerprint: 'SHA256:a' },
    'b.example:22': { fingerprint: 'SHA256:b' }
  })
  assert.equal(await pool.forgetHostKey({ id: 'host-a', host: 'a.example', port: 22 }), true)
  assert.equal(pool.hostKeyFor({ host: 'a.example', port: 22 }), null)
  assert.equal(pool.hostKeyFor({ host: 'b.example', port: 22 }).fingerprint, 'SHA256:b')
  assert.equal(saved.length, 1)
  assert.deepEqual(Object.keys(saved[0]), ['b.example:22'])
  // A second forget is a no-op and does not rewrite the file.
  assert.equal(await pool.forgetHostKey({ id: 'host-a', host: 'a.example', port: 22 }), false)
  assert.equal(saved.length, 1)
})