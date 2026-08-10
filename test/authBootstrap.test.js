import assert from 'node:assert/strict'
import test from 'node:test'
import { restoreAuthSession, withAuthTimeout } from '../src/lib/authSession.js'

test('auth session restore releases loading when getSession never resolves', async () => {
  const state = { ready: false, error: null }
  const stop = restoreAuthSession({
    getSession: () => new Promise(() => {}),
  }, {
    timeoutMs: 5,
    onReady: () => { state.ready = true },
    onError: error => { state.error = error },
  })

  await new Promise(resolve => setTimeout(resolve, 20))
  stop()

  assert.equal(state.ready, true)
  assert.equal(state.error?.code, 'AUTH_SESSION_TIMEOUT')
})

test('auth request rejects on timeout so submit loading can end', async () => {
  await assert.rejects(
    withAuthTimeout(() => new Promise(() => {}), { timeoutMs: 5 }),
    error => error.code === 'AUTH_REQUEST_TIMEOUT',
  )
})
