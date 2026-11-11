import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SSHPool } from '../lib/ssh.js'

// A fake SSH endpoint. `banner` makes ssh2 believe the transport is a real
// server; the connection is then dropped during key exchange, which is the
// exact shape that used to leave `entry.ready` pending forever: ssh2 clears
// its own readyTimeout on close and emits no error once sawHeader is set.
async function fakeServer({ banner = false, drop = true } = {}) {
  const sockets = new Set()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.on('close', () => sockets.delete(socket))
    if (banner) socket.write('SSH-2.0-OpenSSH_9.6\r\n')
    socket.on('data', () => {})
    if (drop) setTimeout(() => socket.end(), 200)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: server.address().port,
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
    }
  }
}

function hostFor(port) {
  return {
    id: `test-${port}`,
    host: '127.0.0.1',
    port,
    username: 'root',
    auth: { kind: 'password', password: 'x' },
    hostKeyMode: 'off'
  }
}

function makePool(tag, logs = null) {
  return new SSHPool({
    knownHostsPath: join(tmpdir(), `dsh-ssh-timeout-${tag}-${process.pid}.json`),
    saveKnownHosts: async () => {},
    log: (level, message) => {
      logs?.push(`${level}: ${message}`)
    }
  })
}

// Anything listening is enough: the test only cares that the TCP connect moved
// past ECONNREFUSED, so the fake server never answers the handshake.
async function freePort() {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

test('a refused connection is retried before it fails the session start', async () => {
  const port = await freePort()
  const logs = []
  const pool = makePool('retry-refused', logs)
  try {
    const started = Date.now()
    await assert.rejects(
      pool.client(hostFor(port), { timeoutMs: 2000, attempts: 3 }),
      (error) => {
        assert.equal(error.code, 'remote-host-unreachable')
        return true
      }
    )
    const elapsed = Date.now() - started
    assert.ok(elapsed >= 1700, `expected ~1.8s of backoff before giving up, saw ${elapsed}ms`)
    assert.equal(logs.filter((line) => line.includes('retrying in')).length, 2)
  } finally {
    pool.dispose()
  }
})

test('a hop that comes back inside the backoff window connects on a later try', async () => {
  const port = await freePort()
  const logs = []
  const pool = makePool('retry-recover', logs)
  const sockets = new Set()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.on('close', () => sockets.delete(socket))
    socket.on('data', () => {})
  })
  const listening = new Promise((resolve) => {
    setTimeout(() => server.listen(port, '127.0.0.1', resolve), 250)
  })
  try {
    await assert.rejects(
      pool.client(hostFor(port), { timeoutMs: 250, attempts: 2 }),
      (error) => {
        // The retry got through the refused port and reached the handshake, so
        // the failure is the silent server's timeout, not ECONNREFUSED.
        assert.equal(error.code, 'remote-connection-timeout')
        return true
      }
    )
    assert.equal(logs.filter((line) => line.includes('retrying in')).length, 1)
  } finally {
    pool.dispose()
    await listening
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('an unresolvable host fails once instead of burning the retry budget', async () => {
  const logs = []
  const pool = makePool('retry-dns', logs)
  try {
    const started = Date.now()
    await assert.rejects(
      pool.client({ ...hostFor(22), host: 'dsh-ssh-no-such-host.invalid' }),
      (error) => {
        assert.equal(error.code, 'remote-host-not-found')
        return true
      }
    )
    assert.ok(Date.now() - started < 3000)
    assert.equal(logs.filter((line) => line.includes('retrying in')).length, 0)
  } finally {
    pool.dispose()
  }
})

test('a handshake dropped after the server banner rejects instead of hanging', async () => {
  const server = await fakeServer({ banner: true })
  const pool = makePool('banner')
  try {
    const started = Date.now()
    await assert.rejects(
      pool.client(hostFor(server.port), { timeoutMs: 5000, attempts: 1 }),
      (error) => {
        assert.equal(error.code, 'remote-connection-closed')
        assert.match(error.message, /握手完成前关闭/u)
        return true
      }
    )
    assert.ok(Date.now() - started < 3000, 'close must settle the pending handshake promptly')
  } finally {
    pool.dispose()
    await server.close()
  }
})

test('a silent server is bounded by the connect deadline', async () => {
  const server = await fakeServer({ drop: false })
  const pool = makePool('silent')
  try {
    const started = Date.now()
    await assert.rejects(
      pool.client(hostFor(server.port), { timeoutMs: 300, attempts: 1 }),
      (error) => {
        assert.equal(error.code, 'remote-connection-timeout')
        return true
      }
    )
    assert.ok(Date.now() - started < 3000)
  } finally {
    pool.dispose()
    await server.close()
  }
})

test('exec bounds connection setup too, not only the command', async () => {
  const server = await fakeServer({ drop: false })
  const pool = makePool('exec')
  try {
    const started = Date.now()
    await assert.rejects(
      pool.exec(hostFor(server.port), 'printf ok', { timeoutMs: 10000, connectTimeoutMs: 300, attempts: 1 }),
      (error) => {
        assert.equal(error.code, 'remote-connection-timeout')
        return true
      }
    )
    assert.ok(Date.now() - started < 3000)
  } finally {
    pool.dispose()
    await server.close()
  }
})

test('a keychain-only host without a readable secret explains the failure', async () => {
  const pool = makePool('keychain')
  const savedAgent = process.env.SSH_AUTH_SOCK
  delete process.env.SSH_AUTH_SOCK
  try {
    await assert.rejects(
      pool.connectConfig({ ...hostFor(22), auth: { kind: 'password', password: '', secretBackend: 'windows' } }),
      /系统凭据库/u
    )
    const config = await pool.connectConfig({
      ...hostFor(22),
      auth: { kind: 'password', password: 'x', secretBackend: 'windows' }
    })
    assert.equal(config.password, 'x')
  } finally {
    if (savedAgent !== undefined) process.env.SSH_AUTH_SOCK = savedAgent
    pool.dispose()
  }
})
