// Generate docs/errors.md from the error catalog in lib/errors.js, so the
// public table can never drift from what the plugin actually sends.
//
//   node scripts/errors-doc.mjs          # write docs/errors.md
//   node scripts/errors-doc.mjs --check  # exit 1 when the file is stale
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ERROR_CATALOG } from '../lib/errors.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const target = join(root, 'docs', 'errors.md')

export function renderErrorTable() {
  const entries = Object.entries(ERROR_CATALOG).sort(([left], [right]) => left.localeCompare(right))
  const zh = entries.map(([code, entry]) => `| \`${code}\` | ${entry.hint} | ${entry.retryable ? '是' : '否'} |`)
  const en = entries.map(([code, entry]) => `| \`${code}\` | ${entry.hintEn} | ${entry.retryable ? 'Yes' : 'No'} |`)
  return [
    '# Error codes',
    '',
    'Generated from `lib/errors.js` — run `npm run docs:errors` after changing the catalog.',
    '',
    'Every failed API response carries `code`, `error`, `hint` and `retryable`. The',
    'wizard and the diagnostics page show `hint` under the failure, so a red line',
    'always comes with the next action.',
    '',
    '## 中文',
    '',
    '| 代码 | 处理方式 | 可重试 |',
    '| --- | --- | --- |',
    ...zh,
    '',
    '## English',
    '',
    '| Code | What to do | Retryable |',
    '| --- | --- | --- |',
    ...en,
    ''
  ].join('\n')
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1].replace(/\\/gu, '/')}`))
if (invokedDirectly) {
  const text = renderErrorTable()
  if (process.argv.includes('--check')) {
    const current = await readFile(target, 'utf8').catch(() => '')
    if (current !== text) {
      console.error('docs/errors.md is stale; run: npm run docs:errors')
      process.exit(1)
    }
    console.log('docs/errors.md is up to date')
  } else {
    await writeFile(target, text)
    console.log(`wrote ${target}`)
  }
}