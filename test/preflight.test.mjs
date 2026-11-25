import test from 'node:test'
import assert from 'node:assert/strict'
import { runPreflight } from '../lib/preflight.js'

const SETTINGS = { dshVersion: '', nodeVersion: '' }

function markers(overrides = {}) {
  const values = {
    OS: 'Linux',
    ARCH: 'x86_64',
    USER: 'deploy',
    UID: '0',
    HOME: '/home/deploy',
    NODE: '/usr/bin/node',
    NODEV: 'v24.22.3',
    INIT: 'systemd',
    SYSTEMD: '/usr/bin/systemctl',
    CRON: '/usr/bin/crontab',
    SUDO: '/usr/bin/sudo',
    DISK: '/dev/sda1 1024000 200000 824000 20% /home/deploy',
    WRITE: 'yes',
    DSH: 'yes',
    ...overrides
  }
  return Object.entries(values).map(([key, value]) => `@@${key}@@${value}\n`).join('') + '@@END@@'
}

function managerFor(stdout, { fail = null, registryCode = '200' } = {}) {
  return {
    store: { settings: SETTINGS },
    pool: {
      exec: async (_host, command) => {
        if (fail && !command.includes('registry')) throw fail
        if (command.includes('registry') || command.includes('wget -q')) return { stdout: registryCode }
        return { stdout }
      }
    }
  }
}

const byId = (result) => Object.fromEntries(result.checks.map((row) => [row.id, row]))

test('a healthy Linux target passes and still reports the portable Node plan', async () => {
  const result = await runPreflight(managerFor(markers({ NODEV: 'v22.11.0' })), {}, { settings: SETTINGS })
  assert.equal(result.ok, true)
  const checks = byId(result)
  assert.equal(checks.platform.state, 'ok')
  assert.equal(checks.node.state, 'warn')
  assert.match(checks.node.detail, /便携 Node/u)
  assert.equal(checks.service.state, 'ok')
  assert.equal(checks.disk.state, 'ok')
  assert.equal(checks.registry.state, 'skip')
})

test('a non-Linux, full or read-only target blocks creation with a hint each', async () => {
  const result = await runPreflight(managerFor(markers({
    OS: 'Darwin',
    DISK: '/dev/disk1 1024000 1000000 1000 100% /Users/deploy',
    WRITE: 'no'
  })), {}, { settings: SETTINGS })
  assert.equal(result.ok, false)
  const errors = result.checks.filter((row) => row.state === 'error')
  assert.deepEqual(errors.map((row) => row.id).sort(), ['disk', 'platform', 'write'])
  for (const row of errors) assert.ok(row.hint, `${row.id} has no hint`)
})

test('a missing systemd falls back to a warning, not a failure', async () => {
  const result = await runPreflight(managerFor(markers({ INIT: 'init', SYSTEMD: '', CRON: '' })), {}, { settings: SETTINGS })
  assert.equal(result.ok, true)
  const checks = byId(result)
  assert.equal(checks.service.state, 'warn')
  assert.match(checks.service.detail, /重启后需手动连接/u)
})

test('remote-download mode probes the npm mirror', async () => {
  const ok = await runPreflight(managerFor(markers(), { registryCode: '200' }), { assetInstallMode: 'remote-download' }, { settings: SETTINGS })
  assert.equal(byId(ok).registry.state, 'ok')
  const bad = await runPreflight(managerFor(markers(), { registryCode: '503' }), { assetInstallMode: 'remote-download' }, { settings: SETTINGS })
  assert.equal(byId(bad).registry.state, 'warn')
  assert.ok(byId(bad).registry.hint)
  assert.equal(bad.ok, true)
})

test('a dead connection degrades instead of blocking the wizard', async () => {
  const result = await runPreflight(managerFor('', { fail: new Error('connect ECONNREFUSED') }), {}, { settings: SETTINGS })
  assert.equal(result.ok, true)
  assert.equal(result.degraded, true)
  assert.equal(result.checks.length, 1)
})

test('every row carries both languages and a fix for anything not ok', async () => {
  const result = await runPreflight(managerFor(markers({
    OS: 'Darwin',
    NODEV: 'v18.20.4',
    INIT: 'init',
    SYSTEMD: '',
    CRON: ''
  }), { registryCode: '503' }), { assetInstallMode: 'remote-download' }, { settings: SETTINGS })
  assert.ok(result.checks.length >= 8)
  for (const row of result.checks) {
    assert.ok(row.id, 'row without an id')
    assert.ok(row.title && row.titleEn, `${row.id} has no title pair`)
    assert.equal(typeof row.detailEn, 'string')
    assert.equal(typeof row.hintEn, 'string')
    if (row.state === 'error' || row.state === 'warn') {
      assert.ok(row.hint, `${row.id} has no hint`)
      assert.ok(row.hintEn, `${row.id} has no English hint`)
    }
  }
  // The English copy is a translation, not a copy of the Chinese sentence.
  const node = result.checks.find((row) => row.id === 'node')
  assert.notEqual(node.titleEn, node.title)
  assert.notEqual(node.hintEn, node.hint)
})