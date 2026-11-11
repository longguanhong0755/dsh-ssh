// RemoteManager methods: keep the remote DSH profiles on the same plugin set as
// the local one.
//
// A remote workspace is a full DSH install with its own profile directories
// (`<dshHome>/profiles/{headless,sdk,web}`). Each `package.json` there decides
// which bundles compose, and bundles are installed into that profile's own
// `node_modules` by dsh's own plugin manager (`dsh plugin --profile <name>
// install`, which drives pnpm). So a plugin added locally never reaches the
// remote until every profile is reconciled.
//
// `planPluginSync` only reads; `syncPlugins` writes with a backup per profile,
// installs through dsh itself, then proves (a) every new package resolves and
// (b) the profile still composes (`--dump-config`). Any failure restores every
// backup and reinstalls, so a bad registry entry can never leave a dead
// workspace.

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  PLUGIN_SYNC_REVISION,
  REMOTE_PROFILES,
  diffManifests,
  mergedManifest,
  parseManifest,
  pickSyncable,
  renderManifest
} from '../sync/plugins.js'
import { joinRemote, q } from '../util.js'
import { INSTALL_TIMEOUT_MS } from './shared.js'

const LOCAL_PROFILE_CANDIDATES = ['desktop', 'web', 'default']
const PNPM_VERSION = '9'
const DEFAULT_REGISTRY = 'https://registry.npmjs.org'

function stamp() {
  return new Date().toISOString().replace(/[-:.TZ]/gu, '').slice(0, 14)
}

/** Last `count` non-empty lines of remote output, joined for the panel. */
function tailOf(text, count = 4) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-count)
    .join(' | ')
}

/** Shell preamble every remote dsh invocation needs. */
function runtimeEnv(workspace, registry) {
  const lines = [`export PATH=${q(dirname(workspace.nodeBin))}:$PATH`]
  if (workspace.dshHome) lines.push(`export DSH_HOME=${q(workspace.dshHome)}`)
  lines.push(`export npm_config_registry=${q(registry || DEFAULT_REGISTRY)}`)
  return lines.join('\n')
}

function dirname(path) {
  const text = String(path || '')
  const index = text.lastIndexOf('/')
  return index > 0 ? text.slice(0, index) : text
}

export const pluginMethods = {
  /** Directory of the profile this app is running from (best effort, cached). */
  async localProfileDir() {
    if (this.localProfile !== undefined) return this.localProfile
    const candidates = []
    if (process.env.DSH_PROFILE_DIR) candidates.push(String(process.env.DSH_PROFILE_DIR))
    const root = join(this.dshHome, 'profiles')
    for (const name of LOCAL_PROFILE_CANDIDATES) candidates.push(join(root, name))
    for (const directory of candidates) {
      try {
        const text = await readFile(join(directory, 'package.json'), 'utf8')
        if (parseManifest(text).bundles.length > 0) {
          this.localProfile = directory
          return directory
        }
      } catch {
        // keep looking
      }
    }
    // Last resort: any profile that declares bundles.
    try {
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const directory = join(root, entry.name)
        try {
          const text = await readFile(join(directory, 'package.json'), 'utf8')
          if (parseManifest(text).bundles.length > 0) {
            this.localProfile = directory
            return directory
          }
        } catch {
          // keep looking
        }
      }
    } catch {
      // no profiles directory at all
    }
    this.localProfile = ''
    return ''
  },

  async readLocalPluginManifest() {
    const directory = await this.localProfileDir()
    if (!directory) throw new Error('no local dsh profile with bundles was found')
    const path = join(directory, 'package.json')
    const text = await readFile(path, 'utf8')
    return { dir: directory, path, manifest: parseManifest(text) }
  },

  remoteProfileDir(workspace, name) {
    return joinRemote(workspace.dshHome, 'profiles', name)
  },

  async readRemotePluginManifest(host, workspace, name) {
    const dir = this.remoteProfileDir(workspace, name)
    const path = joinRemote(dir, 'package.json')
    const file = await this.pool.readFile(host, path, 128 * 1024)
    const text = String(file?.text || '')
    if (!text.trim()) return { dir, path, name, manifest: { name: '', dependencies: {}, bundles: [] }, missing: true }
    return { dir, path, name, manifest: parseManifest(text), missing: false }
  },

  /** Every profile that exists on the remote, in a stable order. */
  async remoteProfiles(host, workspace) {
    const rows = []
    for (const name of REMOTE_PROFILES) {
      const remote = await this.readRemotePluginManifest(host, workspace, name)
      if (!remote.missing) rows.push(remote)
    }
    return rows
  },

  /** Read-only comparison of the local profile against every remote profile. */
  async planPluginSync(host, workspace) {
    const local = await this.readLocalPluginManifest()
    const picked = pickSyncable(local.manifest)
    const profiles = []
    for (const remote of await this.remoteProfiles(host, workspace)) {
      const diff = diffManifests(local.manifest, remote.manifest)
      profiles.push({
        name: remote.name,
        dir: remote.dir,
        remoteBundles: remote.manifest.bundles.length,
        diff,
        skipped: picked.skipped,
        same: !diff.changed
      })
    }
    const drifted = profiles.filter((profile) => !profile.same)
    return {
      revision: PLUGIN_SYNC_REVISION,
      workspaceId: workspace.id,
      localDir: local.dir,
      localBundles: picked.bundles.length,
      profiles,
      same: profiles.length > 0 && drifted.length === 0,
      changed: drifted.length > 0,
      summary: drifted.length ? drifted.map((profile) => `${profile.name}: ${profile.diff.summary}`).join('; ') : 'in sync'
    }
  },

  /** `pnpm` is what dsh's own plugin manager drives; install it once if missing. */
  async ensurePnpm(host, workspace, registry, onLog = () => {}) {
    const probe = await this.pool.exec(host, `${runtimeEnv(workspace, registry)}\ncommand -v pnpm || true`, { timeoutMs: 30000 })
    if (String(probe?.stdout || '').includes('pnpm')) return true
    onLog('info', `plugin sync: installing pnpm@${PNPM_VERSION} on the workspace runtime`)
    await this.pool.run(
      host,
      `${runtimeEnv(workspace, registry)}\nnpm i -g pnpm@${PNPM_VERSION} --no-audit --no-fund`,
      { timeoutMs: INSTALL_TIMEOUT_MS }
    )
    const after = await this.pool.exec(host, `${runtimeEnv(workspace, registry)}\ncommand -v pnpm || true`, { timeoutMs: 30000 })
    return String(after?.stdout || '').includes('pnpm')
  },

  /** `dsh plugin --profile <name> install`, which is dsh's supported path. */
  async installRemoteProfile(host, workspace, name, registry, onLog = () => {}) {
    const command = `${runtimeEnv(workspace, registry)}\n${q(workspace.nodeBin)} ${q(workspace.dshBin)} plugin --profile ${name} install`
    onLog('info', `plugin sync: installing the ${name} profile`)
    try {
      const result = await this.pool.run(host, command, { timeoutMs: INSTALL_TIMEOUT_MS })
      return { ok: true, detail: tailOf(result?.stdout) }
    } catch (error) {
      return { ok: false, error: error?.message || String(error) }
    }
  },

  /**
   * Prove the profile is usable: every package we just asked for resolves, and
   * the composed tree still builds (`--dump-config` boots the plugin stack).
   */
  async verifyRemoteProfile(host, workspace, name, diff, registry) {
    const wanted = [...diff.add.map((item) => item.name), ...diff.update.map((item) => item.name)]
    if (wanted.length) {
      const dir = this.remoteProfileDir(workspace, name)
      const checks = wanted.map((item) => `test -d ${q(joinRemote(dir, 'node_modules', item))} || echo ${q(item)}`).join('\n')
      const result = await this.pool.exec(host, checks, { timeoutMs: 30000 })
      const missing = String(result?.stdout || '').split('\n').map((line) => line.trim()).filter(Boolean)
      if (missing.length) return { ok: false, error: `install finished but ${missing.join(', ')} is missing` }
    }
    try {
      await this.pool.run(
        host,
        `${runtimeEnv(workspace, registry)}\n${q(workspace.nodeBin)} ${q(workspace.dshBin)} --profile ${name} --dump-config > /dev/null`,
        { timeoutMs: 120000 }
      )
    } catch (error) {
      return { ok: false, error: `the ${name} profile no longer composes: ${error?.message || error}` }
    }
    return { ok: true }
  },

  async rollbackRemoteProfile(host, workspace, name, backup, registry) {
    try {
      const path = joinRemote(this.remoteProfileDir(workspace, name), 'package.json')
      await this.pool.run(host, `cp -p ${q(backup)} ${q(path)}`, { timeoutMs: 30000 })
      const install = await this.installRemoteProfile(host, workspace, name, registry)
      return install.ok
    } catch {
      return false
    }
  },

  /**
   * Reconcile every remote profile with the local one.
   *
   * `prune` is opt-in: by default the union keeps whatever the remote already
   * had, because a profile may carry a plugin the local profile does not.
   */
  async syncPlugins(host, workspace, options = {}) {
    const { dryRun = false, prune = false, onLog = () => {} } = options
    const plan = await this.planPluginSync(host, workspace)
    const base = { ...plan, dryRun, prune }
    const planRows = plan.profiles.map((profile) => ({
      name: profile.name,
      changed: !profile.same,
      summary: profile.diff.summary,
      added: profile.diff.add.length + profile.diff.update.length
    }))
    if (!plan.profiles.length) throw new Error('the workspace has no dsh profile yet')
    if (!plan.changed) return { ...base, changed: false, applied: false, rows: planRows }
    if (dryRun) return { ...base, changed: true, applied: false, rows: planRows }
    if (!workspace.nodeBin || !workspace.dshBin) throw new Error('the workspace has no dsh runtime yet')

    const registry = String(this.store?.settings?.npmRegistry || '') || DEFAULT_REGISTRY
    if (!(await this.ensurePnpm(host, workspace, registry, onLog))) {
      throw new Error('pnpm is not available on the remote runtime (dsh plugin manager needs it)')
    }
    const local = await this.readLocalPluginManifest()
    onLog('info', `plugin sync ${workspace.name || workspace.id}: ${plan.summary}`)

    const written = []
    const rows = []
    for (const profile of plan.profiles) {
      if (profile.same) continue
      const remote = await this.readRemotePluginManifest(host, workspace, profile.name)
      const path = joinRemote(profile.dir, 'package.json')
      const backup = `${path}.bak-sync-${stamp()}`
      const text = renderManifest(mergedManifest(local.manifest, remote.manifest, { prune }), { prune })
      await this.pool.run(host, `cp -p ${q(path)} ${q(backup)} 2>/dev/null || true`, { timeoutMs: 30000 })
      written.push({ name: profile.name, backup })
      await this.pool.writeFile(host, path, text, 0o644)
      const install = await this.installRemoteProfile(host, workspace, profile.name, registry, onLog)
      if (!install.ok) {
        onLog('warn', `plugin sync failed for ${workspace.name || workspace.id}/${profile.name}: ${install.error}; rolling back`)
        const rolledBack = await this.rollbackAll(host, workspace, written, registry)
        return { ...base, changed: true, applied: false, error: install.error, rolledBack, rows }
      }
      const verify = await this.verifyRemoteProfile(host, workspace, profile.name, profile.diff, registry)
      if (!verify.ok) {
        onLog('warn', `plugin sync verification failed for ${workspace.name || workspace.id}/${profile.name}: ${verify.error}; rolling back`)
        const rolledBack = await this.rollbackAll(host, workspace, written, registry)
        return { ...base, changed: true, applied: false, error: verify.error, rolledBack, rows }
      }
      rows.push({ name: profile.name, changed: true, applied: true, summary: profile.diff.summary, backup, installed: install.detail })
    }
    return { ...base, changed: true, applied: true, rows }
  },

  async rollbackAll(host, workspace, written, registry) {
    let ok = true
    for (const entry of written) {
      const restored = await this.rollbackRemoteProfile(host, workspace, entry.name, entry.backup, registry)
      if (!restored) ok = false
    }
    return ok
  },

  /**
   * Startup pass: reconcile every reachable workspace once. Failures are logged
   * and never thrown — a workspace whose registry is unreachable must not break
   * the app start.
   */
  async syncAllPlugins({ onLog = () => {}, only = null, dryRun = false } = {}) {
    const rows = []
    let local
    try {
      local = await this.readLocalPluginManifest()
    } catch (error) {
      return { revision: PLUGIN_SYNC_REVISION, available: false, error: error?.message || String(error), rows }
    }
    const workspaces = (this.store?.workspaces || []).filter((workspace) => (only ? only.includes(workspace.id) : true))
    for (const workspace of workspaces) {
      const host = this.store.hosts.find((item) => item.id === workspace.hostId)
      if (!host) continue
      try {
        const result = await this.syncPlugins(host, workspace, { onLog, dryRun })
        rows.push({
          workspaceId: workspace.id,
          name: workspace.name,
          changed: result.changed,
          applied: result.applied,
          summary: result.summary,
          error: result.error
        })
      } catch (error) {
        rows.push({ workspaceId: workspace.id, name: workspace.name, changed: false, applied: false, error: error?.message || String(error) })
      }
    }
    return { revision: PLUGIN_SYNC_REVISION, available: true, localDir: local.dir, rows }
  }
}
