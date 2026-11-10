// Restore the Zstandard session log frame layout DSH insists on:
//
//   frame 1  == exactly one line, the Session header record
//   frame 2+ == independently decodable frames holding the event lines
//
// `session-persistence-jsonl` reads a stored log's header from the FIRST frame
// only and asserts it is a single line ("first frame is not exactly one header
// line"). A log whose first frame carries thousands of events is therefore
// dropped from `list()` (it silently disappears from the session list), and the
// header probe throws for any open-by-id attempt too, while an ordinary
// "decompress every frame" reader still sees a perfectly valid log. The framing
// itself lives in ./log-frames.mjs so every writer shares it.
//
// usage:
//   node scripts/anchor-repack.mjs <file-or-dir> [...] [--write] [--chunk <bytes>]
//
// Without --write it only reports which logs violate the layout.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'

import {
  DEFAULT_CHUNK,
  decodeFirstFrame,
  decodeText,
  headerLineProblem,
  packLog,
  scanFrames
} from './log-frames.mjs'
import { expandTargets } from './log-targets.mjs'

const args = process.argv.slice(2)
const write = args.includes('--write')
const chunkAt = args.indexOf('--chunk')
const chunk = chunkAt >= 0 ? Number(args[chunkAt + 1]) || DEFAULT_CHUNK : DEFAULT_CHUNK
const inputs = args.filter((arg, index) => !arg.startsWith('--') && !(chunkAt >= 0 && index === chunkAt + 1))

const files = expandTargets(inputs)

let broken = 0
let repaired = 0
let unchanged = 0
const lines = []
for (const file of files) {
  const name = file.split(/[\\/]/).slice(-2).join('/')
  const buf = readFileSync(file)
  let text
  try {
    text = decodeText(buf)
  } catch (error) {
    broken += 1
    lines.push(`FAIL   ${name}  undecodable: ${error.message}`)
    continue
  }
  const { frames, skippable } = scanFrames(buf)
  const problem = headerLineProblem(decodeFirstFrame(buf))
  if (!problem) {
    unchanged += 1
    continue
  }
  if (!write) {
    broken += 1
    lines.push(`BROKEN ${name}  ${problem}  frames=${frames.length}`)
    continue
  }
  const packed = packLog(text, chunk)
  const backup = `${file}.bak-frames-${Date.now()}`
  copyFileSync(file, backup)
  writeFileSync(file, packed.buffer)
  repaired += 1
  lines.push(
    `FIXED  ${name}  ${problem}  frames=${frames.length} -> ${packed.frames}  bytes=${buf.length} -> ${packed.bytes}`
      + `${skippable.length ? `  skippable=${skippable.length}` : ''}  backup=${backup.split(/[\\/]/).pop()}`
  )
}

for (const line of lines) console.log(line)
console.log(
  write
    ? `repack: ${files.length} log(s), ${repaired} rewritten, ${unchanged} already valid, ${broken} unreadable`
    : `check: ${files.length} log(s), ${broken} violating the header-frame layout, ${unchanged} valid`
)
process.exitCode = broken && !write ? 1 : 0
