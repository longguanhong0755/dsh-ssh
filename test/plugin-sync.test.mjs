// Local <-> remote plugin reconciliation.
//
// Two layers are covered: the pure manifest algebra (lib/sync/plugins.js) and
// the RemoteManager methods that apply it (lib/remote/plugins.js) against a fake
// pool, so a broken registry entry or a profile that stops composing is proven
// to roll back instead of leaving a dead workspace.

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

import { RemoteManager } from '../lib/remote.js'
import {
  PLUGIN_SYNC_REVISION,
  diffManifests,
  isLocalSpec,
  mergedManifest,
  parseManifest,
  pickSyncable,
  renderManifest
} from '../lib/sync/plugins.js'

const LOCAL_MANIFEST = {
  name: 'dsh-profile-desktop',
  dependencies: {
    'billion-context': '0.1.213',
    'dsh-ssh-remote': 'link:D:/workspace/dsh-ssh/dsh-ssh-remote',
    'dsh-context': '0.83.0'
  },
  bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'billion-context', 'dsh-context']
}

const HEADLESS = { name: 'dsh-profile-headless', dependencies: {}, bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] }
const SDK = { name: 'dsh-profile-sdk', dependencies: {}, bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-sdk-app'] }

const WORKSPACE = {
  id: 'ws-1',
  name: 'ui-showcase',
  hostId: 'host-1',
  dshHome: '/root/.dsh-remote/workspaces/ws-1/home',
  nodeBin: '/root/.dsh-remote/runtime/node/bin/node',
  dshBin: '/root/.dsh-remote/runtime/dsh-0.2.2-rc.1/node_modules/@deepseek-ai/dsh/lib/bin.js'
}

/** Serialize a profile the way dsh writes it (bundles live under dsh.profile). */
function manifestText(manifest) {
  const file = {
    name: manifest.name,
    private: true,
    dependencies: manifest.dependencies,
    dsh: { profile: { bundles: manifest.bundles } }
  }
  return `${JSON.stringify(file, null, 2)}\n`
}

const profilePath = (name) => `${WORKSPACE.dshHome}/profiles/${name}/package.json`

async function withLocalProfile(manifest, run) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), manifestText(manifest), 'utf8')
  try {
    return await run(dir)
  } finally {
    delete process.env.DSH_PROFILE_DIR
    await rm(dir, { recursive: true, force: true })
  }
}

function createManager({ profiles = [HEADLESS, SDK], missing = [], pnpm = true, broken = [], registry = 'https://registry.npmmirror.com' } = {}) {
  const calls = { run: [], exec: [], write: [] }
  const state = { pnpm }
  const files = new Map(profiles.map((manifest) => [profilePath(manifest.name.replace('dsh-profile-', '')), manifestText(manifest)]))
  const pool = {
    async readFile(_host, path) {
      return { text: files.get(path) ?? '', truncated: false, binary: false }
    },
    async writeFile(_host, path, content) {
      calls.write.push({ path, content })
      files.set(path, content)
    },
    async run(_host, command) {
      calls.run.push(command)
      if (broken.some((name) => command.includes(`--profile ${name}`) && command.includes('--dump-config'))) {
        throw new Error('远程命令失败（exit 1）: profile has no such plugin')
      }
      if (command.includes('npm i -g pnpm')) state.pnpm = true
      if (command.includes('command -v pnpm')) return { code: 0, stdout: state.pnpm ? '/root/.dsh-remote/runtime/node/bin/pnpm\n' : '', stderr: '' }
      const quoted = [...command.matchAll(/'([^']*)'/gu)].map((match) => match[1])
      if (command.includes('cp -p') && quoted.length >= 2) files.set(quoted[1], files.get(quoted[0]) ?? '')
      return { code: 0, stdout: 'Packages: +14\ndone', stderr: '' }
    },
    async exec(_host, command) {
      calls.exec.push(command)
      if (command.includes('test -d')) {
        const names = missing.filter((name) => command.includes(name))
        return { code: 0, stdout: names.map((name) => `${name}\n`).join(''), stderr: '' }
      }
      if (command.includes('command -v pnpm')) return { code: 0, stdout: state.pnpm ? '/root/.dsh-remote/runtime/node/bin/pnpm\n' : '', stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    }
  }
  const store = { settings: { npmRegistry: registry }, hosts: [{ id: 'host-1', name: 'loong' }], workspaces: [] }
  return { manager: new RemoteManager({ dshHome: tmpdir(), pool, store }), calls, store, files }
}

test('a broken package.json is reported; an empty one is "not set up yet"', () => {
  assert.throws(() => parseManifest('{ nope'), /package\.json is not valid JSON/u)
  assert.deepEqual(parseManifest(''), { name: '', dependencies: {}, bundles: [] })
  assert.deepEqual(parseManifest('   \n'), { name: '', dependencies: {}, bundles: [] })
})

test('only registry specs travel to the remote profile, listed once each', () => {
  assert.equal(isLocalSpec('link:D:/workspace/dsh-ssh/dsh-ssh-remote'), true)
  assert.equal(isLocalSpec('file:../x'), true)
  assert.equal(isLocalSpec('0.83.0'), false)

  const picked = pickSyncable({
    name: 'p',
    dependencies: { 'dsh-ssh-remote': 'link:D:/x', 'dsh-context': '0.83.0', 'dsh-market': 'file:../m' },
    bundles: ['dsh-context', 'dsh-market', 'dsh-ssh-remote']
  })
  assert.deepEqual(picked.dependencies, { 'dsh-context': '0.83.0' })
  assert.deepEqual(picked.bundles, ['dsh-context'])
  assert.deepEqual(picked.skipped.map((item) => item.name).sort(), ['dsh-market', 'dsh-ssh-remote'])
})

test('profile bundles and unbundled dependencies stay behind', () => {
  const picked = pickSyncable({
    name: 'p',
    dependencies: { 'disabled-plugin': '1.0.0', 'dsh-context': '0.83.0' },
    bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', 'dsh-context']
  })
  assert.deepEqual(picked.bundles, ['dsh-context'], 'the headless shell is never replaced by the local one')
  assert.deepEqual(picked.dependencies, { 'dsh-context': '0.83.0' }, 'a dependency no bundle loads is not installed')
  assert.deepEqual(
    picked.skipped.map((item) => `${item.name}:${item.reason}`).sort(),
    ['@deepseek-ai/dsh-base:per-profile bundle', '@deepseek-ai/dsh-headless:per-profile bundle', 'disabled-plugin:not a bundled plugin']
  )
})

test('the diff names every direction of drift', () => {
  const diff = diffManifests(LOCAL_MANIFEST, HEADLESS)
  assert.deepEqual(diff.add, [
    { name: 'billion-context', spec: '0.1.213' },
    { name: 'dsh-context', spec: '0.83.0' }
  ])
  assert.deepEqual(diff.skipped.map((item) => item.name), ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-ssh-remote'])
  assert.deepEqual(diff.bundlesAdded, ['billion-context', 'dsh-context'])
  assert.equal(diff.changed, true)
  assert.match(diff.summary, /\+2 package/u)
  assert.equal(diffManifests(HEADLESS, HEADLESS).changed, false)
  assert.equal(diffManifests(HEADLESS, HEADLESS).summary, 'in sync')
})

test('rendering is stable, so an in-sync profile is never rewritten', () => {
  const text = renderManifest({ name: 'b', dependencies: { z: '1.0.0', a: '2.0.0' }, bundles: ['b-2', 'b-1'] })
  assert.equal(
    text,
    '{\n  "name": "b",\n  "private": true,\n  "dependencies": {\n    "a": "2.0.0",\n    "z": "1.0.0"\n  },\n  "dsh": {\n    "profile": {\n      "bundles": [\n        "b-2",\n        "b-1"\n      ]\n    }\n  }\n}\n'
  )
  assert.equal(renderManifest(parseManifest(text)), text)
  assert.deepEqual(parseManifest(text).bundles, ['b-2', 'b-1'])
})

test('the merge keeps the remote profile shell and its extra plugins unless pruning', () => {
  const remote = {
    name: 'dsh-profile-headless',
    dependencies: { 'remote-extra': '2.0.0' },
    bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', 'remote-extra']
  }
  const kept = mergedManifest(LOCAL_MANIFEST, remote)
  assert.equal(kept.name, 'dsh-profile-headless')
  assert.equal(kept.dependencies['remote-extra'], '2.0.0')
  assert.equal(kept.dependencies['billion-context'], '0.1.213')
  assert.equal(kept.dependencies['dsh-ssh-remote'], undefined)
  assert.deepEqual(kept.bundles, [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-headless',
    'remote-extra',
    'billion-context',
    'dsh-context'
  ])

  const pruned = mergedManifest(LOCAL_MANIFEST, remote, { prune: true })
  assert.equal(pruned.dependencies['remote-extra'], undefined)
  assert.deepEqual(pruned.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', 'billion-context', 'dsh-context'])
})

test('planning compares every remote profile and changes nothing', async () => {
  await withLocalProfile(LOCAL_MANIFEST, async (dir) => {
    process.env.DSH_PROFILE_DIR = dir
    const { manager, calls } = createManager()
    const plan = await manager.planPluginSync({ id: 'host-1' }, WORKSPACE)
    assert.equal(plan.revision, PLUGIN_SYNC_REVISION)
    assert.deepEqual(plan.profiles.map((profile) => profile.name), ['headless', 'sdk'])
    assert.equal(plan.same, false)
    assert.equal(plan.localBundles, 2, 'only registry bundles that are actually loaded count')
    assert.match(plan.summary, /^headless: /u)
    assert.equal(calls.write.length, 0)
    assert.equal(calls.run.length, 0)
  })
})

test('a profile that does not exist on the remote is not created blindly', async () => {
  await withLocalProfile(LOCAL_MANIFEST, async (dir) => {
    process.env.DSH_PROFILE_DIR = dir
    const { manager } = createManager({ profiles: [SDK] })
    const plan = await manager.planPluginSync({ id: 'host-1' }, WORKSPACE)
    assert.deepEqual(plan.profiles.map((profile) => profile.name), ['sdk'])
  })
})

test('a dry run reports the drift without touching the remote', async () => {
  await withLocalProfile(LOCAL_MANIFEST, async (dir) => {
    process.env.DSH_PROFILE_DIR = dir
    const { manager, calls } = createManager()
    const result = await manager.syncPlugins({ id: 'host-1' }, WORKSPACE, { dryRun: true })
    assert.equal(result.changed, true)
    assert.equal(result.applied, false)
    assert.deepEqual(result.rows.map((row) => row.name), ['headless', 'sdk'])
    assert.equal(calls.write.length, 0)
    assert.equal(calls.run.length, 0)
  })
})

test('applying writes every profile, installs with dsh and proves it composes', async () => {
  await withLocalProfile(LOCAL_MANIFEST, async (dir) => {
    process.env.DSH_PROFILE_DIR = dir
    const { manager, calls } = createManager()
    const result = await manager.syncPlugins({ id: 'host-1' }, WORKSPACE, { onLog: () => {} })
    assert.equal(result.applied, true, `applied (${result.error || 'no error'})`)
    assert.deepEqual(result.rows.map((row) => row.name).sort(), ['headless', 'sdk'])
    assert.equal(calls.write.length, 2)
    for (const write of calls.write) {
      assert.match(write.path, /profiles\/(headless|sdk)\/package\.json$/u)
      const written = parseManifest(write.content)
      assert.equal(written.dependencies['dsh-ssh-remote'], undefined, 'local path bundles never travel')
      assert.equal(written.dependencies['dsh-context'], '0.83.0')
      assert.equal(written.name.includes('headless') || written.name.includes('sdk'), true)
    }
    const installed = calls.run.filter((command) => command.includes('plugin --profile'))
    assert.equal(installed.length, 2)
    assert.ok(installed.every((command) => command.includes(' install')))
    const dumps = calls.run.filter((command) => command.includes('--dump-config'))
    assert.equal(dumps.length, 2, 'every profile must still compose')
    assert.ok(calls.run.some((command) => command.includes('cp -p') && command.includes('bak-sync')))
  })
})

test('a missing bundle after install restores the profile it just wrote', async () => {
  await withLocalProfile(LOCAL_MANIFEST, async (dir) => {
    process.env.DSH_PROFILE_DIR = dir
    const { manager, calls, files } = createManager({ missing: ['dsh-context'] })
    const result = await manager.syncPlugins({ id: 'host-1' }, WORKSPACE, { onLog: () => {} })
    assert.equal(result.applied, false)
    assert.match(result.error, /dsh-context is missing/u)
    assert.equal(result.rolledBack, true)
    assert.equal(calls.write.length, 1, 'the first profile fails and the second is never touched')
    assert.match(calls.write[0].path, /profiles\/headless\/package\.json$/u)
    const restores = calls.run.filter((command) => command.includes('cp -p') && /bak-sync[^']*' '/u.test(command))
    assert.ok(restores.length >= 1, 'the backup is copied back')
    assert.equal(
      parseManifest(files.get(profilePath('headless'))).dependencies['dsh-context'],
      undefined,
      'the rolled-back profile is byte-for-byte the original set of bundles'
    )
  })
})

test('a profile that stops composing is rolled back', async () => {
  await withLocalProfile(LOCAL_MANIFEST, async (dir) => {
    process.env.DSH_PROFILE_DIR = dir
    const { manager } = createManager({ broken: ['sdk'] })
    const result = await manager.syncPlugins({ id: 'host-1' }, WORKSPACE, { onLog: () => {} })
    assert.equal(result.applied, false)
    assert.match(result.error, /no longer composes/u)
    assert.equal(result.rolledBack, true)
  })
})

test('pnpm is provisioned once when the runtime lacks it', async () => {
  await withLocalProfile(LOCAL_MANIFEST, async (dir) => {
    process.env.DSH_PROFILE_DIR = dir
    const { manager, calls } = createManager({ pnpm: false })
    const result = await manager.syncPlugins({ id: 'host-1' }, WORKSPACE, { onLog: () => {} })
    assert.equal(result.applied, true, `applied (${result.error || 'no error'})`)
    assert.ok(calls.run.some((command) => command.includes('npm i -g pnpm@9')), 'installs pnpm through the runtime node')
  })
})

test('a workspace without a dsh runtime is refused instead of half-writing', async () => {
  await withLocalProfile(LOCAL_MANIFEST, async (dir) => {
    process.env.DSH_PROFILE_DIR = dir
    const { manager, calls } = createManager()
    await assert.rejects(manager.syncPlugins({ id: 'host-1' }, { ...WORKSPACE, dshBin: '' }, { onLog: () => {} }), /no dsh runtime/u)
    assert.equal(calls.write.length, 0)
  })
})

test('a workspace with no profile yet is reported, not written', async () => {
  await withLocalProfile(LOCAL_MANIFEST, async (dir) => {
    process.env.DSH_PROFILE_DIR = dir
    const { manager, calls } = createManager({ profiles: [] })
    await assert.rejects(manager.syncPlugins({ id: 'host-1' }, WORKSPACE, { onLog: () => {} }), /no dsh profile/u)
    assert.equal(calls.write.length, 0)
  })
})

test('the startup pass never throws for an unreachable workspace', async () => {
  await withLocalProfile(LOCAL_MANIFEST, async (dir) => {
    process.env.DSH_PROFILE_DIR = dir
    const { manager, store } = createManager()
    store.workspaces = [WORKSPACE, { id: 'ws-2', name: 'gone', hostId: 'missing-host' }]
    const result = await manager.syncAllPlugins({ dryRun: true, onLog: () => {} })
    assert.equal(result.available, true)
    assert.equal(result.rows.length, 1, 'the workspace without a host is skipped')
    assert.equal(result.rows[0].changed, true)
  })
})

test('an unreadable local profile is reported as unavailable', async () => {
  process.env.DSH_PROFILE_DIR = join(tmpdir(), 'dsh-plugin-sync-does-not-exist')
  const { manager } = createManager()
  try {
    const result = await manager.syncAllPlugins({ onLog: () => {} })
    assert.equal(result.available, false)
    assert.match(String(result.error), /no local dsh profile/u)
  } finally {
    delete process.env.DSH_PROFILE_DIR
  }
})

test('the local manifest is read from the profile this app runs from', async () => {
  await withLocalProfile(LOCAL_MANIFEST, async (dir) => {
    process.env.DSH_PROFILE_DIR = dir
    const { manager } = createManager()
    const local = await manager.readLocalPluginManifest()
    assert.equal(local.dir, dir)
    assert.deepEqual(local.manifest.bundles, LOCAL_MANIFEST.bundles)
    assert.equal((await readFile(local.path, 'utf8')).length > 0, true)
  })
})
