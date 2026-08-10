import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { formatAuthErrorMessage, restoreAuthSession, withAuthTimeout } from '../src/lib/authSession.js'

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

test('formats common auth failures into human-readable Chinese copy', () => {
  assert.equal(formatAuthErrorMessage({ code: 'user_already_exists' }), '这个邮箱已经注册过了，请切换到登录。')
})

test('formats invalid password failures without exposing Supabase English', () => {
  assert.equal(formatAuthErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' }), '邮箱或密码不正确，请检查后重试。')
})

test('formats short password failures with a direct hint', () => {
  assert.equal(formatAuthErrorMessage({ message: 'Password should be at least 6 characters' }), '密码至少需要 6 位。')
})

test('auth page exposes the verified magic-link login path with resend cooldown', () => {
  const source = readFileSync(new URL('../src/components/Auth/AuthPage.jsx', import.meta.url), 'utf8')
  assert.match(source, /signInWithOtp/)
  assert.match(source, /登录链接已发送到/)
  assert.match(source, /setLoginLinkCooldown\(60\)/)
})

test('auth page uses a low-friction email guide for demos instead of a fake account', () => {
  const source = readFileSync(new URL('../src/components/Auth/AuthPage.jsx', import.meta.url), 'utf8')
  assert.match(source, /演示提示/)
  assert.match(source, /通常 30 秒完成/)
  assert.doesNotMatch(source, /体验账号/)
})
