// Shared constants and helpers of the remote session bridge.
//
// Moved out of lib/bridge.js unchanged. Every module under lib/bridge/ imports
// what it needs from here, and lib/bridge.js re-exports the helpers that other
// modules import from it.

import { createHash } from 'node:crypto'

const HEADLESS_PACKAGE = {
  name: 'dsh-profile-headless',
  private: true,
  dependencies: {},
  dsh: {
    profile: {
      bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless']
    }
  }
}

const HEADLESS_PATCH = [
  '# dsh-ssh bridge: one-shot runner with the DSH_HOME credential store enabled.',
  '- id: credentials',
  '  disabled: false',
  '- id: authorization',
  '  disabled: false',
  '- id: deepseek-account',
  '  disabled: false',
  ''
].join('\n')

// The `sdk` profile serves the same agent over stdio JSON-RPC and keeps the
// runtime (and every session it owns) alive between turns. It is the preferred
// transport: the process boots once, then each prompt is enqueued without
// starting Node again.
const SDK_PACKAGE = {
  name: 'dsh-profile-sdk',
  private: true,
  dependencies: {},
  dsh: {
    profile: {
      bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-sdk-app']
    }
  }
}

// Idle SDK runtimes are killed by a detached watchdog after this many seconds
// without a prompt. Every submitted turn restarts the watchdog, and a long
// turn refreshes it periodically: a turn can stream for hours (tool calls,
// captures), and the TTL is an idle bound, not a turn cap.
const SDK_TTL_SECONDS = Math.max(30, Number(process.env.DSH_SSH_SDK_TTL) || 1800)
const SDK_HEARTBEAT_MS = Math.max(1_000, Math.floor((SDK_TTL_SECONDS * 1000) / 3))
const SDK_PROVIDER = String(process.env.DSH_SSH_SDK_PROVIDER || 'deepseek-official')
const SDK_MODEL = String(process.env.DSH_SSH_SDK_MODEL || 'deepseek-chat')

// A bridged chat's history lives on the remote host, but `/compact` summarizes
// it in this process, so the summarize request has to use a route this machine
// can actually reach. The remote chat's own route is both reachable and the
// semantically right summarizer; a model picker that still points at a remote-
// only gateway (opencode.ai) would otherwise fail the command after the
// adapter's connect timeout.
const COMPACT_PROVIDER = String(process.env.DSH_SSH_COMPACT_PROVIDER || SDK_PROVIDER)
const COMPACT_MODEL = String(process.env.DSH_SSH_COMPACT_MODEL || SDK_MODEL)

// A bridged chat's history lives on the remote host, so `/compact` must run
// there: only the remote agent can replace its own context. The summary of a
// long session is a large one-shot request, so the call gets its own budget.
const REMOTE_COMPACT_TIMEOUT_MS = Math.max(60_000, Number(process.env.DSH_SSH_COMPACT_TIMEOUT_MS) || 15 * 60_000)
// How long to wait for the mirrored compaction records after the remote
// command acknowledges; they are written before the response, so this only
// covers pipe latency.
const REMOTE_COMPACT_CAPTURE_MS = Math.max(500, Number(process.env.DSH_SSH_COMPACT_CAPTURE_MS) || 8_000)

// One process-wide route for compaction calls: HMR replaces both this module
// and the bridge instance, so the wrapper installed on the single `llm`
// service dispatches through a global slot that the newest bridge fills.
const ROUTER_SLOT = Symbol.for('dsh-ssh-remote.compaction-router')
const ORIGINAL_STREAM = Symbol.for('dsh-ssh-remote.llm.stream.original')
const STREAM_WRAPPER_VERSION = Symbol.for('dsh-ssh-remote.llm.stream.version')
const STREAM_MODULE_SEQ = Symbol.for('dsh-ssh-remote.llm.stream.module')

// Manual `/compact` makes exactly one summarization call and has no retry of
// its own (only automatic pressure compaction retries), so a single transient
// provider timeout fails the command. Replay the whole call from scratch
// before giving up; chunks are buffered until an attempt completes, so a
// failed attempt never leaks partial output into the caller.
const COMPACT_STREAM_ATTEMPTS = Math.min(6, Math.max(1, Number(process.env.DSH_SSH_COMPACT_ATTEMPTS) || 3))
const COMPACT_STREAM_BACKOFF_MS = Math.max(100, Number(process.env.DSH_SSH_COMPACT_BACKOFF_MS) || 800)
// A failed remote command ends its compaction cleanly before `session/query`
// answers, so replaying the command is safe. Each attempt re-summarizes the
// whole session, so keep the budget small.
const REMOTE_COMPACT_ATTEMPTS = Math.min(4, Math.max(1, Number(process.env.DSH_SSH_REMOTE_COMPACT_ATTEMPTS) || 2))

// Events that only exist inside a turn. Seeing one while the bridge reports
// idle means the remote is working on a turn this process did not start (an
// inbox prompt, a stream failure that left it running, or a resumed log whose
// saved offset is already inside the turn) and the turn must be adopted.
const ADOPTING_EVENT_TYPES = new Set([
  'turn/start', 'step/start', 'step/end',
  'assistant/message', 'tool/call', 'tool/result'
])

const TRANSIENT_COMPACTION_CODES = new Set([  'EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT',
  'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE',
  'EAI_AGAIN', 'ENETDOWN', 'ENETUNREACH', 'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET'
])

/** Diagnostic text of a provider error, including its code/status and cause. */
function compactionErrorText(error) {
  if (!error) return ''
  if (typeof error === 'string') return error
  const values = [
    error.message,
    error.code,
    error.type,
    error.status,
    error.cause?.message,
    error.cause?.code
  ]
  return values
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '')
    .map((value) => String(value))
    .join(' ')
}

/** Whether a failed summarization call is worth repeating verbatim. */
function isTransientCompactionError(error) {
  if (!error) return false
  if (typeof error === 'object') {
    if (error.name === 'AbortError') return false
    if (error.name === 'TimeoutError') return true
    if (error.retryable === true) return true
    const code = String(error.code || error.cause?.code || '').trim().toUpperCase()
    if (TRANSIENT_COMPACTION_CODES.has(code)) return true
    const status = Number(error.status ?? error.statusCode ?? error.cause?.status)
    if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true
  }
  return /timed?[ _-]?out|timeout|socket hang up|fetch failed|network|connection (?:reset|closed|refused|aborted)|rate[ _-]?limit|too many requests|overloaded|temporar|server (?:error|unavailable)|bad gateway|gateway timeout|service unavailable|empty (?:response|completion)|stream (?:error|closed|reset)/iu
    .test(compactionErrorText(error))
}

/** Delay that resolves early (by rejecting) when the caller aborts. */
function abortableDelay(ms, signal) {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms))
  if (signal.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('Compaction cancelled.'))
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason instanceof Error ? signal.reason : new Error('Compaction cancelled.'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Replay a compaction stream on transient failures. Non-iterable results are
 * passed through untouched so a malformed request still reports its own error.
 */
function retryCompactionStream(original, thisArg, options) {
  let first
  let firstError
  let failed = false
  try {
    first = original.call(thisArg, options)
  } catch (error) {
    failed = true
    firstError = error
  }
  if (!failed && (first === undefined || typeof first[Symbol.asyncIterator] !== 'function')) return first
  return (async function* runCompactionStream() {
    let pending = failed
    let source = first
    for (let attempt = 1; ; attempt += 1) {
      if (options?.signal?.aborted) throw new Error('Compaction cancelled.')
      const chunks = []
      try {
        if (pending) {
          pending = false
          throw firstError
        }
        for await (const chunk of source) chunks.push(chunk)
      } catch (error) {
        if (attempt >= COMPACT_STREAM_ATTEMPTS || options?.signal?.aborted || !isTransientCompactionError(error)) {
          throw error
        }
        const route = globalThis[ROUTER_SLOT]
        route?.log?.('warn', `bridge: compaction attempt ${attempt}/${COMPACT_STREAM_ATTEMPTS} failed (${compactionErrorText(error)}); retrying`)
        await abortableDelay(COMPACT_STREAM_BACKOFF_MS * 2 ** (attempt - 1), options?.signal)
        source = original.call(thisArg, options)
        continue
      }
      yield* chunks
      return
    }
  })()
}

// `/compact` is shadowed per agent: a bridged chat gets the bridge's remote
// handler, every other chat keeps the stock command. Same identity and text as
// @deepseek-ai/dsh-command-compact so the listing is unchanged.
const COMPACT_COMMAND_ID = '@deepseek-ai/dsh-command-compact'
const COMPACT_DESCRIPTION = 'Compact older conversation history'
const COMPACT_USAGE = 'Usage: /compact (no arguments)'
const COMPACT_BUSY = 'Compaction is unavailable because this process has an active compaction, or the agent is not idle.'
const COMPACT_EMPTY = 'No compactable history yet.'
const COMPACT_UNAVAILABLE = 'The remote SDK runtime is unavailable, so the remote context cannot be compacted.'
// Only reachable when the host profile has no stock command to fall back to;
// the busy message would be a lie in that case.
const COMPACT_NOT_AVAILABLE = 'Compaction is not available for this session.'
// dsh writes this result itself when a started tool call is cut off without a
// durable outcome. A mirrored turn can lose that notification when the remote
// runtime exits, so the bridge writes the same record before the step boundary.
const TOOL_OUTCOME_UNKNOWN_TEXT = 'The tool call was interrupted after it was recorded, but no result was durably recorded. Its outcome is unknown. Decide whether to retry from the tool semantics: retry only if the operation is read-only or idempotent; if it may have side effects, first verify external state or ask the user. Do not retry blindly.'

/**
 * Tool-pairing delta of one surface event, used to find a cut that does not
 * split an assistant tool call from its result. Mirrors the compaction
 * package's own balance rule without importing it into this plugin.
 */
function surfaceToolDelta(event) {
  if (event?.type === 'assistant/message') {
    const content = Array.isArray(event.data?.message?.content) ? event.data.message.content : []
    return content.filter((block) => block?.type === 'tool-call').length
  }
  return event?.type === 'tool/result' ? -1 : 0
}

/** Keep only plain text blocks from a remote summary or checkpoint body. */
function textBlocks(value) {
  if (!Array.isArray(value)) return null
  const blocks = value.filter((block) => block?.type === 'text' && typeof block.text === 'string')
  return blocks.length > 0 ? blocks : null
}

// A tiny out-of-tree profile plugin projects the remote agent's live
// assistant-stream frames onto stdout. The stock `--json` projection only
// emits text after the step's assistant/message commits, which is why remote
// answers used to appear in one block at step end.
const STREAM_PLUGIN_NAME = 'dsh-ssh-stream'
// One live preview chunk is only a preview, but the old 8 KiB cap cut a long
// reasoning block in half. Keep a generous per-chunk bound so the preview shows
// the same text the durable message commits.
const MAX_LIVE_CHUNK_CHARS = 1024 * 1024
// A mirrored JSONL line can carry one whole committed assistant message. The
// old 2 MiB bound silently dropped the overflowing line (and with it the
// answer); keep a generous bound and fail the turn loudly if it is exceeded.
const MAX_BRIDGE_LINE_BYTES = Math.max(
  2 * 1024 * 1024,
  Number(process.env.DSH_SSH_MAX_LINE_BYTES) || 8 * 1024 * 1024
)
const STREAM_PLUGIN_PACKAGE = `${JSON.stringify({
  name: STREAM_PLUGIN_NAME,
  version: '1.0.0',
  private: true,
  type: 'module',
  main: 'index.js'
}, null, 2)}\n`
const STREAM_PLUGIN_SOURCE = `// dsh-ssh bridge: forward live assistant frames as JSONL.
// Headless redirects stdout to the event file; the SDK profile reserves stdout
// for JSON-RPC, so it points DSH_SSH_STREAM_FILE at a shared append-only file.
import { appendFileSync } from 'node:fs'

export const name = '${STREAM_PLUGIN_NAME}'

const file = process.env.DSH_SSH_STREAM_FILE || ''
// The SDK runtime owns stdout for JSON-RPC; only headless can stream there.
const sdk = Boolean(file)

function writeLine(payload) {
  const line = JSON.stringify(payload) + '\\n'
  try {
    if (file) appendFileSync(file, line)
    else process.stdout.write(line)
  } catch {
    // never break the remote run because the projection failed
  }
}

export function apply(ctx) {
  ctx.on('agent/assistant-stream', ({ frame }) => {
    if (!frame || typeof frame !== 'object') return
    if (frame.type === 'start') {
      writeLine({ type: 'stream', frame: { type: 'start', attemptId: String(frame.attemptId), turn: frame.turn, step: frame.step } })
      return
    }
    if (frame.type === 'end') {
      writeLine({ type: 'stream', frame: { type: 'end', attemptId: String(frame.attemptId) } })
      return
    }
    if (frame.type !== 'chunk' || !frame.chunk || typeof frame.chunk !== 'object') return
    const chunk = frame.chunk
    // Bound one line so a pathological provider chunk cannot overflow the
    // bridge's line buffer. Never mutate the agent's frozen chunk.
    const outChunk = typeof chunk.text === 'string' && chunk.text.length > ${MAX_LIVE_CHUNK_CHARS}
      ? { ...chunk, text: chunk.text.slice(0, ${MAX_LIVE_CHUNK_CHARS}) }
      : chunk
    writeLine({ type: 'stream', frame: { type: 'chunk', attemptId: String(frame.attemptId), index: frame.index, time: frame.time, chunk: outChunk } })
  })
  if (sdk) return
  // The stock --json projection caps every string at 8 KiB per event, so a
  // long reasoning block reached the bridge truncated. The committed message
  // itself is lossless; forward it verbatim and let the bridge prefer it over
  // the projection's thinking/text fallback.
  ctx.on('session/event', (session, event) => {
    if (!event || event.type !== 'assistant/message') return
    const data = event.data || {}
    const message = data.message
    if (!message || !Array.isArray(message.content) || message.content.length === 0) return
    writeLine({
      type: 'assistant-content',
      sessionId: String((session && session.id) || ''),
      turn: data.turn,
      step: data.step,
      usage: data.usage,
      stream: data.stream,
      message: { id: message.id, role: message.role, content: message.content, source: message.source }
    })
  })
}
`
const STREAM_PATCH = [
  '- insert:',
  `    - id: ${STREAM_PLUGIN_NAME}`,
  `      name: '${STREAM_PLUGIN_NAME}'`,
  ''
].join('\n')

// The SDK runtime is persistent: a runner booted by an older build can still be
// alive when the app (and this plugin) restarts. It then serves turns without
// the current stream plugin, which looks exactly like a non-streaming model.
// Every profile carries this stamp; a reused runtime whose stamp differs is
// retired instead of being trusted.
const PROFILE_VERSION = createHash('sha256')
  .update(STREAM_PLUGIN_SOURCE)
  .update(STREAM_PATCH)
  .update(SDK_PACKAGE.name)
  .digest('hex')
  .slice(0, 16)

function profileStamp(stream) {
  return `${PROFILE_VERSION}:${stream ? 'stream' : 'plain'}`
}

// A profile rewrite disables streaming for a while, not forever. Retry later so
// one transient module-resolution error cannot hide live output for the whole
// app process.
const STREAM_RETRY_MS = Math.max(60_000, Number(process.env.DSH_SSH_STREAM_RETRY_MS) || 10 * 60_000)
const STREAM_WATCHDOG_MS = Math.max(5_000, Number(process.env.DSH_SSH_STREAM_WATCHDOG_MS) || 12_000)
// A failed SDK boot falls back to headless for this long, then probes the
// runtime again so a transient remote problem does not degrade the session
// for the rest of the process.
const SDK_RETRY_MS = Math.max(10_000, Number(process.env.DSH_SSH_SDK_RETRY_MS) || 60_000)

// A workspace record embeds absolute node/dsh paths, so a session restored from
// the journal can talk to a runner that still speaks an older JSON-RPC dialect
// (`session/query`, used to forward `/compact`, arrived in 0.2.2). The bridge
// retargets the workspace to the configured build before booting a runner; a
// build that is not installed is re-probed at most this often, so an old
// workspace does not pay a remote probe on every turn.
const RUNTIME_SYNC_TTL_MS = Math.max(10_000, Number(process.env.DSH_SSH_RUNTIME_SYNC_MS) || 60_000)

// A headless runner needs 4-5 s to boot before it can accept a task. The
// bridge therefore boots the next turn's runner while the workspace is idle:
// the runner reads its task from a FIFO, so it can be fully initialised before
// the user presses send. The holder keeps the FIFO open; killing it at submit
// time turns into the EOF the CLI waits for. The TTL bounds the idle process
// if no prompt ever arrives; a refresh timer keeps replacing it while the
// workspace stays open (DSH_SSH_PREWARM_TTL overrides it for tests).
const PREWARM_TTL_SECONDS = Math.max(5, Number(process.env.DSH_SSH_PREWARM_TTL) || 300)
// A booted headless runner holds about 200 MB RSS on the target. Keep warmth
// for the most recently used workspaces only; the rest fall back to cold
// starts rather than keeping one process per open session.
const MAX_WARM_RUNNERS = Math.max(0, Number(process.env.DSH_SSH_MAX_WARM ?? 2))

function textOf(input) {
  const content = Array.isArray(input?.content) ? input.content : []
  const text = content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
  return text.trim()
}

function resultText(value) {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function reasonOf(event) {
  const reason = event?.reason
  if (reason && typeof reason === 'object' && typeof reason.kind === 'string') {
    return reason.kind === 'completed' ? { kind: 'completed' } : { kind: 'error', error: { message: reason.message || reason.kind } }
  }
  return { kind: 'completed' }
}

// Remote stderr is a mixed stream: dsh writes routine progress there as well
// (`[llm-deepseek-api-key] model listing …`). When a runner dies without a
// final event, echoing the raw tail turned the chat's failure message into a
// log dump with no cause. Keep lines that name a real failure; when there are
// none, say the runner exited and leave the log reading to the plugin log.
const RUNNER_FAILURE_LINE = /(?:^|[^\w])(?:error|fatal|exception|failed|failure|killed|segmentation|out of memory|heap out of memory|EACCES|EADDRINUSE|ECONNREFUSED|ECONNRESET|ENOENT|ETIMEDOUT|MODULE_NOT_FOUND|No usable native binding|watchdog)(?:[^\w]|$)/iu
const ROUTINE_RUNNER_LINE = /^(?:\[[^\]]+\]\s|[A-Z]+:\s|at\s|npm (?:warn|notice)\b|>|debug\b|info\b|trace\b)/u

// Exported for tests; also used by the dead-runner paths below.
export function runnerFailureMessage(stderr, fallback) {
  const lines = String(stderr || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
  const fatal = lines.filter((line) => RUNNER_FAILURE_LINE.test(line))
  const meaningful = fatal.length > 0 ? fatal : lines.filter((line) => !ROUTINE_RUNNER_LINE.test(line))
  if (meaningful.length === 0) {
    return `${fallback}; the remote log has no error line (retry, and inspect the remote service log if it repeats)`
  }
  return `${fallback}\n${meaningful.slice(-4).join('\n')}`.slice(0, 1600)
}

/** Quote one YAML scalar exactly like JSON, which YAML accepts verbatim. */
function yamlString(value) {
  return JSON.stringify(String(value))
}

/**
 * Copy one id-targeted block (`- id: <id>` plus everything indented under it)
 * out of a profile patch file. The local profile is the source of truth for
 * provider routes; copying the block verbatim avoids a YAML parser and keeps
 * fields the bridge does not know about.
 */
export function extractYamlBlock(text, id) {
  const lines = String(text || '').split(/\r?\n/u)
  const pattern = new RegExp(`^-\\s+id:\\s*['"]?${id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}['"]?\\s*$`, 'u')
  const start = lines.findIndex((line) => pattern.test(line))
  if (start < 0) return ''
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    // A new top-level entry, comment or document marker ends the block.
    if (line.trim() !== '' && !/^\s/u.test(line)) {
      end = index
      break
    }
  }
  const block = lines.slice(start, end).join('\n').replace(/\s+$/u, '')
  return block ? `${block}\n` : ''
}

// Everything above is internal to the bridge; these are the names the split
// modules under lib/bridge/ import from here.
export {
  HEADLESS_PACKAGE, HEADLESS_PATCH, SDK_PACKAGE, SDK_TTL_SECONDS,
  SDK_HEARTBEAT_MS, SDK_PROVIDER, SDK_MODEL, COMPACT_PROVIDER,
  COMPACT_MODEL, REMOTE_COMPACT_TIMEOUT_MS, REMOTE_COMPACT_CAPTURE_MS, ROUTER_SLOT,
  ORIGINAL_STREAM, STREAM_WRAPPER_VERSION, STREAM_MODULE_SEQ, COMPACT_STREAM_ATTEMPTS,
  COMPACT_STREAM_BACKOFF_MS, REMOTE_COMPACT_ATTEMPTS, ADOPTING_EVENT_TYPES, TRANSIENT_COMPACTION_CODES,
  compactionErrorText, isTransientCompactionError, abortableDelay, retryCompactionStream,
  COMPACT_COMMAND_ID, COMPACT_DESCRIPTION, COMPACT_USAGE, COMPACT_BUSY,
  COMPACT_EMPTY, COMPACT_UNAVAILABLE, COMPACT_NOT_AVAILABLE, TOOL_OUTCOME_UNKNOWN_TEXT,
  surfaceToolDelta, textBlocks, STREAM_PLUGIN_NAME, MAX_LIVE_CHUNK_CHARS,
  MAX_BRIDGE_LINE_BYTES, STREAM_PLUGIN_PACKAGE, STREAM_PLUGIN_SOURCE, STREAM_PATCH,
  PROFILE_VERSION, profileStamp, STREAM_RETRY_MS, STREAM_WATCHDOG_MS,
  SDK_RETRY_MS, RUNTIME_SYNC_TTL_MS, PREWARM_TTL_SECONDS, MAX_WARM_RUNNERS,
  textOf, resultText, reasonOf, RUNNER_FAILURE_LINE,
  ROUTINE_RUNNER_LINE, yamlString
}
