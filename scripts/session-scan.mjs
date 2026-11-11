// Read-only health scan of DSH session logs on THIS machine.
//
// The GUI silently drops a session from the sidebar when its log violates the
// storage invariants (see scripts/log-frames.mjs), so a broken log looks like
// "my session disappeared" or "this chat will not open" with no error anywhere.
// This scan reports, for every `session.v4.jsonl.zstd` under DSH_HOME/sessions:
//
//   * frame layout           - first frame must hold exactly one header line
//   * decompression          - every frame must decode
//   * line integrity         - every line must be JSON, header first
//   * tail state             - last event type, so a wedged turn is visible
//
// Nothing is written. Exit code 1 means at least one session is unhealthy.
//
//   node scripts/session-scan.mjs [root ...] [--json] [--quiet]
import fs from 'node:fs'
import path from 'node:path'
import { decodeFirstFrame, decodeText, headerLineProblem, scanFrames } from './log-frames.mjs'

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const quiet = args.includes('--quiet')
const roots = args.filter((arg) => !arg.startsWith('--'))
if (!roots.length) roots.push(path.join(process.env.DSH_HOME || path.join(process.env.USERPROFILE || '.', '.dsh'), 'sessions'))

const LOG_NAME = 'session.v4.jsonl.zstd'

/** Every `<root>/<workspace>/<session>/session.v4.jsonl.zstd` under `root`. */
function collect(root) {
  const out = []
  const workspaces = fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }) : []
  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue
    const workspaceDir = path.join(root, workspace.name)
    for (const session of fs.readdirSync(workspaceDir, { withFileTypes: true })) {
      if (!session.isDirectory()) continue
      const file = path.join(workspaceDir, session.name, LOG_NAME)
      if (fs.existsSync(file)) out.push({ workspace: workspace.name, session: session.name, file })
    }
  }
  return out
}

/** Header record of a log, or null when the first line is not JSON. */
function parseHeader(text) {
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

/** Inspect one log; `problems` is empty for a healthy session. */
function inspect(entry) {
  const problems = []
  const row = { workspace: entry.workspace, session: entry.session, bytes: 0, frames: 0, lines: 0, lastType: null, header: null, problems }
  let buffer
  try {
    buffer = fs.readFileSync(entry.file)
  } catch (error) {
    problems.push(`unreadable: ${error.message}`)
    return row
  }
  row.bytes = buffer.length
  if (!buffer.length) {
    problems.push('empty file')
    return row
  }
  let frames = []
  try {
    frames = scanFrames(buffer).frames
  } catch (error) {
    problems.push(`frame scan failed: ${error.message}`)
  }
  row.frames = frames.length
  if (!frames.length) {
    problems.push('no Zstandard frame found')
    return row
  }
  try {
    const first = decodeFirstFrame(buffer)
    const problem = headerLineProblem(first)
    if (problem) problems.push(problem)
    row.header = parseHeader(first.toString('utf8').split('\n')[0])
    if (!row.header) problems.push('header line is not a JSON object')
  } catch (error) {
    problems.push(`first frame does not decode: ${error.message}`)
    return row
  }
  let text
  try {
    text = decodeText(buffer)
  } catch (error) {
    problems.push(`log does not decode: ${error.message}`)
    return row
  }
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  else problems.push('log does not end with a newline')
  row.lines = lines.length
  const bad = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim()) {
      bad.push(index + 1)
      continue
    }
    try {
      const value = JSON.parse(line)
      if (index === lines.length - 1 && value && typeof value.type === 'string') row.lastType = value.type
    } catch {
      bad.push(index + 1)
    }
  }
  if (bad.length) problems.push(`${bad.length} invalid JSON line(s): ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? '…' : ''}`)
  return row
}

const rows = roots.flatMap((root) => collect(root)).map(inspect)
const broken = rows.filter((row) => row.problems.length)

if (asJson) {
  process.stdout.write(`${JSON.stringify({ roots, rows }, null, 2)}\n`)
} else {
  const healthy = rows.length - broken.length
  if (!quiet || broken.length) {
    for (const row of rows) {
      const mark = row.problems.length ? 'FAIL' : ' ok '
      console.log(`${mark} ${row.workspace}\\${row.session}  ${row.lines} line(s), ${row.frames} frame(s), ${row.bytes} B, last=${row.lastType || '-'}`)
      for (const problem of row.problems) console.log(`       ! ${problem}`)
    }
    console.log(`\n${healthy}/${rows.length} healthy under ${roots.join(', ')}`)
  }
}
process.exitCode = broken.length ? 1 : 0
