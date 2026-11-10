// Scan and repair DSH anchor session logs (v4 jsonl.zstd) so that the native
// reader can load them again.
//
// The bridge used to write step coordinates straight from the remote runtime
// (a per-session counter) while the anchor log numbers steps per turn, and it
// could close a step without settling a tool call. Both defects leave the log
// structurally invalid, and dsh refuses to load the whole conversation.
//
// Rules implemented here mirror @deepseek-ai/dsh-session-format-v3-to-v4
// (`Relationships`), which is the validator dsh runs on restore:
//   turn/start  must equal nextTurn while no turn is open
//   step/start  must equal nextStep (1..N per turn) while no step is open
//   step/end    must match the open turn AND step, and no tool may be open
//   turn/end    must match the open turn with no open step and no open tool
//   tool/call   must match a tool-call block advertised by assistant/message
//   tool/result must close an open call, or be the TOOL_NOT_STARTED repair
//
// usage:
//   node anchor-doctor.mjs scan   <session.v4.jsonl.zstd> [...]
//   node anchor-doctor.mjs repair <session.v4.jsonl.zstd> [--write]
import { readFileSync, writeFileSync, copyFileSync, statSync } from 'node:fs'
import zlib from 'node:zlib'
import { isDeepStrictEqual } from 'node:util'

import { decodeFirstFrame, headerLineProblem, packLog } from './log-frames.mjs'
import { expandTargets, LOG_FILE } from './log-targets.mjs'

const MAGIC = 0xfd2fb528
// The lifecycle rules live in the harness's own format package. The installed
// app is a packed asar, so this reads an extracted copy of that one module:
// point `--validator` at it once if the default below does not exist (see the
// README section "Repairing an unreadable bridged session").
const MODULE = resolveValidatorPath()
const TOOL_NOT_STARTED_TEXT = 'The tool call was interrupted before the Harness recorded it as started. Retry it if it is still needed.'

function walkFrames(buf) {
  const out = []
  let pos = 0
  let truncatedAt = null
  while (pos + 4 <= buf.length) {
    const magic = buf.readUInt32LE(pos)
    if ((magic & 0xfffffff0) === 0x184d2a50) {
      pos += 8 + buf.readUInt32LE(pos + 4)
      continue
    }
    if (magic !== MAGIC) {
      truncatedAt = pos
      break
    }
    const start = pos
    pos += 4
    const fhd = buf[pos]
    pos += 1
    const fcsFlag = fhd >> 6
    const single = (fhd >> 5) & 1
    const checksum = (fhd >> 2) & 1
    const dictFlag = fhd & 3
    if (!single) pos += 1
    pos += [0, 1, 2, 4][dictFlag]
    pos += fcsFlag === 0 ? (single ? 1 : 0) : [0, 2, 4, 8][fcsFlag]
    for (;;) {
      if (pos + 3 > buf.length) {
        truncatedAt = start
        return { frames: out, truncatedAt }
      }
      const head = buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16)
      pos += 3
      const last = head & 1
      const type = (head >> 1) & 3
      const size = head >> 3
      if (type === 3) {
        truncatedAt = start
        return { frames: out, truncatedAt }
      }
      pos += type === 1 ? 1 : size
      if (last) break
    }
    if (checksum) pos += 4
    out.push({ start, end: pos })
  }
  return { frames: out, truncatedAt }
}

function readLog(file) {
  const buf = readFileSync(file)
  const { frames, truncatedAt } = walkFrames(buf)
  const parts = []
  for (const frame of frames) parts.push(zlib.zstdDecompressSync(buf.subarray(frame.start, frame.end)))
  const text = Buffer.concat(parts).toString('utf8')
  const lines = text.split('\n')
  const header = JSON.parse(lines.shift())
  const events = []
  let partial = null
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      partial = line.slice(0, 160)
    }
  }
  return { buf, frames: frames.length, truncatedAt, header, events, partial }
}

/**
 * Rewrite the log with the layout DSH requires: the header alone in the first
 * Zstandard frame, the events in newline-aligned chunks after it. Writing the
 * whole log into one frame is what made repaired sessions vanish from the
 * session list, so the framing comes from ./log-frames.mjs and is asserted
 * before anything touches the file.
 */
function writeLog(file, header, events, { keepBackup = true } = {}) {
  const text = `${JSON.stringify(header)}\n${events.map((event) => JSON.stringify(event)).join('\n')}\n`
  const packed = packLog(text)
  if (keepBackup) copyFileSync(file, `${file}.bak-doctor-${Date.now()}`)
  writeFileSync(file, packed.buffer)
  return packed
}

// Resolution order: `--validator <path>` (also honoured from the environment by
// the CLI), then the dev checkout layout used by this project's analysis folder.
function resolveValidatorPath() {
  const argv = process.argv.slice(2)
  const at = argv.indexOf('--validator')
  const fromArgs = at >= 0 ? argv[at + 1] : undefined
  const candidate = fromArgs || process.env.DSH_SESSION_FORMAT_MODULE
  if (candidate) return candidate
  return new URL('../../analysis/asar/dsh-session-format-v3-to-v4/node_modules/@deepseek-ai/dsh-session-format-v3-to-v4/lib/index.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1')
}

function loadValidator() {
  const source = readFileSync(MODULE, 'utf8')
  const start = source.indexOf('//#region lib/types/relationships.js')
  const end = source.indexOf('//#region lib/types/facts.js')
  if (start < 0 || end < 0) throw new Error('relationships region not found; package layout changed')
  const stubs = `
    class SessionFormatError extends Error { constructor(message) { super(message); this.name = 'SessionFormatError' } }
    const isSessionFormatJsonObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
    const sessionFormatCount = (v, subject) => {
      if (!Number.isSafeInteger(v) || v < 0) throw new SessionFormatError(subject + ' requires a non-negative safe integer')
      return v
    }
  `
  let body = source.slice(start, end)
  if (process.env.ANCHOR_DEBUG) {
    body = body.replace(
      'throw new SessionFormatError(`${event.type} shadowedSeqs do not name an exact current surface span`)',
      'console.error("SPANFAIL", event.seq, start, end, this.surface.slice(start, end + 1).length, seqs.length, JSON.stringify(this.surface.slice(start, end + 1).slice(0, 6)), JSON.stringify(seqs.slice(0, 6))); throw new SessionFormatError(`${event.type} shadowedSeqs do not name an exact current surface span`)'
    )
  }
  return new Function('isDeepStrictEqual', `${stubs}\n${body}\nreturn { assertV4LifecycleRelationships }`)(isDeepStrictEqual)
}

function validate(header, events) {
  const { assertV4LifecycleRelationships } = loadValidator()
  const knownEventTypes = new Set(events.map((event) => event.type))
  const normalizedHeader = {
    version: header.version,
    id: header.id,
    createdAt: header.createdAt,
    isSeeded: header.isSeeded,
    delegationDepth: header.delegationDepth
  }
  for (const key of ['cwd', 'origin', 'agentPreset', 'parentSession']) {
    if (header[key] !== undefined) normalizedHeader[key] = header[key]
  }
  const problems = llmShapeProblems(events)
  if (problems.length) throw new Error(problems[0])
  assertV4LifecycleRelationships({ header: normalizedHeader, events, inheritedEventCount: 0 }, knownEventTypes)
}

// Mirrors assertCurrentLlmShape() in @deepseek-ai/dsh-session: a durable
// request header must carry provider/model and one of four reason markers,
// otherwise dsh refuses the whole session with
// `seed request/header at index N has an invalid reason`.
const REQUEST_REASONS = new Set(['initial', 'resume', 'change', 'series'])

function llmShapeProblems(events) {
  const problems = []
  for (const event of events) {
    if (event.type !== 'request/header') continue
    const data = event.data ?? {}
    const config = data.header?.config ?? {}
    if (typeof config.provider !== 'string' || !config.provider || typeof config.model !== 'string' || !config.model) {
      problems.push(`request/header seq ${event.seq} lacks provider/model`)
    }
    if (config.reasoningEffort !== undefined && (typeof config.reasoningEffort !== 'string' || config.reasoningEffort.length === 0)) {
      problems.push(`request/header seq ${event.seq} has an invalid reasoningEffort`)
    }
    const defaults = data.header?.adapterDefaults
    if (defaults !== undefined) {
      const keys = Object.keys(defaults)
      const badKey = keys.find((key) => key !== 'reasoningEffort' && key !== 'maxTokens')
      const badMarker = keys.find((key) => defaults[key] !== true)
      if (badKey !== undefined || badMarker !== undefined) {
        problems.push(`request/header seq ${event.seq} has invalid adapterDefaults`)
      } else if ((defaults.reasoningEffort === true && config.reasoningEffort === undefined) || (defaults.maxTokens === true && config.maxTokens === undefined)) {
        problems.push(`request/header seq ${event.seq} advertises a missing adapter default`)
      }
    }
    if (!REQUEST_REASONS.has(data.reason)) {
      problems.push(`request/header seq ${event.seq} has an invalid reason ${JSON.stringify(data.reason)}`)
    }
    if (data.startsSeries !== undefined && data.startsSeries !== true) {
      problems.push(`request/header seq ${event.seq} has an invalid startsSeries marker`)
    }
  }
  return problems
}

/**
 * Replay the log and rewrite the events that break the lifecycle rules.
 * Every rewrite is reported; content is never dropped except for rows that are
 * impossible to place (an unopened tool result with no call, a repeated close).
 */
function normalize(header, events, { now = Date.now() } = {}) {
  const notes = []
  const out = []
  let turn = null
  let step = null
  let nextTurn = 1
  let nextStep = 1
  const tools = new Map()
  const seqMap = new Map()
  let synthetic = 0
  let seenHeader = false
  let lastProvider = null
  let lastModel = null

  const push = (event) => {
    event.seq = out.length
    out.push(event)
    return event
  }
  const makeEvent = (type, data, time, extra = {}) => ({ type, seq: out.length, time: time ?? now, ...extra, data })

  /**
   * Drop every still-open tool call instead of inventing a result: a
   * tool/result is a *surface* row, so inserting one shifts the exact span
   * every later `compaction/summary` shadows and breaks restore for a second
   * reason. Removing the advertised block plus its tool/call row keeps the
   * surface untouched and only forgets a call that never returned.
   */
  const settleTools = () => {
    if (!tools.size) return
    const droppedCalls = new Set()
    for (const [callId, tool] of tools) {
      droppedCalls.add(callId)
      if (tool.block && Array.isArray(tool.content)) {
        const index = tool.content.indexOf(tool.block)
        if (index >= 0) tool.content.splice(index, 1)
        notes.push(`unadvertised tool call ${callId} in assistant/message (never settled)`)
      } else {
        notes.push(`dropped unadvertised tool call ${callId}`)
      }
    }
    for (let index = out.length - 1; index >= 0; index -= 1) {
      const event = out[index]
      if (event.type !== 'tool/call') continue
      if (!droppedCalls.has(event.data?.callId)) continue
      notes.push(`dropped unsettled tool/call ${event.data.callId} at index ${index}`)
      out.splice(index, 1)
    }
    tools.clear()
  }

  const openTurn = (time) => {
    push(makeEvent('turn/start', { turn: nextTurn }, time))
    turn = nextTurn
    nextStep = 1
    step = null
    return turn
  }

  for (const source of events) {
    const firstIndex = out.length
    if (typeof source.seq === 'number') seqMap.set(source.seq, firstIndex)
    const event = { ...source, data: source.data && typeof source.data === 'object' ? { ...source.data } : source.data }
    const data = event.data || {}
    const time = event.time

    switch (event.type) {
      case 'turn/start': {
        if (turn !== null) {
          if (step !== null) {
            settleTools(time)
            push(makeEvent('step/end', { turn, step }, time))
            step = null
          }
          settleTools(time)
          push(makeEvent('turn/end', { turn, reason: { kind: 'error', error: { message: 'bridge offline repair: turn closed before a new turn/start' } } }, time))
          notes.push(`closed turn ${turn} before turn/start ${JSON.stringify(data.turn)}`)
          turn = null
        }
        if (data.turn !== nextTurn) {
          notes.push(`turn/start ${JSON.stringify(data.turn)} -> ${nextTurn}`)
          data.turn = nextTurn
        }
        push(event)
        turn = data.turn
        nextStep = 1
        step = null
        break
      }
      case 'turn/end': {
        if (turn === null) {
          notes.push(`dropped turn/end ${JSON.stringify(data.turn)} with no open turn`)
          break
        }
        if (step !== null) {
          settleTools(time)
          push(makeEvent('step/end', { turn, step }, time))
          notes.push(`inserted step/end ${turn}/${step} before turn/end`)
          step = null
        }
        settleTools(time)
        if (data.turn !== turn) {
          notes.push(`turn/end ${JSON.stringify(data.turn)} -> ${turn}`)
          data.turn = turn
        }
        push(event)
        turn = null
        nextTurn += 1
        break
      }
      case 'step/start': {
        if (turn === null) turn = openTurn(time)
        if (step !== null) {
          notes.push(`step/start while ${turn}/${step} still open -> closed first`)
          settleTools(time)
          push(makeEvent('step/end', { turn, step }, time))
          step = null
          nextStep += 1
        }
        const wanted = nextStep
        if (data.turn !== turn || data.step !== wanted) {
          notes.push(`step/start ${JSON.stringify(data.turn)}/${JSON.stringify(data.step)} -> ${turn}/${wanted}`)
        }
        data.turn = turn
        data.step = wanted
        push(event)
        step = wanted
        break
      }
      case 'step/end': {
        if (turn === null || step === null) {
          notes.push(`dropped step/end ${JSON.stringify(data.turn)}/${JSON.stringify(data.step)} with no open step`)
          break
        }
        if (data.turn !== turn || data.step !== step) {
          notes.push(`step/end ${JSON.stringify(data.turn)}/${JSON.stringify(data.step)} -> ${turn}/${step}`)
        }
        data.turn = turn
        data.step = step
        settleTools(time)
        push(event)
        step = null
        nextStep += 1
        break
      }
      case 'assistant/message': {
        if (turn === null) turn = openTurn(time)
        if (step === null) {
          push(makeEvent('step/start', { turn, step: nextStep }, time))
          step = nextStep
          notes.push(`inserted step/start ${turn}/${step} before assistant/message`)
        }
        if (data.turn !== turn || data.step !== step) {
          notes.push(`assistant/message ${JSON.stringify(data.turn)}/${JSON.stringify(data.step)} -> ${turn}/${step}`)
        }
        data.turn = turn
        data.step = step
        for (const block of Array.isArray(data.message?.content) ? data.message.content : []) {
          if (block?.type !== 'tool-call' || typeof block.id !== 'string') continue
          if (tools.has(block.id)) {
            notes.push(`assistant/message repeated advertised tool call ${block.id}`)
            continue
          }
          tools.set(block.id, { name: block.name, arguments: block.arguments, started: false, block, content: data.message.content })
        }
        push(event)
        break
      }
      case 'tool/call': {
        if (turn === null || step === null) {
          if (turn === null) turn = openTurn(time)
          if (step === null) {
            push(makeEvent('step/start', { turn, step: nextStep }, time))
            step = nextStep
          }
          notes.push(`inserted open step ${turn}/${step} before tool/call`)
        }
        const callId = typeof data.callId === 'string' ? data.callId : null
        if (callId === null) {
          notes.push('dropped tool/call without callId')
          break
        }
        const pending = tools.get(callId)
        if (!pending) {
          notes.push(`dropped tool/call ${callId} with no advertised assistant block`)
          break
        }
        if (data.turn !== turn || data.step !== step) {
          notes.push(`tool/call ${callId} ${JSON.stringify(data.turn)}/${JSON.stringify(data.step)} -> ${turn}/${step}`)
        }
        data.turn = turn
        data.step = step
        pending.started = true
        push(event)
        break
      }
      case 'tool/result': {
        if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') {
          if (turn === null) break
          push(event)
          break
        }
        const callId = typeof data.message?.toolCallId === 'string' ? data.message.toolCallId : null
        if (turn === null || step === null) {
          notes.push(`dropped tool/result ${callId ?? '?'} outside a step`)
          break
        }
        if (!callId || !tools.has(callId)) {
          notes.push(`dropped tool/result ${callId ?? '?'} with no open call`)
          break
        }
        if (data.turn !== turn || data.step !== step) {
          notes.push(`tool/result ${callId} ${JSON.stringify(data.turn)}/${JSON.stringify(data.step)} -> ${turn}/${step}`)
        }
        data.turn = turn
        data.step = step
        tools.delete(callId)
        push(event)
        break
      }
      default: {
        // request/header, request/context and llm/retry rows require an open
        // turn; command/* and session/title do not (they only reference ids).
        if (turn === null && ['request/header', 'request/context', 'llm/retry', 'llm/retry-started'].includes(event.type)) {
          turn = openTurn(time)
          notes.push(`inserted turn/start ${turn} before ${event.type}`)
        }
        if (data && typeof data === 'object' && (data.turn !== undefined || data.step !== undefined) && turn !== null) {
          if (data.turn !== undefined && data.turn !== turn) data.turn = turn
          if (data.step !== undefined && step !== null && data.step !== step) data.step = step
        }
        if (event.type === 'request/header' && data && typeof data === 'object') {
          const config = data.header?.config
          if (config && typeof config === 'object') {
            if (config.reasoningEffort === '') {
              delete config.reasoningEffort
              notes.push(`request/header seq ${event.seq}: dropped empty reasoningEffort`)
            }
            if (typeof config.provider !== 'string' || !config.provider) {
              if (lastProvider) {
                config.provider = lastProvider
                notes.push(`request/header seq ${event.seq}: provider -> ${lastProvider}`)
              }
            }
            if (typeof config.model !== 'string' || !config.model) {
              if (lastModel) {
                config.model = lastModel
                notes.push(`request/header seq ${event.seq}: model -> ${lastModel}`)
              }
            }
            lastProvider = config.provider ?? lastProvider
            lastModel = config.model ?? lastModel
            const defaults = data.header.adapterDefaults
            if (defaults && typeof defaults === 'object') {
              if (defaults.reasoningEffort === true && config.reasoningEffort === undefined) {
                delete defaults.reasoningEffort
                notes.push(`request/header seq ${event.seq}: dropped reasoningEffort marker`)
              }
              if (defaults.maxTokens === true && config.maxTokens === undefined) {
                delete defaults.maxTokens
                notes.push(`request/header seq ${event.seq}: dropped maxTokens marker`)
              }
              if (!Object.keys(defaults).length) delete data.header.adapterDefaults
            }
          }
          if (!REQUEST_REASONS.has(data.reason)) {
            const reason = seenHeader ? 'change' : 'initial'
            notes.push(`request/header seq ${event.seq}: reason ${JSON.stringify(data.reason)} -> ${reason}`)
            data.reason = reason
          }
          if (data.startsSeries !== undefined && data.startsSeries !== true) delete data.startsSeries
          seenHeader = true
        }
        push(event)
        break
      }
    }
  }

  // Leave the log with an open tail only when the session really was mid-turn:
  // dsh tolerates an incomplete tail, but a half-closed step confuses it.
  return { events: out, notes, open: { turn, step }, seqMap }
}

function remapReferences(events, map) {
  const changes = []
  events.forEach((event, index) => {
    if (event.seq !== index) changes.push(`${event.seq}->${index} (${event.type})`)
    event.seq = index
  })
  const remap = (value) => (map.has(value) ? map.get(value) : value)
  for (const event of events) {
    const op = event.surfaceOp
    if (op && typeof op === 'object') {
      if (op.startSeq !== undefined) op.startSeq = remap(op.startSeq)
      if (op.endSeq !== undefined) op.endSeq = remap(op.endSeq)
    }
    if (Array.isArray(event.sourceEventSeqs)) event.sourceEventSeqs = event.sourceEventSeqs.map(remap)
    const data = event.data
    if (!data || typeof data !== 'object') continue
    if (data.headerSeq !== undefined) data.headerSeq = remap(data.headerSeq)
    if (Array.isArray(data.messageSeqs)) data.messageSeqs = data.messageSeqs.map(remap)
    if (data.sourceEventSeq !== undefined) data.sourceEventSeq = remap(data.sourceEventSeq)
    if (Array.isArray(data.shadowedSeqs)) data.shadowedSeqs = data.shadowedSeqs.map(remap)
    if (data.shadowedRange && typeof data.shadowedRange === 'object') {
      if (data.shadowedRange.start !== undefined) data.shadowedRange.start = remap(data.shadowedRange.start)
      if (data.shadowedRange.end !== undefined) data.shadowedRange.end = remap(data.shadowedRange.end)
    }
  }
  return changes
}

/** Index of the event that first breaks the lifecycle rules, or -1. */
function firstFailure(header, events) {
  let low = 0
  let high = events.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    try {
      validate(header, events.slice(0, mid))
      low = mid
    } catch {
      high = mid - 1
    }
  }
  return low
}

const SURFACE_TYPES = new Set(['system/message', 'user/message', 'developer/message', 'assistant/message', 'tool/result'])

/**
 * A compaction row must name an exact, contiguous span of the current surface.
 * Repairs that drop or insert rows shift seq numbers, so rebuild the span and
 * keep the summary shadowing exactly what it claims to.
 */
function repairShadowSpans(events) {
  const notes = []
  const surface = []
  for (const event of events) {
    const op = event.surfaceOp
    if (SURFACE_TYPES.has(event.type)) {
      if (op === 'append') surface.push(event.seq)
      else if (op && typeof op === 'object') {
        const first = surface.indexOf(op.startSeq)
        const last = surface.indexOf(op.endSeq)
        if (first >= 0 && last >= first) surface.splice(first, last - first + 1, event.seq)
        else surface.push(event.seq)
      }
    }
    if (event.type !== 'compaction/summary' && event.type !== 'compaction/prune') continue
    const data = event.data ?? {}
    let first = -1
    let last = -1
    if (data.shadowedRange) {
      first = surface.indexOf(data.shadowedRange.start)
      last = surface.indexOf(data.shadowedRange.end)
    }
    if (first < 0 || last < first) {
      const existing = Array.isArray(data.shadowedSeqs) ? data.shadowedSeqs : []
      if (existing.length) {
        first = surface.indexOf(existing[0])
        last = surface.indexOf(existing[existing.length - 1])
      }
    }
    if (first < 0 || last < first) {
      if (process.env.ANCHOR_DEBUG) console.log('    [unresolved]', event.type, event.seq, JSON.stringify(data.shadowedRange), JSON.stringify(data.shadowedSeqs), 'surface', surface.length, 'head', JSON.stringify(surface.slice(0, 4)))
      notes.push(`unresolved shadow span on ${event.type} at seq ${event.seq}`)
      continue
    }
    const span = surface.slice(first, last + 1)
    if (process.env.ANCHOR_DEBUG) console.log('    [span]', event.type, 'seq', event.seq, 'range', JSON.stringify(data.shadowedRange), 'first', first, 'last', last, 'span', span.length, 'existing', Array.isArray(data.shadowedSeqs) ? data.shadowedSeqs.length : 'none', 'surface', surface.length, 'spanHead', JSON.stringify(span.slice(0, 4)), 'spanTail', JSON.stringify(span.slice(-4)), 'seqsHead', JSON.stringify((data.shadowedSeqs || []).slice(0, 4)), 'seqsTail', JSON.stringify((data.shadowedSeqs || []).slice(-4)))
    if (!isDeepStrictEqual(span, data.shadowedSeqs)) {
      notes.push(`${event.type} seq ${event.seq}: shadowedSeqs ${Array.isArray(data.shadowedSeqs) ? data.shadowedSeqs.length : 0} -> ${span.length}`)
      data.shadowedSeqs = span
      data.shadowedRange = { start: span[0], end: span[span.length - 1] }
      if (process.env.ANCHOR_DEBUG) {
        const after = Array.isArray(data.shadowedSeqs) ? data.shadowedSeqs : []
        console.log('    [span2]', event.seq, JSON.stringify(data.shadowedRange), 'len', after.length, 'equalToSpan', isDeepStrictEqual(after, span))
      }
    }
  }
  return notes
}
const [, , command, ...rest] = process.argv
const write = rest.includes('--write')
// --validator <path> names the extracted format package, not a session file.
const validatorAt = rest.indexOf('--validator')
const targets = rest.filter((arg, index) => !arg.startsWith('--') && !(validatorAt >= 0 && index === validatorAt + 1))
const files = targets.length ? expandTargets(targets) : []

if (!command || !targets.length) {
  console.error('usage: node anchor-doctor.mjs scan|repair <file-or-dir> [...] [--write] [--validator <path>]')
  process.exit(2)
}
if (!files.length) {
  // Anchor directories hold the session cwd only; the logs themselves live under
  // `<profile>/.dsh/sessions/<slug>--/<session-id>/session.v4.jsonl.zstd`.
  console.error(`no ${LOG_FILE} found under: ${targets.join(', ')}`)
  process.exit(2)
}

let failures = 0
// Layout problems are repaired by the write itself, so they only fail the run
// when the command was not a repair.
let layoutIssues = 0
for (const file of files) {
  const { frames, truncatedAt, header, events, partial } = readLog(file)
  const name = file.split(/[\\/]/).slice(-2).join('/')
  console.log(`\n${name}`)
  // A log can be perfectly restorable and still be invisible to DSH, which reads
  // the header from the first frame alone.
  let layout = 'OK'
  try {
    layout = headerLineProblem(decodeFirstFrame(readFileSync(file))) || 'OK'
  } catch (error) {
    layout = `unreadable first frame: ${error.message}`
  }
  console.log(`  frames=${frames} events=${events.length}${truncatedAt === null ? '' : ` truncated@${truncatedAt}`}${partial ? ' partial-tail-row' : ''}`)
  console.log(`  header-frame: ${layout}`)
  if (layout !== 'OK') layoutIssues += 1
  let before = 'OK'
  try {
    validate(header, events)
  } catch (error) {
    before = error.message
  }
  console.log(`  before: ${before}`)

  const { events: fixed, notes, open, seqMap } = normalize(header, events)
  const renumberNotes = remapReferences(fixed, seqMap)
  const spanNotes = repairShadowSpans(fixed)
  let after = 'OK'
  try {
    validate(header, fixed)
  } catch (error) {
    after = error.message
    if (process.env.ANCHOR_DEBUG) console.error('    [stack]', error.stack)
    failures += 1
    const at = firstFailure(header, fixed)
    console.log(`  first failing event: index ${at} seq ${fixed[at]?.seq} type ${fixed[at]?.type}`)
    for (const event of fixed.slice(Math.max(0, at - 2), at + 1)) console.log('    >', JSON.stringify(event).slice(0, 320))
  }
  console.log(`  after:  ${after}`)
  console.log(`  rewrites=${notes.length}${renumberNotes.length ? ` renumbered=${renumberNotes.length}` : ''}${spanNotes.length ? ` spans=${spanNotes.length}` : ''} openTail=${open.turn ?? '-'}/${open.step ?? '-'}`)
  for (const note of notes.slice(0, 12)) console.log(`    - ${note}`)
  for (const note of spanNotes) console.log(`    * ${note}`)
  if (notes.length > 12) console.log(`    - ... ${notes.length - 12} more`)

  if (write && command === 'repair' && after === 'OK') {
    const size = statSync(file).size
    const packed = writeLog(file, header, fixed)
    const reloaded = readLog(file)
    validate(reloaded.header, reloaded.events)
    const writtenLayout = headerLineProblem(decodeFirstFrame(readFileSync(file)))
    if (writtenLayout) throw new Error(`written log violates the header-frame layout: ${writtenLayout}`)
    console.log(`  wrote: ${size} -> ${statSync(file).size} bytes, frames=${packed.frames}, reload+validate OK, header-frame OK`)
  }
}
const repairedInPlace = write && command === 'repair'
process.exitCode = failures ? 1 : layoutIssues && !repairedInPlace ? 1 : 0
