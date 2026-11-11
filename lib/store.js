// Local persistence for hosts and remote workspaces. Everything lives under
// $DSH_HOME/ssh-remote and is written atomically with mode 0600 (passwords are
// part of a host record, exactly as ZCode's own dsh-ssh.json does).

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { nowIso, randomId, safeId } from './util.js'

const STORE_VERSION = 1

// The remote runtime must speak the same SDK JSON-RPC dialect as this build:
// the bridge forwards /compact through `session/query`, which shipped after
// 0.2.1-rc.5. Keep this on the desktop build's version.
const DEFAULT_DSH_VERSION = '0.2.2-rc.1'
// Only the exact old defaults migrate. A version the user chose deliberately
// (or a newer one) is left alone.
const LEGACY_DSH_VERSIONS = ['0.2.1-rc.5']

function emptyState() {
  return {
    version: STORE_VERSION,
    settings: {
      dshVersion: DEFAULT_DSH_VERSION,
      nodeVersion: '22.23.2',
      npmRegistry: 'https://registry.npmmirror.com',
      pollIntervalMs: 5000,
      syncCredentials: true,
      createIfMissing: true,
      bridgeEnabled: true,
      remotePermissionMode: 'danger-full-access',
      // ZCode "设为默认连接": the device preselected in project creation.
      defaultHostId: '',
      // ZCode 远程设备 → 偏好设置. `hideProjectDeviceNames` hides the device
      // suffix on task-list project rows; `startupAutoReconnect` reconnects
      // devices seen online in the last 7 days on the next app start.
      hideProjectDeviceNames: false,
      startupAutoReconnect: true,
      // Bundles installed here are not automatically present in the remote
      // profile. `off` skips the check, `check` (default) logs the drift, and
      // `apply` lets a start install it — the panel can always sync by hand.
      pluginSync: 'check'
    },
    hosts: [],
    workspaces: []
  }
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return fallback
  }
}

/**
 * Read state.json without hiding real failures. `readJson` above is for
 * best-effort legacy imports; losing the user's host/workspace list is not an
 * acceptable fallback. Only ENOENT means "new install".
 */
async function readStateFile(path) {
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { kind: 'missing' }
    throw error
  }
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { kind: 'corrupt', reason: 'state.json is not a JSON object' }
    }
    return { kind: 'ok', value }
  } catch (error) {
    return { kind: 'corrupt', reason: error?.message || 'invalid JSON' }
  }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temp, path)
  try {
    await chmod(path, 0o600)
  } catch {
    // Windows chmod is a no-op; the profile directory itself is user-private.
  }
}

/** Import a ZCode-style `~/.dsh/dsh-ssh.json` once, so the host list is not empty. */
async function importZCodeHosts(state) {
  // Persist the "already imported" fact: deleting every host must not make the
  // next start re-import machines the user deliberately removed.
  if (state.settings?.zcodeImportDone) return
  if (state.hosts.length > 0) {
    state.settings.zcodeImportDone = true
    return
  }
  const candidates = [
    join(process.env.ZCODE_HOME || '', 'dsh-ssh.json'),
    join(homedir(), '.dsh', 'dsh-ssh.json'),
    join(homedir(), '.zcode', 'dsh-ssh.json')
  ].filter((path) => path && existsSync(path))
  for (const path of candidates) {
    const legacy = await readJson(path, null)
    if (!legacy || !Array.isArray(legacy.hosts)) continue
    for (const row of legacy.hosts) {
      if (!row?.host) continue
      const auth = row.auth?.kind === 'password'
        ? { kind: 'password', password: String(row.auth.password ?? '') }
        : { kind: 'key', privateKeyPath: String(row.auth?.privateKeyPath ?? row.privateKeyPath ?? ''), passphrase: '' }
      state.hosts.push({
        id: randomId('host'),
        kind: 'ssh',
        name: String(row.alias || row.name || row.host),
        host: String(row.host),
        port: Number(row.port) || 22,
        username: String(row.user || row.username || 'root'),
        auth,
        hostKeyMode: 'accept-new',
        assetInstallMode: 'local-download-upload',
        defaultPath: String(row.workspace || '~'),
        source: 'zcode-import',
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    }
    if (state.hosts.length > 0) break
  }
  state.settings.zcodeImportDone = true
}

export class RemoteStore {
  constructor({ dshHome }) {
    this.root = join(dshHome, 'ssh-remote')
    this.statePath = join(this.root, 'state.json')
    this.state = emptyState()
    this.loaded = false
    this.loadError = null
    this.recoveredFrom = ''
    this.writeChain = Promise.resolve()
  }

  async load() {
    if (this.loaded) return this.state
    try {
      await mkdir(this.root, { recursive: true })
      const result = await readStateFile(this.statePath)
      if (result.kind === 'ok') {
        const loaded = result.value
        this.state = {
          ...emptyState(),
          ...loaded,
          settings: { ...emptyState().settings, ...(loaded.settings || {}) },
          hosts: Array.isArray(loaded.hosts) ? loaded.hosts : [],
          workspaces: Array.isArray(loaded.workspaces) ? loaded.workspaces : []
        }
      } else if (result.kind === 'corrupt') {
        // Keep the broken file as evidence instead of silently replacing it.
        const backup = `${this.statePath}.corrupt-${new Date().toISOString().replace(/[:.]/gu, '-')}`
        try {
          await rename(this.statePath, backup)
          this.recoveredFrom = backup
          console.warn(`[ssh-remote] state.json 无法解析（${result.reason}），已备份到 ${backup}`)
        } catch (error) {
          this.loadError = error
          throw new Error(`state.json 损坏且无法备份，已拒绝写入: ${error?.message || error}`)
        }
      }
      await importZCodeHosts(this.state)
      // Settings written by an older build pin the runtime the plugin used to
      // default to. That runtime predates command forwarding, so /compact on a
      // bridged chat could never reach the remote agent. Migrate only the old
      // default: an explicit version in settings is the user's choice.
      if (LEGACY_DSH_VERSIONS.includes(this.state.settings.dshVersion)) {
        console.log(`[ssh-remote] 远程 dsh 默认版本从 ${this.state.settings.dshVersion} 迁移到 ${DEFAULT_DSH_VERSION}`)
        this.state.settings.dshVersion = DEFAULT_DSH_VERSION
      }
      // Older builds cached the remote Web token for the console proxy. The
      // console feature is gone, so drop the secret from existing state files.
      for (const workspace of this.state.workspaces) {
        delete workspace.tokenUrl
        if (workspace.lastStatus) delete workspace.lastStatus.tokenUrl
      }
      this.loaded = true
      await this.save()
      return this.state
    } catch (error) {
      this.loadError = error
      throw error
    }
  }

  async save() {
    if (this.loadError) {
      throw new Error(`state.json 不可用，已拒绝覆盖: ${this.loadError?.message || this.loadError}`)
    }
    const snapshot = this.state
    this.writeChain = this.writeChain
      .catch(() => {})
      .then(() => writeJsonAtomic(this.statePath, snapshot))
    return this.writeChain
  }

  get settings() {
    return this.state.settings
  }

  get hosts() {
    return this.state.hosts
  }

  get workspaces() {
    return this.state.workspaces
  }

  host(id) {
    return this.state.hosts.find((row) => row.id === id) || null
  }

  workspace(id) {
    return this.state.workspaces.find((row) => row.id === id) || null
  }

  findWorkspace({ hostId, remotePath }) {
    return this.state.workspaces.find((row) => row.hostId === hostId && row.remotePath === remotePath) || null
  }

  async upsertHost(input) {
    const now = nowIso()
    const id = input.id || randomId('host')
    const existing = this.host(id)
    const kind = input.kind === 'wsl' || input.kind === 'docker' ? input.kind : 'ssh'
    const record = {
      id,
      kind,
      name: String(input.name || input.host || input.distro || input.container || id).trim(),
      host: String(input.host || '').trim(),
      port: Number(input.port) || 22,
      username: String(input.username || 'root').trim(),
      auth: {
        kind: input.auth?.kind === 'key' ? 'key' : 'password',
        password: input.auth?.kind === 'key' ? '' : String(input.auth?.password ?? existing?.auth?.password ?? ''),
        privateKeyPath: input.auth?.kind === 'key' ? String(input.auth?.privateKeyPath ?? '') : '',
        passphrase: input.auth?.kind === 'key' ? String(input.auth?.passphrase ?? existing?.auth?.passphrase ?? '') : ''
      },
      hostKeyMode: ['accept-new', 'verify', 'off'].includes(input.hostKeyMode) ? input.hostKeyMode : 'accept-new',
      assetInstallMode: ['local-download-upload', 'remote-download'].includes(input.assetInstallMode)
        ? input.assetInstallMode
        : (existing?.assetInstallMode || 'local-download-upload'),
      defaultPath: String(input.defaultPath || '~').trim() || '~',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      // Device metadata is discovered from the host, not edited in the form.
      // Keep it across edits and save cycles.
      deviceId: String(input.deviceId ?? existing?.deviceId ?? ''),
      hostname: String(input.hostname ?? existing?.hostname ?? ''),
      osUser: String(input.osUser ?? existing?.osUser ?? ''),
      runtimeVersion: String(input.runtimeVersion ?? existing?.runtimeVersion ?? ''),
      infoCheckedAt: String(input.infoCheckedAt ?? existing?.infoCheckedAt ?? ''),
      serviceState: input.serviceState || existing?.serviceState || 'running',
      serviceLogs: Array.isArray(input.serviceLogs)
        ? input.serviceLogs.slice(-60)
        : (Array.isArray(existing?.serviceLogs) ? existing.serviceLogs : []),
      stoppedAt: String(input.stoppedAt ?? existing?.stoppedAt ?? ''),
      disconnectedAt: String(input.disconnectedAt ?? existing?.disconnectedAt ?? ''),
      lastOnlineAt: String(input.lastOnlineAt ?? existing?.lastOnlineAt ?? '')
    }
    if (kind === 'wsl') {
      record.distro = String(input.distro || '').trim()
      record.user = String(input.user || '').trim()
      record.host = record.distro || 'WSL'
      record.username = record.user
    } else if (kind === 'docker') {
      record.container = String(input.container || '').trim()
      record.image = String(input.image || existing?.image || '').trim()
      record.host = record.container
      record.username = String(input.user || '').trim()
    }
    if (kind === 'ssh' && !record.host) throw new Error('host is required')
    if (kind === 'docker' && !record.container) throw new Error('容器名或 ID 不能为空')
    if (existing) {
      Object.assign(existing, record)
    } else {
      this.state.hosts.push(record)
    }
    await this.save()
    return record
  }

  async removeHost(id, { cascade = false } = {}) {
    const used = this.state.workspaces.filter((row) => row.hostId === id)
    if (used.length > 0 && !cascade) {
      throw new Error(`host still owns ${used.length} remote workspace(s); delete them first`)
    }
    if (cascade) {
      // ZCode 移除设备: drop this computer's connections, credentials and
      // project records. Remote services and project data are untouched.
      this.state.workspaces = this.state.workspaces.filter((row) => row.hostId !== id)
    }
    this.state.hosts = this.state.hosts.filter((row) => row.id !== id)
    if (this.state.settings?.defaultHostId === id) this.state.settings.defaultHostId = ''
    await this.save()
    return used
  }

  async patchHost(id, patch) {
    const host = this.host(id)
    if (!host) return null
    Object.assign(host, patch, { updatedAt: nowIso() })
    await this.save()
    return host
  }

  /** Ring of real device-level events shown by 查看最近日志 (newest last). */
  appendHostLog(host, level, message) {
    if (!host || !message) return
    const list = Array.isArray(host.serviceLogs) ? host.serviceLogs : []
    list.push({ timestamp: nowIso(), level: level === 'error' || level === 'warn' ? level : 'info', message: String(message).slice(0, 500) })
    host.serviceLogs = list.slice(-60)
  }

  async upsertWorkspace(input) {
    const now = nowIso()
    const id = input.id || randomId('ws')
    const existing = this.workspace(id)
    const record = {
      ...(existing || {}),
      ...input,
      id,
      name: String(input.name || existing?.name || `remote-${safeId(input.remotePath)}`).trim(),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    }
    if (existing) Object.assign(existing, record)
    else this.state.workspaces.push(record)
    await this.save()
    return record
  }

  async patchWorkspace(id, patch) {
    const record = this.workspace(id)
    if (!record) return null
    Object.assign(record, patch, { updatedAt: nowIso() })
    await this.save()
    return record
  }

  async removeWorkspace(id) {
    this.state.workspaces = this.state.workspaces.filter((row) => row.id !== id)
    await this.save()
  }
}
