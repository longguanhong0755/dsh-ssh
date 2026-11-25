import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FALLBACK_DSH_VERSION,
  FALLBACK_NODE_VERSION,
  detectLocalDshEngines,
  detectLocalDshVersion,
  nodeMinimumFromEngines,
  portableNodeVersion,
  resolveRuntimeTarget,
  versionAtLeast
} from '../lib/dsh-version.js'

async function installDir(t, manifest) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-version-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  if (manifest) {
    const pkg = join(dir, 'node_modules', '@deepseek-ai', 'dsh')
    await mkdir(pkg, { recursive: true })
    await writeFile(join(pkg, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  }
  return dir
}

test('the desktop install directory names the running dsh build', async (t) => {
  const dir = await installDir(t, {
    name: '@deepseek-ai/dsh',
    version: '0.2.2-rc.5',
    engines: { node: '>=24.9.0' }
  })
  const env = { DSH_INSTALL_DIR: dir }
  assert.equal(detectLocalDshVersion({ env }), '0.2.2-rc.5')
  assert.equal(detectLocalDshEngines({ env }), '>=24.9.0')
})

test('DSH_VERSION wins over the manifest', async (t) => {
  const dir = await installDir(t, { name: '@deepseek-ai/dsh', version: '0.2.2-rc.5' })
  assert.equal(detectLocalDshVersion({ env: { DSH_INSTALL_DIR: dir, DSH_VERSION: '0.3.0' } }), '0.3.0')
})

test('an unrelated app manifest is not mistaken for dsh', async (t) => {
  const dir = await installDir(t, null)
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-desktop', version: '0.2.2-rc.5' }), 'utf8')
  assert.equal(detectLocalDshVersion({ env: { DSH_INSTALL_DIR: dir, DSH_HOME: '', DSH_PROFILE: '' } }), FALLBACK_DSH_VERSION)
})

test('an engines range becomes the lowest exact Node version', () => {
  assert.equal(nodeMinimumFromEngines('>=24.9.0'), '24.9.0')
  assert.equal(nodeMinimumFromEngines('>=24'), '24.0.0')
  assert.equal(nodeMinimumFromEngines('^22.23.2'), '22.23.2')
  assert.equal(nodeMinimumFromEngines('v24.9.0'), '24.9.0')
  assert.equal(nodeMinimumFromEngines(''), FALLBACK_NODE_VERSION)
})

test('Node comparison is numeric, not lexical', () => {
  assert.equal(versionAtLeast('v24.22.3', '24.9.0'), true)
  assert.equal(versionAtLeast('24.8.0', '24.9.0'), false)
  assert.equal(versionAtLeast('22.23.2', '24.9.0'), false)
  assert.equal(versionAtLeast('24.9.0', '24.9.0'), true)
  assert.equal(versionAtLeast('not-a-version', '24.9.0'), false)
})

test('an empty setting follows this computer; a pinned one wins', async (t) => {
  const dir = await installDir(t, { name: '@deepseek-ai/dsh', version: '0.2.2-rc.5', engines: { node: '>=24.9.0' } })
  const env = { DSH_INSTALL_DIR: dir }
  const auto = resolveRuntimeTarget({}, { env })
  assert.deepEqual(auto, { version: '0.2.2-rc.5', engines: '>=24.9.0', nodeMinimum: '24.9.0', source: 'manifest' })
  const pinned = resolveRuntimeTarget({ dshVersion: '0.2.2-rc.1' }, { env })
  assert.equal(pinned.version, '0.2.2-rc.1')
  assert.equal(pinned.source, 'settings')
  assert.equal(pinned.nodeMinimum, '24.9.0')
})

test('without a readable manifest the fallback keeps deployment working', () => {
  const target = resolveRuntimeTarget({}, { env: { DSH_INSTALL_DIR: '', DSH_HOME: '', DSH_PROFILE: '' } })
  assert.equal(target.version, FALLBACK_DSH_VERSION)
  assert.equal(target.nodeMinimum, FALLBACK_NODE_VERSION)
})

test('the portable Node follows the requirement unless pinned', async (t) => {
  const dir = await installDir(t, { name: '@deepseek-ai/dsh', version: '0.2.2-rc.5', engines: { node: '>=24.9.0' } })
  const env = { DSH_INSTALL_DIR: dir }
  assert.equal(portableNodeVersion({}, { env }), '24.9.0')
  assert.equal(portableNodeVersion({ nodeVersion: '22.23.2' }, { env }), '22.23.2')
})