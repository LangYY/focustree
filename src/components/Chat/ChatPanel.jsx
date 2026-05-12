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

/**
 * 把回复内容里的 ✅ / 🎯 / ⚠️ 行渲染成 badge；任务名「xxx」做成可悬浮高亮
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
        if (line.startsWith('✅')) {
          return renderLine(line, i, 'mt-1.5 text-xs text-green-400 bg-green-900/30 rounded-lg px-2 py-1')
        }
        if (line.startsWith('🎯')) {
          return renderLine(line, i, 'mt-1.5 text-xs text-emerald-300 bg-emerald-900/30 rounded-lg px-2 py-1')
        }
        if (line.startsWith('⚠️')) {
          return renderLine(line, i, 'mt-1.5 text-xs text-amber-300 bg-amber-900/30 rounded-lg px-2 py-1')
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
    user_goal, tradeoff_analysis, traps_avoided, leverage_insight,
    next_concrete_step, success_criterion, risk_if_skipped,
  } = thinking
  const hasContent = user_goal || tradeoff_analysis || traps_avoided?.length ||
                     leverage_insight || next_concrete_step || success_criterion || risk_if_skipped
  if (!hasContent) return null

  return (
    <div className="mt-2 text-xs">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
      >
        {open ? '▾' : '▸'} 为什么这样推荐
      </button>
      {open && (
        <div className="mt-1.5 p-2.5 bg-gray-950/60 border border-gray-800 rounded-lg space-y-2 text-[11px] leading-relaxed">
          {user_goal && (
            <Row label="目标" value={user_goal} valueColor="text-gray-300" />
          )}
          {next_concrete_step && (
            <Row label="下一步" value={next_concrete_step} valueColor="text-blue-300" emphasis />
          )}
          {success_criterion && (
            <Row label="完成标准" value={success_criterion} valueColor="text-gray-300" />
          )}
          {tradeoff_analysis && (
            <Row label="权衡" value={tradeoff_analysis} valueColor="text-gray-300" multi />
          )}
          {Array.isArray(traps_avoided) && traps_avoided.length > 0 && (
            <div>
              <div className="text-gray-500 mb-0.5">规避陷阱</div>
              <ul className="space-y-0.5 pl-1">
                {traps_avoided.map((t, i) => (
                  <li key={i} className="text-amber-300">· {t}</li>
                ))}
              </ul>
            </div>
          )}
          {leverage_insight && (
            <Row label="杠杆点" value={leverage_insight} valueColor="text-emerald-300" />
          )}
          {risk_if_skipped && (
            <Row label="不做的代价" value={risk_if_skipped} valueColor="text-rose-300" />
          )}
        </div>
      )}
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
          🎯 当前阶段目标 {goalExpired && <span className="text-amber-400">· 已过期</span>}
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
  { value: 'auto',     label: '自动',  hint: '简单操作用快速，推荐/思考用深度' },
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

    // /新对话 或 /重置 或 /reset → 开新 session（旧对话保留在历史里）
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
              {reviewGenerating ? '回顾中…' : '📓 回顾'}
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
              ↻ 新对话
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
                    📓 本周回顾
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
                  <ThinkingCard thinking={msg.thinking} />
                )}
                {msg.role === 'assistant' && msg.model_used && (
                  <div className="mt-1 text-[10px] text-gray-500">
                    {msg.model_used === 'deepseek-v4-pro' ? '深度 V4-pro' : '快速 V4-flash'}
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-800 text-gray-400 px-3 py-2 rounded-2xl rounded-bl-sm text-sm">
              <span className="animate-pulse">···</span>
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
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="说点什么…（试试 /目标 设置当前阶段目标）"
            rows={1}
            className="flex-1 bg-gray-800 text-gray-200 placeholder-gray-500 text-sm px-3 py-2 rounded-xl resize-none outline-none focus:ring-1 focus:ring-blue-500"
            style={{ maxHeight: 96 }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="flex-shrink-0 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm px-3 py-2 rounded-xl transition-colors"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  )
}
