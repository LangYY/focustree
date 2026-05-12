/**
 * 专注树 Agent 核心逻辑
 *
 * 职责：
 * 1. 构建带 few-shot 示例的 system prompt
 * 2. 调用 LLM（目前 DeepSeek，可替换）
 * 3. 解析并校验 JSON 输出
 * 4. 失败时带错误反馈自动重试（最多 MAX_RETRIES 次）
 * 5. 全部失败时返回安全降级结果
 */

const MAX_RETRIES = 3
const VALID_TYPES = [
  'mark_done', 'mark_active', 'mark_dormant',
  'add_task', 'add_category', 'add_project',
  'rename', 'delete', 'clear_all',
  'annotate',                     // 给已有节点打/改策略标签
  'remember',                     // 写入 learned_patterns（长期画像）
]

const VALID_TIME_HORIZON  = ['立即', '短期', '中期', '长期']
const VALID_ENERGY_COST   = ['高专注', '中等', '机械']
const VALID_RISK          = ['确定性', '投机性']
const VALID_STRATEGIC_TAG = ['现金流', '资产积累', '信号建立', '维持性', '探索']

// ── 入口 ─────────────────────────────────────────────

/**
 * @param {string} message         用户当前输入
 * @param {string} treeText        树的文字描述（含 id 和已有 annotations）
 * @param {Set<string>} nodeIdSet  树中所有合法 id 的集合（用于校验）
 * @param {Array} history          对话历史 [{role, content}]
 * @param {object} userGoal        { text, set_at, expires_at, constraints, exclude } | null
 * @param {string} model           'auto' | 'chat' | 'reasoner'，默认 'auto'
 * @param {string} apiKey          LLM API key
 * @returns {{ intent, reply, actions, thinking?, model_used? }}
 */
export async function runAgent({
  message, treeText, nodeIdSet, history, userGoal,
  recentSummaries = [], learnedPatterns = [], hitRate = null,
  clientTime = null,
  model = 'auto', apiKey,
}) {
  const systemPrompt = buildSystemPrompt(treeText, userGoal, recentSummaries, learnedPatterns, hitRate, clientTime)
  const modelName = resolveModel(model, message)
  let lastError = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const messages = buildMessages(history, message, lastError, attempt)
    const raw = await callLLM(systemPrompt, messages, apiKey, modelName)

    const parseResult = safeParseJSON(raw)
    if (!parseResult.ok) {
      lastError = `JSON 解析失败：${parseResult.error}。你的原始输出是：${raw.slice(0, 200)}`
      console.warn(`[agent] attempt ${attempt + 1} parse error:`, lastError)
      continue
    }

    const normalized = normalizeOutput(parseResult.data)

    const validation = validateOutput(normalized, nodeIdSet)
    if (!validation.ok) {
      lastError = `输出校验失败：${validation.errors.join('；')}。请严格按格式重新生成。`
      console.warn(`[agent] attempt ${attempt + 1} validation error:`, validation.errors)
      continue
    }

    console.log(`[agent] success on attempt ${attempt + 1}, model=${modelName}, intent=${normalized.intent}, actions=${normalized.actions.length}, has_thinking=${!!normalized.thinking}`)
    return { ...normalized, model_used: modelName }
  }

  console.error('[agent] all attempts failed, falling back')
  return {
    intent: 'query',
    reply: '抱歉，我遇到了一些问题，没能完成这个操作。能换个说法再试试吗？',
    actions: [],
    model_used: modelName,
  }
}

/**
 * 'auto' / 'chat' / 'reasoner' → 实际 deepseek 模型名
 * auto 模式启发式：如果消息像推荐/优先级/建议类问题，用 reasoner；否则 chat
 */
function resolveModel(mode, message) {
  if (mode === 'chat')     return 'deepseek-v4-flash'   // 快速：V4 小模型
  if (mode === 'reasoner') return 'deepseek-v4-pro'     // 深度：V4 大模型（真正的推理）

  // auto 模式：除了简单"操作"型指令（添加/标完成/重命名/删除），其它一律走 V4-pro
  // 反向白名单更稳：明确判定为"纯操作"才用 flash，模糊就用 pro
  const msg = message.trim()

  // 1. 极短 + 非问句 → 可能是测试或填充 → flash
  if (msg.length < 4 && !/[?？]/.test(msg)) return 'deepseek-v4-flash'

  // 2. 纯命令式（含明确操作动词 + 不带反思/推理词 + 不是问句）
  //    用"含有"而非"开头"，覆盖"在 X 下添加 Y"这种位置在中间的指令
  const actionVerbs    = /(添加|加任务|加分类|新建|创建|删除|删掉|重命名|改名为|标记|做完了|完成了|暂停|搁置|清空|清除)/
  const reasoningWords = /(建议|推荐|该|应该|为什么|怎么|哪个|哪些|分析|思考|规划|策略|优先|值得|要不要|该不该|做什么|做啥|做设么|做点啥|想做)/
  const isQuestion     = /[?？]/.test(msg)
  if (actionVerbs.test(msg) && !reasoningWords.test(msg) && !isQuestion) {
    return 'deepseek-v4-flash'
  }

  // 3. 其他一切（问句 / 推理词 / 较长输入 / 不确定）→ V4-pro
  return 'deepseek-v4-pro'
}

// ── Prompt 构建 ───────────────────────────────────────

function buildSystemPrompt(treeText, userGoal, recentSummaries, learnedPatterns, hitRate, clientTime) {
  const goalBlock      = formatGoalBlock(userGoal)
  const summariesBlock = formatSummariesBlock(recentSummaries)
  const learnedBlock   = formatLearnedBlock(learnedPatterns)
  const hitRateBlock   = formatHitRateBlock(hitRate)
  const timeBlock      = formatTimeBlock(clientTime)

  return `你是「专注树」AI 助理，同时也是一个有经验的成长教练。你的唯一输出必须是合法 JSON，不得包含任何额外文字、markdown 代码块或注释。

## 🔒 状态来源优先级（最重要的规则）
1. 下方 ## 当前项目树 块是**此刻的唯一真实状态**——以它为准。
2. 对话历史里可能残留过去的状态描述（如"树已清空"、"现在没有项目"等），**全部视为过时信息**，不得引用、不得续写。
3. 不要描述"树已清空 / 已清除 / 重新开始"等过去操作——除非本轮用户当下又要求清空。
4. 不要在 reply 开头总结上次操作的结果。专注回答用户当下的问题。
${timeBlock}${goalBlock}${summariesBlock}${learnedBlock}${hitRateBlock}
## 当前项目树（括号内是节点 ID，操作时必须使用这些 ID）
${treeText}

## 输出 Schema（必须严格遵守）
{
  "intent": "action" | "query" | "idea",
  "reply": "给用户的中文回复，120字以内。引用任务时只写「任务名」即可，不要写 (id:xxx)——id 放在 thinking.recommended_primary_id / recommended_alternative_ids 字段里。reply 末尾另起一行加 🎯 对齐目标 ✓ 或 ⚠️ 偏离目标：<原因>。",
  "thinking": {                  // ← 推荐/优先级/规划类问题必须输出，越具体越好
    "user_goal":                "<复述用户当前阶段目标，一句话>",
    "tradeoff_analysis":        "<为什么选 A 而不是 B/C？至少对比 2 个真实候选，给出权衡，一段话>",
    "traps_avoided":            ["<识别到的陷阱，每条具体到机制，不要套话>"],
    "leverage_insight":         "<用户没想到的杠杆点。要新颖、要具体，不要重复 user_goal>",
    "next_concrete_step":       "<推荐任务的第一个 30 分钟内能做完的具体动作>",
    "success_criterion":        "<本次任务做到什么程度算完成？可验证的标准>",
    "risk_if_skipped":          "<如果这周不做这件事，对目标产生什么具体损失>",
    "recommended_primary_id":   "<主推荐任务的 node id，从 ## 当前项目树 中真实存在的 id。无具体任务推荐时为 null>",
    "recommended_alternative_ids": ["<备选任务的 node id 列表，0-3 个；无则空数组>"]
  },
  "actions": []
}

## 可用 Action 类型（字段名不可变动，不可自创）
{ "type": "mark_done",    "id": "...", "name": "..." }
{ "type": "mark_active",  "id": "...", "name": "..." }
{ "type": "mark_dormant", "id": "...", "name": "..." }
{ "type": "add_task",     "name": "...", "parent": "...", "annotations": {...} }   // annotations 可选但鼓励
{ "type": "add_category", "name": "...", "parent": "...", "annotations": {...} }
{ "type": "add_project",  "name": "...", "color": "#hex", "annotations": {...} }
{ "type": "rename",       "id": "...", "name": "..." }
{ "type": "delete",       "id": "...", "name": "..." }
{ "type": "clear_all" }
{ "type": "annotate",     "id": "...", "annotations": {...} }                       // 给已有节点打/改标签
{ "type": "remember",     "observation": "<一句话事实>", "confidence": 0.0-1.0, "topic": "<分类标签>" }  // 记入长期画像

## annotations 对象的字段（全部可选，知道就填）
{
  "roi_type":      { "现金": 0-1, "经验": 0-1, "资产": 0-1, "关系": 0-1, "心情": 0-1, "健康": 0-1 },
  "time_horizon":  "立即" | "短期" | "中期" | "长期",
  "energy_cost":   "高专注" | "中等" | "机械",
  "feasibility":   0-1,
  "risk":          "确定性" | "投机性",
  "strategic_tag": "现金流" | "资产积累" | "信号建立" | "维持性" | "探索",
  "ai_notes":      "<一句话解释为什么这样标>"
}

## 意图分类规则
- action：用户明确要修改树（完成/添加/删除/重命名/打标签）
- query：咨询、询问建议、问现在该做什么
- idea：用户在记录想法或灵感，暂时不需要操作树

## 「我该做什么 / 优先级 / 规划」类问题的核心规则

### 必答字段（thinking 全部七个字段）
当用户询问做什么/优先级/今天做几件事/接下来怎么走时，**thinking 七项全部填写**：
1. **user_goal** — 复述用户当前阶段目标
2. **tradeoff_analysis** — 必须显式对比 ≥2 个候选任务，写"为什么是 A 不是 B"
3. **traps_avoided** — 识别 1-3 个潜在陷阱，每条具体到机制
4. **leverage_insight** — 一个用户没想到、且本轮没被覆盖到的角度
5. **next_concrete_step** — 推荐任务的第一个 30 分钟具体动作（动词开头）
6. **success_criterion** — 这次推荐完成到什么程度算 "done enough"
7. **risk_if_skipped** — 不做的具体后果

### 深度要求（极重要！）
"建议做 X 因为它是上游瓶颈" 这种回答太空。每次推荐必须满足：
- **可执行**：用户读完知道下一步具体打开什么、做什么动作
- **可比较**：解释清楚为什么不是别的任务
- **可验证**：给出 "完成" 的判断标准
- **可反思**：指出潜在的失败路径

### 对齐标注
reply 末尾必须另起一行：
- 推荐对齐目标 → "🎯 对齐目标 ✓"
- 不得不偏离 → "⚠️ 偏离目标：<一句话原因>"

### 目标提醒
- 如果 ## 用户当前阶段目标 块里显示"目标：xxx"，**绝对不要再说"建议先用 /目标"**。
- 只有在该块明确写"用户尚未设置阶段目标"时，才提醒一次。

### 空树规则
当用户已设目标但树里没任务时，提出 2-3 个具体可切入的候选任务，并主动询问要不要加进树，仍输出 thinking。

### 🔥 反幻觉硬规则
- 如果 ## 当前项目树 块里有任何 [task] 节点，**必须从真实 task 中挑 1-2 个**做主要推荐。
- 必须引用真实节点 name 和 id。
- 严禁说"你目前没有任务记录"。
- 只有当树中确实**没有任何 [task]** 时，才采用抽象建议模板。

### 多任务建议（"今天做哪三件事"）
当用户问"今天做几件事"或"列三件最重要的"时：
- reply 给出 3 条**具体任务名 + id + 一句理由**，用换行分隔
- thinking 字段照常输出，但 next_concrete_step 写**第一件事**的具体动作即可

## remember Action 使用规则（关键！）

当用户在对话中**透露关于自己的稳定事实**时，主动发出 remember action 把它记下来。这是长期"懂用户"的基础。

**应该 remember 的信号**（举例）：
- 工作节奏 / 精力分布："我早上写脚本效率最高" → topic="energy_pattern"
- 偏好与厌恶："我不喜欢面对面销售" → topic="preference"
- 拖延模式："我又把求职拖了三天" → topic="procrastination"
- 决策转折："这个月先搁置 B 站，专心接外包" → topic="focus_shift"
- 性格信号："比起多线程，我更喜欢一次做完一件事" → topic="work_style"
- 资源 / 技能："我会用 Figma 做设计" → topic="skill"

**不要 remember**：
- 一次性事件（"今天完成了任务"）
- AI 自己推断的猜测（除非置信度 ≥ 0.7）
- 重复已经在 ## 已学到的用户模式 里的事实
- 容易过时的状态（"我现在饿了"）

**confidence 评分**：
- 0.9+：用户明确陈述，多次重复
- 0.7：用户清晰陈述一次
- 0.5：从语境中较强推断
- 不到 0.5 别 remember

**一个回复里通常 0-1 个 remember。多了说明你在脑补。**

## 创建新节点时的智能标注规则

当 add_task / add_category / add_project 时，**尽量带上 annotations**：
- 根据任务名称推断 roi_type 分布（"剪辑视频" → 资产+经验；"接咨询单" → 现金+信号；"练琴" → 心情+经验）
- 推断 time_horizon（"今天发一条朋友圈" → 立即；"运营 B 站半年" → 长期）
- 推断 energy_cost、risk、strategic_tag
- ai_notes 写一句解释，让用户后续可以质疑你的判断

## Few-shot 示例

输入: 「第2集脚本写完了」，树中有 [task] 第2集脚本 (id:t-123)
输出: {"intent":"action","reply":"太棒了！第2集脚本已标记完成 ✓","actions":[{"type":"mark_done","id":"t-123","name":"第2集脚本"}]}

输入: 「在熊猫团团下加个任务：剪辑第1集」，树中有 [project] 熊猫团团 (id:p-001)
输出: {"intent":"action","reply":"已添加任务「剪辑第1集」","actions":[{"type":"add_task","name":"剪辑第1集","parent":"p-001","annotations":{"roi_type":{"资产":0.6,"经验":0.4},"time_horizon":"短期","energy_cost":"高专注","strategic_tag":"资产积累","ai_notes":"视频剪辑是 B 站频道的核心产出，沉淀为长期资产"}}]}

输入: 「我想到一个新功能，做每日回顾」
输出: {"intent":"idea","reply":"好主意，已记录！以后可以加到产品规划里","actions":[]}

输入: 「把求职项目暂停，先专注熊猫团团」，树中有 [project] 求职 (id:p-003) 及子任务 (t-008, t-009)
输出: {"intent":"action","reply":"好，已将求职项目及子任务标记为暂停","actions":[{"type":"mark_dormant","id":"p-003","name":"求职"},{"type":"mark_dormant","id":"t-008","name":"更新简历"},{"type":"mark_dormant","id":"t-009","name":"整理目标公司"}]}

输入: 「把所有东西都清空」
输出: {"intent":"action","reply":"好的，已清空所有项目（可在顶部撤销）","actions":[{"type":"clear_all"}]}

输入（目标=「Q2 月入 15k 自由职业 + 重启 B 站频道」）：「我该做什么？」，树中有「接咨询单 t-101」「剪辑第3集 t-102」「整理简历 t-103」
输出: {
  "intent":"query",
  "reply":"先做「接咨询单」，最短路径变现且能强化你的专业信号。剪辑放下午精力低时做。整理简历建议暂缓——和"自由职业"路径冲突。\\n🎯 对齐目标 ✓",
  "thinking":{
    "user_goal":"Q2 月入 15k 自由职业并重启 B 站",
    "traps_avoided":["整理简历是路径依赖，违背自由职业目标","只看剪辑会陷入「忙但没收入」的行动幻觉"],
    "leverage_insight":"接咨询单同时产生现金和专业信号，可以反哺 B 站内容素材"
  },
  "actions":[]
}

输入（目标=「专注 B 站频道」）：「要不要去摆摊？」
输出: {
  "intent":"query",
  "reply":"不建议。摆摊看似快但会切走你 B 站的核心创作时间，回报一次性、没有沉淀。\\n⚠️ 偏离目标：和长期资产积累冲突",
  "thinking":{
    "user_goal":"专注 B 站频道，积累长期资产",
    "traps_avoided":["短期现金 vs 长期资产错配","摆摊的体力和社交成本对内向创作者不匹配"],
    "leverage_insight":"如果短期需要现金，可以接 B 站相关的小型商单或咨询，而不是切换赛道"
  },
  "actions":[]
}

输入（无目标）：「我该做什么？」，树中有 [task] 写脚本 (id:t-001)
输出: {"intent":"query","reply":"建议先用 /目标 设个阶段目标，推荐会更准。\\n暂按现状看，「写脚本」是唯一活跃任务。","actions":[]}

输入（目标=「Q3 完成 3 篇博客」，树完全为空，无任何 [task] 节点）：「我该做什么？」
输出: {
  "intent":"query",
  "reply":"树里还没具体任务。可以从这三个切入：(1) 列博客主题清单 (2) 写第一篇大纲 (3) 找参考资料。要我把其中之一加进树吗？\\n🎯 对齐目标 ✓",
  "thinking":{
    "user_goal":"Q3 完成 3 篇博客",
    "traps_avoided":["跳过梳理直接动笔会反复返工"],
    "leverage_insight":"先批量定主题比逐篇构思效率高很多"
  },
  "actions":[]
}

输入（目标=「每月持续现金回报」，树中有 ▶ [task] 第2集脚本 (id:t-aaa)、▶ [task] 绘制分镜图 (id:t-bbb)、▶ [task] 配角设计 (id:t-ccc)、▶ [task] AI时代自由职业 (id:t-ddd)）：「我现在该做什么？」
输出: {
  "intent":"query",
  "reply":"先做「第2集脚本」。脚本完成才能解锁分镜和外包变现，是熊猫团团这条线唯一的瓶颈。今天用一个早上把冷开场写完就行，不追求精修。\\n🎯 对齐目标 ✓",
  "thinking":{
    "user_goal":"Q2 每月稳定现金回报",
    "tradeoff_analysis":"候选有 4 个：第2集脚本、绘制分镜图、配角设计、AI时代自由职业。脚本和分镜对变现路径都有贡献，但分镜依赖脚本（顺序约束）；配角设计是纯艺术加分项，本月不做也不影响发布；AI时代自由职业是另一个项目的内容创作，分散注意力且变现链路更长。最优是脚本——它阻塞 3 条下游变现路径（分镜/配音/发布）。",
    "traps_avoided":["把配角设计当成'必须先打磨完美'，结果一直不发布","平行推进多个项目，每个都半成品，没有一个能跑通变现闭环"],
    "leverage_insight":"脚本写完别等分镜，可以立刻在 B 站发文字版预热，先看观众反应；这一步几乎零成本但能验证内容方向",
    "next_concrete_step":"打开脚本文档，给第2集写一个 200 字的冷开场（钩子片段），写完就停",
    "success_criterion":"第2集脚本至少有：冷开场 + 三幕大纲，不需要修润，能让分镜画师看懂动作流程",
    "risk_if_skipped":"再拖一周，本月就发不出新片，现金流闭环又往后推一个月；累计三集没发会让粉丝活跃度掉一档",
    "recommended_primary_id":"t-aaa",
    "recommended_alternative_ids":["t-bbb","t-ddd"]
  },
  "actions":[]
}

输入（同样的树和目标）：「今天建议我做哪三件事？」
输出: {
  "intent":"query",
  "reply":"今天三件，按权重排：\\n1. 「第2集脚本」 — 用 90 分钟写完冷开场 + 大纲\\n2. 「绘制分镜图」 — 下午精力低时画 1 页就行\\n3. 「AI时代自由职业」 — 晚上花 30 分钟列一份接单平台清单\\n🎯 对齐目标 ✓",
  "thinking":{
    "user_goal":"Q2 每月稳定现金回报",
    "tradeoff_analysis":"按变现链路长度排序：脚本（直接变现源头）> 分镜（依赖脚本，但能并行启动后期）> AI自由职业（不同赛道，需要单独建立信号）。配角设计本月不做。三件事按精力档位错峰：高专注早上、机械下午、清单整理晚上。",
    "traps_avoided":["三件事都用'高专注'去做，下午精力崩盘只完成一件","把分镜安排到脚本完全定稿后才开始，错过并行机会"],
    "leverage_insight":"早上把脚本冷开场写完后，立刻把这段发个朋友圈试反应，零成本拿到一次真实信号",
    "next_concrete_step":"打开脚本文档，写第2集冷开场 200 字",
    "success_criterion":"晚上回看时，三件事都至少有一个可见产出（脚本草稿、分镜 1 页、平台清单），不要求完美",
    "risk_if_skipped":"今天没产出会让本周后半段被各种事情侵占，本月发布节奏崩溃",
    "recommended_primary_id":"t-aaa",
    "recommended_alternative_ids":["t-bbb","t-ddd"]
  },
  "actions":[]
}`
}

function formatGoalBlock(userGoal) {
  if (!userGoal || !userGoal.text) {
    return `
## 用户当前阶段目标
（用户尚未设置阶段目标。如果用户来询问"做什么"，请温和提醒一次去设置。）
`
  }
  const expired = userGoal.expires_at && new Date(userGoal.expires_at) < new Date()
  const lines = [`目标：${userGoal.text}`]
  if (expired) lines.push('⚠️ 注意：该目标已过有效期，可在回复中建议用户更新。')
  if (Array.isArray(userGoal.constraints) && userGoal.constraints.length)
    lines.push(`约束条件：${userGoal.constraints.join('；')}`)
  if (Array.isArray(userGoal.exclude) && userGoal.exclude.length)
    lines.push(`暂时排除：${userGoal.exclude.join('；')}`)

  return `
## 用户当前阶段目标（核心上下文，所有推荐都要围绕它）
${lines.join('\n')}
`
}

function formatSummariesBlock(summaries) {
  if (!summaries?.length) return ''
  const lines = summaries.slice(0, 5).map(s => {
    const date = s.ended_at ? new Date(s.ended_at).toISOString().slice(0, 10) : '—'
    return `- [${date}] ${s.summary}`
  })
  return `
## 近期会话回顾（最多 5 条，最新优先；用于理解用户最近在做什么，不要重复其内容）
${lines.join('\n')}
`
}

/**
 * 注入当前时间：让 AI 能做时段感知的推荐
 * clientTime = { iso, weekday, hour, period }  // period: '清晨' | '上午' | '下午' | '傍晚' | '晚上' | '深夜'
 */
function formatTimeBlock(clientTime) {
  if (!clientTime) return ''
  const { weekday, hour, period, iso } = clientTime
  const guidance = {
    '清晨':   '用户精力刚起步，适合温和启动型任务或规划',
    '上午':   '高专注黄金时段，优先安排创意/思考密集的核心任务',
    '下午':   '精力中等，适合机械执行、整理、协调类任务',
    '傍晚':   '注意力下滑，适合收尾、复盘、轻量沟通',
    '晚上':   '低能量时段，适合阅读、清单整理、清理 inbox',
    '深夜':   '不建议安排重要任务，提示用户休息',
  }[period] || ''
  return `
## 当前时间（用于时段感知推荐）
${weekday}，${hour} 点（${period}）
推荐建议：${guidance}
`
}

/**
 * 注入历史命中率：让 AI 看到自己过去的推荐效果，用于自我修正
 * hitRate = { total, completed, dropped, pending, dropped_examples: [...] }
 */
function formatHitRateBlock(hitRate) {
  if (!hitRate || !hitRate.total) return ''
  const { total, completed, dropped, pending } = hitRate
  const rate = total > 0 ? Math.round((completed / total) * 100) : null

  const lines = [
    `近 30 天你共做了 ${total} 次推荐：${completed} 个被用户完成，${dropped} 个超过 7 天未做（流产），${pending} 个待办。`,
  ]
  if (rate !== null) lines.push(`命中率：${rate}%。`)

  if (Array.isArray(hitRate.dropped_examples) && hitRate.dropped_examples.length) {
    lines.push(`流产案例（用户没做）：${hitRate.dropped_examples.slice(0, 3).map(e => `「${e}」`).join('、')}`)
    lines.push('如果这次推荐和流产案例类型类似，要先反思：是不是用户对这类任务有抗性？是否要换角度？')
  }

  return `
## 你的推荐命中率反馈（重要！让你看见自己的判断质量，用于自我校准）
${lines.join('\n')}
`
}

function formatLearnedBlock(patterns) {
  if (!patterns?.length) return ''
  // 只注入 confidence >= 0.5 的，避免低质量噪声
  const filtered = patterns
    .filter(p => p && p.observation && (p.confidence ?? 1) >= 0.5)
    .slice(-15)
  if (!filtered.length) return ''
  const lines = filtered.map(p => {
    const tag = p.topic ? `[${p.topic}] ` : ''
    const conf = p.confidence != null ? `（置信 ${Math.round(p.confidence * 100)}%）` : ''
    return `- ${tag}${p.observation} ${conf}`
  })
  return `
## 已学到的用户模式（请在推理中参考；遇到与之冲突的信号，提出来跟用户确认而不是默默改变行为）
${lines.join('\n')}
`
}

/**
 * Server-side defense in depth：清洗历史，杜绝过时状态污染
 *
 * 策略（配对过滤）：
 *   - 如果某条 assistant 消息引用了过时状态（"树已清空"等），**连同它前面的 user 消息一起丢弃**
 *     因为只删一半会让模型误读 user 的请求（如孤立的"清除面板"看起来像当下指令）
 *   - 保留下来的 assistant 消息要剥离 ✅ / 🎯 / ⚠️ 等装饰行
 *   - 最后只取最近 3 个完整 turn（6 条）
 */
const STALE_STATE_PATTERNS = [
  /已清空(项目)?树/,
  /已清空所有项目/,
  /(现在)?是一张白纸/,
  /树已经?清空/,
  /没有任何项目了?/,
  /项目树已清空/,
  /已删除全部/,
]
const DECORATION_PREFIXES = ['✅', '🎯', '⚠️']

function containsStaleState(text) {
  return STALE_STATE_PATTERNS.some(re => re.test(text || ''))
}
function stripDecorations(text) {
  return (text || '')
    .split('\n')
    .filter(line => !DECORATION_PREFIXES.some(p => line.trim().startsWith(p)))
    .join('\n')
    .trim()
}

function sanitizeHistory(history) {
  const cleaned = []
  for (const m of (history || [])) {
    if (!m || typeof m.content !== 'string') continue

    if (m.role === 'assistant') {
      if (containsStaleState(m.content)) {
        // 删除这条 assistant + 前一条 user（孤立 user 会误导模型）
        if (cleaned.length && cleaned[cleaned.length - 1].role === 'user') cleaned.pop()
        continue
      }
      const stripped = stripDecorations(m.content)
      if (!stripped) {
        if (cleaned.length && cleaned[cleaned.length - 1].role === 'user') cleaned.pop()
        continue
      }
      cleaned.push({ role: 'assistant', content: stripped })
    } else {
      cleaned.push({ role: m.role, content: m.content })
    }
  }
  return cleaned.slice(-6)
}

function buildMessages(history, message, lastError, attempt) {
  const cleaned = sanitizeHistory(history)
  const msgs = [
    ...cleaned,
    { role: 'user', content: message },
  ]
  if (lastError && attempt > 0) {
    msgs.push({
      role: 'user',
      content: `⚠️ 你上一次的输出不符合格式要求：${lastError}\n请重新生成一个合法的 JSON，不要包含任何额外文字。`,
    })
  }
  return msgs
}

// ── LLM 调用 ─────────────────────────────────────────

async function callLLM(systemPrompt, messages, apiKey, modelName) {
  const isPro = modelName === 'deepseek-v4-pro'
  const body = {
    model: modelName,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    // V4-pro 的 reasoning_content 会占用 token 预算，深度推理时常吃掉 1500+，必须留足空间
    max_tokens: isPro ? 4500 : 1200,
    response_format: { type: 'json_object' },
  }
  // pro 模型内置推理流程，不需要也不接受 temperature；flash 用低温确保格式稳定
  if (!isPro) body.temperature = 0.3

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`LLM API error ${res.status}: ${err}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

// ── 解析与校验 ────────────────────────────────────────

function safeParseJSON(raw) {
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim()
    return { ok: true, data: JSON.parse(cleaned) }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/**
 * 规范化：把 task_id/node_id 等变体统一成 id；保留 annotations / thinking
 */
function normalizeOutput(data) {
  const actions = (data.actions || []).map(a => {
    const id = a.id || a.task_id || a.node_id || a.nodeId || a.taskId
    const parent = a.parent || a.parent_id || a.parentId
    return { ...a, id, parent }
  })
  return {
    intent:   data.intent,
    reply:    data.reply,
    thinking: data.thinking || null,
    actions,
  }
}

/**
 * 校验输出
 */
function validateOutput(data, nodeIdSet) {
  const errors = []

  if (!['action', 'query', 'idea'].includes(data.intent)) {
    errors.push(`intent 必须是 action/query/idea，收到：${JSON.stringify(data.intent)}`)
  }

  if (!data.reply || typeof data.reply !== 'string' || data.reply.trim() === '') {
    errors.push('reply 必须是非空字符串')
  }

  // thinking 是可选的，但如果存在必须是 object
  if (data.thinking !== null && data.thinking !== undefined && typeof data.thinking !== 'object') {
    errors.push('thinking 必须是 object 或 null')
  }

  if (!Array.isArray(data.actions)) {
    errors.push('actions 必须是数组')
    return { ok: false, errors }
  }

  // 同批次内新建的 project/category 名称，可作为后续 action 的 parent 引用
  const newSiblingNames = new Set()
  for (const a of data.actions) {
    if ((a.type === 'add_project' || a.type === 'add_category') && a.name) {
      newSiblingNames.add(a.name)
    }
  }

  for (let i = 0; i < data.actions.length; i++) {
    const a = data.actions[i]
    const prefix = `actions[${i}]`

    if (!VALID_TYPES.includes(a.type)) {
      errors.push(`${prefix}.type "${a.type}" 不合法，可选值：${VALID_TYPES.join(', ')}`)
      continue
    }

    if (a.type === 'clear_all') continue

    // remember action 不涉及节点
    if (a.type === 'remember') {
      if (!a.observation || typeof a.observation !== 'string' || !a.observation.trim()) {
        errors.push(`${prefix}(remember) observation 必须是非空字符串`)
      }
      if (a.confidence != null) {
        if (typeof a.confidence !== 'number' || a.confidence < 0 || a.confidence > 1) {
          errors.push(`${prefix}(remember) confidence 必须是 0-1 数字`)
        }
      }
      continue
    }

    const needsId     = ['mark_done', 'mark_active', 'mark_dormant', 'delete', 'rename', 'annotate'].includes(a.type)
    const needsName   = ['add_task', 'add_category', 'add_project', 'rename'].includes(a.type)
    const needsParent = ['add_task', 'add_category'].includes(a.type)

    if (needsId) {
      if (!a.id) {
        errors.push(`${prefix}(${a.type}) 缺少 id 字段`)
      } else if (nodeIdSet && nodeIdSet.size > 0 && !nodeIdSet.has(a.id)) {
        errors.push(`${prefix}(${a.type}) id "${a.id}" 不存在于当前树中`)
      }
    }
    if (needsName && !a.name) {
      errors.push(`${prefix}(${a.type}) 缺少 name 字段`)
    }
    if (needsParent) {
      if (!a.parent) {
        errors.push(`${prefix}(${a.type}) 缺少 parent 字段`)
      } else {
        // parent 必须满足以下之一：(1) 真实节点 id；(2) 同批次新建 project/category 的名称
        const existsInTree    = nodeIdSet && nodeIdSet.has(a.parent)
        const existsAsSibling = newSiblingNames.has(a.parent)
        if (!existsInTree && !existsAsSibling) {
          errors.push(`${prefix}(${a.type}) parent "${a.parent}" 不存在于当前树中，且不是本次新建的项目/分类名`)
        }
      }
    }

    // annotations 字段校验（可选）
    if (a.annotations) {
      const annErrors = validateAnnotations(a.annotations, `${prefix}.annotations`)
      errors.push(...annErrors)
    }

    // annotate action 必须有 annotations
    if (a.type === 'annotate' && !a.annotations) {
      errors.push(`${prefix}(annotate) 缺少 annotations 字段`)
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

/**
 * 校验 annotations 对象（所有字段都是可选的，但出现就要合法）
 */
function validateAnnotations(ann, prefix) {
  const errors = []
  if (typeof ann !== 'object' || ann === null) {
    errors.push(`${prefix} 必须是 object`)
    return errors
  }
  if (ann.time_horizon  && !VALID_TIME_HORIZON.includes(ann.time_horizon))
    errors.push(`${prefix}.time_horizon 必须是 ${VALID_TIME_HORIZON.join('/')}`)
  if (ann.energy_cost   && !VALID_ENERGY_COST.includes(ann.energy_cost))
    errors.push(`${prefix}.energy_cost 必须是 ${VALID_ENERGY_COST.join('/')}`)
  if (ann.risk          && !VALID_RISK.includes(ann.risk))
    errors.push(`${prefix}.risk 必须是 ${VALID_RISK.join('/')}`)
  if (ann.strategic_tag && !VALID_STRATEGIC_TAG.includes(ann.strategic_tag))
    errors.push(`${prefix}.strategic_tag 必须是 ${VALID_STRATEGIC_TAG.join('/')}`)
  if (ann.feasibility !== undefined) {
    const f = ann.feasibility
    if (typeof f !== 'number' || f < 0 || f > 1)
      errors.push(`${prefix}.feasibility 必须是 0-1 的数字`)
  }
  if (ann.roi_type && typeof ann.roi_type !== 'object')
    errors.push(`${prefix}.roi_type 必须是 object`)
  return errors
}
