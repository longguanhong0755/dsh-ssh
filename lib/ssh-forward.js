// Local loopback bridges into a remote dsh Web server.
//
// The remote dsh binds 127.0.0.1 only, and its browser session is an
// authority-bound cookie. Exposing it therefore means a *fixed* local port
// forwarding straight into the remote loopback port through the existing
// pooled SSH connection — no second ssh process, no remote reconfiguration.

import net from 'node:net'

/** Port range for local mirrors; kept away from the remote workspace range. */
const LOCAL_PORT_RANGE = [39180, 39380]

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.removeListener('error', onError)
      resolve(server.address().port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}

async function canBind(port) {
  const probe = net.createServer()
  try {
    await listen(probe, port)
    return true
  } catch {
    return false
  } finally {
    probe.close()
  }
}

export class ForwarderPool {
  constructor({ pool, log = () => {} }) {
    this.pool = pool
    this.log = log
    // workspaceId -> { server, port, host, remotePort, sockets:Set }
    this.entries = new Map()
    this.pending = new Map()
  }

  get(workspaceId) {
    return this.entries.get(String(workspaceId)) || null
  }

  /**
   * Start (or reuse) the local mirror for one workspace and answer its port.
   * `preferred` is the workspace's remembered port; when it is taken the next
   * free port in the range is used and the caller persists the new one.
   */
  async ensure(workspaceId, { host, remotePort, preferred = 0 }) {
    const key = String(workspaceId)
    const existing = this.entries.get(key)
    if (existing && existing.remotePort === Number(remotePort)) return existing
    if (this.pending.has(key)) return this.pending.get(key)
    const promise = (async () => {
      if (existing) await this.close(key)
      let port = 0
      if (Number(preferred) > 1024 && await canBind(Number(preferred))) {
        port = Number(preferred)
      } else {
        for (let candidate = LOCAL_PORT_RANGE[0]; candidate <= LOCAL_PORT_RANGE[1]; candidate += 1) {
          if (await canBind(candidate)) {
            port = candidate
            break
          }
        }
        if (!port) throw new Error(`本机转发端口 ${LOCAL_PORT_RANGE[0]}-${LOCAL_PORT_RANGE[1]} 都被占用`)
      }
      if (!port) throw new Error('本机没有可用的转发端口')
      const entry = { server: null, port, host, remotePort: Number(remotePort), sockets: new Set() }
      const server = net.createServer((socket) => void this.bridge(key, socket, entry))
      server.on('error', (error) => this.log('warn', `[ssh-remote:view] 本地转发端口 ${port} 出错: ${error?.message || error}`))
      const bound = await listen(server, port)
      entry.port = bound
      entry.server = server
      this.entries.set(key, entry)
      this.log('info', `[ssh-remote:view] 127.0.0.1:${bound} -> ${host.name || host.host}:${remotePort}`)
      return entry
    })()
    this.pending.set(key, promise)
    try {
      return await promise
    } finally {
      this.pending.delete(key)
    }
  }

  async bridge(key, socket, entry) {
    socket.setNoDelay(true)
    let channel = null
    try {
      channel = await this.pool.forwardOut(entry.host, entry.remotePort)
    } catch (error) {
      this.log('warn', `[ssh-remote:view] 建立转发通道失败: ${error?.message || error}`)
      // Answer with a minimal page instead of a silent reset: the browser tab
      // the user just opened explains itself.
      socket.end('HTTP/1.1 502 Bad Gateway\r\ncontent-type: text/plain; charset=utf-8\r\nconnection: close\r\n\r\n远程 DSH 暂时不可达，请回到设备页检查连接。\n')
      return
    }
    entry.sockets.add(socket)
    entry.sockets.add(channel)
    const teardown = () => {
      entry.sockets.delete(socket)
      entry.sockets.delete(channel)
      socket.destroy()
      try { channel.destroy() } catch { /* already closed */ }
    }
    socket.on('error', teardown)
    channel.on('error', teardown)
    socket.on('close', () => {
      entry.sockets.delete(socket)
      try { channel.end() } catch { /* already closed */ }
    })
    channel.on('close', () => {
      entry.sockets.delete(channel)
      socket.destroy()
    })
    socket.pipe(channel)
    channel.pipe(socket)
  }

  async close(workspaceId) {
    const key = String(workspaceId)
    const entry = this.entries.get(key)
    if (!entry) return false
    this.entries.delete(key)
    for (const stream of entry.sockets) {
      try { stream.destroy() } catch { /* already closed */ }
    }
    await new Promise((resolve) => entry.server.close(resolve))
    return true
  }

  async closeAll() {
    await Promise.all([...this.entries.keys()].map((key) => this.close(key)))
  }
}