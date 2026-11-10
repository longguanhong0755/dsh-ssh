// Guard the Zstandard framing that decides whether DSH can see a session.
//
// A stored log is listed by `@deepseek-ai/dsh-session-persistence-jsonl` only
// when its FIRST frame decompresses to exactly one line — the header record.
// The earlier `doctor` writer packed a whole log into one frame, so the store
// threw `first frame is not exactly one header line` and every one of those
// sessions vanished from the sidebar while the log itself stayed valid. These
// tests pin both halves: the layout we write and the check that catches it.
import test from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'

import {
  DEFAULT_CHUNK,
  chunkLines,
  decodeFirstFrame,
  decodeText,
  headerLineProblem,
  packLog,
  scanFrames,
} from '../scripts/log-frames.mjs'

const header = JSON.stringify({
  id: 'session-00000000-0000-4000-8000-000000000000',
  version: 4,
  cwd: 'C:\\Users\\Administrator\\.dsh\\ssh-remote\\anchors\\ws-test-000000',
  createdAt: 1794000000000,
  isSeeded: false,
})

function logWithEvents(count, filler = 'x'.repeat(120)) {
  const rows = [header]
  for (let index = 0; index < count; index += 1) {
    rows.push(JSON.stringify({ seq: index, type: 'turn/start', data: { turn: index + 1, filler } }))
  }
  return `${rows.join('\n')}\n`
}

test('the header line travels alone in the first frame', () => {
  const text = logWithEvents(40)
  const { buffer, frames } = packLog(text)
  assert.ok(frames > 1, 'events must live in their own frames')
  assert.equal(decodeFirstFrame(buffer).toString('utf8'), `${header}\n`)
  assert.equal(headerLineProblem(decodeFirstFrame(buffer)), null)
})

test('packing preserves every byte of a large log', () => {
  const text = logWithEvents(3000)
  const { buffer, lines, bytes } = packLog(text)
  assert.equal(lines, 3001)
  assert.equal(decodeText(buffer), text)
  assert.equal(bytes, buffer.length)
  assert.ok(bytes > 0)
})

test('event frames stay inside the chunk budget and end on a line boundary', () => {
  const text = logWithEvents(300)
  const { buffer } = packLog(text, 4096)
  const { frames } = scanFrames(buffer)
  assert.ok(frames.length > 3)
  for (const span of frames.slice(1)) {
    const plain = zlib.zstdDecompressSync(buffer.subarray(span.start, span.end))
    assert.equal(plain[plain.length - 1], 10, 'a frame must end with a newline')
    assert.ok(plain.length <= 4096, `frame of ${plain.length} bytes exceeds the budget`)
  }
})

test('a single frame holding events is exactly what the store rejects', () => {
  const text = logWithEvents(50)
  const old = zlib.zstdCompressSync(Buffer.from(text, 'utf8'))
  const problem = headerLineProblem(decodeFirstFrame(old))
  assert.equal(problem, 'first frame holds 51 line(s), DSH requires exactly 1')
  // the same buffer is a perfectly ordinary log for a reader that concatenates frames
  assert.equal(decodeText(old), text)
})

test('an empty first frame and a missing header are reported, not silently accepted', () => {
  assert.equal(headerLineProblem(Buffer.alloc(0)), 'first frame is empty')
  assert.throws(() => packLog(''), /log has no header line/)
})

test('the header alone is a complete (if empty) log', () => {
  const { buffer, frames, lines } = packLog(`${header}\n`)
  assert.equal(frames, 1)
  assert.equal(lines, 1)
  assert.equal(decodeText(buffer), `${header}\n`)
})

test('a missing trailing newline is added instead of merging rows', () => {
  const text = `${header}\n{"seq":0}`
  const { buffer } = packLog(text)
  assert.equal(decodeText(buffer), `${header}\n{"seq":0}\n`)
})

test('chunking never splits a line and always reproduces the input', () => {
  const lines = Array.from({ length: 200 }, (_, index) => `${index}:`.padEnd(50, 'y'))
  const chunks = chunkLines(lines, 512)
  assert.equal(chunks.join(''), lines.map((line) => `${line}\n`).join(''))
  for (const chunk of chunks) {
    assert.ok(Buffer.byteLength(chunk) <= 512)
    assert.equal(chunk[chunk.length - 1], '\n')
  }
  assert.equal(chunkLines([], 512).length, 0)
})

test('packing is deterministic, so a re-run rewrites the same bytes', () => {
  const text = logWithEvents(120)
  const first = packLog(text)
  const second = packLog(decodeText(first.buffer))
  assert.equal(second.buffer.equals(first.buffer), true)
  assert.equal(second.frames, first.frames)
})

test('the default chunk keeps a long line in one piece', () => {
  const long = `{"seq":0,"data":"${'z'.repeat(DEFAULT_CHUNK + 10)}"}`
  const { buffer } = packLog(`${header}\n${long}\n`)
  const { frames } = scanFrames(buffer)
  assert.equal(frames.length, 2)
  assert.equal(decodeText(buffer), `${header}\n${long}\n`)
})
