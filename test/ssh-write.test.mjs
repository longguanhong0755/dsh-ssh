import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SSHPool } from '../lib/ssh.js'

const host = { id: 'write-test', host: '127.0.0.1', port: 22, username: 'root', auth: { kind: 'password', password: 'x' } }

function makePool() {
  return new SSHPool({
    knownHostsPath: join(tmpdir(), `dsh-ssh-write-${process.pid}.json`),
    saveKnownHosts: async () => {},
    log: () => {}
  })
}

function workingSftp() {
  return {
    open(path, flags, callback) { callback(null, 1) },
    write(handle, buffer, offset, length, position, callback) { callback(null) },
    close(handle, callback) { callback(null) },
    chmod(path, mode, callback) { callback(null) },
    end() {}
  }
}

function healthyClient(state) {
  return {
    sftp(callback) {
      state.sftpCalls += 1
      callback(null, workingSftp())
    },
    destroy() { state.destroyed += 1 }
  }
}

// The exact live failure: ssh2 accepts the SFTP request but the server never
// answers (black-holed tunnel). The old code rejected after 30s yet kept the
// dead connection in the pool, so every retry — including the session start
// that wrote the profile — stalled the same way.
function stalledClient(state) {
  return {
    sftp() { state.sftpCalls += 1 },
    destroy() { state.destroyed += 1 }
  }
}

test('a stalled SFTP channel is dropped so the next attempt gets a fresh connection', async () => {
  const state = { sftpCalls: 0, destroyed: 0 }
  const pool = makePool()
  const clients = [stalledClient(state), healthyClient(state)]
  pool.client = async () => clients.shift()
  try {
    await pool.writeFile(host, '/root/.dsh-remote/package.json', '{"name":"x"}\n', 0o600, {
      openTimeoutMs: 60,
      timeoutMs: 2000
    })
    assert.equal(state.sftpCalls, 2, 'the write is retried exactly once')
    assert.equal(state.destroyed, 1, 'the wedged connection is destroyed, not reused')
  } finally {
    pool.dispose()
  }
})

test('two stalled attempts fail with a timeout instead of hanging forever', async () => {
  const state = { sftpCalls: 0, destroyed: 0 }
  const pool = makePool()
  pool.client = async () => stalledClient(state)
  try {
    const started = Date.now()
    await assert.rejects(
      pool.writeFile(host, '/root/.dsh-remote/package.json', '{}', 0o600, { openTimeoutMs: 60, timeoutMs: 2000 }),
      (error) => {
        assert.equal(error.code, 'remote-connection-timeout')
        assert.match(error.message, /SFTP 通道打开超时/u)
        return true
      }
    )
    assert.ok(Date.now() - started < 3000)
    assert.equal(state.sftpCalls, 2)
    assert.equal(state.destroyed, 2)
  } finally {
    pool.dispose()
  }
})

test('a real filesystem error is not retried', async () => {
  const state = { sftpCalls: 0, destroyed: 0 }
  const pool = makePool()
  const sftp = {
    open(path, flags, callback) {
      callback(Object.assign(new Error('permission denied'), { code: 'EACCES' }))
    },
    end() {}
  }
  pool.client = async () => ({ sftp(callback) { state.sftpCalls += 1; callback(null, sftp) }, destroy() { state.destroyed += 1 } })
  try {
    await assert.rejects(pool.writeFile(host, '/root/secret', '{}', 0o600, { openTimeoutMs: 500 }), /permission denied/u)
    assert.equal(state.sftpCalls, 1)
    assert.equal(state.destroyed, 0, 'a healthy connection survives a filesystem error')
  } finally {
    pool.dispose()
  }
})
