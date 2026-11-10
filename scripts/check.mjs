// `npm run check`: syntax-check every shipped module without a test run.
//
// The sources live in nested folders (`lib/bridge/*.js`), so the walk is
// recursive; a top-level-only list silently skips every file an edit can break.
//
// `lib/client/*.js` holds the hand-written parts of the browser script: they are
// plain slices of the single `lib/client.js` the host loads, so one part on its
// own is an unterminated expression by design. The generated bundle
// (`lib/client.js`) is parsed here instead — a broken part cannot survive
// `npm run build:client` + this check.
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const PART_DIRS = new Set([join('lib', 'client')])

let checked = 0
function walk(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    // A missing root is a mistake in the caller, not a pass: see the guard below.
    return
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.') || PART_DIRS.has(path)) continue
      walk(path)
      continue
    }
    if (!/\.(?:m?js)$/u.test(entry.name)) continue
    execFileSync(process.execPath, ['--check', path], { stdio: 'inherit' })
    checked += 1
  }
}

for (const dir of ['lib', 'bin', 'scripts']) walk(dir)
if (checked === 0) {
  console.error('check: no files found — run this from the package root')
  process.exit(1)
}
console.log(`check: ${checked} file(s) parsed`)
