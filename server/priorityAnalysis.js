import { postChatCompletion } from './llmClient.js'

const VALID_RELATIONS = new Set(['normal', 'required', 'enables', 'supporting', 'optional'])
const BATCH_SIZE = 18
const ENV = globalThis.process?.env || {}

export function estimatePriorityAnalysisTokens(nodes, goal) {
  const inputChars = JSON.stringify({ goal, nodes }).length + 1200
  const inputTokens = Math.ceil(inputChars / 1.8)
  const outputTokens = (nodes?.length || 0) * 105
  return Math.max(900, inputTokens + outputTokens)
}

export async function analyzePriorityNodes({ nodes, goal, provider, apiKey, signal }) {
  const normalizedNodes = normalizeNodes(nodes)
  if (!goal?.text?.trim()) throw new Error('请先设置当前目标，再进行 AI 优先级分析。')
  if (!normalizedNodes.length) throw new Error('没有需要分析的节点。')
  if (normalizedNodes.length > 80) throw new Error('单次最多分析 80 个节点。')

  const batches = chunk(normalizedNodes, BATCH_SIZE)
  const proposals = []
  const usages = []
  const costs = []
  const models = []

  for (const batch of batches) {
    const result = await analyzeBatch({ batch, goal, provider, apiKey, signal })
    proposals.push(...result.proposals)
    if (result.usage) usages.push(result.usage)
    if (result.usageCost) costs.push(result.usageCost)
    models.push(result.model)
  }

  return {
    proposals,
    usage: sumUsage(usages),
    usageCost: sumCosts(costs),
    modelUsed: [...new Set(models)].join(' + '),
    batches: batches.length,
    estimatedTokens: estimatePriorityAnalysisTokens(normalizedNodes, goal),
  }
}

async function analyzeBatch({ batch, goal, provider, apiKey, signal }) {
  const primaryModel = provider === 'openai'
    ? (ENV.OPENAI_MODEL_REASONER || ENV.OPENAI_MODEL || 'gpt-5.4-mini')
    : 'deepseek-v4-pro'
  const fallbackModel = provider === 'openai'
    ? (ENV.OPENAI_MODEL_CHAT || ENV.OPENAI_MODEL || 'gpt-5.4-mini')
    : 'deepseek-v4-flash'
  const models = primaryModel === fallbackModel ? [primaryModel] : [primaryModel, fallbackModel]
  let lastError = null

  for (const model of models) {
    try {
      const body = {
        model,
        messages: [
          { role: 'system', content: priorityAnalysisPrompt() },
          { role: 'user', content: JSON.stringify({ goal, nodes: batch }) },
        ],
        max_tokens: model === 'deepseek-v4-pro' ? 10000 : 7000,
      }
      if (model !== 'deepseek-v4-pro' || ENV.DEEPSEEK_PRO_JSON_MODE === 'true') {
        body.response_format = { type: 'json_object' }
      }
      if (model !== 'deepseek-v4-pro') body.temperature = 0.2

      const response = await postChatCompletion(provider, body, { apiKey, signal })
      const raw = response.choices?.[0]?.message?.content || ''
      const parsed = parseJSON(raw)
      const proposals = validateProposals(parsed?.proposals, batch)
      return {
        proposals,
        usage: response.usage || null,
        usageCost: response.usage_cost || null,
        model,
      }
    } catch (error) {
      lastError = error
      if (signal?.aborted) throw error
    }
  }

  throw lastError || new Error('优先级分析失败。')
}

function priorityAnalysisPrompt() {
  return `你是 FocusTree 的语义分析器。你的职责不是计算最终优先级，而是把目标与节点之间的含义转成确定性算法可用的信号。

只输出 JSON：{"proposals":[...]}。必须为输入中的每个节点输出且只输出一项，node_id 必须原样复制。

每项字段：
- name：原节点名
- node_id：原节点 id
- goal_alignment：0-1，与当前目标的直接契合程度
- necessity：0-1，是否为实现目标不可绕过的步骤
- delay_cost：0-1，延误该节点会造成多大现实损失
- relation_type：normal|required|enables|supporting|optional，表示节点相对父节点的作用
- confidence：0-1，信息不足时必须降低
- reason：不超过 40 个汉字的一句可核查解释

约束：
1. 不输出最终分数、百分比、排序或精力配比。
2. 不因为节点数量、层级深度或描述长度而提高分值。
3. required 表示不可绕过，enables 表示解锁后续，supporting 表示辅助，optional 表示可跳过。
4. 当前目标有期限时按阶段目标判断；没有期限时按长期目标判断。
5. 如果目标与节点关系不明确，使用中性值并降低 confidence，不得编造事实。`
}

function normalizeNodes(nodes) {
  return (Array.isArray(nodes) ? nodes : [])
    .filter(node => node?.id && node?.name && node?.status !== 'done')
    .map(node => ({
      id: String(node.id),
      name: String(node.name).slice(0, 160),
      type: String(node.type || 'task'),
      status: String(node.status || 'active'),
      parent_id: node.parent_id ? String(node.parent_id) : null,
      parent_name: node.parent_name ? String(node.parent_name).slice(0, 160) : null,
      path: String(node.path || node.name).slice(0, 600),
      details: String(node.details || '').slice(0, 900),
      current_priority: node.current_priority || null,
      target_completion_date: node.target_completion_date || null,
    }))
}

function validateProposals(raw, batch) {
  if (!Array.isArray(raw)) throw new Error('模型没有返回 proposals 数组。')
  const expected = new Map(batch.map(node => [String(node.id), node]))
  const seen = new Set()
  const result = []

  for (const proposal of raw) {
    const id = String(proposal?.node_id || '')
    const node = expected.get(id)
    if (!node || seen.has(id)) continue
    seen.add(id)
    result.push({
      name: node.name,
      node_id: id,
      goal_alignment: unit(proposal.goal_alignment),
      necessity: unit(proposal.necessity),
      delay_cost: unit(proposal.delay_cost),
      relation_type: VALID_RELATIONS.has(proposal.relation_type) ? proposal.relation_type : 'normal',
      confidence: unit(proposal.confidence ?? 0.5),
      reason: String(proposal.reason || '').trim().slice(0, 120),
    })
  }

  if (result.length !== expected.size) {
    const missing = [...expected.keys()].filter(id => !seen.has(id))
    throw new Error(`模型漏掉了 ${missing.length} 个节点：${missing.slice(0, 5).join('、')}`)
  }
  return result
}

function parseJSON(raw) {
  const text = String(raw || '').trim()
  if (!text) throw new Error('模型返回空内容。')
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型未返回 JSON 对象。')
  return JSON.parse(candidate.slice(start, end + 1))
}

function unit(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(1, numeric))
}

function chunk(items, size) {
  const output = []
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size))
  return output
}

function sumUsage(usages) {
  if (!usages.length) return null
  return usages.reduce((total, usage) => ({
    prompt_tokens: total.prompt_tokens + Number(usage.prompt_tokens || 0),
    completion_tokens: total.completion_tokens + Number(usage.completion_tokens || 0),
    total_tokens: total.total_tokens + Number(usage.total_tokens || 0),
    prompt_cache_hit_tokens: total.prompt_cache_hit_tokens + Number(usage.prompt_cache_hit_tokens || 0),
    prompt_cache_miss_tokens: total.prompt_cache_miss_tokens + Number(usage.prompt_cache_miss_tokens || 0),
  }), {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    prompt_cache_hit_tokens: 0,
    prompt_cache_miss_tokens: 0,
  })
}

function sumCosts(costs) {
  if (!costs.length) return null
  const first = costs[0]
  return costs.reduce((total, cost) => ({
    ...total,
    amount: total.amount + Number(cost.amount || 0),
    input_cost: total.input_cost + Number(cost.input_cost || 0),
    output_cost: total.output_cost + Number(cost.output_cost || 0),
    prompt_tokens: total.prompt_tokens + Number(cost.prompt_tokens || 0),
    completion_tokens: total.completion_tokens + Number(cost.completion_tokens || 0),
    total_tokens: total.total_tokens + Number(cost.total_tokens || 0),
    cached_input_tokens: total.cached_input_tokens + Number(cost.cached_input_tokens || 0),
    uncached_input_tokens: total.uncached_input_tokens + Number(cost.uncached_input_tokens || 0),
  }), {
    provider: first.provider,
    model: costs.map(cost => cost.model).filter(Boolean).join(' + '),
    currency: first.currency,
    amount: 0,
    input_cost: 0,
    output_cost: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    cached_input_tokens: 0,
    uncached_input_tokens: 0,
  })
}
