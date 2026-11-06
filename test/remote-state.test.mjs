import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveWorkspaceState } from '../lib/remote.js'
import { clampPollInterval } from '../lib/util.js'

test('deriveWorkspaceState maps the service and HTTP probes', () => {
  assert.equal(deriveWorkspaceState({ active: false, desiredState: 'stopped', httpStatus: '000' }), 'stopped')
  assert.equal(deriveWorkspaceState({ active: false, desiredState: 'running', httpStatus: '000' }), 'error')
  assert.equal(deriveWorkspaceState({ active: true, desiredState: 'running', httpStatus: '200' }), 'running')
  assert.equal(deriveWorkspaceState({ active: true, desiredState: 'running', httpStatus: '302' }), 'running')
  assert.equal(deriveWorkspaceState({ active: true, desiredState: 'running', httpStatus: '401' }), 'running')
  assert.equal(deriveWorkspaceState({ active: true, desiredState: 'running', httpStatus: '503' }), 'error')
  assert.equal(deriveWorkspaceState({ active: true, desiredState: 'running', httpStatus: '000', uptimeSec: 30 }), 'starting')
  assert.equal(deriveWorkspaceState({ active: true, desiredState: 'running', httpStatus: '000', uptimeSec: 300 }), 'error')
  assert.equal(deriveWorkspaceState({ active: true, desiredState: 'stopped', httpStatus: '000' }), 'error')
})

test('a failed service substate always wins', () => {
  assert.equal(deriveWorkspaceState({
    active: true,
    desiredState: 'running',
    httpStatus: '200',
    subState: 'failed'
  }), 'error')
})

test('clampPollInterval keeps the shared 2s-60s window', () => {
  assert.equal(clampPollInterval(1000), 2000)
  assert.equal(clampPollInterval(5000), 5000)
  assert.equal(clampPollInterval(120000), 60000)
  assert.equal(clampPollInterval('7500'), 7500)
  assert.equal(clampPollInterval(undefined), 5000)
  assert.equal(clampPollInterval('nope', 4000), 4000)
})
