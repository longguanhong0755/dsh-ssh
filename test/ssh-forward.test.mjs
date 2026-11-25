import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { ForwarderPool } from '../lib/ssh-forward.js'

async function echoServer() {
  const server = net.createServer((socket) => {
    socket.on('data', (chunk) => socket.write(chunk))
    socket.on('error', () => {})
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) }
}

function poolFor(targetPort, { fail = false } = {}) {
  return {
    forwarded: [],
    async forwardOut(host, dstPort) {
      this.forwarded.push({ host, dstPort })
      if (fail) throw new Error('channel open failure')
      const socket = net.connect(targetPort, '127.0.0.1')
      await new Promise((resolve, reject) => {
        socket.once('connect', resolve)
        socket.once('error', reject)
      })
      return socket
    }
  }
}

function roundTrip(port, text) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1')
    let answer = ''
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('timeout')) }, 4000)
    socket.on('connect', () => socket.write(text))
    socket.on('data', (chunk) => { answer += chunk.toString('utf8') })
    socket.on('end', () => { clearTimeout(timer); resolve(answer) })
    socket.on('error', (error) => { clearTimeout(timer); reject(error) })
    socket.on('data', () => {
      // The echo answers once; closing from here keeps the test deterministic.
      socket.end()
    })
  })
}

test('a fixed local port mirrors the remote port through the pool', async () => {
  const echo = await echoServer()
  const pool = poolFor(echo.port)
  const forwarder = new ForwarderPool({ pool })
  const host = { id: 'h1', name: 'dev', host: '10.0.0.9' }
  try {
    const first = await forwarder.ensure('w1', { host, remotePort: 45123, preferred: 0 })
    assert.ok(first.port >= 39180 && first.port <= 39380)
    assert.equal(await roundTrip(first.port, 'ping'), 'ping')
    // A second open keeps the same local port: the browser cookie is bound to
    // the authority, so a moving port would silently log the user out.
    const second = await forwarder.ensure('w1', { host, remotePort: 45123, preferred: first.port })
    assert.equal(second.port, first.port)
    // Reusing the mirror must not open a second channel.
    assert.equal(pool.forwarded.length, 1)
    assert.equal(pool.forwarded[0].dstPort, 45123)
  } finally {
    await forwarder.closeAll()
    await echo.close()
  }
})

test('a refused channel answers 502 instead of a silent reset', async () => {
  const pool = poolFor(0, { fail: true })
  const forwarder = new ForwarderPool({ pool })
  try {
    const entry = await forwarder.ensure('w2', { host: { id: 'h2', name: 'gone' }, remotePort: 45124, preferred: 0 })
    const response = await new Promise((resolve, reject) => {
      const socket = net.connect(entry.port, '127.0.0.1')
      let text = ''
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('timeout')) }, 4000)
      socket.on('data', (chunk) => { text += chunk.toString('utf8') })
      socket.on('close', () => { clearTimeout(timer); resolve(text) })
      socket.on('error', () => {})
    })
    assert.match(response, /502 Bad Gateway/u)
  } finally {
    await forwarder.closeAll()
  }
})

test('closing one mirror leaves the others running', async () => {
  const echo = await echoServer()
  const forwarder = new ForwarderPool({ pool: poolFor(echo.port) })
  try {
    const a = await forwarder.ensure('a', { host: { id: 'h1', name: 'dev' }, remotePort: 45123, preferred: 0 })
    const b = await forwarder.ensure('b', { host: { id: 'h1', name: 'dev' }, remotePort: 45123, preferred: 0 })
    assert.notEqual(a.port, b.port)
    assert.equal(await forwarder.close('a'), true)
    assert.equal(await forwarder.close('a'), false)
    assert.equal(forwarder.get('a'), null)
    assert.equal(forwarder.get('b').port, b.port)
    assert.equal(await roundTrip(b.port, 'still here'), 'still here')
  } finally {
    await forwarder.closeAll()
    await echo.close()
  }
})