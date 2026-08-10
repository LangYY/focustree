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
import {
  containsDeprecatedPlanningPolicy,
  containsDeprecatedPlanningPolicyDeep,
  redactDeprecatedPlanningPolicy,
} from './promptSafety.js'

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
 * @param {string} provider        'deepseek' | 'openai'，默认 'deepseek'
 * @param {string} apiKey          LLM API key
 * @returns {{ intent, reply, actions, thinking?, model_used? }}
 */
export async function runAgent({
  message, treeText, nodeIdSet, history, userGoal,
  recentSummaries = [], learnedPatterns = [], userMemory = null, contextMode = 'global_tree', hitRate = null,
  clientTime = null,
  provider = 'deepseek', apiKey,
  signal = null,
}) {
  const contextPolicy = resolveContextPolicy()
  const effectiveContext = applyContextPolicy({
    history,
    recentSummaries,
    learnedPatterns,
    userMemory,
    hitRate,
  }, contextPolicy)
  const systemPrompt = buildSystemPrompt(
    treeText,
    userGoal,
    effectiveContext.recentSummaries,
    effectiveContext.learnedPatterns,
    effectiveContext.userMemory,
    contextMode,
    effectiveContext.hitRate,
    clientTime,
    contextPolicy
  )
  const modelName = resolveModel()
  let lastError = null
  let lastErrorKind = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (signal?.aborted) {
      console.log('[agent] aborted by client')
      return { intent: 'query', reply: '已停止。', actions: [], model_used: modelName, context_policy: { policy: contextPolicy, mode: contextMode }, aborted: true }
    }

    const messages = buildMessages(effectiveContext.history, message)

    // 重试反馈作为 system 级指令追回，不伪装成 user 消息污染对话历史
    const effectivePrompt = lastError && attempt > 0
      ? systemPrompt + `\n\n## 系统重试提示（第 ${attempt + 1}/${MAX_RETRIES} 次）\n上一轮输出无效：${lastError}\n请严格按 Schema 重新生成合法 JSON。`
      : systemPrompt

    const attemptModel = resolveAttemptModel(modelName, attempt, lastErrorKind)
    let llmResult
    let raw
    try {
      llmResult = await callLLM(effectivePrompt, messages, apiKey, attemptModel, provider, signal)
      raw = llmResult.content
    } catch (err) {
      if (signal?.aborted) {
        console.log('[agent] LLM call aborted')
        return { intent: 'query', reply: '已停止。', actions: [], model_used: modelName, context_policy: { policy: contextPolicy, mode: contextMode }, aborted: true }
      }
      lastError = `API 调用失败：${err.message}`
      lastErrorKind = 'api'
      console.warn(`[agent] attempt ${attempt + 1} API error, model=${attemptModel}:`, err.message)
      continue
    }

    if (!raw?.trim()) {
      lastError = `模型返回空内容（model=${attemptModel}, finish_reason=${llmResult.finishReason || 'unknown'}）`
      lastErrorKind = 'empty_content'
      console.warn(`[agent] attempt ${attempt + 1} empty content, model=${attemptModel}, finish_reason=${llmResult.finishReason || 'unknown'}`)
      continue
    }

    const parseResult = safeParseJSON(raw)
    if (!parseResult.ok) {
      lastError = `JSON 解析失败：${parseResult.error}。原始输出片段：${raw.slice(0, 200)}`
      lastErrorKind = 'parse'
      console.warn(`[agent] attempt ${attempt + 1} parse error, model=${attemptModel}:`, lastError)
      continue
    }

    const normalized = normalizeOutput(parseResult.data)

    const validation = validateOutput(normalized, nodeIdSet)
    if (!validation.ok) {
      lastError = `输出校验失败：${validation.errors.join('；')}。请严格按格式重新生成。`
      lastErrorKind = 'validation'
      console.warn(`[agent] attempt ${attempt + 1} validation error, model=${attemptModel}:`, validation.errors)
      continue
    }

    console.log(`[agent] success on attempt ${attempt + 1}, model=${attemptModel}, intent=${normalized.intent}, actions=${normalized.actions.length}, has_thinking=${!!normalized.thinking}`)
    return {
      ...normalized,
      model_used: modelName,
      context_policy: { policy: contextPolicy, mode: contextMode },
      usage: llmResult.usage || null,
      usage_cost: llmResult.usageCost || null,
    }
  }

  const failMsg = ['empty_content', 'parse'].includes(lastErrorKind)
    ? '这次模型没有返回完整的结构化结果，我没有改动面板。可以再发一次，或先让我只做梳理不落节点。'
    : lastError
      ? `抱歉，没能完成这个操作。（${lastError.slice(0, 80)}）`
      : '抱歉，没能完成这个操作，换个说法试试？'
  console.error('[agent] all attempts failed:', lastError)
  return {
    intent: 'query',
    reply: failMsg,
    actions: [],
    model_used: modelName,
    context_policy: { policy: contextPolicy, mode: contextMode },
    error: true,
  }
}

/**
 * 前端只有一个模型入口；内部重试才会根据失败类型切换到 pro。
 */
export function resolveModel() {
  return 'deepseek-v4-flash'
}

export function resolveAttemptModel(primaryModel, attempt, lastErrorKind) {
  if (attempt === 0) return primaryModel
  if (!['empty_content', 'parse'].includes(lastErrorKind)) return primaryModel
  return 'deepseek-v4-pro'
}

function resolveContextPolicy() {
  const raw = (
    process.env.FOCUSTREE_CONTEXT_POLICY ||
    process.env.FOCUSTREE_TEST_CONTEXT_ISOLATION ||
    ''
  ).trim().toLowerCase()

  if (['persistent', 'memory', 'full', 'keep', 'false', '0', 'off'].includes(raw)) {
    return 'persistent'
  }
  if (['isolated', 'test', 'fresh', 'none', 'true', '1', 'on'].includes(raw)) {
    return 'isolated'
  }

  return process.env.NODE_ENV === 'production' ? 'persistent' : 'isolated'
}

function applyContextPolicy(context, policy) {
  if (policy !== 'isolated') return context
  return {
    history: [],
    recentSummaries: [],
    learnedPatterns: [],
    userMemory: null,
    hitRate: null,
  }
}

// ── Prompt 构建 ───────────────────────────────────────

function buildSystemPrompt(treeText, userGoal, recentSummaries, learnedPatterns, userMemory, contextMode, hitRate, clientTime, contextPolicy) {
  const goalBlock      = formatGoalBlock(userGoal)
  const summariesBlock = userMemory ? '' : formatSummariesBlock(recentSummaries)
  const userMemoryBlock = formatUserMemoryBlock(userMemory)
  const hitRateBlock   = formatHitRateBlock(hitRate)
  const timeBlock      = formatTimeBlock(clientTime)
  const contextBlock   = formatContextPolicyBlock(contextPolicy)
  const scopeBlock     = formatContextModeBlock(contextMode)

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
  const learnedBlock = userMemory ? '' : formatLearnedBlock((learnedPatterns || []).slice(-10))

  return `你是「专注树」Focus Agent。风格：简洁、克制、有判断力。不写空泛鼓励，但要给出真实取舍和结构化判断。纯操作确认一句话收住；复杂梳理、规划、推荐要说清楚为什么。你的唯一输出必须是合法 JSON，不得包含任何额外文字、markdown 代码块或注释。

## reply 的人话原则（重要）
thinking 里的字段是给你自己用的推理脚手架，用来防止遗漏、方便复盘校验，用户不会逐字段阅读。reply 才是用户实际会读的内容，必须读起来像一个很了解这些项目、跟用户很熟的人在说话，不是在生成一份结构化报告。

- 不要每次都用固定句式开头（比如每次都写"我的判断：..."）。开场方式要自然变化——可以直接给结论，可以先接住用户的情绪，可以直接问关键问题，像正常对话一样有变化。
- 不要在 reply 里堆砌你在 thinking 里已经拆解过的所有维度（局面/假设/目标使用方式/合并了哪些重复……）。这些是你想清楚问题的过程，不是用户需要被逐条告知的内容。挑真正影响用户决定的 1-2 个点说清楚就够。
- 参考对比：
  - ❌ 机械版："我的判断：根据当前局面，你有3个主线项目，已合并2条重复项，目标使用方式为背景参考。建议优先处理A。"
  - ✅ 人话版："这几件事里，A其实是最卡脖子的——B和C都能往后放放。先把A啃下来。"
  - ❌ 机械版："根据权衡分析，选项A在现金流维度优于选项B，但资产积累维度弱于选项B，风险等级为投机性。"
  - ✅ 人话版："A能更快看到钱，但B更像在攒后劲——就看你现在更缺哪个。"

## 状态来源优先级（最重要的规则）
1. 下方 ## 当前项目树 块是**此刻的唯一真实状态**——以它为准。
2. 对话历史里可能残留过去的状态描述（如"树已清空"、"现在没有项目"等），**全部视为过时信息**，不得引用、不得续写。
3. 不要描述"树已清空 / 已清除 / 重新开始"等过去操作——除非本轮用户当下又要求清空。
4. 不要在 reply 开头总结上次操作的结果。专注回答用户当下的问题。
5. 旧 assistant 回复中的项目压缩口径不是产品规则；当前规则以本 system prompt 和当前项目树为准。
${contextBlock}${scopeBlock}${timeBlock}${goalBlock}${userMemoryBlock}${summariesBlock}${learnedBlock}${hitRateBlock}
## 当前项目树（括号内是节点 ID，操作时必须使用这些 ID）
${trimmedTree}

## Focus Agent 的核心职责
你不是简单的增删改命令入口。明确、机械的操作通常已由本地算法处理；如果这类请求偶然进入你这里，保持极简即可。你的主要价值在这些场景：
- 用户表达混乱、压力、犹豫、多个项目互相牵扯：先帮他把局面看清楚，再落成可执行结构。
- 用户需要规划、优先级、取舍、复盘：给出判断依据、关键风险和下一步动作。
- 用户给出一堆想法/任务：保留原意，合并重复，区分事实、推断和不确定项。
- 用户明确说“整理到面板 / 放到树上 / 转成任务 / 帮我建出来 / 加进去”时，才用 actions 实际改树。否则先给 proposed_panel_changes，不直接改树。

## 稳定思考协议（必须按顺序执行，降低模型随机性）
以下步骤是内部工作协议，不要把长链路原样写给用户；只把结论压缩进 brief_rationale、situation_map、preserved_inputs 等字段。

1. 意图闸门：先判断用户是在“机械操作 / 全局梳理 / 建树落地 / 推荐排序 / 目标或优先级分析 / 普通想法记录”中的哪一种。只有用户明确要求改树，或语义等价于“放到面板/建出来/确认应用”，才输出 actions；否则 actions 必须为空。
2. 输入保全清单：从用户原文抽取所有明确提到的项目、任务、约束、情绪压力、时间节点和偏好，去重后放入 preserved_inputs。不得先按目标筛掉内容。
3. 目标使用闸门：根据本轮意图选择 goal_usage_mode。全局梳理用 background，推荐排序用 priority_filter，用户要求先完整梳理时用 ignored。目标只能影响解释和排序，不能删除或改写用户明确表达。
4. 结构映射：把 preserved_inputs 映射为 project/category/task/annotation/open_question。顶层项目先保全，项目内部细节再压缩；缺少执行细节时保留粗颗粒 project，并用 open_questions 或 task「明确下一步」承接。
5. 覆盖性自检：生成回复前逐项检查 preserved_inputs 中的每个非重复项目是否出现在 actions、draft_actions、proposed_panel_changes 或当前树中。若没有，必须补上；不能把顶层项目只放进 deferred_or_unsure。
6. 重复合并：只合并同义或明显重复项，写入 merged_duplicates。不要把“执行少”“兴趣项目”“暂时不赚钱”当作重复或删除理由。
7. 优先级分析闸门：你不计算最终权重或百分比。用户设置目标、要求分析优先级或目标发生变化时，只输出 goal_analysis 和 node_priority_proposals，等待用户确认。本地算法会据此计算最终分数。
8. 不确定性闸门：证据不足时不要编任务细节；弱模型也应选择更粗颗粒节点 + open_questions，而不是胡乱补全。需要用户判断的问题最多 3 个。
9. 输出自检：reply 必须和 actions/thinking 一致；不能说“已落地”却 actions 为空；用户明确提到的项目必须能在结构草案或面板变更说明里找到对应位置；不能输出 schema 外文字。

## 输出 Schema（必须严格遵守）
{
  "intent": "action" | "query" | "idea",
  "reply": "中文回复。纯操作确认（标记/添加/删除等）一句话 ≤30字，不要加总结或鼓励。复杂梳理/整理到树/规划/推荐可写 120-220 字；开场自然变化，不要套用固定句式（不要每次都写「我的判断：...」）；直接给结论和真正影响决定的取舍，不需要逐项复述局面/合并/待补——这些留在 thinking 里备查，reply 只说用户需要知道的部分。推荐类问题才在末尾标注 [对齐目标] 或 [偏离目标] <原因>，其余情况不标。引用任务写「任务名」，不要写 (id:xxx)，id 放 thinking 字段。用户明确提到的项目，仍需被安置到某个主线或待补细节里，但不必在 reply 里逐条报告安置结果，除非用户问起。",
  "thinking": {                  // ← 推荐/优先级/规划/复杂整理类问题必须输出，越具体越好
    "brief_rationale":          "<给用户看的简短思考过程：1-2 句，只讲判断依据和取舍，不展开长链路>",
    "situation_map":            ["<把用户材料压成 2-4 条真实主线/矛盾/约束>"],
    "assumptions":              ["<为了整理而做的轻量假设；不确定就写进 open_questions>"],
    "open_questions":           ["<最影响下一步结构的 0-3 个问题，不要问无关细节>"],
    "proposed_panel_changes":   ["<如果本轮不直接改树，这里写建议加到面板的节点/层级；如果已 actions 落地，也可写已落地摘要>"],
    "draft_actions":            [{"type":"add_project|add_category|add_task|annotate","name":"...","parent":"...","annotations":{}}],
    "goal_usage_mode":          "background" | "priority_filter" | "ignored",
    "goal_usage_reason":        "<本轮为什么这样使用阶段目标：只作背景 / 用来排序 / 不使用>",
    "goal_analysis":           {"text":"<用户目标原文>","outcome":"<可验证成果>","kind":"stage"|"long_term","start_date":"YYYY-MM-DD或null","deadline":"YYYY-MM-DD或null","constraints":["..."],"exclude":["..."],"confidence":0-1,"requires_confirmation":true},
    "node_priority_proposals": [{"name":"<已有节点名>","node_id":"<当前树中真实id>","goal_alignment":0-1,"necessity":0-1,"delay_cost":0-1,"relation_type":"normal"|"required"|"enables"|"supporting"|"optional","confidence":0-1,"reason":"<一句可核查解释>"}],
    "preserved_inputs":         ["<用户提到且被保留下来的主线/任务，去重后列出>"],
    "merged_duplicates":        ["<被合并的重复/同义项，格式：A/B → C；无则空数组>"],
    "deferred_or_unsure":       ["<因信息不足、超过本轮节点上限或不确定而暂未展开的内容；无则空数组>"],
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
{ "type": "add_task",     "name": "...", "parent": "...", "annotations": {...} }
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
- action：用户明确要修改树（完成/添加/删除/重命名/打标签），或明确要求“整理到面板/树/任务里”
- query：咨询、询问建议、一起思考、帮忙梳理但尚未要求改树
- idea：用户在记录想法或灵感，暂时不需要操作树

## 协作式思考规则
当用户抛出一堆正在梳理、让他困惑的事情时：
- 先把信息整理成 situation_map：主线、冲突、约束、卡点，而不是立刻把每个名词变成节点。
- 明确区分：用户明说的事实、你为了推进整理做的假设、仍需确认的问题。
- 阶段目标此时只作为背景，不得为了贴合目标删改、弱化、替换用户正在表达的真实意图。thinking.goal_usage_mode 应为 "background" 或 "ignored"。
- reply 先给一个短判断，再给 2-4 条有重点的结构，不要平均用力。
- 如果用户没明确要求改面板，actions 必须为空；用 proposed_panel_changes 给出建议结构，并用一句话询问是否落到面板。
- 如果用户明确要求转成面板任务，actions 可以落地，但仍要在 reply/thinking 里说明整理逻辑，不能只说“已添加”。
- 可执行任务应使用“动词 + 对象”的颗粒度，如“写第2集冷开场”优于“内容创作”；不确定项先做 category 或 deferred_or_unsure。

## 阶段目标的使用边界
- 目标不是用来改写用户意图的。用户在梳理全局、倾诉混乱、整理项目时，必须先忠实保留用户说的内容；目标最多帮助你标注“这条线可能更靠近/更远离目标”，不能因此删掉或压扁其他线。
- 只有当用户问“今天该做什么 / 最近以什么为重点 / 哪个优先 / 要不要做 X / 给我排序”时，目标才作为 priority_filter，明显影响推荐、排序和取舍。
- 如果用户明确说“暂时不考虑目标 / 先完整梳理 / 不要替我取舍”，目标应设为 ignored。
- reply 里不要动不动把话题拉回目标。只有推荐/排序类问题才标注 [对齐目标] 或 [偏离目标]。

## 复杂整理 / 建树质量规则
当用户发送一段项目描述并要求你“梳理、整理、拆解、规划、放到树上”时：
- 项目保全优先：用户明确提到的非重复项目/主线，必须进入 actions 或 draft_actions 的顶层 project，或者在 proposed_panel_changes 里作为将要保留的 project；不能因为“构思多、执行少、暂时不重要、和目标弱相关”而把它排除在结构草案之外。
- deferred_or_unsure 只用于“项目内部细节/下一步不清楚/需要补信息”，不得用来替代用户明确提到的顶层项目。若某项目缺少执行细节，仍先保留为粗颗粒 project，并加一个“补充执行细节/明确下一步”的 task 或 open_question。
- 覆盖性优先：用户明确说到的非重复内容，必须进入 actions/draft_actions/proposed_panel_changes，或写入 deferred_or_unsure 说明哪一部分内部细节暂不展开；不能静默丢弃。
- 不自作主张改写用户意图。可以理解、归纳、补足上下位关系，但不能把用户没说的目标当成事实。
- 允许删去重复项：同义/重复内容只建一个节点，并在 thinking.merged_duplicates 里说明如何合并。
- 先识别真实顶层项目，不要把所有名词都建成平级项目；项目内部展开深度可以控制，但用户明确提到的顶层项目数量不能被压缩。
- 全局梳理/建树落地默认保留用户提到的主线和已说出的具体事项；只有用户明确要求“聚焦/压缩/只留重点”时，才减少内部展开深度。
- reply 要有重点：说清这次整理的关键取舍，以及用户接下来该往哪使劲。不要只说「已添加」，也不要把局面/合并/暂缓逐条列成清单——那些放 thinking 里备查。
- thinking.brief_rationale 要给用户一眼能懂的简短思考过程，但不要输出长篇链式推理。
- actions 要体现层级和优先级；能判断现金流/资产积累/探索时，给 annotations。不要生成或修改 weight。
- 新节点的优先级语义要等节点真实创建并获得 id 后再分析，不要给草案节点编造 node_priority_proposals。
- 不确定的信息不要硬编，放成较粗颗粒的 category，等用户补充后再细化。

## 「我该做什么 / 优先级 / 规划」类问题的核心规则

当用户询问做什么/优先级/今天做几件事时，输出 thinking（user_goal + next_concrete_step 必填，其余按需填写）。深度要求：可执行、可比较（至少对比 2 个候选）、可验证、可反思。

reply 末尾只在给出推荐时标注对齐情况（[对齐目标] 或 [偏离目标] 原因），纯操作不用标。

已设目标时绝不说"建议先用 /目标"。空树（无 [task]）时提 2-3 个候选并询问是否加入。

反幻觉：树里有 [task] 就必须从中推 1-2 个，引用真实 name/id，严禁说"没有任务记录"。

问"今天做哪几件事"时：reply 列 3 条（任务名 + 一句理由），next_concrete_step 写第一件事的动作。

## 目标与优先级语义分析
- 最终综合优先级由本地确定性算法计算。你不得输出最终分数、权重百分比或同级配比。
- 当用户明确设置/替换目标时，输出 goal_analysis。能识别时间就填 stage 与日期；没有明确时间就填 long_term，deadline 必须为 null，不要擅自补 90 天。
- 新目标会替换当前目标，但必须先让用户在对话卡片中确认。
- 用户要求分析优先级、目标变化影响或重新评估时，只对当前树中真实存在且确实相关的节点输出 node_priority_proposals。
- goal_alignment：节点与当前目标的直接契合程度。
- necessity：节点是否为达成目标的必要步骤；“最后回款”等不可绕过步骤应较高。
- delay_cost：延迟执行造成损失的程度，不等同于任务数量或描述长度。
- relation_type 描述该节点相对父节点的作用：required 必要步骤，enables 解锁后续，normal 普通组成，supporting 辅助，optional 可选。
- 每项必须给一句 reason 和 confidence。信息不足就降低 confidence，不要为了显得完整而编造。
- 当前目标变化后，旧分析会失效，因此相反目标应当导致相关节点的 goal_alignment 出现有方向的变化；若不变化，必须说明硬性截止日期等原因。

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
- 一次性最多建 10 个节点时，优先保证“所有用户明确提到的顶层项目都被保留”；若节点预算不足，减少每个项目的子节点展开，而不是删除顶层项目
- 优先复用当前树中的已有节点；同名/近义内容不要重复创建，改用 annotate 或挂到已有节点下面。

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

输入: 「我现在有点乱，一边想继续做熊猫团团，一边又怕没收入，可能要接外包，还想找工作。你先帮我一起梳理一下。」
输出: {
  "intent":"query",
  "reply":"我的判断：这不是单纯任务太多，而是长期资产、短期现金和安全感三条线在抢精力。先不直接改面板，我建议完整保留「内容资产」「现金流补位」「求职安全垫」三条主线；已经明确的事项放进对应主线，缺信息的地方用问题承接。要我按这个结构加到面板上吗？",
  "thinking":{
    "brief_rationale":"用户没有明确要求改树，所以先帮助澄清结构；真正的冲突是不同时间回报的项目互相争夺注意力。",
    "situation_map":["熊猫团团偏长期资产，回报慢但能沉淀","外包偏短期现金，能缓解收入焦虑","求职偏安全垫，但可能分散自由职业路径"],
    "assumptions":["用户目前最需要的是降低混乱感，而不是一次性塞满面板"],
    "open_questions":["当前最缺的是现金、作品进度，还是确定感？"],
    "proposed_panel_changes":["项目「内容资产」> 任务「写熊猫团团下一集大纲」","项目「现金流补位」> 任务「列 3 个可接外包方向」","项目「求职安全垫」> 任务「更新简历核心经历」"],
    "draft_actions":[
      {"type":"add_project","name":"内容资产"},
      {"type":"add_task","name":"写熊猫团团下一集大纲","parent":"内容资产"},
      {"type":"add_project","name":"现金流补位"},
      {"type":"add_task","name":"列 3 个可接外包方向","parent":"现金流补位"},
      {"type":"add_project","name":"求职安全垫"},
      {"type":"add_task","name":"更新简历核心经历","parent":"求职安全垫"}
    ],
    "goal_usage_mode":"background",
    "goal_usage_reason":"用户是在梳理全局，不是在询问优先级；阶段目标不能覆盖他对收入和安全感的表达。",
    "preserved_inputs":["熊猫团团","没收入的担心","接外包","找工作"],
    "merged_duplicates":[],
    "deferred_or_unsure":["三条线里信息不足的部分先用问题承接，等用户确认当前最缺的资源后再细化"]
  },
  "actions":[]
}

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
    "goal_usage_mode":"priority_filter",
    "goal_usage_reason":"用户询问现在该做什么，阶段目标应用来排序和取舍。",
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
  "reply":"我的判断：这段话其实是三条主线，不适合全部铺平成任务。已建「B站频道」>「熊猫团团」（写脚本、画分镜、配音），「求职」（更新简历、刷算法题），以及「副业接外包」。副业细节先不拆，等你补充客户/交付再细化。",
  "thinking":{
    "brief_rationale":"我把长期内容生产、求职和现金型副业拆成三条主线；先保留用户明确提到的主线，再控制每条主线的展开深度，避免面板一上来过载。",
    "situation_map":["B站频道是内容资产主线","求职是安全垫主线","副业接外包是现金流主线"],
    "assumptions":["用户希望把这段描述直接落到面板，而不是只讨论"],
    "open_questions":["副业外包的客户类型或交付物是什么？"],
    "proposed_panel_changes":["已落地：B站频道 > 熊猫团团 > 写脚本/画分镜/配音","已落地：求职 > 更新简历/刷算法题","已落地：副业接外包"],
    "goal_usage_mode":"background",
    "goal_usage_reason":"本轮任务是把用户材料完整转成面板结构，而不是替用户做优先级取舍。",
    "preserved_inputs":["B站频道","熊猫团团系列","写脚本","画分镜","配音","找工作","更新简历","刷算法题","副业接外包"],
    "merged_duplicates":[],
    "deferred_or_unsure":["副业接外包暂未拆成具体任务，因为还缺客户、报价或交付物信息"],
    "user_goal":"把当前混乱项目整理成可执行面板"
  },
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
## 用户当前阶段目标（用于推荐/排序，不得改写用户意图）
${lines.join('\n')}
`
}

function formatSummariesBlock(summaries) {
  if (!summaries?.length) return ''
  const lines = summaries.slice(0, 5).flatMap(s => {
    if (containsDeprecatedPlanningPolicyDeep(s)) return []
    const date = s.ended_at ? new Date(s.ended_at).toISOString().slice(0, 10) : '—'
    const summary = redactDeprecatedPlanningPolicy(s.summary).trim()
    return summary ? [`- [${date}] ${summary}`] : []
  })
  if (!lines.length) return ''
  return `
## 近期会话回顾（最多 5 条，最新优先；用于理解用户最近在做什么，不要重复其内容）
${lines.join('\n')}
`
}

function formatContextPolicyBlock(contextPolicy) {
  if (contextPolicy !== 'isolated') return ''
  return `
## 测试上下文策略
当前处于测试上下文隔离模式：本轮不注入旧聊天历史、会话摘要、长期画像或推荐命中率。只依据当前用户输入、当前项目树、阶段目标和本 system prompt 判断。
`
}

/**
 * 注入当前时间：让 AI 能做时段感知的推荐
 * clientTime = { iso, weekday, hour, period }  // period: '清晨' | '上午' | '下午' | '傍晚' | '晚上' | '深夜'
 */
function formatContextModeBlock(contextMode) {
  const mode = contextMode || 'global_tree'
  const labels = {
    global_tree: '全局项目树',
    focused_node: '当前节点局部',
    task_pick: '活跃任务候选',
    minimal: '极简项目索引',
  }
  const scope = labels[mode] || labels.global_tree
  const caution = mode === 'global_tree'
    ? '本轮包含完整项目树，可以做全局判断。'
    : '本轮只包含局部或压缩上下文；不要假装看过完整项目树。若用户要求全局判断，请说明需要切换到全局梳理。'
  return `
## 本轮上下文范围
范围：${scope}
${caution}
`
}

function formatUserMemoryBlock(memory) {
  if (!memory) return ''
  const patternLines = Array.isArray(memory.patterns)
    ? memory.patterns
        .filter(Boolean)
        .slice(0, 8)
        .map(item => redactDeprecatedPlanningPolicy(String(item)).trim())
        .filter(Boolean)
        .map(item => `- ${item}`)
    : []
  const recentLines = Array.isArray(memory.recent)
    ? memory.recent
        .filter(Boolean)
        .slice(0, 3)
        .map(item => redactDeprecatedPlanningPolicy(String(item)).trim())
        .filter(Boolean)
        .map(item => `- ${item}`)
    : []
  const lines = []
  if (patternLines.length) {
    lines.push('长期用户记忆：')
    lines.push(...patternLines)
  }
  if (recentLines.length) {
    lines.push('近期压缩回顾：')
    lines.push(...recentLines)
  }
  if (!lines.length) return ''
  return `
## 用户记忆（压缩摘要，不是完整对话历史）
${lines.join('\n')}
`
}

function formatTimeBlock(clientTime) {
  if (!clientTime) return ''
  const { weekday, hour, period } = clientTime
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
    .filter(p => !containsDeprecatedPlanningPolicy(p.observation))
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
      if (containsStaleState(m.content) || containsDeprecatedPlanningPolicy(m.content)) {
        // 删除这条 assistant + 前一条 user（孤立 user 会误导模型）
        if (cleaned.length && cleaned[cleaned.length - 1].role === 'user') cleaned.pop()
        continue
      }
      const stripped = redactDeprecatedPlanningPolicy(stripDecorations(m.content))
      if (!stripped) {
        if (cleaned.length && cleaned[cleaned.length - 1].role === 'user') cleaned.pop()
        continue
      }
      cleaned.push({ role: 'assistant', content: stripped })
    } else {
      cleaned.push({ role: m.role, content: redactDeprecatedPlanningPolicy(m.content) })
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
  const body = buildAgentRequestBody(systemPrompt, messages, modelName)

  const data = await postChatCompletion(provider, body, { apiKey, signal })
  const choice = data.choices?.[0]
  const message = choice?.message || {}
  return {
    content: message.content || '',
    reasoningContent: message.reasoning_content || '',
    finishReason: choice?.finish_reason || null,
    usage: data.usage || null,
    usageCost: data.usage_cost || null,
  }
}

export function buildAgentRequestBody(systemPrompt, messages, modelName = 'deepseek-v4-flash') {
  return {
    model: modelName,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    max_tokens: 16000,
    reasoning_effort: 'max',
    temperature: 0.3,
    response_format: { type: 'json_object' },
  }
}

// ── 解析与校验 ────────────────────────────────────────

function safeParseJSON(raw) {
  try {
    const cleaned = extractJSON(raw)
    return { ok: true, data: JSON.parse(cleaned) }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

function extractJSON(raw) {
  const cleaned = (raw || '').replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim()
  if (!cleaned) return cleaned
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) return cleaned

  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) return cleaned.slice(start, end + 1)
  return cleaned
}

/**
 * 规范化：把 task_id/node_id 等变体统一成 id；保留 annotations / thinking
 */
function normalizeOutput(data) {
  const actions = (data.actions || []).map(a => {
    const id = a.id || a.task_id || a.node_id || a.nodeId || a.taskId
    const parent = a.parent || a.parent_id || a.parentId
    const annotations = normalizeAnnotations(a.annotations)
    const normalized = { ...a, id, parent }
    if (annotations) normalized.annotations = annotations
    return normalized
  })
  return {
    intent:   data.intent,
    reply:    data.reply,
    thinking: normalizeThinking(data.thinking),
    actions,
  }
}

function normalizeThinking(thinking) {
  if (!thinking || typeof thinking !== 'object') return null
  const next = { ...thinking }
  if (next.goal_analysis && typeof next.goal_analysis === 'object') {
    const goal = next.goal_analysis
    next.goal_analysis = {
      text: String(goal.text || '').trim(),
      outcome: String(goal.outcome || goal.text || '').trim(),
      kind: goal.kind === 'stage' ? 'stage' : 'long_term',
      start_date: normalizeDate(goal.start_date),
      deadline: normalizeDate(goal.deadline),
      constraints: Array.isArray(goal.constraints) ? goal.constraints.filter(Boolean).map(String) : [],
      exclude: Array.isArray(goal.exclude) ? goal.exclude.filter(Boolean).map(String) : [],
      confidence: clampUnit(goal.confidence ?? 0.5),
      requires_confirmation: true,
    }
    if (!next.goal_analysis.deadline && !next.goal_analysis.start_date) next.goal_analysis.kind = 'long_term'
  }
  next.node_priority_proposals = Array.isArray(next.node_priority_proposals)
    ? next.node_priority_proposals.map(proposal => ({
        name: String(proposal?.name || '').trim(),
        node_id: proposal?.node_id || proposal?.id || null,
        goal_alignment: clampUnit(proposal?.goal_alignment),
        necessity: clampUnit(proposal?.necessity),
        delay_cost: clampUnit(proposal?.delay_cost),
        relation_type: ['normal', 'required', 'enables', 'supporting', 'optional'].includes(proposal?.relation_type)
          ? proposal.relation_type
          : 'normal',
        confidence: clampUnit(proposal?.confidence ?? 0.5),
        reason: String(proposal?.reason || '').trim(),
      })).filter(proposal => proposal.node_id)
    : []
  delete next.weight_strategy
  delete next.branch_weight_proposals
  return next
}

function clampUnit(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(1, numeric))
}

function normalizeDate(value) {
  if (!value) return null
  const text = String(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

function normalizeAnnotations(ann) {
  if (!ann || typeof ann !== 'object') return null
  const next = { ...ann }

  if (next.time_horizon && !VALID_TIME_HORIZON.includes(next.time_horizon)) delete next.time_horizon
  if (next.energy_cost && !VALID_ENERGY_COST.includes(next.energy_cost)) delete next.energy_cost
  if (next.risk && !VALID_RISK.includes(next.risk)) delete next.risk
  if (next.strategic_tag && !VALID_STRATEGIC_TAG.includes(next.strategic_tag)) delete next.strategic_tag

  if (next.feasibility !== undefined) {
    const value = typeof next.feasibility === 'string'
      ? Number(next.feasibility)
      : next.feasibility
    if (Number.isFinite(value)) {
      next.feasibility = Math.max(0, Math.min(1, value))
    } else {
      delete next.feasibility
    }
  }

  return next
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

  if (containsDeprecatedPlanningPolicyDeep({
    reply: data.reply,
    thinking: data.thinking,
    actions: data.actions,
  })) {
    errors.push('回复包含已废弃的项目压缩口径；必须完整保留用户明确提到的主线和具体事项')
  }

  // thinking 是可选的，但如果存在必须是 object
  if (data.thinking !== null && data.thinking !== undefined && typeof data.thinking !== 'object') {
    errors.push('thinking 必须是 object 或 null')
  }

  for (const [index, proposal] of (data.thinking?.node_priority_proposals || []).entries()) {
    if (!proposal.node_id || (nodeIdSet?.size && !nodeIdSet.has(proposal.node_id))) {
      errors.push(`thinking.node_priority_proposals[${index}].node_id 必须是当前树中真实 id`)
    }
    for (const key of ['goal_alignment', 'necessity', 'delay_cost', 'confidence']) {
      if (typeof proposal[key] !== 'number' || proposal[key] < 0 || proposal[key] > 1) {
        errors.push(`thinking.node_priority_proposals[${index}].${key} 必须是 0-1 数字`)
      }
    }
  }

  if (!Array.isArray(data.actions)) {
    errors.push('actions 必须是数组')
    return { ok: false, errors }
  }

  // 同批次内新建的节点名称，可作为后续 action 的 parent 引用
  const newSiblingNames = new Set()
  for (const a of data.actions) {
    if ((a.type === 'add_project' || a.type === 'add_category' || a.type === 'add_task') && a.name) {
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
