import { ProxyAgent, fetch as undiciFetch } from 'undici'

const DEFAULT_TIMEOUT_MS = 45_000

let cachedProxyUrl = null
let cachedDispatcher = null
let didLogProxy = false

function getProxyUrl() {
  return (
    process.env.LLM_PROXY_URL ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.ALL_PROXY ||
    ''
  ).trim()
}

function getDispatcher() {
  const proxyUrl = getProxyUrl()
  if (!proxyUrl) return undefined

  if (cachedProxyUrl !== proxyUrl) {
    cachedProxyUrl = proxyUrl
    cachedDispatcher = new ProxyAgent(proxyUrl)
    didLogProxy = false
  }

  if (!didLogProxy) {
    console.log(`[llm] using proxy ${proxyUrl}`)
    didLogProxy = true
  }

  return cachedDispatcher
}

function parseTimeout(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS
}

function createAbortSignal(parentSignal, timeoutMs) {
  const controller = new AbortController()
  let timeoutId = null

  const abortFromParent = () => controller.abort(parentSignal.reason)
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort(parentSignal.reason)
    else parentSignal.addEventListener('abort', abortFromParent, { once: true })
  }

  timeoutId = setTimeout(() => {
    const err = new Error(`LLM request timed out after ${timeoutMs}ms`)
    err.name = 'TimeoutError'
    controller.abort(err)
  }, timeoutMs)

  const cleanup = () => {
    clearTimeout(timeoutId)
    if (parentSignal) parentSignal.removeEventListener('abort', abortFromParent)
  }

  return { signal: controller.signal, cleanup }
}

export async function llmFetch(url, options = {}) {
  const timeoutMs = parseTimeout(options.timeoutMs || process.env.LLM_TIMEOUT_MS)
  const { signal, cleanup } = createAbortSignal(options.signal, timeoutMs)
  const dispatcher = getDispatcher()

  try {
    const { timeoutMs: _timeoutMs, ...fetchOptions } = options
    return await undiciFetch(url, {
      ...fetchOptions,
      signal,
      ...(dispatcher ? { dispatcher } : {}),
    })
  } catch (err) {
    if (signal.aborted && options.signal?.aborted) throw err
    if (signal.aborted) {
      const reason = signal.reason
      throw reason instanceof Error ? reason : new Error(`LLM request timed out after ${timeoutMs}ms`)
    }
    throw err
  } finally {
    cleanup()
  }
}

export async function postDeepSeekChat(body, { apiKey, signal, timeoutMs } = {}) {
  const data = await postChatCompletion('deepseek', body, { apiKey, signal, timeoutMs })
  return data
}

export async function postChatCompletion(provider, body, { apiKey, signal, timeoutMs } = {}) {
  const normalizedProvider = provider === 'openai' ? 'openai' : 'deepseek'
  const url = normalizedProvider === 'openai'
    ? 'https://api.openai.com/v1/chat/completions'
    : 'https://api.deepseek.com/chat/completions'
  const providerLabel = normalizedProvider === 'openai' ? 'OpenAI' : 'DeepSeek'

  const res = await llmFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
    timeoutMs,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`${providerLabel} API error ${res.status}: ${err}`)
  }

  return res.json()
}
