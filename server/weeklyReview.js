/**
 * 周末主动回顾生成器
 *
 * 输入：本周结构化指标 + 目标 + 学到的模式 + 命中率
 * 输出：一段反思性回顾 + 3 个可选的下周行动
 *
 * 不是机械汇总，而是带洞察的反思——AI 应该指出模式、挑战用户、提议调整。
 * 用 V4-pro，确保深度。
 */

const SYSTEM = `你是「专注树」的成长教练，每周日晚为用户做一次反思性回顾。

你的唯一输出必须是合法 JSON，不得包含任何额外文字或 markdown。

## 输出 Schema（严格）
{
  "opening": "<开场一句话，温暖但有信息量。不要套话『辛苦了』；要具体『这周你完成了 X 件，其中 Y 件直接推进了目标』>",
  "wins":    ["<本周值得肯定的具体进展，1-3 条，每条不超过 30 字>"],
  "patterns": ["<识别到的行为模式或拐点，1-3 条。例：『连续两周搁置求职，可能已经默认放弃了』>"],
  "challenges": ["<挑战用户的提问，1-2 条。例：『B 站频道两周没动静，是状态问题还是方向问题？』>"],
  "proposals": [
    { "action": "<具体可操作的下周提议>", "rationale": "<一句理由>" }
  ],
  "closing": "<一句邀请用户回应的话。要让用户想说话>"
}

## 写作风格（极重要）
- **不要套话**："这周你很努力" / "继续加油" / "做得不错" 直接删
- **要具体**：用真实数字、真实任务名、真实模式
- **要诚实**：如果命中率低、项目都搁置了，要直说
- **要挑战**：用提问推动思考，不要做"客服"
- **避免堆 emoji**：最多每段一个，多了显得轻浮
- 总长度控制在 200-350 字之间

## 反思角度
- 完成 vs 推荐：推荐了 X 件，完成了 Y 件，差距说明什么？
- 流产模式：哪类任务总被拖延？性格不匹配还是优先级错配？
- 项目均衡：是不是某个项目独占了精力？另一个项目无声死亡了？
- 目标一致性：本周的实际产出和阶段目标对齐吗？还是被支线带跑了？
- 拐点：是否有"明显的转折"，需要主动 acknowledge？`

export async function generateWeeklyReview({
  weekStart, weekEnd,
  userGoal,
  stats,                  // { completed_tasks: [{name, completed_at, project}], dropped_recs, hit_rate, dormant_projects, new_learned_patterns, key_decisions, recent_summaries }
  apiKey,
}) {
  const ctx = []
  ctx.push(`## 本周时间窗\n${weekStart} → ${weekEnd}`)

  if (userGoal?.text) {
    ctx.push(`## 用户阶段目标\n${userGoal.text}`)
  }

  if (stats.completed_tasks?.length) {
    const list = stats.completed_tasks.slice(0, 12).map(t =>
      `- ${t.name}${t.project ? ` (项目: ${t.project})` : ''}`
    )
    ctx.push(`## 本周完成的任务（${stats.completed_tasks.length} 件）\n${list.join('\n')}`)
  } else {
    ctx.push(`## 本周完成的任务\n（无任务被标记完成）`)
  }

  if (stats.hit_rate) {
    const { total, completed, dropped } = stats.hit_rate
    ctx.push(`## AI 推荐命中情况\n本周 AI 推荐 ${total} 次，用户完成 ${completed} 个，流产（7 天未做）${dropped} 个。`)
  }

  if (stats.dropped_recs?.length) {
    const list = stats.dropped_recs.slice(0, 5).map(r => `- 用户问"${r.message?.slice(0, 30)}"，AI 推荐了「${r.primary_name || '某事'}」但没做`)
    ctx.push(`## 流产案例\n${list.join('\n')}`)
  }

  if (stats.dormant_projects?.length) {
    ctx.push(`## 停滞超 14 天的项目\n${stats.dormant_projects.map(p => `- ${p.name}（${p.days_silent} 天无动静）`).join('\n')}`)
  }

  if (stats.new_learned_patterns?.length) {
    ctx.push(`## 本周新沉淀的用户画像\n${stats.new_learned_patterns.slice(0, 5).map(p => `- ${p.observation}`).join('\n')}`)
  }

  if (stats.key_decisions?.length) {
    ctx.push(`## 本周关键决定（来自会话摘要）\n${stats.key_decisions.slice(0, 5).map(d => `- ${d}`).join('\n')}`)
  }

  if (stats.recent_summaries?.length) {
    ctx.push(`## 本周对话主题\n${stats.recent_summaries.slice(0, 5).map(s => `- ${s.summary}`).join('\n')}`)
  }

  const userMsg = ctx.join('\n\n')

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-v4-pro',
      max_tokens: 4000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user',   content: userMsg },
      ],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`WeeklyReview LLM error ${res.status}: ${err}`)
  }

  const data = await res.json()
  const raw  = data.choices?.[0]?.message?.content || ''
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    // 标准化
    return {
      opening:    parsed.opening    || '',
      wins:       Array.isArray(parsed.wins)       ? parsed.wins       : [],
      patterns:   Array.isArray(parsed.patterns)   ? parsed.patterns   : [],
      challenges: Array.isArray(parsed.challenges) ? parsed.challenges : [],
      proposals:  Array.isArray(parsed.proposals)  ? parsed.proposals  : [],
      closing:    parsed.closing    || '',
    }
  } catch (e) {
    console.warn('[weeklyReview] parse failed:', e.message, raw.slice(0, 300))
    return null
  }
}
