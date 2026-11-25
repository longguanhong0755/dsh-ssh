// Every `rem-`/`sshR-` class the client builds must have a rule in the stylesheet.
//
// The CSS lives in one injected sheet and the markup is spread across parts, so
// a class that gets renamed on one side only has no compiler to complain: the
// element simply loses its box. This walks the parts, collects the class names
// that appear in a `className`, and diffs them against the selectors.
//
// Names ending in `-` are template prefixes (`rem-badge-${tone}`), which the
// splitter reduces to a stub; they are skipped on purpose.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const clientDir = join(here, '..', 'lib', 'client')
const STYLE_PART = '30-styles.js'

const CLASS = /^(?:rem|sshR)-[a-zA-Z0-9-]+$/u

/**
 * @returns {{ used: Map<string, Set<string>>, styled: Set<string>, missing: string[] }}
 */
export function auditClasses(dir = clientDir) {
  const styled = new Set(
    [...readFileSync(join(dir, STYLE_PART), 'utf8').matchAll(/\.((?:rem|sshR)-[a-zA-Z0-9-]+)/gu)].map((match) => match[1])
  )
  const used = new Map()
  for (const file of readdirSync(dir)) {
    if (!/^\d\d-/u.test(file) || file === STYLE_PART) continue
    const source = readFileSync(join(dir, file), 'utf8')
    for (const match of source.matchAll(/className:\s*(?:`([^`]*)`|'([^']*)'|"([^"]*)")/gu)) {
      const raw = match[1] ?? match[2] ?? match[3] ?? ''
      for (const token of raw.split(/[\s${}?:]+/u)) {
        const name = token.trim()
        if (!CLASS.test(name) || name.endsWith('-')) continue
        if (!used.has(name)) used.set(name, new Set())
        used.get(name).add(file)
      }
    }
  }
  const missing = [...used.keys()].filter((name) => !styled.has(name)).sort()
  return { used, styled, missing }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { used, styled, missing } = auditClasses()
  for (const name of missing) console.log(`unstyled class: ${name}`)
  console.log(`classes: ${used.size} used, ${styled.size} styled, ${missing.length} without a rule`)
  process.exitCode = missing.length > 0 ? 1 : 0
}