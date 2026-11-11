import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SecretStore } from '../lib/secrets.js'
import { RemoteStore } from '../lib/store.js'

function failure(message, exitCode = 1) {
  return Object.assign(new Error(message), { exitCode })
}

/** Linux: secret-tool on stdin/stdout, exit 1 when the entry is missing. */
function linuxRunner(store = new Map(), { probeMissing = true } = {}) {
  const calls = []
  const run = async (command, args, options = {}) => {
    calls.push({ command, args, input: options.input || '' })
    if (command !== 'secret-tool') throw new Error(`unexpected command ${command}`)
    const account = args[args.indexOf('account') + 1]
    if (args[0] === 'lookup') {
      if (store.has(account)) return { stdout: store.get(account), stderr: '' }
      throw failure('', 1)
    }
    if (args[0] === 'store') {
      store.set(account, options.input)
      return { stdout: '', stderr: '' }
    }
    if (args[0] === 'clear') {
      store.delete(account)
      return { stdout: '', stderr: '' }
    }
    throw new Error(`unexpected secret-tool mode ${args[0]}`)
  }
  return { run, calls, store, probeMissing }
}

function windowsRunner(store = new Map()) {
  const calls = []
  const run = async (command, args, options = {}) => {
    calls.push({ command, args, input: options.input || '' })
    assert.equal(command, 'powershell.exe')
    assert.ok(args.includes('-EncodedCommand'))
    const request = JSON.parse(Buffer.from(String(options.input || '').trim(), 'base64').toString('utf8'))
    if (request.action === 'readMany') {
      const lines = request.ids
        .filter((id) => store.has(id))
        .map((id) => `${id}\t${Buffer.from(store.get(id), 'utf8').toString('base64')}`)
      return { stdout: lines.length ? `${lines.join('\r\n')}\r\n` : '', stderr: '' }
    }
    if (request.action === 'write') {
      store.set(request.id, Buffer.from(request.payload, 'base64').toString('utf8'))
      return { stdout: 'ok\r\n', stderr: '' }
    }
    if (request.action === 'delete') {
      const removed = store.delete(request.id)
      return { stdout: removed ? 'removed\r\n' : 'missing\r\n', stderr: '' }
    }
    throw new Error(`unexpected action ${request.action}`)
  }
  return { run, calls, store }
}

/** macOS: the write goes through `security -i`, the stored value is base64. */
function macRunner(store = new Map()) {
  const calls = []
  const run = async (command, args, options = {}) => {
    calls.push({ command, args, input: options.input || '' })
    assert.equal(command, 'security')
    if (args[0] === '-i') {
      const line = String(options.input || '').trim()
      const match = /-a (\S+) -w (\S+)$/u.exec(line)
      if (!match) throw new Error(`unparsable security command: ${line}`)
      store.set(match[1], match[2])
      return { stdout: 'password has been added to keychain.\n', stderr: '' }
    }
    if (args[0] === 'find-generic-password') {
      const account = args[args.indexOf('-a') + 1]
      if (!store.has(account)) throw failure('security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.', 44)
      return { stdout: `${store.get(account)}\n`, stderr: '' }
    }
    if (args[0] === 'delete-generic-password') {
      const account = args[args.indexOf('-a') + 1]
      if (!store.delete(account)) throw failure('not found', 44)
      return { stdout: '', stderr: '' }
    }
    throw new Error(`unexpected security mode ${args[0]}`)
  }
  return { run, calls, store }
}

test('no usable backend leaves the plaintext fallback alone', async () => {
  const run = async () => {
    throw Object.assign(new Error('spawn secret-tool ENOENT'), { code: 'ENOENT' })
  }
  const secrets = new SecretStore({ platform: 'linux', run })
  assert.equal(await secrets.backend(), '')
  assert.equal(await secrets.write('host-1', { password: 'x' }), false)
  assert.equal(await secrets.read('host-1'), null)
})

test('a Linux D-Bus failure is reported as no backend', async () => {
  const run = async () => {
    throw failure('Cannot autolaunch D-Bus without X11 $DISPLAY', 1)
  }
  const secrets = new SecretStore({ platform: 'linux', run })
  assert.equal(await secrets.backend(), '')
})

test('libsecret reads and writes the JSON payload on stdin', async () => {
  const { run, store } = linuxRunner()
  const secrets = new SecretStore({ platform: 'linux', run })
  assert.equal(await secrets.backend(), 'libsecret')
  assert.equal(await secrets.write('host-1', { password: 'p@ss word', passphrase: 'kp' }), true)
  assert.equal(JSON.parse(store.get('host-1')).password, 'p@ss word')
  assert.deepEqual(await secrets.read('host-1'), { password: 'p@ss word', passphrase: 'kp' })
  assert.equal(await secrets.read('host-2'), null)
  assert.equal(await secrets.remove('host-1'), true)
  assert.equal(await secrets.read('host-1'), null)
})

test('Windows Credential Manager uses one encoded PowerShell call per read', async () => {
  const { run, store, calls } = windowsRunner(new Map([['host-1', JSON.stringify({ password: 's3cret', passphrase: '' })]]))
  const secrets = new SecretStore({ platform: 'win32', run })
  assert.equal(await secrets.backend(), 'windows')
  assert.deepEqual(await secrets.readMany(['host-1', 'host-2']), new Map([
    ['host-1', { password: 's3cret', passphrase: '' }]
  ]))
  assert.equal(calls.length, 1)
  assert.ok(!String(calls[0].input).includes('s3cret'), 'secret must not be in the request line')
  assert.equal(await secrets.write('host-2', { password: 'other' }), true)
  assert.equal(JSON.parse(store.get('host-2')).password, 'other')
  assert.equal(await secrets.remove('host-2'), true)
  assert.equal(store.has('host-2'), false)
})

test('macOS keeps the raw password out of argv and decodes the stored envelope', async () => {
  const { run, store, calls } = macRunner()
  const secrets = new SecretStore({ platform: 'darwin', run })
  assert.equal(await secrets.backend(), 'macos')
  assert.equal(await secrets.write('host-1', { password: 'hunter2', passphrase: '' }), true)
  const writeCall = calls.find((call) => call.args[0] === '-i')
  assert.ok(writeCall, 'write must use security -i')
  assert.ok(!writeCall.args.join(' ').includes('hunter2'), 'secret must not be an argv token')
  const envelope = store.get('host-1')
  assert.ok(!envelope.includes('hunter2'), 'the keychain value is the base64 envelope')
  assert.equal(JSON.parse(Buffer.from(envelope, 'base64').toString('utf8')).password, 'hunter2')
  assert.deepEqual(await secrets.read('host-1'), { password: 'hunter2', passphrase: '' })
  assert.equal(await secrets.read('host-2'), null)
})

function fakeSecrets({ backend = 'windows', initial = new Map() } = {}) {
  const data = new Map(initial)
  const calls = []
  return {
    data,
    calls,
    backend: async () => backend,
    read: async (id) => data.get(id) || null,
    readMany: async (ids) => new Map(ids.filter((id) => data.has(id)).map((id) => [id, data.get(id)])),
    write: async (id, value) => {
      calls.push(['write', id])
      if (!backend) return false
      data.set(id, value)
      return true
    },
    remove: async (id) => {
      calls.push(['remove', id])
      data.delete(id)
      return true
    }
  }
}

async function makeHome(t) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-ssh-secrets-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  return home
}

async function seedState(home, hosts) {
  const root = join(home, 'ssh-remote')
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'state.json'), JSON.stringify({
    version: 1,
    settings: { zcodeImportDone: true },
    hosts,
    workspaces: []
  }), 'utf8')
}

const HOST = {
  id: 'host-1',
  kind: 'ssh',
  name: 'dev-1',
  host: '10.0.0.1',
  port: 22,
  username: 'root',
  auth: { kind: 'password', password: 'plain-secret', passphrase: '' }
}

test('loading migrates plaintext into the OS store and strips the file', async (t) => {
  const home = await makeHome(t)
  await seedState(home, [HOST])
  const secrets = fakeSecrets()
  const store = new RemoteStore({ dshHome: home, secrets })
  await store.load()

  const saved = JSON.parse(await readFile(join(home, 'ssh-remote', 'state.json'), 'utf8'))
  assert.equal(saved.hosts[0].auth.password, '')
  assert.equal(saved.hosts[0].auth.secretBackend, 'windows')
  assert.equal(secrets.data.get('host-1').password, 'plain-secret')
  // The running process still needs the secret; only the file loses it.
  assert.equal(store.host('host-1').auth.password, 'plain-secret')
  assert.deepEqual(store.secretStatus(), { enabled: true, backend: 'windows', keychain: 1, plaintext: 0, migrated: 1 })
})

test('a later start hydrates the record from the OS store', async (t) => {
  const home = await makeHome(t)
  await seedState(home, [{ ...HOST, auth: { kind: 'password', password: '', passphrase: '', secretBackend: 'windows' } }])
  const secrets = fakeSecrets({ initial: new Map([['host-1', { password: 'from-vault', passphrase: '' }]]) })
  const store = new RemoteStore({ dshHome: home, secrets })
  await store.load()
  assert.equal(store.host('host-1').auth.password, 'from-vault')
  assert.equal(store.host('host-1').auth.secretBackend, 'windows')
  assert.equal(store.secretStatus().plaintext, 0)
})

test('a failed keychain write keeps the plaintext and reports it', async (t) => {
  const home = await makeHome(t)
  await seedState(home, [HOST])
  const secrets = fakeSecrets({ backend: '' })
  const store = new RemoteStore({ dshHome: home, secrets })
  await store.load()
  const saved = JSON.parse(await readFile(join(home, 'ssh-remote', 'state.json'), 'utf8'))
  assert.equal(saved.hosts[0].auth.password, 'plain-secret')
  assert.equal(saved.hosts[0].auth.secretBackend, undefined)
  assert.equal(store.secretStatus().plaintext, 1)
})

test('saving a new host writes the secret to the store, not the file', async (t) => {
  const home = await makeHome(t)
  await seedState(home, [])
  const secrets = fakeSecrets()
  const store = new RemoteStore({ dshHome: home, secrets })
  await store.load()
  await store.upsertHost({
    host: 'example.com',
    username: 'root',
    auth: { kind: 'password', password: 'new-password' }
  })
  const saved = JSON.parse(await readFile(join(home, 'ssh-remote', 'state.json'), 'utf8'))
  assert.equal(saved.hosts[0].auth.password, '')
  assert.equal(saved.hosts[0].auth.secretBackend, 'windows')
  assert.equal(secrets.data.get(saved.hosts[0].id).password, 'new-password')

  // An edit that leaves the password blank keeps the stored one.
  await store.upsertHost({ id: saved.hosts[0].id, host: 'example.com', username: 'root', auth: { kind: 'password', password: '' } })
  assert.equal(secrets.data.get(saved.hosts[0].id).password, 'new-password')
})

test('removing a host removes its stored credential', async (t) => {
  const home = await makeHome(t)
  await seedState(home, [])
  const secrets = fakeSecrets()
  const store = new RemoteStore({ dshHome: home, secrets })
  await store.load()
  const saved = await store.upsertHost({ host: 'example.com', auth: { kind: 'password', password: 'bye' } })
  assert.ok(secrets.data.has(saved.id))
  await store.removeHost(saved.id, { cascade: true })
  assert.equal(secrets.data.has(saved.id), false)
  assert.ok(secrets.calls.some(([op, id]) => op === 'remove' && id === saved.id))
})

test('secretWrites:false reads but never mutates the credential store', async (t) => {
  const home = await makeHome(t)
  await seedState(home, [HOST])
  const secrets = fakeSecrets()
  const store = new RemoteStore({ dshHome: home, secrets, secretWrites: false })
  await store.load()
  const saved = JSON.parse(await readFile(join(home, 'ssh-remote', 'state.json'), 'utf8'))
  assert.equal(saved.hosts[0].auth.password, 'plain-secret')
  assert.equal(secrets.calls.length, 0)
  assert.equal(store.host('host-1').auth.password, 'plain-secret')
})
