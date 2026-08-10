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

function createAuthTimeoutError(timeoutMs, code = 'AUTH_SESSION_TIMEOUT') {
  const error = new Error(`Auth session restore timed out after ${timeoutMs}ms`)
  error.code = code
  return error
}
