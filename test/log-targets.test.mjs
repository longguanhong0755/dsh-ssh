// The maintenance scripts take either a log file or a directory tree; both
// layouts DSH produces are nested (`sessions/<slug>--/<session-id>/log` and
// `sessions/<slug>--/log`), so the walk has to recurse and pick only logs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { LOG_FILE, expandTargets } from '../scripts/log-targets.mjs'

function tree(spec) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-log-targets-'))
  for (const [rel, body] of Object.entries(spec)) {
    const full = join(root, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, body ?? '')
  }
  return root
}

test('a directory expands to every stored log below it', () => {
  const root = tree({
    [`a/${LOG_FILE}`]: 'one',
    [`b/session-x/${LOG_FILE}`]: 'two',
    [`b/session-y/${LOG_FILE}`]: 'three',
    ['b/session-y/notes.txt']: 'ignore me',
    [`c/${LOG_FILE}.bak-doctor-1`]: 'backup',
  })
  const files = expandTargets([root])
  assert.equal(files.length, 3)
  assert.ok(files.every((file) => file.endsWith(LOG_FILE)))
  assert.ok(files.every((file) => file.startsWith(root)))
})

test('a file argument is passed through untouched', () => {
  const root = tree({ [`a/${LOG_FILE}`]: 'one' })
  const direct = join(root, 'a', LOG_FILE)
  assert.deepEqual(expandTargets([direct]), [direct])
})

test('a directory with no logs yields nothing instead of throwing', () => {
  const root = tree({ ['ws-abc/readme.txt']: 'anchor cwd only' })
  assert.deepEqual(expandTargets([root]), [])
})

test('several targets keep their order', () => {
  const first = tree({ [`a/${LOG_FILE}`]: 'one' })
  const second = tree({ [`b/${LOG_FILE}`]: 'two' })
  const files = expandTargets([first, second])
  assert.equal(files.length, 2)
  assert.ok(files[0].startsWith(first))
  assert.ok(files[1].startsWith(second))
})
