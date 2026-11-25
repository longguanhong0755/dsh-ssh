// The public error table is generated, so it must match the catalog: a hint
// edited in lib/errors.js without regenerating docs would reach users stale.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { renderErrorTable } from '../scripts/errors-doc.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

test('docs/errors.md matches the error catalog', async () => {
  const current = await readFile(join(root, 'docs', 'errors.md'), 'utf8')
  assert.equal(current, renderErrorTable(), 'run `npm run docs:errors`')
})