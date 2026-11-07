import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareRemoteCredentials } from '../lib/credentials.js'

const LOCAL_DOCUMENT = [
  'version: "1"',
  'refs:',
  '  DEEPSEEK_API_KEY: sk-local',
  'records:',
  '  client-connection/browser-session:',
  '    kind: grant',
  '    payload:',
  '      version: "1"',
  '      secret: abc',
  '  model/default:',
  '    kind: api-key',
  '    key: sk-record',
  ''
].join('\n')

test('quotes around the document version are removed', () => {
  const { text } = prepareRemoteCredentials('version: "1"\nrefs:\n  A: b\n')
  assert.ok(text.startsWith('version: 1\n'))
})

test('records the remote build cannot parse are dropped', () => {
  const { text, droppedRecords } = prepareRemoteCredentials(LOCAL_DOCUMENT)
  assert.equal(droppedRecords, 1)
  assert.match(text, /kind: api-key/u)
  assert.doesNotMatch(text, /browser-session/u)
  assert.doesNotMatch(text, /kind: grant/u)
})

test('refs and api-key records survive unchanged', () => {
  const { text } = prepareRemoteCredentials(LOCAL_DOCUMENT)
  assert.match(text, /refs:\n {2}DEEPSEEK_API_KEY: sk-local/u)
  assert.match(text, / {2}model\/default:\n {4}kind: api-key\n {4}key: sk-record/u)
})

test('a document with only unsupported records loses the empty section', () => {
  const { text, droppedRecords } = prepareRemoteCredentials([
    'version: "1"',
    'refs:',
    '  A: b',
    'records:',
    '  account/default:',
    '    kind: grant',
    ''
  ].join('\n'))
  assert.equal(droppedRecords, 1)
  assert.doesNotMatch(text, /^records:/mu)
})

test('a document the remote build already accepts is left alone', () => {
  const source = 'version: 1\nrefs:\n  A: b\nrecords:\n  default:\n    kind: api-key\n    key: k\n'
  const prepared = prepareRemoteCredentials(source)
  assert.equal(prepared.text, source)
  assert.equal(prepared.droppedRecords, 0)
})

test('an empty document stays empty', () => {
  assert.deepEqual(prepareRemoteCredentials(''), { text: '', droppedRecords: 0 })
  assert.deepEqual(prepareRemoteCredentials(undefined), { text: '', droppedRecords: 0 })
})
