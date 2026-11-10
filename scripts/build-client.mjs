// `npm run build:client`: regenerate lib/client.js from lib/client/*.js.
//
// lib/client.js is a classic browser script (no bundler, no ES modules): DSH
// serves it and it registers itself through window.__ModuleLoader__.load(...).
// The hand-written source lives in lib/client/ as ordered text slices of that one
// file, so this "build" is a plain concat in filename order -- there is nothing
// to transpile and no dependency graph to resolve.
//
// Conventions enforced here:
//   * every part starts with a `// part: <name> -- <concern>` line, which is
//     build metadata and is NOT written to lib/client.js (it is the only line a
//     part may add, so the concatenated body stays byte-identical to the bundle
//     the parts were cut from);
//   * parts are plain text slices: no reformatting, no newline translation, no
//     banner, no trailing newline added;
//   * the run is deterministic and idempotent (same input -> same bytes).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const partsDir = path.join(root, 'lib', 'client')
const outFile = path.join(root, 'lib', 'client.js')
const HEADER = /^\/\/ part:\s*\S/u

const parts = readdirSync(partsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
  .map((entry) => entry.name)
  .sort()

if (parts.length === 0) throw new Error(`no parts found in ${partsDir}`)

const chunks = []
for (const name of parts) {
  const text = readFileSync(path.join(partsDir, name), 'utf8')
  const eol = text.indexOf('\n')
  const firstLine = eol === -1 ? text : text.slice(0, eol)
  if (!HEADER.test(firstLine)) {
    throw new Error(`lib/client/${name}: first line must be "// part: <name> -- <concern>"`)
  }
  chunks.push(eol === -1 ? '' : text.slice(eol + 1))
}

const body = chunks.join('')
writeFileSync(outFile, body, 'utf8')

const lineCount = body === '' ? 0 : body.split('\n').length - (body.endsWith('\n') ? 1 : 0)
console.log(`built lib/client.js from ${parts.length} parts (${lineCount} lines)`)
