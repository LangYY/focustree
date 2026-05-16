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

import { postChatCompletion } from './llmClient.js'

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
 * @param {string} provider        'deepseek' | 'openai'，默认 'deepseek'
 * @param {string} apiKey          LLM API key
 * @returns {{ intent, reply, actions, thinking?, model_used? }}
 */
export async function runAgent({
  message, treeText, nodeIdSet, history, userGoal,
  recentSummaries = [], learnedPatterns = [], hitRate = null,
  clientTime = null,
  model = 'auto', provider = 'deepseek', apiKey,
  signal = null,
}) {
  const systemPrompt = buildSystemPrompt(treeText, userGoal, recentSummaries, learnedPatterns, hitRate, clientTime)
  const modelName = resolveModel(model, message, provider)
  let lastError = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (signal?.aborted) {
      console.log('[agent] aborted by client')
      return { intent: 'query', reply: '已停止。', actions: [], model_used: modelName, aborted: true }
    }

    const messages = buildMessages(history, message)

    // 重试反馈作为 system 级指令追回，不伪装成 user 消息污染对话历史
    const effectivePrompt = lastError && attempt > 0
      ? systemPrompt + `\n\n## 系统重试提示（第 ${attempt + 1}/${MAX_RETRIES} 次）\n上一轮输出无效：${lastError}\n请严格按 Schema 重新生成合法 JSON。`
      : systemPrompt

    let raw
    try {
      raw = await callLLM(effectivePrompt, messages, apiKey, modelName, provider, signal)
    } catch (err) {
      if (signal?.aborted) {
        console.log('[agent] LLM call aborted')
        return { intent: 'query', reply: '已停止。', actions: [], model_used: modelName, aborted: true }
      }
      lastError = `API 调用失败：${err.message}`
      console.warn(`[agent] attempt ${attempt + 1} API error:`, err.message)
      continue
    }

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

  const failMsg = lastError
    ? `抱歉，没能完成这个操作。（${lastError.slice(0, 80)}）`
    : '抱歉，没能完成这个操作，换个说法试试？'
  console.error('[agent] all attempts failed:', lastError)
  return {
    intent: 'query',
    reply: failMsg,
    actions: [],
    model_used: modelName,
    error: true,
  }
}

/**
 * 'auto' / 'chat' / 'reasoner' → 实际模型名
 * auto 模式启发式：如果消息像推荐/优先级/建议类问题，用 reasoner；否则 chat
 */
function resolveModel(mode, message, provider = 'deepseek') {
  const isOpenAI = provider === 'openai'
  const chatModel = isOpenAI
    ? (process.env.OPENAI_MODEL_CHAT || process.env.OPENAI_MODEL || 'gpt-4o-mini')
    : 'deepseek-v4-flash'
  const reasonerModel = isOpenAI
    ? (process.env.OPENAI_MODEL_REASONER || process.env.OPENAI_MODEL || 'gpt-4o')
    : 'deepseek-v4-pro'

  if (mode === 'chat')     return chatModel
  if (mode === 'reasoner') return reasonerModel

  // auto 模式：除了简单"操作"型指令（添加/标完成/重命名/删除），其它一律走 V4-pro
  // 反向白名单更稳：明确判定为"纯操作"才用 flash，模糊就用 pro
  const msg = message.trim()

  // 1. 极短 + 非问句 → 可能是测试或填充 → flash
  if (msg.length < 4 && !/[?？]/.test(msg)) return chatModel

  // 2. 纯命令式（含明确操作动词 + 不带反思/推理词 + 不是问句）
  //    用"含有"而非"开头"，覆盖"在 X 下添加 Y"这种位置在中间的指令
  const actionVerbs    = /(添加|加任务|加分类|新建|创建|删除|删掉|重命名|改名为|标记|做完了|完成了|暂停|搁置|清空|清除)/
  const reasoningWords = /(建议|推荐|该|应该|为什么|怎么|哪个|哪些|分析|思考|规划|策略|优先|值得|要不要|该不该|做什么|做啥|做设么|做点啥|想做)/
  const isQuestion     = /[?？]/.test(msg)
  if (actionVerbs.test(msg) && !reasoningWords.test(msg) && !isQuestion) {
    return chatModel
  }

  // 3. 其他一切（问句 / 推理词 / 较长输入 / 不确定）→ V4-pro
  return reasonerModel
}

// ── Prompt 构建 ───────────────────────────────────────

function buildSystemPrompt(treeText, userGoal, recentSummaries, learnedPatterns, hitRate, clientTime) {
  const goalBlock      = formatGoalBlock(userGoal)
  const summariesBlock = formatSummariesBlock(recentSummaries)
  const hitRateBlock   = formatHitRateBlock(hitRate)
  const timeBlock      = formatTimeBlock(clientTime)

  // 大小保护：截断过长的 treeText，保留前面的高层级节点
  const MAX_TREE_LEN = 6000
  let trimmedTree = treeText || '（暂无项目）'
  if (trimmedTree.length > MAX_TREE_LEN) {
    trimmedTree = trimmedTree.slice(0, MAX_TREE_LEN)
      .split('\n')
      .slice(0, -1)  // 丢弃最后一行（大概率被截断）
      .join('\n')
    trimmedTree += `\n...（树节点过多，已截断。剩余 ${treeText.split('\n').length - trimmedTree.split('\n').length} 行未显示）`
  }

  // 学习模式限制最近 10 条，避免 prompt 膨胀
  const learnedBlock = formatLearnedBlock((learnedPatterns || []).slice(-10))

  return `你是「专注树」AI 助理。风格：简洁、克制、不啰嗦。行动确认一句话收住（≤30字），不要展开解释。只在用户主动询问时才给建议。你的唯一输出必须是合法 JSON，不得包含任何额外文字、markdown 代码块或注释。

## 状态来源优先级（最重要的规则）
1. 下方 ## 当前项目树 块是**此刻的唯一真实状态**——以它为准。
2. 对话历史里可能残留过去的状态描述（如"树已清空"、"现在没有项目"等），**全部视为过时信息**，不得引用、不得续写。
3. 不要描述"树已清空 / 已清除 / 重新开始"等过去操作——除非本轮用户当下又要求清空。
4. 不要在 reply 开头总结上次操作的结果。专注回答用户当下的问题。
${timeBlock}${goalBlock}${summariesBlock}${learnedBlock}${hitRateBlock}
## 当前项目树（括号内是节点 ID，操作时必须使用这些 ID）
${trimmedTree}

## 输出 Schema（必须严格遵守）
{
  "intent": "action" | "query" | "idea",
  "reply": "中文回复。纯操作确认（标记/添加/删除等）一句话 ≤30字，不要加总结或鼓励。推荐/回答 ≤100字。推荐类问题才在末尾标注 [对齐目标] 或 [偏离目标] <原因>，其余情况不标。引用任务写「任务名」，不要写 (id:xxx)，id 放 thinking 字段。",
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
{ "type": "add_project",  "name": "...", "color": "#hex", "weight": 0.0-2.0, "annotations": {...} }  // weight 默认 1.0，>1 更重要
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

当用户询问做什么/优先级/今天做几件事时，输出 thinking（user_goal + next_concrete_step 必填，其余按需填写）。深度要求：可执行、可比较（至少对比 2 个候选）、可验证、可反思。

reply 末尾只在给出推荐时标注对齐情况（[对齐目标] 或 [偏离目标] 原因），纯操作不用标。

已设目标时绝不说"建议先用 /目标"。空树（无 [task]）时提 2-3 个候选并询问是否加入。

反幻觉：树里有 [task] 就必须从中推 1-2 个，引用真实 name/id，严禁说"没有任务记录"。

问"今天做哪几件事"时：reply 列 3 条（任务名 + 一句理由），next_concrete_step 写第一件事的动作。

## 权重（w:N%）的含义
树中每个节点后都有 (w:N%) 表示权重百分比。权重越高，节点越重要，链接线越粗。
- 权重由用户在创建项目时确认或后续调整，反映项目对目标的战略优先级
- 推荐优先推高权重节点下的活跃 task，同等条件下权重高的排前面
- 创建项目时主动提出建议权重让用户确认，格式例如：这个项目权重建议 80%（因为它直接推进你的月入目标）
- 权重范围 0-100%，默认 100%。低于 30% 的项目仅在用户主动提及时才推荐

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

## 批量输入时的语义拆解规则（重要！）

当用户发送大段文字描述自己的工作/项目时，不要全部建成平级 project。按语义层级拆解：
- 识别顶层领域/方向 → 建为 project
- 领域下的子方向/模块 → 建为 category（挂在对应 project 下）
- 具体要做的事 → 建为 task（挂在对应 category/project 下）
- 一次性最多建 10 个节点，超过的优先保留最重要的

示例：用户说「我的 B 站频道在做一个系列叫熊猫团团，需要写脚本、画分镜、配音。同时还在找工作，要更新简历和刷题。」
→ 应建：project「B站频道」> category「熊猫团团」> task「写脚本」「画分镜」「配音」| project「求职」> task「更新简历」「刷算法题」

## 创建新节点时的智能标注规则

当 add_task / add_category / add_project 时，**尽量带上 annotations**：
- 根据任务名称推断 roi_type 分布（"剪辑视频" → 资产+经验；"接咨询单" → 现金+信号；"练琴" → 心情+经验）
- 推断 time_horizon（"今天发一条朋友圈" → 立即；"运营 B 站半年" → 长期）
- 推断 energy_cost、risk、strategic_tag
- ai_notes 写一句解释，让用户后续可以质疑你的判断

## Few-shot 示例

输入: 「第2集脚本写完了」，树中有 [task] 第2集脚本 (id:t-123)
输出: {"intent":"action","reply":"第2集脚本已标记完成。","actions":[{"type":"mark_done","id":"t-123","name":"第2集脚本"}]}

输入: 「在熊猫团团下加个任务：剪辑第1集」，树中有 [project] 熊猫团团 (id:p-001)
输出: {"intent":"action","reply":"已添加「剪辑第1集」。","actions":[{"type":"add_task","name":"剪辑第1集","parent":"p-001","annotations":{"roi_type":{"资产":0.6,"经验":0.4},"time_horizon":"短期","energy_cost":"高专注","strategic_tag":"资产积累","ai_notes":"视频剪辑是 B 站频道的核心产出，沉淀为长期资产"}}]}

输入: 「我想到一个新功能，做每日回顾」
输出: {"intent":"idea","reply":"已记录。","actions":[]}

输入: 「把求职项目暂停，先专注熊猫团团」，树中有 [project] 求职 (id:p-003) 及子任务 (t-008, t-009)
输出: {"intent":"action","reply":"求职项目及子任务已暂停。","actions":[{"type":"mark_dormant","id":"p-003","name":"求职"},{"type":"mark_dormant","id":"t-008","name":"更新简历"},{"type":"mark_dormant","id":"t-009","name":"整理目标公司"}]}

输入: 「把所有东西都清空」
输出: {"intent":"action","reply":"已清空。（可撤销）","actions":[{"type":"clear_all"}]}

输入（目标=「Q2 月入 15k 自由职业 + 重启 B 站频道」）：「我该做什么？」，树中有「接咨询单 t-101」「剪辑第3集 t-102」「整理简历 t-103」
输出: {
  "intent":"query",
  "reply":"先做「接咨询单」，最短路径变现。剪辑放下午做。整理简历暂缓——跟自由职业路径冲突。\\n[对齐目标]",
  "thinking":{
    "user_goal":"Q2 月入 15k 自由职业并重启 B 站",
    "tradeoff_analysis":"接咨询单同时产生现金和信号；剪辑是长期资产但变现慢；整理简历背离自由职业目标",
    "traps_avoided":["整理简历是路径依赖","只看剪辑会陷入'忙但没收入'的行动幻觉"],
    "leverage_insight":"咨询单的反哺素材可以作为 B 站内容",
    "next_concrete_step":"打开接单平台，筛选 3 个匹配的咨询需求",
    "success_criterion":"今天至少对 1 个咨询需求发出响应",
    "risk_if_skipped":"收入真空期延长，本月现金流目标落空",
    "recommended_primary_id":"t-101",
    "recommended_alternative_ids":["t-102"]
  },
  "actions":[]
}

输入（目标=「专注 B 站频道」）：「要不要去摆摊？」
输出: {
  "intent":"query",
  "reply":"不建议。摆摊切走创作时间，回报一次性没沉淀。\\n[偏离目标]和长期资产积累冲突",
  "thinking":{
    "user_goal":"专注 B 站频道，积累长期资产",
    "tradeoff_analysis":"摆摊短期现金 vs 频道长期资产，时间精力不可兼得",
    "traps_avoided":["短期现金幻觉 vs 长期资产错配"],
    "leverage_insight":"需要现金可以接 B 站商单，同赛道不分散",
    "next_concrete_step":"查 3 个 B 站 up 主的商单价位作为参考",
    "success_criterion":"明确放弃摆摊想法，专注频道",
    "risk_if_skipped":"精力被分散到低杠杆活动，频道更新断档"
  },
  "actions":[]
}

输入（无目标）：「我该做什么？」，树中有 [task] 写脚本 (id:t-001)
输出: {"intent":"query","reply":"建议先设个阶段目标，推荐会更准。暂按现状，「写脚本」是唯一活跃任务。","actions":[]}

输入（目标=「Q3 完成 3 篇博客」，树完全为空）：「我该做什么？」
输出: {
  "intent":"query",
  "reply":"树里还没任务。可从这三步切入：列主题清单 → 写第一篇大纲 → 找参考资料。要加进树吗？\\n[对齐目标]",
  "thinking":{
    "user_goal":"Q3 完成 3 篇博客",
    "tradeoff_analysis":"先批量定主题比逐篇构思效率高；直接动笔会反复返工",
    "traps_avoided":["跳过梳理直接动笔"],
    "leverage_insight":"列清单本身是低成本高杠杆的第一步",
    "next_concrete_step":"打开文档，列出 10 个候选博客主题",
    "success_criterion":"有 ≥5 个写明了标题+一句话摘要的主题",
    "risk_if_skipped":"选题拖延导致写作计划整体滞后"
  },
  "actions":[]
}

输入（目标=「每月持续现金回报」，树中有 4 个 task：第2集脚本 t-aaa / 绘制分镜图 t-bbb / 配角设计 t-ccc / AI时代自由职业 t-ddd）：「我现在该做什么？」
输出: {
  "intent":"query",
  "reply":"先做「第2集脚本」——它阻塞下游分镜和发布，是唯一瓶颈。用一个早上写冷开场，不追求精修。\\n[对齐目标]",
  "thinking":{
    "user_goal":"每月稳定现金回报",
    "tradeoff_analysis":"脚本阻塞分镜→配音→发布整条变现链；分镜依赖脚本；配角设计纯加分项本月不做不影响；AI自由职业是另一赛道分散注意力",
    "traps_avoided":["打磨配角设计导致一直不发布","平行推进多个项目个个半成品"],
    "leverage_insight":"脚本写完可先发文字版到 B 站预热，零成本验证内容方向",
    "next_concrete_step":"打开脚本文档，写一个 200 字的冷开场",
    "success_criterion":"冷开场 + 三幕大纲写完，分镜画师能看懂",
    "risk_if_skipped":"本月发不出新片，现金流闭环再推一个月",
    "recommended_primary_id":"t-aaa",
    "recommended_alternative_ids":["t-bbb","t-ddd"]
  },
  "actions":[]
}

输入（同样的树和目标）：「今天建议我做哪三件事？」
输出: {
  "intent":"query",
  "reply":"1. 「第2集脚本」— 早上写冷开场+大纲\\n2. 「绘制分镜图」— 下午精力低时画 1 页\\n3. 「AI时代自由职业」— 晚上列接单平台清单\\n[对齐目标]",
  "thinking":{
    "user_goal":"每月稳定现金回报",
    "tradeoff_analysis":"按变现链路排：脚本>分镜>AI自由职业。配角设计本月不做。精力错峰：高专注早上、机械下午、清单晚上。",
    "traps_avoided":["三件都用高专注做，下午崩盘","分镜等脚本定稿才开工会错过并行窗口"],
    "leverage_insight":"早上脚本冷开场写完立刻发朋友圈试反应，零成本拿真实信号",
    "next_concrete_step":"打开脚本文档，写第2集冷开场 200 字",
    "success_criterion":"三件事各有可见产出，不要求完美",
    "risk_if_skipped":"今天没产出，本周后半段被杂事侵占",
    "recommended_primary_id":"t-aaa",
    "recommended_alternative_ids":["t-bbb","t-ddd"]
  },
  "actions":[]
}

输入（用户发来一段项目描述）：「我的B站频道在做熊猫团团系列，要写脚本、画分镜、配音。同时在找工作，要更新简历和刷算法题。还有一个副业接外包。」
输出: {
  "intent":"action",
  "reply":"已按层级建好：B站频道 > 熊猫团团（3个任务），求职（2个任务），副业接外包。",
  "actions":[
    {"type":"add_project","name":"B站频道","color":"#4A8C5C"},
    {"type":"add_category","name":"熊猫团团","parent":"B站频道"},
    {"type":"add_task","name":"写脚本","parent":"熊猫团团"},
    {"type":"add_task","name":"画分镜","parent":"熊猫团团"},
    {"type":"add_task","name":"配音","parent":"熊猫团团"},
    {"type":"add_project","name":"求职","color":"#E07B5A"},
    {"type":"add_task","name":"更新简历","parent":"求职"},
    {"type":"add_task","name":"刷算法题","parent":"求职"},
    {"type":"add_project","name":"副业接外包","color":"#7B9FE0"}
  ]
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
  if (expired) lines.push('注意：该目标已过有效期，可在回复中建议用户更新。')
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
 *   - 保留下来的 assistant 消息要剥离 [OK]/[目标]/[-] 及旧版 emoji 等装饰行
 *   - 最后只取最近 5 个完整 turn（10 条）
 */
const STALE_STATE_PATTERNS = [
  /已清空(项目)?树/,
  /已清空所有项目/,
  /(现在)?是一张白纸/,
  /树已经?清空/,
  /项目树已清空/,
  /已删除全部(项目|任务|节点)/,
]
const DECORATION_PREFIXES = ['✅', '🎯', '⚠️', '[对齐目标]', '[偏离目标]', '[OK]', '[目标]', '[-]']

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
  return cleaned.slice(-10)
}

function buildMessages(history, message) {
  const cleaned = sanitizeHistory(history)
  return [
    ...cleaned,
    { role: 'user', content: message },
  ]
}

// ── LLM 调用 ─────────────────────────────────────────

async function callLLM(systemPrompt, messages, apiKey, modelName, provider, signal) {
  const isDeepSeek = provider !== 'openai'
  const isPro = modelName === 'deepseek-v4-pro'
  const body = {
    model: modelName,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    // V4-pro 的 reasoning_content 占用 token 预算。大段输入可能触发大量 actions（如批量创建节点），需留足空间
    // V4-flash 现在也是推理模型，reasoning_content 会吃 token；
    // 配上 agent 的庞大 system prompt 经常爆 1200。提到 4000 留出余量。
    max_tokens: isPro ? 16000 : 4000,
  }
  // pro 模型内置推理，不需要 temperature 也不接受 response_format；flash 用低温 + json_object 确保格式
  if (!isDeepSeek || !isPro) {
    body.temperature = 0.3
    body.response_format = { type: 'json_object' }
  }

  const data = await postChatCompletion(provider, body, { apiKey, signal })
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
