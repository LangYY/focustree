import { ProxyAgent, fetch as undiciFetch } from 'undici'

const DEFAULT_TIMEOUT_MS = 45_000
const TOKENS_PER_MILLION = 1_000_000

const PRICING_PER_1M = {
  deepseek: {
    // CNY rates from DeepSeek zh-CN pricing. V4-pro reflects the current 75% discount.
    'deepseek-v4-flash': { currency: 'CNY', inputCacheHit: 0.02, inputCacheMiss: 1, output: 2 },
    'deepseek-v4-pro':   { currency: 'CNY', inputCacheHit: 0.025, inputCacheMiss: 3, output: 6 },
    'deepseek-chat':     { alias: 'deepseek-v4-flash' },
    'deepseek-reasoner': { alias: 'deepseek-v4-flash' },
  },
  openai: {
    'gpt-5.5':      { currency: 'USD', input: 5.00, cachedInput: 0.50,  output: 30.00 },
    'gpt-5.4':      { currency: 'USD', input: 2.50, cachedInput: 0.25,  output: 15.00 },
    'gpt-5.4-mini': { currency: 'USD', input: 0.75, cachedInput: 0.075, output: 4.50 },
  },
}

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
    const fetchOptions = { ...options }
    delete fetchOptions.timeoutMs
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

  const data = await res.json()
  return {
    ...data,
    usage_cost: estimateUsageCost(normalizedProvider, body.model, data.usage),
  }
}

function resolvePricing(provider, model) {
  const providerPricing = PRICING_PER_1M[provider]
  const pricing = providerPricing?.[model]
  if (!pricing) return null
  if (pricing.alias) return providerPricing[pricing.alias] || null
  return pricing
}

export function estimateUsageCost(provider, model, usage) {
  if (!usage) return null

  const normalizedProvider = provider === 'openai' ? 'openai' : 'deepseek'
  const pricing = resolvePricing(normalizedProvider, model)
  if (!pricing) return null

  const promptTokens = usage.prompt_tokens || 0
  const completionTokens = usage.completion_tokens || 0
  const totalTokens = usage.total_tokens || promptTokens + completionTokens
  const cachedInputTokens =
    usage.prompt_cache_hit_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    0
  const uncachedInputTokens =
    usage.prompt_cache_miss_tokens ??
    Math.max(0, promptTokens - cachedInputTokens)

  const inputCost = normalizedProvider === 'deepseek'
    ? (cachedInputTokens * pricing.inputCacheHit +
       uncachedInputTokens * pricing.inputCacheMiss) / TOKENS_PER_MILLION
    : (cachedInputTokens * pricing.cachedInput +
       uncachedInputTokens * pricing.input) / TOKENS_PER_MILLION
  const outputCost = completionTokens * pricing.output / TOKENS_PER_MILLION

  return {
    provider: normalizedProvider,
    model,
    currency: pricing.currency,
    amount: inputCost + outputCost,
    input_cost: inputCost,
    output_cost: outputCost,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    cached_input_tokens: cachedInputTokens,
    uncached_input_tokens: uncachedInputTokens,
  }
}
