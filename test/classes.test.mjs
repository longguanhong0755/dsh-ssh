import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { auditClasses } from '../scripts/classes.mjs'

async function fixture(style, parts) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-classes-'))
  await writeFile(join(dir, '30-styles.js'), style, 'utf8')
  for (const [name, source] of Object.entries(parts)) await writeFile(join(dir, name), source, 'utf8')
  return dir
}

test('the stylesheet covers every class the client builds', () => {
  const { used, missing } = auditClasses()
  assert.ok(used.size > 200, `only ${used.size} classes found — did the parts move?`)
  assert.deepEqual(missing, [], `no rule for: ${missing.join(', ')}`)
})

test('a class renamed on one side is reported', async () => {
  const dir = await fixture('.rem-card{padding:0}', {
    '60-part.js': "h('div', { className: 'rem-card rem-card-wide' })"
  })
  const { missing } = auditClasses(dir)
  assert.deepEqual(missing, ['rem-card-wide'])
})

test('template prefixes and non-plugin classes are ignored', async () => {
  const dir = await fixture('.rem-badge{color:red}', {
    '60-part.js': "h('span', { className: `rem-badge rem-badge-${tone} ds-button` })"
  })
  const { missing } = auditClasses(dir)
  assert.deepEqual(missing, [])
})