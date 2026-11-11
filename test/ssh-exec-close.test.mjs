import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { SSHPool } from '../lib/ssh.js'

function poolWith(streamBehavior) {
  const pool = new SSHPool({
    knownHostsPath: '',
    saveKnownHosts: async () => {},
    log: () => {}
  })
  const channel = new EventEmitter()
  channel.stderr = new EventEmitter()
  channel.close = () => {}
  channel.destroy = () => {}
  pool.client = async () => ({
    exec(command, callback) {
      callback(null, channel)
      setImmediate(() => streamBehavior(channel))
    },
    destroy() {}
  })
  return pool
}

const host = { id: 'host-test', name: 'test', host: '127.0.0.1', port: 22, kind: 'ssh' }

test('a channel closed by the transport rejects instead of reporting success', async () => {
  const pool = poolWith((channel) => channel.emit('close', undefined))
  await assert.rejects(pool.exec(host, 'test -d /srv/app', { timeoutMs: 5000 }), (error) => {
    assert.equal(error.code, 'remote-connection-closed')
    return true
  })
})

test('a real exit status still resolves after close', async () => {
  const pool = poolWith((channel) => {
    channel.emit('data', Buffer.from('yes\n'))
    channel.emit('exit', 0)
    channel.emit('close', undefined)
  })
  const result = await pool.exec(host, 'test -d /srv/app && echo yes', { timeoutMs: 5000 })
  assert.equal(result.code, 0)
  assert.equal(result.stdout, 'yes\n')
})

test('a non-zero exit status is preserved', async () => {
  const pool = poolWith((channel) => {
    channel.emit('exit', 3)
    channel.emit('close', 3)
  })
  const result = await pool.exec(host, 'exit 3', { timeoutMs: 5000 })
  assert.equal(result.code, 3)
})
