import { useState, useRef, useEffect, useMemo } from 'react'
import { flattenTree } from '../../lib/treeUtils'

/**
 * 解析一行文本：找出所有「任务名」并按是否能映射到 treeData 节点切片
 * 返回 [{ kind: 'text'|'task', text, nodeId? }, ...]
 */
function parseTaskRefs(line, nameToId) {
  // 防御性：先剥掉残留的 (id:xxx)
  line = line.replace(/\s*\(id:[a-z0-9-]+\)/gi, '')
  const re = /「([^」]+)」/g
  const out = []
  let last = 0
  let m
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push({ kind: 'text', text: line.slice(last, m.index) })
    const name = m[1]
    const nodeId = nameToId[name] || null
    out.push({ kind: 'task', text: name, nodeId })
    last = m.index + m[0].length
  }
  if (last < line.length) out.push({ kind: 'text', text: line.slice(last) })
  return out
}

function formatModelLabel(modelUsed) {
  if (!modelUsed) return ''
  if (modelUsed === 'deepseek-v4-pro') return 'DeepSeek V4-pro'
  if (modelUsed === 'deepseek-v4-flash' || modelUsed === 'deepseek-chat') return 'DeepSeek V4-flash'
  if (modelUsed.startsWith('gpt-')) return `OpenAI ${modelUsed}`
  return modelUsed
}

function formatResponseTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
}

function formatCost(cost) {
  if (!cost || typeof cost.amount !== 'number' || !Number.isFinite(cost.amount)) return ''
  const symbol = cost.currency === 'CNY' ? '¥' : '$'
  if (cost.amount < 0.0001) return `${symbol}${cost.amount.toFixed(6)}`
  if (cost.amount < 0.01) return `${symbol}${cost.amount.toFixed(5)}`
  return `${symbol}${cost.amount.toFixed(4)}`
}

function formatTokenCount(usage) {
  const total = usage?.total_tokens
  if (typeof total !== 'number' || !Number.isFinite(total)) return ''
  return `${total.toLocaleString()} tok`
}

function formatContextMeta(contextPolicy) {
  if (!contextPolicy) return ''
  const policy = typeof contextPolicy === 'string' ? contextPolicy : contextPolicy.policy
  const mode = typeof contextPolicy === 'object' ? contextPolicy.mode : ''
  const labels = {
    global_tree: '全局',
    focused_node: '局部',
    task_pick: '任务',
    minimal: '极简',
  }
  const parts = []
  if (labels[mode]) parts.push(labels[mode])
  if (policy === 'isolated') parts.push('上下文隔离')
  return parts.join(' · ')
}

function formatLocalRoute(route) {
  const labels = {
    stats: '统计',
    selected_node: '当前节点',
    time_tasks: '时间任务',
    active_tasks: '任务清单',
    search: '搜索',
  }
  return labels[route] || ''
}

/**
 * 把回复内容里的 [OK]/[目标]/[-] 及旧版 emoji 行渲染成 badge；任务名「xxx」做成可悬浮高亮
 */
function MessageContent({ content, nameToId, onHoverNode }) {
  const lines = content.split('\n')

  function renderLine(line, i, classNameWrap) {
    const segments = parseTaskRefs(line, nameToId || {})
    const inner = segments.map((seg, idx) => {
      if (seg.kind === 'text') return <span key={idx}>{seg.text}</span>
      const linked = !!seg.nodeId
      return (
        <span
          key={idx}
          onMouseEnter={() => linked && onHoverNode?.(seg.nodeId)}
          onMouseLeave={() => linked && onHoverNode?.(null)}
          className={linked
            ? 'cursor-pointer underline decoration-dotted decoration-blue-400/50 underline-offset-2 hover:text-blue-300 hover:decoration-blue-300 transition-colors'
            : ''
          }
        >
          「{seg.text}」
        </span>
      )
    })
    return <div key={i} className={classNameWrap}>{inner}</div>
  }

  return (
    <div className="whitespace-pre-wrap">
      {lines.map((line, i) => {
        if (line.startsWith('[OK]') || line.startsWith('✅')) {
          return renderLine(line, i, 'mt-1.5 text-xs text-green-400 bg-green-900/30 rounded-lg px-2 py-1')
        }
        if (line.startsWith('[目标]') || line.startsWith('🎯')) {
          return renderLine(line, i, 'mt-1.5 text-xs text-emerald-300 bg-emerald-900/30 rounded-lg px-2 py-1')
        }
        if (line.startsWith('[-]') || line.startsWith('⚠️')) {
          return renderLine(line, i, 'mt-1.5 text-xs text-amber-300 bg-amber-900/30 rounded-lg px-2 py-1')
        }
        return renderLine(line, i, '')
      })}
    </div>
  )
}

/**
 * 可展开的「为什么这样推荐」卡片
 *
 * 注：thinking 里还有 situation_map / assumptions / goal_usage_mode / preserved_inputs /
 * merged_duplicates / user_goal / traps_avoided / leverage_insight / success_criterion 等字段，
 * 是给模型自己用的推理脚手架（防遗漏、方便校验），故意不在这里渲染——那是「审计口径」，
 * 不是用户想读的内容。这里只挑对用户真正有决策价值的几项，保持这张卡片是「读得懂的结论」，
 * 不是「内部记录」。
 */
function ThinkingCard({ thinking }) {
  const [open, setOpen] = useState(false)
  if (!thinking || typeof thinking !== 'object') return null
  const {
    brief_rationale, open_questions, proposed_panel_changes, deferred_or_unsure,
    tradeoff_analysis, next_concrete_step, risk_if_skipped,
  } = thinking
  const hasStructuring = proposed_panel_changes?.length || deferred_or_unsure?.length
  const hasContent = hasStructuring || brief_rationale || open_questions?.length ||
                     tradeoff_analysis || next_concrete_step || risk_if_skipped
  if (!hasContent) return null

  return (
    <div className="mt-2 text-xs">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
      >
        {open ? '[-]' : '[+]'} {hasStructuring ? '为什么这样整理' : '为什么这样推荐'}
      </button>
      {open && (
        <div className="mt-1.5 p-2.5 bg-gray-950/60 border border-gray-800 rounded-lg space-y-2 text-[11px] leading-relaxed">
          {brief_rationale && (
            <Row label="判断" value={brief_rationale} valueColor="text-gray-300" multi />
          )}
          {Array.isArray(proposed_panel_changes) && proposed_panel_changes.length > 0 && (
            <ListRow label="面板建议" items={proposed_panel_changes} valueColor="text-blue-300" />
          )}
          {Array.isArray(open_questions) && open_questions.length > 0 && (
            <ListRow label="待确认" items={open_questions} valueColor="text-amber-300" />
          )}
          {Array.isArray(deferred_or_unsure) && deferred_or_unsure.length > 0 && (
            <ListRow label="暂缓" items={deferred_or_unsure} valueColor="text-amber-300" />
          )}
          {tradeoff_analysis && (
            <Row label="权衡" value={tradeoff_analysis} valueColor="text-gray-300" multi />
          )}
          {next_concrete_step && (
            <Row label="下一步" value={next_concrete_step} valueColor="text-blue-300" emphasis />
          )}
          {risk_if_skipped && (
            <Row label="不做的代价" value={risk_if_skipped} valueColor="text-rose-300" />
          )}
        </div>
      )}
    </div>
  )
}

function DraftPlanCard({ thinking, applied, onApply }) {
  const actions = Array.isArray(thinking?.draft_actions)
    ? thinking.draft_actions.filter(action => ['add_project', 'add_category', 'add_task', 'annotate'].includes(action?.type))
    : []
  if (!actions.length) return null

  const summary = actions.reduce((acc, action) => {
    acc[action.type] = (acc[action.type] || 0) + 1
    return acc
  }, {})
  const summaryText = [
    summary.add_project ? `${summary.add_project} 个项目` : null,
    summary.add_category ? `${summary.add_category} 个分类` : null,
    summary.add_task ? `${summary.add_task} 个任务` : null,
    summary.annotate ? `${summary.annotate} 个标注` : null,
  ].filter(Boolean).join('、')
  const preview = actions.slice(0, 5).map(action => action.name || action.id || '未命名节点')

  return (
    <div className="mt-2 border-t border-gray-700/70 pt-2 text-[11px] leading-relaxed">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div>
          <span className="text-blue-300 font-medium">结构草案</span>
          <span className="text-gray-500 ml-1">{summaryText || `${actions.length} 项`}</span>
        </div>
        <button
          onClick={onApply}
          disabled={applied || !onApply}
          className="text-[11px] px-2 py-1 rounded-md bg-blue-700/80 hover:bg-blue-600 text-white disabled:bg-gray-700 disabled:text-gray-500 transition-colors"
        >
          {applied ? '已应用' : '应用到面板'}
        </button>
      </div>
      {preview.length > 0 && (
        <div className="text-gray-500">
          {preview.join('、')}{actions.length > preview.length ? ` 等 ${actions.length} 项` : ''}
        </div>
      )}
    </div>
  )
}

function PriorityAnalysisCard({ thinking, applied, onApply }) {
  const sourceGoal = thinking?.goal_analysis || null
  const sourceProposals = Array.isArray(thinking?.node_priority_proposals)
    ? thinking.node_priority_proposals
    : []
  const [goal, setGoal] = useState(() => sourceGoal ? { ...sourceGoal } : null)
  const [proposals, setProposals] = useState(() => sourceProposals.map(normalizePriorityProposal))
  if (!goal && !proposals.length) return null

  const updateProposal = (index, key, value) => {
    setProposals(current => current.map((proposal, itemIndex) => (
      itemIndex === index ? { ...proposal, [key]: value } : proposal
    )))
  }

  return (
    <div className="mt-2 border-t border-gray-700/70 pt-2 text-[11px] leading-relaxed">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-violet-300 font-medium">目标与优先级分析</span>
        <button
          onClick={() => onApply?.({ goal_analysis: goal, node_priority_proposals: proposals })}
          disabled={applied || !onApply}
          className="text-[11px] px-2 py-1 rounded-md bg-violet-700/80 hover:bg-violet-600 text-white disabled:bg-gray-700 disabled:text-gray-500 transition-colors"
        >
          {applied ? '已确认' : '确认并应用'}
        </button>
      </div>

      {goal && (
        <div className="mb-2 space-y-1.5 border-l border-emerald-800/60 pl-2">
          <div className="text-emerald-300">目标拆解</div>
          <input
            value={goal.outcome || goal.text || ''}
            onChange={event => setGoal(current => ({ ...current, outcome: event.target.value, text: event.target.value }))}
            disabled={applied}
            className="w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 text-gray-200 outline-none focus:border-emerald-600"
          />
          <div className="grid grid-cols-2 gap-1.5">
            <select
              value={goal.kind || 'long_term'}
              onChange={event => setGoal(current => ({ ...current, kind: event.target.value }))}
              disabled={applied}
              className="rounded border border-gray-700 bg-gray-950 px-1.5 py-1 text-gray-300"
            >
              <option value="long_term">长期目标</option>
              <option value="stage">阶段目标</option>
            </select>
            <input
              type="date"
              value={goal.deadline || ''}
              onChange={event => setGoal(current => ({
                ...current,
                deadline: event.target.value || null,
                kind: event.target.value ? 'stage' : current.kind,
              }))}
              disabled={applied}
              className="rounded border border-gray-700 bg-gray-950 px-1.5 py-1 text-gray-300"
            />
          </div>
          <input
            value={Array.isArray(goal.constraints) ? goal.constraints.join('；') : ''}
            onChange={event => setGoal(current => ({
              ...current,
              constraints: event.target.value.split(/[；;]/).map(item => item.trim()).filter(Boolean),
            }))}
            disabled={applied}
            placeholder="约束条件（用分号分隔）"
            className="w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 text-gray-300 outline-none focus:border-emerald-600"
          />
          <input
            value={Array.isArray(goal.exclude) ? goal.exclude.join('；') : ''}
            onChange={event => setGoal(current => ({
              ...current,
              exclude: event.target.value.split(/[；;]/).map(item => item.trim()).filter(Boolean),
            }))}
            disabled={applied}
            placeholder="暂时排除（用分号分隔）"
            className="w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 text-gray-300 outline-none focus:border-emerald-600"
          />
        </div>
      )}

      <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
        {proposals.map((proposal, index) => (
          <div key={`${proposal.node_id}-${index}`} className="border-l border-violet-800/60 pl-2">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-gray-200">{proposal.name}</span>
              <span className="text-gray-600">置信 {Math.round(proposal.confidence * 100)}%</span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {[
                ['goal_alignment', '契合'],
                ['necessity', '必要'],
                ['delay_cost', '延误'],
              ].map(([key, label]) => (
                <label key={key} className="text-gray-500">
                  <span>{label}</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={Math.round(proposal[key] * 100)}
                    onChange={event => updateProposal(index, key, Math.max(0, Math.min(100, Number(event.target.value))) / 100)}
                    disabled={applied}
                    className="mt-0.5 w-full rounded border border-gray-700 bg-gray-950 px-1 py-0.5 text-gray-300"
                  />
                </label>
              ))}
            </div>
            <select
              value={proposal.relation_type}
              onChange={event => updateProposal(index, 'relation_type', event.target.value)}
              disabled={applied}
              className="mt-1 w-full rounded border border-gray-700 bg-gray-950 px-1.5 py-1 text-gray-400"
            >
              <option value="normal">普通组成</option>
              <option value="required">必要步骤</option>
              <option value="enables">解锁后续</option>
              <option value="supporting">辅助支持</option>
              <option value="optional">可选路径</option>
            </select>
            <input
              value={proposal.reason}
              onChange={event => updateProposal(index, 'reason', event.target.value)}
              disabled={applied}
              placeholder="判断理由"
              className="mt-1 w-full rounded border border-gray-800 bg-gray-950 px-1.5 py-1 text-gray-500 outline-none focus:border-violet-700"
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function normalizePriorityProposal(item) {
  return {
    name: item?.name || '未命名节点',
    node_id: item?.node_id || item?.id || null,
    goal_alignment: clampUnit(item?.goal_alignment),
    necessity: clampUnit(item?.necessity),
    delay_cost: clampUnit(item?.delay_cost),
    relation_type: ['normal', 'required', 'enables', 'supporting', 'optional'].includes(item?.relation_type)
      ? item.relation_type
      : 'normal',
    confidence: clampUnit(item?.confidence ?? 0.5),
    reason: item?.reason || '',
  }
}

function clampUnit(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(1, numeric))
}

function ListRow({ label, items, valueColor = 'text-gray-300' }) {
  return (
    <div>
      <div className="text-gray-500 mb-0.5">{label}</div>
      <ul className="space-y-0.5 pl-1">
        {items.map((item, i) => (
          <li key={i} className={valueColor}>· {item}</li>
        ))}
      </ul>
    </div>
  )
}

function Row({ label, value, valueColor = 'text-gray-300', emphasis, multi }) {
  return (
    <div className={emphasis ? 'border-l-2 border-blue-500/40 pl-2' : ''}>
      <span className="text-gray-500">{label} · </span>
      {multi
        ? <div className={`mt-0.5 ${valueColor}`}>{value}</div>
        : <span className={valueColor}>{value}</span>
      }
    </div>
  )
}

/**
 * 顶部目标横幅
 */
function GoalBanner({ goalText, goalExpired, onEdit, onClear }) {
  if (!goalText) {
    return (
      <div
        onClick={onEdit}
        className="cursor-pointer px-3 py-2 bg-gray-800/40 border-b border-gray-800 hover:bg-gray-800/70 transition-colors"
      >
        <div className="text-[10px] text-gray-500 uppercase tracking-wider">当前阶段目标</div>
        <div className="text-xs text-gray-500 mt-0.5">
          点击设置 · 或输入 <code className="text-gray-400">/目标 ...</code>
        </div>
      </div>
    )
  }
  return (
    <div className="px-3 py-2 bg-emerald-950/40 border-b border-emerald-900/40 group">
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-emerald-500 uppercase tracking-wider">
          当前阶段目标 {goalExpired && <span className="text-amber-400">· 已过期</span>}
        </div>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
          <button onClick={onEdit}  className="text-[10px] text-gray-400 hover:text-gray-200">改</button>
          <button onClick={onClear} className="text-[10px] text-gray-400 hover:text-gray-200">清</button>
        </div>
      </div>
      <div className="text-xs text-emerald-200 mt-0.5 leading-relaxed">{goalText}</div>
    </div>
  )
}

const MODEL_OPTIONS = [
  { value: 'auto',     label: '自动',  hint: '质量优先：复杂梳理/规划用深度，短操作用快速' },
  { value: 'chat',     label: '快速',  hint: 'DeepSeek V4-flash · 便宜快' },
  { value: 'reasoner', label: '深度',  hint: 'DeepSeek V4-pro · 推理强' },
]

export default function ChatPanel({
  messages, isLoading, onSend, isOpen,
  goalText, goalExpired, onClearGoal,
  model, onModelChange,
  onResetConversation,
  onOpenHistory, onOpenLearned, onOpenRecommendations,
  hitRate,
  treeData, onHoverNode,
  onTriggerReview, reviewGenerating,
  onRetry,
  onCancel, onApplyDraftPlan, onApplyPriorityAnalysis, pendingCount,
}) {
  // 树扁平化 → 用 name 反查 id（任务名重复时取第一个找到的，足够日常使用）
  const nameToId = useMemo(() => {
    if (!treeData) return {}
    const map = {}
    for (const n of flattenTree(treeData)) {
      if (n.name && n.id && !map[n.name]) map[n.name] = n.id
    }
    return map
  }, [treeData])
  const [input, setInput] = useState('')
  const bottomRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  /**
   * 解析 slash command。返回 true 表示已被命令拦截，不走 AI。
   */
  function tryHandleSlashCommand(text) {
    // /目标 xxx   或  /goal xxx
    const goalMatch = text.match(/^\/(?:目标|goal)\s*(.*)$/i)
    if (goalMatch) {
      const body = goalMatch[1].trim()
      if (!body || body === 'clear' || body === '清除') {
        onClearGoal?.()
      } else {
        onSend(`请把我的当前目标设为：${body}。先拆解目标和相关节点优先级，等我确认后再应用。`)
      }
      return true
    }

    // /新对话 或 /重置 或 /reset → 用户主动开新 session（旧对话保留在历史里）
    if (/^\/(?:新对话|重置|reset|清除对话|清空对话)\s*$/i.test(text)) {
      onResetConversation?.()
      return true
    }

    return false
  }

  function handleResetClick() {
    onResetConversation?.()
  }

  function handleSend() {
    const text = input.trim()
    if (!text || isLoading) return

    // 先尝试拦截 slash command
    if (tryHandleSlashCommand(text)) {
      setInput('')
      return
    }

    onSend(text)
    setInput('')
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  /**
   * 编辑目标的弹窗式交互（先用 prompt 简化实现，后面再做精致的 modal）
   */
  function handleEditGoal() {
    const next = window.prompt(
      '设置当前阶段目标（例如：Q2 月入 15k，启动 B 站频道）：',
      goalText || ''
    )
    if (next === null) return        // 取消
    const trimmed = next.trim()
    if (!trimmed) { onClearGoal?.(); return }
    onSend(`请把我的当前目标设为：${trimmed}。先拆解目标和相关节点优先级，等我确认后再应用。`)
  }

  return (
    <div
      className="flex flex-col h-full bg-gray-900 border-l border-gray-800"
      style={{
        width: isOpen ? 320 : 0,
        minWidth: isOpen ? 320 : 0,
        overflow: 'hidden',
        transition: 'width 0.25s ease, min-width 0.25s ease',
      }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex-shrink-0 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-300">AI 助理</span>
        <div className="flex items-center gap-2">
          {onTriggerReview && (
            <button
              onClick={onTriggerReview}
              disabled={reviewGenerating}
              title="生成本周回顾"
              className="text-[11px] text-gray-500 hover:text-indigo-300 transition-colors disabled:opacity-50"
            >
              {reviewGenerating ? '回顾中…' : '回顾'}
            </button>
          )}
          {onOpenRecommendations && (
            <button
              onClick={onOpenRecommendations}
              title={hitRate?.total ? `命中率 ${Math.round((hitRate.completed/hitRate.total)*100)}%` : 'AI 推荐记录'}
              className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1"
            >
              推荐
              {hitRate?.total > 0 && (
                <span className="text-[10px] text-emerald-400">
                  {Math.round((hitRate.completed / hitRate.total) * 100)}%
                </span>
              )}
            </button>
          )}
          {onOpenHistory && (
            <button
              onClick={onOpenHistory}
              title="查看历史对话"
              className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
            >
              历史
            </button>
          )}
          {onOpenLearned && (
            <button
              onClick={onOpenLearned}
              title="AI 学到的关于你的事"
              className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
            >
              记忆
            </button>
          )}
          {onResetConversation && (
            <button
              onClick={handleResetClick}
              title="开始新对话（旧对话保留可查）"
              className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
            >
              新对话
            </button>
          )}
          {onModelChange && (
            <select
              value={model || 'auto'}
              onChange={e => onModelChange(e.target.value)}
              title={MODEL_OPTIONS.find(o => o.value === (model || 'auto'))?.hint}
              className="bg-gray-800 text-gray-300 text-[11px] border border-gray-700 rounded px-1.5 py-0.5 outline-none focus:border-blue-500 cursor-pointer"
            >
              {MODEL_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Goal banner */}
      <GoalBanner
        goalText={goalText}
        goalExpired={goalExpired}
        onEdit={handleEditGoal}
        onClear={onClearGoal}
      />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
        {messages.map(msg => {
          // 周末回顾：特殊样式（更宽、不同背景）
          if (msg.kind === 'weekly_review') {
            return (
              <div key={msg.id} className="flex justify-start">
                <div className="max-w-[95%] w-full bg-gradient-to-br from-indigo-950/60 to-gray-900 border border-indigo-800/40 rounded-2xl px-3 py-3 text-sm leading-relaxed">
                  <div className="text-[10px] text-indigo-400 uppercase tracking-wider mb-1.5">
                    本周回顾
                  </div>
                  <MessageContent
                    content={msg.content}
                    nameToId={nameToId}
                    onHoverNode={onHoverNode}
                  />
                </div>
              </div>
            )
          }
          return (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : 'bg-gray-800 text-gray-200 rounded-bl-sm'
                }`}
              >
                <MessageContent
                  content={msg.content}
                  nameToId={nameToId}
                  onHoverNode={onHoverNode}
                />
                {msg.role === 'assistant' && msg.thinking && (
                  <DraftPlanCard
                    thinking={msg.thinking}
                    applied={!!msg.applied_draft_actions}
                    onApply={onApplyDraftPlan ? () => onApplyDraftPlan(msg.id) : null}
                  />
                )}
                {msg.role === 'assistant' && msg.thinking && (
                  <PriorityAnalysisCard
                    thinking={msg.thinking}
                    applied={!!msg.applied_priority_analysis}
                    onApply={onApplyPriorityAnalysis ? overrides => onApplyPriorityAnalysis(msg.id, overrides) : null}
                  />
                )}
                {msg.role === 'assistant' && msg.thinking && (
                  <ThinkingCard thinking={msg.thinking} />
                )}
                {msg.role === 'assistant' && msg.model_used && (
                  <div
                    className="mt-1 text-[10px] text-gray-500"
                    title={msg.usage_cost
                      ? `输入 ${msg.usage_cost.prompt_tokens || 0} tokens（缓存 ${msg.usage_cost.cached_input_tokens || 0}，未命中 ${msg.usage_cost.uncached_input_tokens || 0}），输出 ${msg.usage_cost.completion_tokens || 0} tokens`
                      : undefined
                    }
                  >
                    {formatModelLabel(msg.model_used)}
                    {formatResponseTime(msg.response_ms) && ` · ${formatResponseTime(msg.response_ms)}`}
                    {formatCost(msg.usage_cost) && ` · ${formatCost(msg.usage_cost)}`}
                    {formatTokenCount(msg.usage) && ` · ${formatTokenCount(msg.usage)}`}
                    {formatContextMeta(msg.context_policy) && ` · ${formatContextMeta(msg.context_policy)}`}
                  </div>
                )}
                {msg.role === 'assistant' && msg.kind === 'local' && (
                  <div className="mt-1 text-[10px] text-gray-600">
                    本地算法 · 0 token
                    {formatLocalRoute(msg.local_route) && ` · ${formatLocalRoute(msg.local_route)}`}
                  </div>
                )}
                {msg.isError && onRetry && (
                  <button
                    onClick={() => onRetry(treeData)}
                    disabled={isLoading}
                    className="mt-1.5 text-[11px] text-amber-400 hover:text-amber-300 border border-amber-700/50 hover:border-amber-600/50 rounded px-2 py-0.5 transition-colors disabled:opacity-50"
                  >
                    重试
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-800 text-gray-400 px-3 py-2 rounded-2xl rounded-bl-sm text-sm">
              <span className="animate-pulse">...</span>
              {pendingCount > 0 && (
                <span className="ml-2 text-amber-400 text-[11px]">
                  还有 {pendingCount} 条消息等待处理
                </span>
              )}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 px-3 pb-4 pt-2 border-t border-gray-800">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onInput={(e) => {
              setInput(e.target.value)
              const el = e.target
              el.style.height = 'auto'
              el.style.height = Math.min(el.scrollHeight, 200) + 'px'
            }}
            onKeyDown={handleKeyDown}
            placeholder="说点什么…（试试 /目标 设置当前阶段目标）"
            rows={2}
            className="flex-1 bg-gray-800 text-gray-200 placeholder-gray-500 text-sm px-3 py-2 rounded-xl resize-vertical outline-none focus:ring-1 focus:ring-blue-500"
            style={{ maxHeight: 200, minHeight: 44 }}
          />
          {isLoading ? (
            <button
              onClick={() => onCancel?.()}
              className="flex-shrink-0 bg-red-600 hover:bg-red-500 text-white text-sm px-3 py-2 rounded-xl transition-colors relative"
            >
              停止
              {pendingCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-amber-500 text-white text-[10px] min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1">
                  {pendingCount}
                </span>
              )}
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="flex-shrink-0 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm px-3 py-2 rounded-xl transition-colors"
            >
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
