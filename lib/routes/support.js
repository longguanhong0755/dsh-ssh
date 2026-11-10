// Part of lib/routes.js. Route bodies moved verbatim; this module registers
// one group and shares the request helpers through ./support.js.

import { readdir, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { clampPollInterval, errorText, nowIso } from '../util.js'
import { isDockerAvailable, isWslAvailable, listDockerContainers, listWslDistros } from '../local.js'
import { validateTarget } from '../targets.js'
import { forgetNativeWorkspace, reconcileNativeWorkspaces, renameNativeWorkspace } from '../native.js'
import { SSH_TRANSPORT_REVISION } from '../ssh.js'

export const MAX_BODY_BYTES = 1024 * 1024

// Reported by GET /ssh-remote/bridge. The plugin runs from a junction to this
// checkout, so a reload cannot be observed from outside the process unless the
// served value names the code it is running: bump this with the bridge itself.
export const BRIDGE_REVISION = '2026-11-10 compact-probe'

// Reported by GET /ssh-remote/health; names the sidebar projection behaviour.
export const NATIVE_REVISION = '2026-11-10 anchor-reattach'

// Watchdogs for long jobs. Every remote command is bounded on its own, so
// these only catch a job that stops making progress for an unknown reason 鈥?// the dialog must never stay at 銆屾墽琛屼腑鈥︺€?forever.
export const RUNTIME_JOB_LIMITS = { timeoutMs: 60 * 60 * 1000, idleMs: 20 * 60 * 1000 }
export const WORKSPACE_JOB_LIMITS = { timeoutMs: 60 * 60 * 1000, idleMs: 20 * 60 * 1000 }

export async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) return {}
  return JSON.parse(text)
}

export function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

export function publicHost(host, { isDefault = false, lastOnlineAt = '', projectCount = 0 } = {}) {
  if (!host) return null
  const kind = host.kind === 'wsl' || host.kind === 'docker' ? host.kind : 'ssh'
  return {
    id: host.id,
    kind,
    name: host.name,
    host: host.host,
    port: host.port,
    username: host.username,
    distro: host.distro || '',
    user: host.user || '',
    container: host.container || '',
    image: host.image || '',
    auth: {
      kind: host.auth?.kind || 'password',
      hasPassword: Boolean(host.auth?.password),
      privateKeyPath: host.auth?.privateKeyPath || '',
      hasPassphrase: Boolean(host.auth?.passphrase)
    },
    hostKeyMode: host.hostKeyMode || 'accept-new',
    assetInstallMode: host.assetInstallMode || 'local-download-upload',
    defaultPath: host.defaultPath || '~',
    source: host.source || '',
    createdAt: host.createdAt,
    updatedAt: host.updatedAt,
    lastSuccessAt: host.lastSuccessAt || '',
    lastOnlineAt: lastOnlineAt || host.lastOnlineAt || '',
    isDefault,
    // ZCode expanded card metadata (`鐗堟湰/涓绘満鍚?绯荤粺鐢ㄦ埛/璁惧 ID`).
    deviceId: host.deviceId || host.id,
    hostname: host.hostname || '',
    osUser: host.osUser || '',
    runtimeVersion: host.runtimeVersion || '',
    serviceState: host.serviceState || 'running',
    stoppedAt: host.stoppedAt || '',
    disconnectedAt: host.disconnectedAt || '',
    // Live SSH reachability, refreshed by the background poll even when the
    // device has no projects yet.
    connState: host.connState || '',
    connCheckedAt: host.connCheckedAt || '',
    connError: host.connError || '',
    projectCount,
    logs: Array.isArray(host.serviceLogs) ? host.serviceLogs.slice(-20) : []
  }
}

export function publicWorkspace(workspace, { includeLog = false } = {}) {
  if (!workspace) return null
  const status = workspace.lastStatus ? { ...workspace.lastStatus } : null
  if (status) {
    if (!includeLog) delete status.logTail
    // The remote Web token is only needed by the (removed) console proxy.
    delete status.tokenUrl
  }
  return {
    id: workspace.id,
    name: workspace.name,
    hostId: workspace.hostId,
    targetKind: workspace.targetKind || 'ssh',
    targetPort: workspace.targetPort || 22,
    hostName: workspace.hostName,
    host: workspace.host,
    username: workspace.username,
    port: workspace.port,
    remotePath: workspace.remotePath,
    dshVersion: workspace.dshVersion,
    unit: workspace.unit,
    serviceKind: workspace.serviceKind,
    desiredState: workspace.desiredState,
    syncedCredentials: workspace.syncedCredentials,
    nativeWorkspaceId: workspace.nativeWorkspaceId || '',
    lastOpenedAt: workspace.lastOpenedAt || '',
    // ZCode's 缃《 survives restarts with the project entry.
    pinned: workspace.pinned === true,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    status
  }
}

export function expandLocal(input) {
  const text = String(input || '').trim()
  if (!text) return homedir()
  if (text === '~') return homedir()
  if (text.startsWith('~/') || text.startsWith('~\\')) return join(homedir(), text.slice(2))
  return resolve(text)
}

/**
 * Parse the local ~/.ssh/config Host blocks, mirroring ZCode's "浠?SSH config
 * 瀵煎叆": only concrete aliases (no wildcards/negations) are offered.
 */
export async function readSshConfig() {
  let text = ''
  try {
    text = await readFile(join(homedir(), '.ssh', 'config'), 'utf8')
  } catch {
    return []
  }
  const rows = []
  let current = null
  const flush = () => {
    if (current?.alias) rows.push(current)
    current = null
  }
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Za-z][A-Za-z0-9]*)\s+(.+)$/u)
    if (!match) continue
    const key = match[1].toLowerCase()
    const value = match[2].trim().replace(/^"(.*)"$/u, '$1')
    if (key === 'host') {
      flush()
      for (const alias of value.split(/\s+/u)) {
        if (!alias || /[*?!]/u.test(alias)) continue
        current = { alias, host: '', port: 22, username: '', privateKeyPath: '' }
        break
      }
    } else if (current) {
      if (key === 'hostname') current.host = value
      else if (key === 'port') current.port = Number(value) || 22
      else if (key === 'user') current.username = value
      else if (key === 'identityfile') current.privateKeyPath = value.replace(/^~(?=\/)/u, homedir())
    }
  }
  flush()
  return rows.map((row) => ({ ...row, host: row.host || row.alias }))
}

export async function localListing(input) {  const target = expandLocal(input)
  const rows = await readdir(target, { withFileTypes: true })
  const entries = rows
    .filter((row) => row.isDirectory())
    .map((row) => ({
      name: row.name,
      path: join(target, row.name),
      dir: true,
      hidden: row.name.startsWith('.')
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    path: target,
    home: homedir(),
    parent: dirname(target) === target ? null : dirname(target),
    entries
  }
}

/** Adapt one Node-style route handler to the Desktop/Web Fetch carrier. */

