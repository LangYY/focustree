/**
 * 每日聚焦生成器
 *
 * 输入：树文本 + 目标 + 摘要 + learned + 命中率 + 当前时间
 * 输出：3 件今天该做的事，每件含 node_id / 时段 / 一句理由
 *
 * 用 V4-pro 模型，确保推荐质量。
 */

import { postChatCompletion } from './llmClient.js'

const SYSTEM = `你是「专注树」的每日规划师。任务：根据用户当前阶段目标、项目树、最近的会话和学到的模式，给出**今天最值得做的 3 件事**。

你的唯一输出必须是合法 JSON，不得包含任何额外文字或 markdown。

## 输出 Schema（严格）
{
  "summary": "<对今天这套安排的一句话总结，不超过 40 字>",
  "tasks": [
    {
      "node_id":      "<树中真实存在的 node id；不能引用不存在的 id；若所推荐的事在树里没对应节点则 node_id 写 null>",
      "name":         "<任务名，和树里的名字一致；若 node_id 为 null 则给一个新建议>",
      "energy_tier":  "早上" | "下午" | "晚上" | "任意",
      "why":          "<一句话理由：为什么放在这个时段、对目标的贡献>"
    },
    ... 共 3 件
  ]
}

## 强约束
- **必须 3 件**，不多不少
- 至少 2 件 node_id 是真实存在的节点（从 ## 当前项目树 中挑）
- 任务按 energy_tier 错峰：早上做高专注、下午做执行、晚上做轻量
- 围绕「当前阶段目标」展开，每件 why 都要说清楚和目标的关系
- 不要重复树里 status='done' 的任务
- 不要选 status='dormant' 的任务（除非用户明确说要恢复）
- 不要选 status='dropped' 的任务；它们是已废弃但保留痕迹的节点

## 写作风格
- name 简洁，最多 12 字
- why 一句话有信息密度："90 分钟写完冷开场，解锁分镜下游"
- 不要套话："这件事很重要" 这种废话直接删掉`

export async function generateDailyFocus({
  treeText, userGoal, recentSummaries, learnedPatterns, hitRate, clientTime, apiKey, provider = 'deepseek',
}) {
  const contextParts = []

  if (clientTime) {
    contextParts.push(`## 当前时间\n${clientTime.weekday}，${clientTime.hour} 点（${clientTime.period}）`)
  }
  if (userGoal?.text) {
    const constraints = (userGoal.constraints || []).join('；')
    contextParts.push(`## 用户当前阶段目标\n${userGoal.text}${constraints ? `\n约束：${constraints}` : ''}`)
  }
  if (recentSummaries?.length) {
    const lines = recentSummaries.slice(0, 3).map(s => `- ${s.summary}`)
    contextParts.push(`## 近期会话回顾\n${lines.join('\n')}`)
  }
  if (learnedPatterns?.length) {
    const high = learnedPatterns.filter(p => (p.confidence ?? 1) >= 0.6).slice(-8)
    if (high.length) {
      contextParts.push(`## 已学到的用户模式\n${high.map(p => `- ${p.observation}`).join('\n')}`)
    }
  }
  if (hitRate?.total) {
    contextParts.push(`## 你的历史命中率\n近 30 天推荐 ${hitRate.total} 次，完成 ${hitRate.completed}，流产 ${hitRate.dropped}。`)
  }
  contextParts.push(`## 当前项目树\n${treeText || '（暂无项目）'}`)

  const userMsg = contextParts.join('\n\n')

  const data = await postChatCompletion(provider, {
    model: provider === 'openai'
      ? (process.env.OPENAI_MODEL_REASONER || process.env.OPENAI_MODEL || 'gpt-4o')
      : 'deepseek-v4-pro',
    max_tokens: 3500,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user',   content: userMsg },
    ],
  }, { apiKey })
  const raw = data.choices?.[0]?.message?.content || ''
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed.tasks)) throw new Error('tasks not array')
    // 标准化
    parsed.tasks = parsed.tasks.slice(0, 3).map(t => ({
      node_id:     t.node_id || null,
      name:        t.name || '',
      energy_tier: ['早上', '下午', '晚上', '任意'].includes(t.energy_tier) ? t.energy_tier : '任意',
      why:         t.why || '',
      done:        false,
    }))
    return parsed
  } catch (e) {
    console.warn('[dailyFocus] parse fail:', e.message, raw.slice(0, 300))
    return null
  }
}
