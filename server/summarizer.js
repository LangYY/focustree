/**
 * Session 摘要器：把一段对话压缩成 1-2 句 summary + key_decisions + topics
 *
 * 用一个独立的 LLM 调用，不与主 agent 共享 prompt。
 * 输出严格 JSON schema：{ summary, key_decisions: [], topics: [] }
 */

import { postChatCompletion } from './llmClient.js'
import {
  containsDeprecatedPlanningPolicy,
  redactDeprecatedPlanningPolicy,
} from './promptSafety.js'

const SUMMARY_SYSTEM_PROMPT = `你是「专注树」会话摘要器。任务：把用户和 AI 的一段对话压缩成结构化记忆。
你的输出必须是合法 JSON，不得包含任何额外文字或 markdown。

## 输出 Schema（严格）
{
  "summary":       "<1-2 句话总结这段对话发生了什么。聚焦：用户做了什么、决定了什么、AI 帮了什么。不要复述细节>",
  "key_decisions": ["<用户或共同做出的关键决定，可以是空数组>"],
  "topics":        ["<这段对话围绕的主题/关键词，2-5 个>"]
}

## 写作风格
- summary 用第三人称（"用户..."），简洁有力
- 不要写"用户问了什么、AI 答了什么"这种废话流水账
- 提炼**沉淀价值**：决策、转折、明确放弃、明确选择
- 只总结用户真实决定，不沉淀旧 assistant 的面板压缩口径
- topics 用名词短语，例：「B站频道」「现金流规划」「项目优先级」

## 示例
输入对话：
user: 我该做什么
assistant: 建议先做第2集脚本，是上游瓶颈
user: 好，我先做这个，求职那边先放一放
assistant: 收到

输出：
{"summary":"用户决定优先推进 B 站脚本，暂时搁置求职项目","key_decisions":["优先 B 站脚本","暂停求职"],"topics":["B 站频道","项目优先级"]}`

export async function summarizeSession({ messages, apiKey, provider = 'deepseek' }) {
  if (!messages?.length) return null
  // 把对话拼成纯文本
  const cleanMessages = messages
    .filter(m => !(m.role === 'assistant' && containsDeprecatedPlanningPolicy(m.content)))
    .map(m => ({ ...m, content: redactDeprecatedPlanningPolicy(m.content) }))

  const text = cleanMessages
    .map(m => `${m.role}: ${m.content}`)
    .join('\n')
    .slice(0, 4000)   // 安全截断

  const data = await postChatCompletion(provider, {
    model: provider === 'openai'
      ? (process.env.OPENAI_MODEL_CHAT || process.env.OPENAI_MODEL || 'gpt-4o-mini')
      : 'deepseek-v4-flash',          // 摘要用便宜模型
    temperature: 0.3,
    max_tokens: 400,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
      { role: 'user',   content: `请总结以下对话：\n\n${text}` },
    ],
  }, { apiKey })
  const raw = data.choices?.[0]?.message?.content || ''
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(cleaned)
    const summary = redactDeprecatedPlanningPolicy(parsed.summary || '').trim()
    return {
      summary,
      key_decisions: Array.isArray(parsed.key_decisions)
        ? parsed.key_decisions
            .filter(item => !containsDeprecatedPlanningPolicy(item))
            .map(item => redactDeprecatedPlanningPolicy(item))
        : [],
      topics: Array.isArray(parsed.topics)
        ? parsed.topics
            .filter(item => !containsDeprecatedPlanningPolicy(item))
            .map(item => redactDeprecatedPlanningPolicy(item))
        : [],
    }
  } catch (e) {
    console.warn('[summarizer] JSON parse failed:', e.message, raw.slice(0, 200))
    return null
  }
}
