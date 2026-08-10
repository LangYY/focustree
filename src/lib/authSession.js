export const AUTH_SESSION_TIMEOUT_MS = 8000
export const AUTH_REQUEST_TIMEOUT_MS = 15000

export function restoreAuthSession(auth, {
  timeoutMs = AUTH_SESSION_TIMEOUT_MS,
  onSession,
  onReady,
  onError,
} = {}) {
  let cancelled = false
  let ready = false
  const timeout = Math.max(1, Number(timeoutMs) || AUTH_SESSION_TIMEOUT_MS)
  let timer

  const finish = () => {
    if (cancelled || ready) return
    ready = true
    globalThis.clearTimeout(timer)
    onReady?.()
  }

  timer = globalThis.setTimeout(() => {
    if (cancelled || ready) return
    onError?.(createAuthTimeoutError(timeout))
    finish()
  }, timeout)

  Promise.resolve()
    .then(() => auth.getSession())
    .then(result => {
      if (cancelled) return
      if (result?.error) throw result.error
      onSession?.(result?.data?.session || null)
      finish()
    })
    .catch(error => {
      if (cancelled || ready) return
      onError?.(error)
      finish()
    })

  return () => {
    cancelled = true
    globalThis.clearTimeout(timer)
  }
}

export function withAuthTimeout(task, {
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS,
} = {}) {
  const timeout = Math.max(1, Number(timeoutMs) || AUTH_REQUEST_TIMEOUT_MS)
  return new Promise((resolve, reject) => {
    let settled = false
    let timer
    const finish = callback => {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timer)
      callback()
    }

    timer = globalThis.setTimeout(() => {
      finish(() => reject(createAuthTimeoutError(timeout, 'AUTH_REQUEST_TIMEOUT')))
    }, timeout)

    Promise.resolve()
      .then(task)
      .then(value => finish(() => resolve(value)))
      .catch(error => finish(() => reject(error)))
  })
}

export function formatAuthErrorMessage(error) {
  const code = String(error?.code || '').toLowerCase()
  const message = String(error?.message || '').toLowerCase()

  if (code === 'auth_request_timeout') return '登录请求超时，请检查网络后重试。'
  if (message.includes('password should be at least') || message.includes('password must be at least')) {
    return '密码至少需要 6 位。'
  }
  if (code === 'user_already_exists' || code === 'email_exists' || message.includes('already registered')) {
    return '这个邮箱已经注册过了，请切换到登录。'
  }
  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return '邮箱或密码不正确，请检查后重试。'
  }
  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return '邮箱还没完成验证，请先点击验证邮件中的链接。'
  }
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || message.includes('rate limit')) {
    return '请求太频繁，请稍后再试。'
  }
  return '暂时无法完成操作，请稍后再试。'
}

function createAuthTimeoutError(timeoutMs, code = 'AUTH_SESSION_TIMEOUT') {
  const error = new Error(`Auth session restore timed out after ${timeoutMs}ms`)
  error.code = code
  return error
}
