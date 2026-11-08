import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RemoteStore } from '../lib/store.js'

async function makeHome(t) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-ssh-store-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  return home
}

test('a missing state file starts a fresh install and writes defaults', async (t) => {
  const home = await makeHome(t)
  const store = new RemoteStore({ dshHome: home })
  await store.load()
  assert.equal(store.loaded, true)
  assert.equal(store.loadError, null)
  const raw = await readFile(join(home, 'ssh-remote', 'state.json'), 'utf8')
  const saved = JSON.parse(raw)
  assert.equal(saved.version, 1)
  // Legacy ~/.dsh/dsh-ssh.json may be imported on a developer machine; only
  // the state shape is this test's concern.
  assert.ok(Array.isArray(saved.hosts))
  assert.equal(typeof saved.settings.pollIntervalMs, 'number')
})

test('a corrupt state file is backed up instead of overwritten', async (t) => {
  const home = await makeHome(t)
  const root = join(home, 'ssh-remote')
  await mkdir(root, { recursive: true })
  const statePath = join(root, 'state.json')
  await writeFile(statePath, '{ this is not json', 'utf8')

  const store = new RemoteStore({ dshHome: home })
  await store.load()
  assert.equal(store.loaded, true)
  assert.ok(store.recoveredFrom.startsWith(`${statePath}.corrupt-`))

  const names = await readdir(root)
  const backups = names.filter((name) => name.startsWith('state.json.corrupt-'))
  assert.equal(backups.length, 1)
  assert.equal(await readFile(join(root, backups[0]), 'utf8'), '{ this is not json')

  // A fresh, valid state replaced the unreadable one.
  const saved = JSON.parse(await readFile(statePath, 'utf8'))
  assert.equal(saved.version, 1)
  assert.ok(Array.isArray(saved.hosts))
})

test('a non-object state file is treated as corrupt', async (t) => {
  const home = await makeHome(t)
  const root = join(home, 'ssh-remote')
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'state.json'), '[]', 'utf8')

  const store = new RemoteStore({ dshHome: home })
  await store.load()
  assert.ok(store.recoveredFrom)
})

test('the legacy runtime default migrates to a build that can forward commands', async (t) => {
  const home = await makeHome(t)
  const root = join(home, 'ssh-remote')
  await mkdir(root, { recursive: true })
  const statePath = join(root, 'state.json')
  await writeFile(statePath, JSON.stringify({
    version: 1,
    settings: { dshVersion: '0.2.1-rc.5' },
    hosts: [],
    workspaces: []
  }), 'utf8')

  const store = new RemoteStore({ dshHome: home })
  await store.load()
  assert.equal(store.settings.dshVersion, '0.2.2-rc.1')
  const saved = JSON.parse(await readFile(statePath, 'utf8'))
  assert.equal(saved.settings.dshVersion, '0.2.2-rc.1')
})

test('a deliberately pinned runtime version is not migrated', async (t) => {
  const home = await makeHome(t)
  const root = join(home, 'ssh-remote')
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'state.json'), JSON.stringify({
    version: 1,
    settings: { dshVersion: '0.2.1-rc.4' },
    hosts: [],
    workspaces: []
  }), 'utf8')

  const store = new RemoteStore({ dshHome: home })
  await store.load()
  assert.equal(store.settings.dshVersion, '0.2.1-rc.4')
})

test('an unreadable state file blocks every write instead of clearing data', async (t) => {
  const home = await makeHome(t)
  const root = join(home, 'ssh-remote')
  await mkdir(root, { recursive: true })
  // Point state.json at a directory: reading it fails with EISDIR/EPERM, which
  // must not be mistaken for "no state yet".
  await mkdir(join(root, 'state.json'))

  const store = new RemoteStore({ dshHome: home })
  await assert.rejects(() => store.load())
  assert.ok(store.loadError)
  await assert.rejects(() => store.save(), /拒绝覆盖/u)
})
