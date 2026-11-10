// A dead remote runner used to surface its raw stderr tail as the turn error.
// Routine dsh progress lines (`[llm-deepseek-api-key] model listing …`) then
// looked like the failure itself. Keep real diagnostics, drop routine logs,
// and say plainly when the log holds no error.
import test from 'node:test'
import assert from 'node:assert/strict'
import { runnerFailureMessage } from '../lib/bridge.js'

const FALLBACK = 'the remote dsh runner exited before finishing this turn'

test('routine info logs are not reported as the failure', () => {
  const stderr = [
    '[llm-deepseek-api-key] model listing ...',
    '[llm-deepseek-api-key] model listing ...',
    '[llm-deepseek-api-key] model listing ...'
  ].join('\n')
  const message = runnerFailureMessage(stderr, FALLBACK)
  assert.match(message, /remote dsh runner exited/u)
  assert.doesNotMatch(message, /model listing/u)
  assert.match(message, /no error line/u)
})

test('a real error line is kept and routine lines are dropped', () => {
  const stderr = [
    '[llm-deepseek-api-key] model listing ...',
    'Error: connect ETIMEDOUT 10.0.0.1:443',
    '    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1)',
    'npm notice New minor version of npm available!'
  ].join('\n')
  const message = runnerFailureMessage(stderr, FALLBACK)
  assert.match(message, /^the remote dsh runner exited/u)
  assert.match(message, /connect ETIMEDOUT/u)
  assert.doesNotMatch(message, /model listing/u)
  assert.doesNotMatch(message, /npm notice/u)
})

test('meaningful non-error output survives instead of a bare fallback', () => {
  const message = runnerFailureMessage('worker refused to start: permission denied by host policy', FALLBACK)
  assert.match(message, /permission denied by host policy/u)
})

test('a watchdog stop is reported as the cause', () => {
  const stderr = [
    '[llm-deepseek-api-key] model listing ...',
    'dsh-ssh watchdog: no client heartbeat for 1800s; stopping the remote sdk runtime'
  ].join('\n')
  const message = runnerFailureMessage(stderr, FALLBACK)
  assert.match(message, /watchdog/u)
  assert.match(message, /no client heartbeat/u)
  assert.doesNotMatch(message, /model listing/u)
  assert.doesNotMatch(message, /no error line/u)
})

test('an empty log still explains what happened', () => {
  assert.equal(runnerFailureMessage('', FALLBACK), `${FALLBACK}; the remote log has no error line (retry, and inspect the remote service log if it repeats)`)
})
