/* global process */

import assert from 'node:assert/strict'
import test from 'node:test'

const originalFetch = globalThis.fetch
const originalEnvironment = Object.fromEntries([
  'DEEPSEEK_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
].map(key => [key, process.env[key]]))

const state = {
  mode: 'recover-once',
  failureTable: 'node_annotations',
  attempts: new Map(),
}

function resetState(mode, failureTable) {
  state.mode = mode
  state.failureTable = failureTable
  state.attempts = new Map()
}

function failureResponse({ message, code }) {
  return new Response(JSON.stringify({ message, code, details: 'local diagnostic response', hint: null }), {
    status: 502,
    headers: { 'content-type': 'application/json' },
  })
}

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  if (!url.pathname.startsWith('/rest/v1/')) return originalFetch.call(globalThis, input, init)

  const table = url.pathname.split('/').at(-1)
  const attempt = (state.attempts.get(table) || 0) + 1
  state.attempts.set(table, attempt)

  if (table === state.failureTable && state.mode === 'recover-once' && attempt === 1) {
    return failureResponse({ message: '', code: 'TRANSIENT_EMPTY_MESSAGE' })
  }
  if (table === state.failureTable && state.mode === 'always-fail') {
    return failureResponse({ message: 'persistent upstream failure', code: 'PERSISTENT_UPSTREAM' })
  }

  return new Response(null, {
    status: 200,
    headers: { 'content-range': '0-0/0' },
  })
}

for (const [key, value] of Object.entries({
  DEEPSEEK_API_KEY: 'local-test-key',
  SUPABASE_URL: 'http://local.test',
  SUPABASE_SERVICE_ROLE_KEY: 'local-service-key',
  VITE_SUPABASE_URL: 'http://local.test',
  VITE_SUPABASE_ANON_KEY: 'local-anon-key',
})) process.env[key] = value

const { app } = await import('../server/index.js?readiness-test')
const appServer = await new Promise((resolve) => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server))
})
const appUrl = `http://127.0.0.1:${appServer.address().port}/readiness`

async function requestReadiness() {
  const response = await originalFetch(appUrl)
  return { status: response.status, body: await response.json() }
}

test('readiness retries a transient empty-message table failure', async () => {
  resetState('recover-once', 'node_annotations')

  const { status, body } = await requestReadiness()

  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.database.ok, true)
  assert.equal(body.database.tables.node_annotations.ok, true)
  assert.equal(state.attempts.get('node_annotations'), 2)
  assert.deepEqual(body.database.tables.node_annotations, { ok: true })
})

test('readiness keeps the final error after the bounded retry fails', async () => {
  resetState('always-fail', 'weekly_reviews')
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args)

  try {
    const { status, body } = await requestReadiness()

    assert.equal(status, 503)
    assert.equal(body.ok, false)
    assert.equal(body.database.ok, false)
    assert.deepEqual(body.database.tables.weekly_reviews, {
      ok: false,
      message: 'persistent upstream failure',
    })
    assert.equal(state.attempts.get('weekly_reviews'), 2)

    const warning = warnings.find(([label, details]) => (
      label === '[/readiness] table check failed' && details?.table === 'weekly_reviews'
    ))
    assert.deepEqual(warning?.[1], {
      table: 'weekly_reviews',
      name: '',
      code: 'PERSISTENT_UPSTREAM',
      message: 'persistent upstream failure',
      status: 502,
    })
  } finally {
    console.warn = originalWarn
  }
})

test.after(async () => {
  await new Promise((resolve, reject) => appServer.close(error => error ? reject(error) : resolve()))
  globalThis.fetch = originalFetch
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})
