// Hot-reload this plugin inside the running DeepSeek Harness desktop app.
//
// The desktop profile enables HMR, so the plugin-manager RPC can swap the
// plugin in-process: disable it, wait for the fiber to unload, enable it again,
// then wait for the new fiber to report active. No app restart, and no bridge
// attachments survive the swap, so reopen remote chats afterwards.
//
//   node scripts/reload.mjs [--base http://127.0.0.1:3082] [--id dsh-ssh-remote]
//
// Exits non-zero when the plugin does not come back active. The plugin's own
// `/api/ssh-remote/*` routes are served through the app renderer's fetch
// carrier, so they cannot be probed from Node here; `fiberPhase` is the signal.
import process from 'node:process'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i]
  if (arg.startsWith('--')) args.set(arg.slice(2), process.argv[i + 1]?.startsWith('--') ? true : process.argv[++i])
}
const base = String(args.get('base') || process.env.DSH_BASE || 'http://127.0.0.1:3082').replace(/\/+$/u, '')
const pluginId = String(args.get('id') || 'dsh-ssh-remote')
const entryId = pluginId.startsWith('include:') ? pluginId : `include:${pluginId}`

async function rpc(method, payload) {
  const response = await fetch(`${base}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `${method}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      method,
      payload: { args: payload }
    }),
    signal: AbortSignal.timeout(20000)
  })
  const body = await response.json()
  if (!response.ok || body?.result?.ok === false) {
    throw new Error(`${method} failed: HTTP ${response.status} ${JSON.stringify(body).slice(0, 400)}`)
  }
  return body.result?.value
}

async function entry() {
  const list = await rpc('pluginManager/listPlugins', {})
  return list.find((plugin) => plugin.entryId === entryId || plugin.moduleName === pluginId)
}

async function setEnabled(enabled) {
  const value = await rpc('pluginManager/setPluginEnabled', { id: entryId, enabled })
  return value?.application || value
}

async function waitFor(predicate, { timeoutMs = 30000, intervalMs = 500, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      last = await predicate()
      if (last) return last
    } catch (error) {
      last = error
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`timed out waiting for ${label} (last: ${last instanceof Error ? last.message : JSON.stringify(last)})`)
}

const before = await entry()
if (!before) throw new Error(`${entryId} is not installed in this profile`)
console.log(`reload: ${entryId} before: enabled=${before.enabled} phase=${before.fiberPhase}`)

// Toggling in try/finally: an interrupted reload must not leave the plugin off.
let reloaded = false
try {
  const off = await setEnabled(false)
  console.log(`reload: disable -> ${off}`)
  await waitFor(async () => {
    const plugin = await entry()
    return !plugin || plugin.enabled === false
  }, { label: 'plugin disabled' })
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const on = await setEnabled(true)
  console.log(`reload: enable -> ${on}`)
  const active = await waitFor(async () => {
    const plugin = await entry()
    return plugin && plugin.enabled && plugin.fiberPhase === 'active' ? plugin : null
  }, { label: 'plugin active' })
  console.log(`reload: ${entryId} active`)
  reloaded = true
} finally {
  if (!reloaded) {
    const plugin = await entry().catch(() => null)
    if (plugin && !plugin.enabled) {
      console.error('reload: left disabled, re-enabling')
      await setEnabled(true).catch((error) => console.error(`reload: re-enable failed: ${error.message}`))
    }
  }
}
