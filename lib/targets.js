// Dispatches the plugin's transport calls to the right backend:
//   kind === 'ssh'    -> SSHPool   (ssh2)
//   kind === 'wsl'    -> WSLBackend (wsl.exe --exec bash -lc)
//   kind === 'docker' -> DockerBackend (docker exec -i ... sh -lc)
//
// The rest of the host half (RemoteManager, SessionBridge, routes) only ever
// talks to this facade, exactly like it used to talk to SSHPool directly.

import { DockerBackend, WSLBackend, isValidWslUser } from './local.js'

export function targetKind(host) {
  return host?.kind === 'wsl' || host?.kind === 'docker' ? host.kind : 'ssh'
}

/** ZCode `buildRemoteTargetTelemetryKey` equivalent. */
export function targetIdentity(host) {
  const kind = targetKind(host)
  if (kind === 'wsl') {
    return `wsl:${String(host.distro ?? '').trim().toLowerCase() || 'default'}\0${String(host.user ?? '').trim()}`
  }
  if (kind === 'docker') return `docker:${String(host.container ?? '').trim()}`
  return `ssh:${String(host.host ?? '').trim().toLowerCase()}:${Number(host.port) || 22}:${String(host.username ?? '').trim()}`
}

/** ZCode `isSameRemoteTarget` for saved devices. */
export function isSameTarget(left, right) {
  const leftKind = targetKind(left)
  if (leftKind !== targetKind(right)) return false
  if (leftKind === 'wsl') {
    return (String(left.distro ?? '').trim() || 'default') === (String(right.distro ?? '').trim() || 'default')
      && (String(left.user ?? '').trim()) === (String(right.user ?? '').trim())
  }
  if (leftKind === 'docker') return String(left.container ?? '').trim() === String(right.container ?? '').trim()
  return String(left.host ?? '').trim().toLowerCase() === String(right.host ?? '').trim().toLowerCase()
    && (Number(left.port) || 22) === (Number(right.port) || 22)
    && String(left.username ?? '').trim() === String(right.username ?? '').trim()
}

export function validateTarget(host) {
  const kind = targetKind(host)
  if (kind === 'wsl') {
    if (host.user && !isValidWslUser(host.user)) {
      throw new Error('Linux 用户名不能包含控制字符、冒号、斜杠或反斜杠，且长度不能超过 64 个字符。')
    }
    return
  }
  if (kind === 'docker') {
    if (!String(host.container ?? '').trim()) throw new Error('容器名或 ID 不能为空')
    return
  }
  if (!String(host.host ?? '').trim()) throw new Error('host is required')
  if (host.auth?.kind === 'key') {
    if (!String(host.auth.privateKeyPath ?? '').trim()) throw new Error('private key path is required')
  }
}

export class TargetPool {
  constructor({ sshPool, log = () => {} }) {
    this.ssh = sshPool
    this.log = log
    this.localById = new Map()
    this.localByIdentity = new Map()
    this.disposed = false
  }

  kind(host) {
    return targetKind(host)
  }

  backend(host) {
    const kind = targetKind(host)
    if (kind === 'ssh') return null
    const identity = targetIdentity(host)
    const idKey = host.id ? String(host.id) : ''
    const cached = (idKey && this.localById.get(idKey)) || this.localByIdentity.get(identity)
    if (cached) return cached
    const backend = kind === 'wsl'
      ? new WSLBackend({ distro: host.distro, user: host.user })
      : new DockerBackend({ container: host.container })
    if (idKey) this.localById.set(idKey, backend)
    this.localByIdentity.set(identity, backend)
    return backend
  }

  async exec(host, command, options = {}) {
    const backend = this.backend(host)
    if (!backend) return await this.ssh.exec(host, command, options)
    return await backend.exec(command, options)
  }

  /** Incremental exec used by the session bridge's live-turn tail. */
  async execStream(host, command, options = {}) {
    const backend = this.backend(host)
    if (!backend) return await this.ssh.execStream(host, command, options)
    return await backend.execStream(command, options)
  }

  async run(host, command, options = {}) {
    const backend = this.backend(host)
    if (!backend) return await this.ssh.run(host, command, options)
    return await backend.run(command, options)
  }

  async upload(host, localPath, remotePath, options = {}) {
    const backend = this.backend(host)
    if (!backend) return await this.ssh.upload(host, localPath, remotePath, options)
    return await backend.upload(localPath, remotePath)
  }

  async writeFile(host, remotePath, content, mode = 0o600) {
    const backend = this.backend(host)
    if (!backend) return await this.ssh.writeFile(host, remotePath, content, mode)
    return await backend.writeFile(remotePath, content, mode)
  }

  /** Directory listing for the embedded browser. */
  async listDirs(host, path) {
    const backend = this.backend(host)
    if (!backend) {
      const client = await this.ssh.client(host)
      const rows = await new Promise((resolvePromise, reject) => {
        client.sftp((error, sftp) => {
          if (error) {
            reject(error)
            return
          }
          sftp.readdir(path, (readError, list) => {
            sftp.end()
            if (readError) reject(readError)
            else resolvePromise(list || [])
          })
        })
      })
      return rows
        .filter((row) => row.filename !== '.' && row.filename !== '..')
        .map((row) => ({
          name: row.filename,
          dir: row.attrs?.isDirectory?.() === true,
          size: row.attrs?.size ?? null,
          mtime: row.attrs?.mtime ? new Date(row.attrs.mtime * 1000).toISOString() : null
        }))
    }
    return await backend.listDirs(path)
  }

  async probe(host) {
    const backend = this.backend(host)
    if (!backend) return await this.ssh.probe(host)
    const started = Date.now()
    try {
      await backend.resolveInfo()
      const latencyMs = Date.now() - started
      const platform = (await backend.execSimple('uname -s')).trim()
      const arch = (await backend.execSimple('uname -m')).trim()
      const home = (await backend.execSimple('printf %s "$HOME"')).trim()
      const nodePath = (await backend.execSimple('command -v node 2>/dev/null || true')).trim()
      const node = (await backend.execSimple('node -v 2>/dev/null || true')).trim()
      const distro = await backend.execSimple('printf %s "${WSL_DISTRO_NAME:-}"').catch(() => '')
      return {
        ok: true,
        latencyMs,
        platform,
        arch,
        home,
        nodePath,
        node,
        kind: backend.kind,
        distro: String(distro || '').trim()
      }
    } finally {
      try {
        backend.dispose()
      } catch {
        // ignore
      }
      for (const [key, value] of this.localById) {
        if (value === backend) this.localById.delete(key)
      }
      for (const [key, value] of this.localByIdentity) {
        if (value === backend) this.localByIdentity.delete(key)
      }
    }
  }

  closeHost(hostId) {
    this.ssh.closeHost(hostId)
    const backend = this.localById.get(String(hostId))
    if (backend) {
      this.localById.delete(String(hostId))
      for (const [key, value] of this.localByIdentity) {
        if (value === backend) this.localByIdentity.delete(key)
      }
      try {
        backend.dispose()
      } catch {
        // ignore
      }
    }
  }

  dispose() {
    this.disposed = true
    for (const backend of new Set([...this.localById.values(), ...this.localByIdentity.values()])) {
      try {
        backend.dispose()
      } catch {
        // ignore
      }
    }
    this.localById.clear()
    this.localByIdentity.clear()
    this.ssh.dispose()
  }
}
