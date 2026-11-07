// Credentials documents written by the local app are newer than the pinned
// dsh build the plugin installs remotely. That build's credentials-local
// parser only admits `version: 1` as a number and `records` entries tagged
// `kind: api-key`; anything else fails its activation and the whole remote
// Web profile exits with "startup failed" (SELinux hosts surfaced this as a
// misleading 203/EXEC first). The sync step therefore rewrites the document
// into the shape the remote build reads: model keys stay in `refs`, browser
// session / account grants are dropped.

const REMOTE_RECORD_KINDS = new Set(['api-key'])

function topLevelKey(line) {
  const match = /^([A-Za-z_][\w.-]*)\s*:/u.exec(line)
  return match ? match[1] : null
}

function indentOf(line) {
  return /^\s*/u.exec(line)[0].length
}

function recordKind(lines) {
  for (const line of lines) {
    const match = /^\s+kind\s*:\s*(.+?)\s*$/u.exec(line)
    if (match) return match[1].replace(/^["']|["']$/gu, '')
  }
  return ''
}

// Split a records section into entries (one per child key) and keep only the
// tags the remote parser knows. Returns the surviving lines plus the number of
// dropped entries so the caller can tell the user what was left behind.
function filterRecords(body) {
  const indents = body.filter((line) => line.trim() !== '').map(indentOf)
  if (indents.length === 0) return { lines: body, dropped: 0 }
  const entryIndent = Math.min(...indents)
  const preamble = []
  const entries = []
  let current = null
  for (const line of body) {
    const startsEntry = line.trim() !== '' && indentOf(line) === entryIndent
    if (startsEntry) {
      if (current) entries.push(current)
      current = [line]
    } else if (current) {
      current.push(line)
    } else {
      preamble.push(line)
    }
  }
  if (current) entries.push(current)
  const kept = [...preamble]
  let dropped = 0
  for (const entry of entries) {
    if (REMOTE_RECORD_KINDS.has(recordKind(entry))) kept.push(...entry)
    else dropped += 1
  }
  return { lines: kept, dropped }
}

export function prepareRemoteCredentials(text) {
  const source = String(text ?? '')
  if (source.trim() === '') return { text: source, droppedRecords: 0 }
  const sections = []
  let current = { key: null, lines: [] }
  for (const line of source.split('\n')) {
    const key = topLevelKey(line)
    if (key) {
      sections.push(current)
      current = { key, lines: [line] }
    } else {
      current.lines.push(line)
    }
  }
  sections.push(current)

  const out = []
  let droppedRecords = 0
  for (const section of sections) {
    if (section.key === 'version') {
      const header = section.lines[0]
      // A quoted scalar is valid YAML but this build compares the parsed value
      // with the number 1, so `version: "1"` is rejected.
      out.push(/^version\s*:\s*(["'])1\1\s*$/u.test(header) ? 'version: 1' : header)
      out.push(...section.lines.slice(1))
      continue
    }
    if (section.key !== 'records') {
      out.push(...section.lines)
      continue
    }
    const filtered = filterRecords(section.lines.slice(1))
    droppedRecords += filtered.dropped
    if (filtered.lines.join('').trim() === '') continue
    out.push(section.lines[0], ...filtered.lines)
  }
  return { text: out.join('\n'), droppedRecords }
}
