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

function makePool(tag) {
  return new SSHPool({
    knownHostsPath: join(tmpdir(), `dsh-ssh-timeout-${tag}-${process.pid}.json`),
    saveKnownHosts: async () => {},
    log: () => {}
  })
}

test('a handshake dropped after the server banner rejects instead of hanging', async () => {
  const server = await fakeServer({ banner: true })
  const pool = makePool('banner')
  try {
    const started = Date.now()
    await assert.rejects(
      pool.client(hostFor(server.port), { timeoutMs: 5000 }),
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
      pool.client(hostFor(server.port), { timeoutMs: 300 }),
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
      pool.exec(hostFor(server.port), 'printf ok', { timeoutMs: 10000, connectTimeoutMs: 300 }),
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
