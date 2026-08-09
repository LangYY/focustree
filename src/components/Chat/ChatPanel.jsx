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
function MessageContent({ content, nameToId, onHoverNode, onSelectNode }) {
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
          onClick={() => linked && onSelectNode?.(seg.nodeId)}
          className={linked
            ? 'cursor-pointer ft-chat-task-link transition-colors'
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
          return renderLine(line, i, 'ft-message-status ft-status-ok')
        }
        if (line.startsWith('[目标]') || line.startsWith('🎯')) {
          return renderLine(line, i, 'ft-message-status ft-status-goal')
        }
        if (line.startsWith('[-]') || line.startsWith('⚠️')) {
          return renderLine(line, i, 'ft-message-status ft-status-warn')
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
        className="text-[11px] ft-chat-text-tertiary ft-chat-hover-text-secondary transition-colors"
      >
        {open ? '[-]' : '[+]'} {hasStructuring ? '为什么这样整理' : '为什么这样推荐'}
      </button>
      {open && (
        <div className="mt-1.5 p-2.5 ft-chat-surface-base-60 border ft-chat-border-subtle rounded-lg space-y-2 text-[11px] leading-relaxed">
          {brief_rationale && (
            <Row label="判断" value={brief_rationale} valueColor="ft-chat-text-secondary" multi />
          )}
          {Array.isArray(proposed_panel_changes) && proposed_panel_changes.length > 0 && (
            <ListRow label="面板建议" items={proposed_panel_changes} valueColor="ft-chat-text-accent" />
          )}
          {Array.isArray(open_questions) && open_questions.length > 0 && (
            <ListRow label="待确认" items={open_questions} valueColor="ft-chat-text-warn" />
          )}
          {Array.isArray(deferred_or_unsure) && deferred_or_unsure.length > 0 && (
            <ListRow label="暂缓" items={deferred_or_unsure} valueColor="ft-chat-text-warn" />
          )}
          {tradeoff_analysis && (
            <Row label="权衡" value={tradeoff_analysis} valueColor="ft-chat-text-secondary" multi />
          )}
          {next_concrete_step && (
            <Row label="下一步" value={next_concrete_step} valueColor="ft-chat-text-accent" emphasis />
          )}
          {risk_if_skipped && (
            <Row label="不做的代价" value={risk_if_skipped} valueColor="ft-chat-text-danger" />
          )}
        </div>
      )}
    </div>
  )
}

function ProposalReferenceCard({ thinking, messageId, onOpenInbox }) {
  const draftCount = Math.max(
    Array.isArray(thinking?.draft_actions) ? thinking.draft_actions.length : 0,
    Array.isArray(thinking?.proposed_panel_changes) ? thinking.proposed_panel_changes.length : 0,
  )
  const goalCount = thinking?.goal_analysis ? 1 : 0
  const priorityCount = Array.isArray(thinking?.node_priority_proposals) ? thinking.node_priority_proposals.length : 0
  const total = draftCount + goalCount + priorityCount
  if (!total) return null
  return (
    <button type="button" className="ft-chat-proposal-reference" onClick={() => onOpenInbox?.(messageId)}>
      <span>产生了 {total} 条待确认提案</span><span aria-hidden="true">→</span>
    </button>
  )
}

function ListRow({ label, items, valueColor = 'ft-chat-text-secondary' }) {
  return (
    <div>
      <div className="ft-chat-text-tertiary mb-0.5">{label}</div>
      <ul className="space-y-0.5 pl-1">
        {items.map((item, i) => (
          <li key={i} className={valueColor}>· {item}</li>
        ))}
      </ul>
    </div>
  )
}

function Row({ label, value, valueColor = 'ft-chat-text-secondary', emphasis, multi }) {
  return (
    <div className={emphasis ? 'border-l-2 ft-chat-border-accent-40 pl-2' : ''}>
      <span className="ft-chat-text-tertiary">{label} · </span>
      {multi
        ? <div className={`mt-0.5 ${valueColor}`}>{value}</div>
        : <span className={valueColor}>{value}</span>
      }
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
  onClearGoal,
  model, onModelChange,
  onResetConversation,
  onOpenHistory, onOpenLearned, onOpenRecommendations,
  onOpenInbox,
  hitRate,
  treeData, onHoverNode, onSelectNode,
  onTriggerReview, reviewGenerating,
  onRetry,
  onCancel, pendingCount,
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

  useEffect(() => {
    const prefill = event => {
      setInput(String(event.detail || ''))
      window.setTimeout(() => textareaRef.current?.focus(), 0)
    }
    const focus = () => textareaRef.current?.focus()
    window.addEventListener('ft-prefill-chat', prefill)
    window.addEventListener('ft-focus-chat', focus)
    return () => {
      window.removeEventListener('ft-prefill-chat', prefill)
      window.removeEventListener('ft-focus-chat', focus)
    }
  }, [])

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

  return (
    <div
      className="ft-chat-panel"
      style={{
        width: isOpen ? '100%' : 0,
        minWidth: isOpen ? 0 : 0,
        overflow: 'hidden',
        transition: 'opacity var(--ft-dur-2) var(--ft-ease-out)',
      }}
    >
      {/* Header */}
      <div className="ft-chat-header">
        <span className="ft-chat-title">AI 助理</span>
        <div className="ft-chat-header-actions">
          {onTriggerReview && (
            <button
              onClick={onTriggerReview}
              disabled={reviewGenerating}
              title="生成本周回顾"
              className="text-[11px] ft-chat-text-tertiary ft-chat-hover-text-accent transition-colors disabled:opacity-50"
            >
              {reviewGenerating ? '回顾中…' : '回顾'}
            </button>
          )}
          {onOpenRecommendations && (
            <button
              onClick={onOpenRecommendations}
              title={hitRate?.total ? `命中率 ${Math.round((hitRate.completed/hitRate.total)*100)}%` : 'AI 推荐记录'}
              className="text-[11px] ft-chat-text-tertiary ft-chat-hover-text-secondary transition-colors flex items-center gap-1"
            >
              推荐
              {hitRate?.total > 0 && (
                <span className="text-[10px] ft-chat-text-accent">
                  {Math.round((hitRate.completed / hitRate.total) * 100)}%
                </span>
              )}
            </button>
          )}
          {onOpenHistory && (
            <button
              onClick={onOpenHistory}
              title="查看历史对话"
              className="text-[11px] ft-chat-text-tertiary ft-chat-hover-text-secondary transition-colors"
            >
              历史
            </button>
          )}
          {onOpenLearned && (
            <button
              onClick={onOpenLearned}
              title="AI 学到的关于你的事"
              className="text-[11px] ft-chat-text-tertiary ft-chat-hover-text-secondary transition-colors"
            >
              记忆
            </button>
          )}
          {onResetConversation && (
            <button
              onClick={handleResetClick}
              title="开始新对话（旧对话保留可查）"
              className="text-[11px] ft-chat-text-tertiary ft-chat-hover-text-secondary transition-colors"
            >
              新对话
            </button>
          )}
          {onModelChange && (
            <select
              value={model || 'auto'}
              onChange={e => onModelChange(e.target.value)}
              title={MODEL_OPTIONS.find(o => o.value === (model || 'auto'))?.hint}
              className="ft-chat-surface-hover ft-chat-text-secondary text-[11px] border ft-chat-border rounded px-1.5 py-0.5 outline-none ft-chat-control cursor-pointer"
            >
              {MODEL_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="ft-chat-messages">
        {messages.map(msg => {
          // 周末回顾：特殊样式（更宽、不同背景）
          if (msg.kind === 'weekly_review') {
            return (
              <div key={msg.id} className="ft-chat-message is-review">
                <div className="ft-message-body">
                  <div className="text-[10px] ft-chat-text-accent uppercase tracking-wider mb-1.5">
                    本周回顾
                  </div>
                  <MessageContent
                    content={msg.content}
                    nameToId={nameToId}
                    onHoverNode={onHoverNode}
                    onSelectNode={onSelectNode}
                  />
                </div>
              </div>
            )
          }
          return (
              <div
                key={msg.id}
                className={`ft-chat-message ${msg.role === 'user' ? 'is-user' : 'is-ai'}`}
              >
                <div
                className="ft-message-body"
              >
                <MessageContent
                  content={msg.content}
                  nameToId={nameToId}
                  onHoverNode={onHoverNode}
                  onSelectNode={onSelectNode}
                />
                {msg.role === 'assistant' && msg.thinking && (
                  <ThinkingCard thinking={msg.thinking} />
                )}
                {msg.role === 'assistant' && msg.thinking && (
                  <ProposalReferenceCard thinking={msg.thinking} messageId={msg.id} onOpenInbox={onOpenInbox} />
                )}
                {msg.role === 'assistant' && msg.model_used && (
                  <div
                    className="mt-1 text-[10px] ft-chat-text-tertiary"
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
                  <div className="mt-1 text-[10px] ft-chat-text-faint">
                    本地算法 · 0 token
                    {formatLocalRoute(msg.local_route) && ` · ${formatLocalRoute(msg.local_route)}`}
                  </div>
                )}
                {msg.isError && onRetry && (
                  <button
                    onClick={() => onRetry(treeData)}
                    disabled={isLoading}
                    className="mt-1.5 text-[11px] ft-chat-text-warn ft-chat-hover-text-warn border ft-chat-border-warn-50 ft-chat-hover-border-warn-50 rounded px-2 py-0.5 transition-colors disabled:opacity-50"
                  >
                    重试
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {isLoading && (
          <div className="ft-chat-waiting-wrap">
            <div className="ft-chat-waiting">
              <span className="ft-chat-wait-line" />
              <span className="ft-mono">等待中</span>
              {pendingCount > 0 && (
                <span className="ml-2 ft-chat-text-warn text-[11px]">
                  还有 {pendingCount} 条消息等待处理
                </span>
              )}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="ft-chat-input-wrap">
        <div className="ft-chat-input-row">
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
            className="ft-chat-input"
            style={{ maxHeight: 200, minHeight: 44 }}
          />
          {isLoading ? (
            <button
              onClick={() => onCancel?.()}
              className="ft-chat-cancel"
            >
              停止
              {pendingCount > 0 && (
                <span className="ft-chat-queue-badge">
                  {pendingCount}
                </span>
              )}
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="ft-chat-send"
            >
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
