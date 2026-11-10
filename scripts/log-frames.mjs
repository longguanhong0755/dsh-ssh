// Zstandard session-log framing shared by the maintenance scripts.
//
// `@deepseek-ai/dsh-session-persistence-jsonl` reads a stored log's header from
// the FIRST frame only and asserts that frame holds exactly one line
// ("corrupt Zstandard session log: first frame is not exactly one header line").
// A log whose first frame carries the events too is therefore dropped from
// `list()` — the session silently disappears from the sidebar — while an
// ordinary "decompress every frame" reader still sees a perfectly valid log.
// Every writer in this package goes through `packLog` so the layout cannot
// regress.
import zlib from 'node:zlib'

const MAGIC = 0xfd2fb528

/** Frame size used for event chunks; well under the 1 MiB a reader may expect. */
export const DEFAULT_CHUNK = 64 * 1024

/**
 * Walk the frame boundaries of a Zstandard stream.
 * @param {Buffer} buf
 * @returns {{ frames: {start: number, end: number}[], skippable: {start: number, end: number}[], trailing: number }}
 */
export function scanFrames(buf) {
  const frames = []
  const skippable = []
  let pos = 0
  while (pos + 4 <= buf.length) {
    const magic = buf.readUInt32LE(pos)
    if ((magic & 0xfffffff0) === 0x184d2a50) {
      const size = buf.readUInt32LE(pos + 4)
      skippable.push({ start: pos, end: pos + 8 + size })
      pos += 8 + size
      continue
    }
    if (magic !== MAGIC) break
    const start = pos
    pos += 4
    const descriptor = buf[pos]
    pos += 1
    const fcsFlag = descriptor >> 6
    const single = (descriptor >> 5) & 1
    const checksum = (descriptor >> 2) & 1
    const dictFlag = descriptor & 3
    if (!single) pos += 1
    pos += [0, 1, 2, 4][dictFlag]
    pos += fcsFlag === 0 ? (single ? 1 : 0) : [0, 2, 4, 8][fcsFlag]
    let bad = false
    for (;;) {
      if (pos + 3 > buf.length) {
        bad = true
        break
      }
      const head = buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16)
      pos += 3
      const last = head & 1
      const type = (head >> 1) & 3
      const size = head >> 3
      if (type === 3) {
        bad = true
        break
      }
      pos += type === 1 ? 1 : size
      if (last) break
    }
    if (bad) break
    if (checksum) pos += 4
    frames.push({ start, end: pos })
  }
  return { frames, skippable, trailing: pos }
}

/** Decompress every frame and return the whole text. */
export function decodeText(buf) {
  const { frames } = scanFrames(buf)
  if (!frames.length) throw new Error('no Zstandard frame found')
  const parts = frames.map((span) => zlib.zstdDecompressSync(buf.subarray(span.start, span.end)))
  return Buffer.concat(parts).toString('utf8')
}

/** Decompress only the first frame, which DSH treats as the header record. */
export function decodeFirstFrame(buf) {
  const { frames } = scanFrames(buf)
  if (!frames.length) throw new Error('no Zstandard frame found')
  return zlib.zstdDecompressSync(buf.subarray(frames[0].start, frames[0].end))
}

/**
 * Group whole lines into frames of at most `chunk` bytes. Every group ends with
 * the newline that terminates its last line, so concatenating the frames
 * reproduces the input byte for byte.
 */
export function chunkLines(lines, chunk = DEFAULT_CHUNK) {
  const out = []
  let current = []
  let size = 0
  for (const line of lines) {
    const bytes = Buffer.byteLength(line) + 1
    if (current.length && size + bytes > chunk) {
      out.push(current.map((item) => `${item}\n`).join(''))
      current = []
      size = 0
    }
    current.push(line)
    size += bytes
  }
  if (current.length) out.push(current.map((item) => `${item}\n`).join(''))
  return out
}

/** Why a first frame does not satisfy DSH, or null when it does. */
export function headerLineProblem(first) {
  if (first.length === 0) return 'first frame is empty'
  const nl = first.indexOf(10)
  if (nl !== first.length - 1) {
    const lines = first.toString('utf8').split('\n').length - (first[first.length - 1] === 10 ? 1 : 0)
    return `first frame holds ${lines} line(s), DSH requires exactly 1`
  }
  return null
}

function encode(framesPlain) {
  return Buffer.concat(framesPlain.map((plain) => zlib.zstdCompressSync(Buffer.from(plain, 'utf8'))))
}

/**
 * Frame a whole session log for DSH: header alone in frame 1, event lines in
 * newline-aligned chunks after it. Round-trip and layout are asserted before
 * anything is returned, so a caller can write the buffer without re-checking.
 * @param {string} text - complete log text, header line first.
 * @param {number} [chunk] - maximum plaintext bytes per event frame.
 */
export function packLog(text, chunk = DEFAULT_CHUNK) {
  const safe = text.endsWith('\n') ? text : `${text}\n`
  const all = safe.split('\n')
  all.pop()
  if (!all.length || !all[0].trim()) throw new Error('log has no header line')
  const header = `${all[0]}\n`
  const body = all.length > 1 ? chunkLines(all.slice(1), chunk) : []
  const buffer = encode([header, ...body])
  if (decodeText(buffer) !== safe) throw new Error('packed log does not round-trip')
  const frames = scanFrames(buffer).frames
  const problem = headerLineProblem(decodeFirstFrame(buffer))
  if (problem) throw new Error(`packed log violates the header-frame layout: ${problem}`)
  return { buffer, frames: frames.length, bytes: buffer.length, lines: all.length }
}
