// Which dsh build a remote workspace must run, and the Node line that build
// needs. Everything is derived from the build this plugin is loaded into:
// the bridge speaks the same SDK dialect as the local Host, so a hard-coded
// remote version drifts the moment DeepSeek Harness updates.
//
// Resolution order for the target version:
//   1. `DSH_VERSION` (explicit override, set by some launch wrappers)
//   2. `<DSH_INSTALL_DIR>/node_modules/@deepseek-ai/dsh/package.json` (Desktop)
//   3. `require.resolve('@deepseek-ai/dsh/package.json')` (Web/profile install)
//   4. the fallback below, only when nothing can be read
//
// `settings.dshVersion` and `settings.nodeVersion` still win over all of this:
// an empty string means "follow this computer", a value pins it.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

/** Used only when the local build cannot be inspected at all. */
export const FALLBACK_DSH_VERSION = '0.2.2-rc.5'
/** Node minimum of FALLBACK_DSH_VERSION; also the portable Node to download. */
export const FALLBACK_NODE_VERSION = '24.9.0'

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u
const NODE_VERSION_PATTERN = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/u

/** Drop range operators (`>=`, `^`) and a leading `v` before matching. */
function withoutRangePrefix(text) {
  return String(text || '').trim().replace(/^[^\d]*/u, '')
}

function readManifest(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

/** Every manifest path that could describe the running dsh build, best first. */
function candidateManifests(env) {
  const rows = []
  const installDir = String(env.DSH_INSTALL_DIR || '').trim()
  if (installDir) {
    rows.push(join(installDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
    rows.push(join(installDir, 'package.json'))
  }
  const dshHome = String(env.DSH_HOME || '').trim()
  const profile = String(env.DSH_PROFILE || '').trim()
  if (dshHome && profile) {
    rows.push(join(dshHome, 'profiles', profile, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
  }
  return rows
}

function pickManifest(env) {
  for (const path of candidateManifests(env)) {
    const manifest = readManifest(path)
    // The Desktop app manifest is not the dsh manifest, so accept the app one
    // only when it actually describes the package we care about.
    if (manifest && manifest.name === '@deepseek-ai/dsh') return manifest
  }
  try {
    const require = createRequire(import.meta.url)
    const manifest = readManifest(require.resolve('@deepseek-ai/dsh/package.json'))
    if (manifest) return manifest
  } catch {
    // Not resolvable from the plugin's own tree (Desktop runs from app.asar).
  }
  return null
}

/** The dsh version this Host runs, and where it came from. */
function detectLocal({ env }) {
  const override = String(env.DSH_VERSION || '').trim()
  if (VERSION_PATTERN.test(override)) return { version: override, source: 'env' }
  const manifest = pickManifest(env)
  const version = String(manifest?.version || '').trim()
  if (VERSION_PATTERN.test(version)) return { version, source: 'manifest' }
  return { version: FALLBACK_DSH_VERSION, source: 'fallback' }
}

/** The dsh version this Host runs; never empty. */
export function detectLocalDshVersion({ env = process.env } = {}) {
  return detectLocal({ env }).version
}

/** The local build's `engines.node`, e.g. `>=24.9.0`; '' when unknown. */
export function detectLocalDshEngines({ env = process.env } = {}) {
  const manifest = pickManifest(env)
  const engines = manifest?.engines
  const node = typeof engines === 'string' ? engines : engines?.node
  return String(node || '').trim()
}

/** Turn an engines range into the lowest exact version that satisfies it. */
export function nodeMinimumFromEngines(engines) {
  const match = withoutRangePrefix(engines).match(NODE_VERSION_PATTERN)
  if (!match) return FALLBACK_NODE_VERSION
  return `${Number(match[1])}.${Number(match[2] || 0)}.${Number(match[3] || 0)}`
}

/** Parse a `node -v` style string into a comparable triple, or null. */
export function parseVersion(text) {
  const match = withoutRangePrefix(text).match(NODE_VERSION_PATTERN)
  if (!match) return null
  return [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)]
}

/** True when `version` is at least `minimum` (both plain x.y.z). */
export function versionAtLeast(version, minimum) {
  const left = parseVersion(version)
  const right = parseVersion(minimum)
  if (!left || !right) return false
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return true
    if (left[index] < right[index]) return false
  }
  return true
}

/**
 * Resolve the whole runtime target in one place so routes, the installer and
 * the diagnostics panel cannot disagree.
 *
 * @returns {{version: string, engines: string, nodeMinimum: string, source: 'settings'|'local'|'fallback'}}
 */
export function resolveRuntimeTarget(settings = {}, { env = process.env } = {}) {
  const pinned = String(settings?.dshVersion || '').trim()
  const engines = detectLocalDshEngines({ env })
  const local = detectLocal({ env })
  const fromSettings = VERSION_PATTERN.test(pinned)
  // A pinned older runtime still uses the local engines rule: it is the only
  // Node requirement this plugin can prove without fetching a manifest.
  const effectiveEngines = engines || `>=${FALLBACK_NODE_VERSION}`
  return {
    version: fromSettings ? pinned : local.version,
    engines: effectiveEngines,
    nodeMinimum: nodeMinimumFromEngines(effectiveEngines),
    source: fromSettings ? 'settings' : local.source
  }
}

/** The portable Node build to download when the remote Node is too old. */
export function portableNodeVersion(settings = {}, { env = process.env } = {}) {
  const parsed = parseVersion(settings?.nodeVersion)
  if (parsed) return parsed.join('.')
  return resolveRuntimeTarget(settings, { env }).nodeMinimum
}
