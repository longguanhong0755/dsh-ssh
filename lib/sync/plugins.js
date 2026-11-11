// Plugin manifest sync: pure helpers.
//
// The local app and every remote workspace run the same DSH, but only the local
// profile is edited by hand. Without a reconciler the remote keeps whatever
// bundles it was created with, so a plugin that the local profile gained (or
// upgraded) silently does not exist on the remote. These helpers turn two
// `package.json` files into a plan; lib/remote/plugins.js executes the plan.
//
// Everything here is pure so the decisions can be tested without an SSH host.

export const PLUGIN_SYNC_REVISION = '2026-11-11 plugin-sync'

// Specs that only resolve on the machine that wrote them: `link:` (a checkout on
// disk), `file:` (a tarball next to it), `workspace:` (a pnpm workspace member)
// and `portal:`. Copying those to another host would make `npm install` fail, so
// they are reported and skipped instead of shipped.
const LOCAL_SPEC = /^(?:link|file|workspace|portal):/u

export const REMOTE_PROFILE = 'web'

// Every profile a remote workspace may boot. The web profile serves the remote
// UI, `headless` runs one-shot tasks, `sdk` is what the bridge drives — all three
// compose their own bundle list, so a plugin has to be merged into each.
export const REMOTE_PROFILES = ['headless', 'sdk', 'web']

// Bundles that define what a profile *is* — the base runtime plus the app shell.
// dsh writes those itself and they legitimately differ per profile (a headless
// profile must never be handed the web app bundle), so they are never copied.
export const PROFILE_BUNDLES = new Set([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-headless',
  '@deepseek-ai/dsh-sdk-app',
  '@deepseek-ai/dsh-web-app'
])

export function isLocalSpec(spec) {
  return LOCAL_SPEC.test(String(spec ?? '').trim())
}

export function parseManifest(raw) {
  const text = typeof raw === 'string' ? raw.trim() : JSON.stringify(raw ?? null)
  // An absent or emptied profile is "no plugin set yet", not corruption: the
  // caller must be able to heal it instead of crashing on JSON.parse('').
  if (!text) return { name: '', dependencies: {}, bundles: [] }
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`package.json is not valid JSON: ${error?.message || error}`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('package.json is not an object')
  const dependencies = {}
  const declared = value.dependencies && typeof value.dependencies === 'object' ? value.dependencies : {}
  for (const [name, spec] of Object.entries(declared)) dependencies[name] = String(spec)
  const bundles = Array.isArray(value?.dsh?.profile?.bundles) ? value.dsh.profile.bundles.map((item) => String(item)) : []
  return {
    name: typeof value.name === 'string' ? value.name : '',
    dependencies,
    bundles
  }
}

/**
 * Split a manifest into the part that travels and the part that cannot.
 *
 * Three things stay behind: bundles that shape the profile (see PROFILE_BUNDLES),
 * bundles whose spec only resolves on this machine, and dependencies that no
 * bundle of this profile actually loads — shipping those would install packages
 * nobody asks for (a disabled plugin keeps its dependency entry for a while).
 */
export function pickSyncable(manifest) {
  const dependencies = {}
  const skipped = []
  const note = (name, spec, reason) => {
    if (!skipped.some((item) => item.name === name)) skipped.push({ name, spec, reason })
  }
  const bundles = []
  for (const bundle of manifest.bundles) {
    if (PROFILE_BUNDLES.has(bundle)) {
      note(bundle, undefined, 'per-profile bundle')
      continue
    }
    const spec = manifest.dependencies[bundle]
    if (spec !== undefined && isLocalSpec(spec)) {
      note(bundle, spec, 'bundle uses a local specifier')
      continue
    }
    bundles.push(bundle)
  }
  for (const [name, spec] of Object.entries(manifest.dependencies)) {
    if (isLocalSpec(spec)) {
      note(name, spec, 'local specifier')
      continue
    }
    if (!bundles.includes(name)) {
      note(name, spec, 'not a bundled plugin')
      continue
    }
    dependencies[name] = spec
  }
  return { dependencies, bundles, skipped }
}

export function diffManifests(localManifest, remoteManifest) {
  const left = pickSyncable(localManifest)
  const right = pickSyncable(remoteManifest)
  const add = []
  const update = []
  const keep = []
  const drop = []
  for (const [name, spec] of Object.entries(left.dependencies)) {
    const current = right.dependencies[name]
    if (current === undefined) add.push({ name, spec })
    else if (current !== spec) update.push({ name, from: current, to: spec })
    else keep.push({ name, spec })
  }
  for (const [name, spec] of Object.entries(right.dependencies)) {
    if (left.dependencies[name] === undefined) drop.push({ name, spec })
  }
  const bundlesAdded = left.bundles.filter((name) => !right.bundles.includes(name))
  const bundlesDropped = right.bundles.filter((name) => !left.bundles.includes(name))
  return {
    add,
    update,
    keep,
    drop,
    skipped: left.skipped,
    bundlesAdded,
    bundlesDropped,
    changed: Boolean(add.length || update.length || drop.length || bundlesAdded.length || bundlesDropped.length),
    // Dry-run friendly one-liner, used by the routes and the startup log.
    summary: describeDiff({ add, update, drop, bundlesAdded, bundlesDropped })
  }
}

export function describeDiff({ add = [], update = [], drop = [], bundlesAdded = [], bundlesDropped = [] } = {}) {
  const parts = []
  if (add.length) parts.push(`+${add.length} package(s)`)
  if (update.length) parts.push(`~${update.length} version(s)`)
  if (drop.length) parts.push(`-${drop.length} package(s)`)
  if (bundlesAdded.length) parts.push(`+${bundlesAdded.length} bundle(s)`)
  if (bundlesDropped.length) parts.push(`-${bundlesDropped.length} bundle(s)`)
  return parts.length ? parts.join(', ') : 'in sync'
}

export function sameManifest(localManifest, remoteManifest) {
  return !diffManifests(localManifest, remoteManifest).changed
}

/**
 * Render the reconciled profile manifest. Keys are sorted so a no-op sync writes
 * a byte-identical file (and therefore never touches the remote).
 *
 * `prune` decides whether remote-only packages are removed. It defaults to
 * false: a remote workspace may have been given an extra plugin on purpose, and
 * deleting it would break that workspace.
 */
export function renderManifest({ name, dependencies, bundles }, { prune = false, fallbackName = 'dsh-profile-web' } = {}) {
  const sorted = {}
  for (const key of Object.keys(dependencies).sort()) sorted[key] = dependencies[key]
  const value = {
    name: name || fallbackName,
    private: true,
    dependencies: sorted,
    dsh: { profile: { bundles: [...bundles] } }
  }
  return `${JSON.stringify(value, null, 2)}\n`
}

/**
 * The manifest to write for `remote`: local plugins win, and the remote keeps
 * whatever it owns — its profile bundles always, its extra plugins unless
 * `prune` asks for exactly the local set.
 */
export function mergedManifest(localManifest, remoteManifest, { prune = false } = {}) {
  const local = pickSyncable(localManifest)
  const dependencies = { ...local.dependencies }
  // Start from the remote's own list so its base/app bundles stay in front.
  const bundles = []
  for (const bundle of remoteManifest.bundles) {
    if (PROFILE_BUNDLES.has(bundle)) bundles.push(bundle)
    else if (!prune) bundles.push(bundle)
  }
  for (const bundle of local.bundles) if (!bundles.includes(bundle)) bundles.push(bundle)
  if (!prune) {
    for (const [name, spec] of Object.entries(remoteManifest.dependencies)) {
      if (isLocalSpec(spec) || dependencies[name] !== undefined) continue
      if (!bundles.includes(name)) continue
      dependencies[name] = spec
    }
  }
  return { name: remoteManifest.name || localManifest.name, dependencies, bundles }
}
