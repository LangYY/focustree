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
            ? 'cursor-pointer underline decoration-dotted decoration-accent/50 underline-offset-2 hover:text-accent-strong hover:decoration-accent transition-colors'
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
          return renderLine(line, i, 'mt-1.5 text-xs text-accent-strong bg-accent-soft rounded-lg px-2 py-1')
        }
        if (line.startsWith('[目标]') || line.startsWith('🎯')) {
          return renderLine(line, i, 'mt-1.5 text-xs text-accent-strong bg-accent-soft rounded-lg px-2 py-1')
        }
        if (line.startsWith('[-]') || line.startsWith('⚠️')) {
          return renderLine(line, i, 'mt-1.5 text-xs text-warn bg-warn-soft rounded-lg px-2 py-1')
        }
        return renderLine(line, i, '')
      })}
    </div>
  )
}

/** 可展开的「为什么这样推荐」卡片 */
function ThinkingCard({ thinking }) {
  const [open, setOpen] = useState(false)
  if (!thinking || typeof thinking !== 'object') return null
  const {
    brief_rationale, situation_map, assumptions, open_questions, proposed_panel_changes,
    goal_usage_mode, goal_usage_reason,
    preserved_inputs, merged_duplicates, deferred_or_unsure,
    user_goal, tradeoff_analysis, traps_avoided, leverage_insight,
    next_concrete_step, success_criterion, risk_if_skipped,
  } = thinking
  const hasStructuring = brief_rationale || situation_map?.length ||
                         assumptions?.length || open_questions?.length ||
                         proposed_panel_changes?.length ||
                         goal_usage_mode || goal_usage_reason || preserved_inputs?.length ||
                         merged_duplicates?.length || deferred_or_unsure?.length
  const hasContent = hasStructuring || user_goal || tradeoff_analysis || traps_avoided?.length ||
                     leverage_insight || next_concrete_step || success_criterion || risk_if_skipped
  if (!hasContent) return null

  return (
    <div className="mt-2 text-xs">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-[11px] text-ink-faint hover:text-ink-soft transition-colors"
      >
        {open ? '[-]' : '[+]'} {hasStructuring ? '为什么这样整理' : '为什么这样推荐'}
      </button>
      {open && (
        <div className="mt-1.5 p-2.5 bg-panel-soft/60 border border-line rounded-lg space-y-2 text-[11px] leading-relaxed">
          {brief_rationale && (
            <Row label="判断" value={brief_rationale} valueColor="text-ink-soft" multi />
          )}
          {Array.isArray(situation_map) && situation_map.length > 0 && (
            <ListRow label="局面" items={situation_map} valueColor="text-ink-soft" />
          )}
          {Array.isArray(proposed_panel_changes) && proposed_panel_changes.length > 0 && (
            <ListRow label="面板建议" items={proposed_panel_changes} valueColor="text-accent" />
          )}
          {(goal_usage_mode || goal_usage_reason) && (
            <Row
              label="目标使用"
              value={`${goalUsageLabel(goal_usage_mode)}${goal_usage_reason ? `：${goal_usage_reason}` : ''}`}
              valueColor="text-ink-soft"
              multi
            />
          )}
          {Array.isArray(assumptions) && assumptions.length > 0 && (
            <ListRow label="假设" items={assumptions} valueColor="text-ink-faint" />
          )}
          {Array.isArray(open_questions) && open_questions.length > 0 && (
            <ListRow label="待确认" items={open_questions} valueColor="text-warn" />
          )}
          {Array.isArray(preserved_inputs) && preserved_inputs.length > 0 && (
            <ListRow label="保留" items={preserved_inputs} valueColor="text-accent" />
          )}
          {Array.isArray(merged_duplicates) && merged_duplicates.length > 0 && (
            <ListRow label="合并" items={merged_duplicates} valueColor="text-accent" />
          )}
          {Array.isArray(deferred_or_unsure) && deferred_or_unsure.length > 0 && (
            <ListRow label="暂缓" items={deferred_or_unsure} valueColor="text-warn" />
          )}
          {user_goal && (
            <Row label="目标" value={user_goal} valueColor="text-ink-soft" />
          )}
          {next_concrete_step && (
            <Row label="下一步" value={next_concrete_step} valueColor="text-accent" emphasis />
          )}
          {success_criterion && (
            <Row label="完成标准" value={success_criterion} valueColor="text-ink-soft" />
          )}
          {tradeoff_analysis && (
            <Row label="权衡" value={tradeoff_analysis} valueColor="text-ink-soft" multi />
          )}
          {Array.isArray(traps_avoided) && traps_avoided.length > 0 && (
            <div>
              <div className="text-ink-faint mb-0.5">规避陷阱</div>
              <ul className="space-y-0.5 pl-1">
                {traps_avoided.map((t, i) => (
                  <li key={i} className="text-warn">· {t}</li>
                ))}
              </ul>
            </div>
          )}
          {leverage_insight && (
            <Row label="杠杆点" value={leverage_insight} valueColor="text-accent" />
          )}
          {risk_if_skipped && (
            <Row label="不做的代价" value={risk_if_skipped} valueColor="text-danger" />
          )}
        </div>
      )}
    </div>
  )
}

function goalUsageLabel(mode) {
  if (mode === 'priority_filter') return '用于排序'
  if (mode === 'ignored') return '本轮不使用'
  if (mode === 'background') return '仅作背景'
  return mode || '未标注'
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
    <div className="mt-2 border-t border-line pt-2 text-[11px] leading-relaxed">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div>
          <span className="text-accent font-medium">结构草案</span>
          <span className="text-ink-faint ml-1">{summaryText || `${actions.length} 项`}</span>
        </div>
        <button
          onClick={onApply}
          disabled={applied || !onApply}
          className="text-[11px] px-2 py-1 rounded-md bg-accent hover:bg-accent-strong text-white disabled:bg-panel-soft disabled:text-ink-ghost transition-colors"
        >
          {applied ? '已应用' : '应用到面板'}
        </button>
      </div>
      {preview.length > 0 && (
        <div className="text-ink-faint">
          {preview.join('、')}{actions.length > preview.length ? ` 等 ${actions.length} 项` : ''}
        </div>
      )}
    </div>
  )
}

function WeightPlanCard({ thinking, applied, onApply }) {
  const proposals = Array.isArray(thinking?.branch_weight_proposals)
    ? thinking.branch_weight_proposals.map(normalizeWeightProposal).filter(p => p.share != null)
    : []
  if (!proposals.length) return null

  const total = proposals.reduce((sum, p) => sum + p.share, 0)
  const totalPct = Math.round(total * 100)
  const needsNormalization = total > 0 && Math.abs(total - 1) > 0.01
  const conflicts = Array.isArray(thinking?.conflicts) ? thinking.conflicts.filter(Boolean) : []
  const blocked = conflicts.length > 0 || thinking?.weight_strategy?.requires_clarification
  const strategy = thinking?.weight_strategy || {}
  const scopeLabel = strategy.scope === 'nested' ? '子分支精力配比' : '顶层精力配比'

  return (
    <div className="mt-2 border-t border-line pt-2 text-[11px] leading-relaxed">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div>
          <span className="text-accent font-medium">权重方案</span>
          <span className="text-ink-faint ml-1">
            {scopeLabel}：{totalPct}%
          </span>
        </div>
        <button
          onClick={onApply}
          disabled={applied || blocked || !onApply}
          className="text-[11px] px-2 py-1 rounded-md bg-accent hover:bg-accent-strong text-white disabled:bg-panel-soft disabled:text-ink-ghost transition-colors"
        >
          {applied ? '已应用' : blocked ? '需确认' : '应用权重方案'}
        </button>
      </div>

      {needsNormalization && (
        <div className="mb-1.5 text-warn">
          这是相对权重，应用时会归一化为 100%。
        </div>
      )}
      {strategy.conflict_note && (
        <div className="mb-1.5 text-warn">{strategy.conflict_note}</div>
      )}
      {conflicts.length > 0 && (
        <ul className="mb-1.5 space-y-0.5">
          {conflicts.map((item, index) => (
            <li key={index} className="text-warn">· {item}</li>
          ))}
        </ul>
      )}

      <div className="space-y-1.5">
        {proposals.map((proposal, index) => (
          <div key={`${proposal.name}-${index}`} className="pl-2 border-l border-line-strong">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-ink">{proposal.name}</span>
              <span className="text-accent font-medium">{Math.round(proposal.share * 100)}%</span>
            </div>
            {typeof proposal.confidence === 'number' && (
              <div className="text-ink-ghost mt-0.5">置信 {Math.round(proposal.confidence * 100)}%</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function normalizeWeightProposal(item) {
  if (!item || typeof item !== 'object') return String(item)
  const rawShare = item.suggested_share ?? item.suggested_weight ?? item.weight ?? item.share
  const numericShare = typeof rawShare === 'string'
    ? Number(rawShare.replace('%', '').trim())
    : rawShare
  const share = Number.isFinite(numericShare)
    ? (numericShare > 2 ? numericShare / 100 : numericShare)
    : null
  return {
    name: item.name || item.branch_name || '未命名分支',
    share,
    confidence: typeof item.confidence === 'number' ? item.confidence : null,
  }
}

function ListRow({ label, items, valueColor = 'text-ink-soft' }) {
  return (
    <div>
      <div className="text-ink-faint mb-0.5">{label}</div>
      <ul className="space-y-0.5 pl-1">
        {items.map((item, i) => (
          <li key={i} className={valueColor}>· {item}</li>
        ))}
      </ul>
    </div>
  )
}

function Row({ label, value, valueColor = 'text-ink-soft', emphasis, multi }) {
  return (
    <div className={emphasis ? 'border-l-2 border-accent/40 pl-2' : ''}>
      <span className="text-ink-faint">{label} · </span>
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
        className="cursor-pointer px-3 py-2 bg-panel-soft/50 border-b border-line hover:bg-panel-soft transition-colors"
      >
        <div className="text-[10px] text-ink-faint uppercase tracking-wider">当前阶段目标</div>
        <div className="text-xs text-ink-faint mt-0.5">
          点击设置 · 或输入 <code className="text-ink-faint">/目标 ...</code>
        </div>
      </div>
    )
  }
  return (
    <div className="px-3 py-2 bg-accent-soft/60 border-b border-accent/20 group">
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-accent uppercase tracking-wider">
          当前阶段目标 {goalExpired && <span className="text-warn">· 已过期</span>}
        </div>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
          <button onClick={onEdit}  className="text-[10px] text-ink-faint hover:text-ink">改</button>
          <button onClick={onClear} className="text-[10px] text-ink-faint hover:text-ink">清</button>
        </div>
      </div>
      <div className="text-xs text-accent-strong mt-0.5 leading-relaxed">{goalText}</div>
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
  goalText, goalExpired, onSetGoal, onClearGoal,
  model, onModelChange,
  onResetConversation,
  onOpenHistory, onOpenLearned, onOpenRecommendations,
  hitRate,
  treeData, onHoverNode,
  onTriggerReview, reviewGenerating,
  onRetry,
  onCancel, onApplyDraftPlan, onApplyWeightPlan, pendingCount,
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
        onSetGoal?.(body)
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
    onSetGoal?.(trimmed)
  }

  return (
    <div
      className="flex flex-col h-full bg-panel border-l border-line"
      style={{
        width: isOpen ? 320 : 0,
        minWidth: isOpen ? 320 : 0,
        overflow: 'hidden',
        transition: 'width 0.25s ease, min-width 0.25s ease',
      }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-line flex-shrink-0 flex items-center justify-between">
        <span className="text-sm font-semibold font-display tracking-wide text-ink">AI 助理</span>
        <div className="flex items-center gap-2">
          {onTriggerReview && (
            <button
              onClick={onTriggerReview}
              disabled={reviewGenerating}
              title="生成本周回顾"
              className="text-[11px] text-ink-faint hover:text-accent transition-colors disabled:opacity-50"
            >
              {reviewGenerating ? '回顾中…' : '回顾'}
            </button>
          )}
          {onOpenRecommendations && (
            <button
              onClick={onOpenRecommendations}
              title={hitRate?.total ? `命中率 ${Math.round((hitRate.completed/hitRate.total)*100)}%` : 'AI 推荐记录'}
              className="text-[11px] text-ink-faint hover:text-ink-soft transition-colors flex items-center gap-1"
            >
              推荐
              {hitRate?.total > 0 && (
                <span className="text-[10px] text-accent">
                  {Math.round((hitRate.completed / hitRate.total) * 100)}%
                </span>
              )}
            </button>
          )}
          {onOpenHistory && (
            <button
              onClick={onOpenHistory}
              title="查看历史对话"
              className="text-[11px] text-ink-faint hover:text-ink-soft transition-colors"
            >
              历史
            </button>
          )}
          {onOpenLearned && (
            <button
              onClick={onOpenLearned}
              title="AI 学到的关于你的事"
              className="text-[11px] text-ink-faint hover:text-ink-soft transition-colors"
            >
              记忆
            </button>
          )}
          {onResetConversation && (
            <button
              onClick={handleResetClick}
              title="开始新对话（旧对话保留可查）"
              className="text-[11px] text-ink-faint hover:text-ink-soft transition-colors"
            >
              新对话
            </button>
          )}
          {onModelChange && (
            <select
              value={model || 'auto'}
              onChange={e => onModelChange(e.target.value)}
              title={MODEL_OPTIONS.find(o => o.value === (model || 'auto'))?.hint}
              className="bg-panel-soft text-ink-soft text-[11px] border border-line rounded px-1.5 py-0.5 outline-none focus:border-accent cursor-pointer"
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
                <div className="max-w-[95%] w-full bg-gradient-to-br from-accent-soft/70 to-panel border border-accent/20 rounded-2xl px-3 py-3 text-sm leading-relaxed">
                  <div className="text-[10px] text-accent uppercase tracking-wider mb-1.5">
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
                    ? 'bg-accent text-white rounded-br-sm'
                    : 'bg-panel-soft text-ink rounded-bl-sm'
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
                  <WeightPlanCard
                    thinking={msg.thinking}
                    applied={!!msg.applied_weight_plan}
                    onApply={onApplyWeightPlan ? () => onApplyWeightPlan(msg.id) : null}
                  />
                )}
                {msg.role === 'assistant' && msg.thinking && (
                  <ThinkingCard thinking={msg.thinking} />
                )}
                {msg.role === 'assistant' && msg.model_used && (
                  <div
                    className="mt-1 text-[10px] text-ink-faint"
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
                  <div className="mt-1 text-[10px] text-ink-ghost">
                    本地算法 · 0 token
                    {formatLocalRoute(msg.local_route) && ` · ${formatLocalRoute(msg.local_route)}`}
                  </div>
                )}
                {msg.isError && onRetry && (
                  <button
                    onClick={() => onRetry(treeData)}
                    disabled={isLoading}
                    className="mt-1.5 text-[11px] text-warn border border-warn/50 hover:border-warn/80 rounded px-2 py-0.5 transition-colors disabled:opacity-50"
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
            <div className="bg-panel-soft text-ink-faint px-3 py-2 rounded-2xl rounded-bl-sm text-sm">
              <span className="animate-pulse">...</span>
              {pendingCount > 0 && (
                <span className="ml-2 text-warn text-[11px]">
                  还有 {pendingCount} 条消息等待处理
                </span>
              )}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 px-3 pb-4 pt-2 border-t border-line">
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
            className="flex-1 bg-panel-soft text-ink placeholder-ink-ghost text-sm px-3 py-2 rounded-xl resize-vertical outline-none focus:ring-1 focus:ring-accent"
            style={{ maxHeight: 200, minHeight: 44 }}
          />
          {isLoading ? (
            <button
              onClick={() => onCancel?.()}
              className="flex-shrink-0 bg-danger hover:bg-danger/90 text-white text-sm px-3 py-2 rounded-xl transition-colors relative"
            >
              停止
              {pendingCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-warn text-white text-[10px] min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1">
                  {pendingCount}
                </span>
              )}
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="flex-shrink-0 bg-accent hover:bg-accent-strong disabled:bg-panel-soft disabled:text-ink-ghost text-white text-sm px-3 py-2 rounded-xl transition-colors"
            >
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
