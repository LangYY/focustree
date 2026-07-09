import { useState, useMemo } from 'react'
import { findNodeById } from '../../lib/treeUtils'

/**
 * 推荐记录面板
 *  - 显示近 30 天 AI 给出过的推荐
 *  - 每条标注：[done] 已完成 / [pending] 待办 / [drop] 流产
 *  - 顶部命中率 badge
 *  - 单条展开可看完整 thinking
 */
export default function RecommendationLogPanel({
  recommendations, hitRate, treeData,
  onClose,
}) {
  const [expanded, setExpanded] = useState(null)

  const items = recommendations || []
  const totalMeaningful = hitRate?.total || 0
  const completed       = hitRate?.completed || 0
  const dropped         = hitRate?.dropped || 0
  const pending         = hitRate?.pending || 0
  const rate            = totalMeaningful ? Math.round((completed / totalMeaningful) * 100) : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <div
        className="bg-panel border border-line rounded-2xl w-[720px] max-h-[85vh] flex flex-col shadow-lift"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-line flex items-start justify-between">
          <div className="flex-1">
            <div className="text-base font-semibold text-ink mb-1">AI 推荐记录</div>
            <div className="text-[11px] text-ink-faint">
              近 30 天 AI 给你的推荐，标记完成的会自动回填到这里
            </div>
            {/* 命中率统计 */}
            {totalMeaningful > 0 && (
              <div className="mt-3 flex items-center gap-3 text-xs">
                <span className="text-ink-soft font-medium">
                  命中率 <span className="text-accent text-base font-semibold">{rate}%</span>
                </span>
                <span className="text-ink-ghost">·</span>
                <span className="text-accent">[done] {completed} 完成</span>
                <span className="text-ink-ghost">·</span>
                <span className="text-ink-faint">[-] {pending} 待办</span>
                <span className="text-ink-ghost">·</span>
                <span className="text-danger">[drop] {dropped} 流产</span>
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-ink-faint hover:text-ink-soft text-sm ml-3 flex-shrink-0">
            关闭 [x]
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {items.length === 0 && (
            <div className="text-center text-ink-faint text-sm py-12">
              还没有 AI 推荐记录。<br />
              <span className="text-xs">问 AI "我现在该做什么"，它的推荐会自动归档到这里。</span>
            </div>
          )}
          {items.map(r => (
            <RecItem
              key={r.id}
              rec={r}
              treeData={treeData}
              isOpen={expanded === r.id}
              onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function RecItem({ rec, treeData, isOpen, onToggle }) {
  const outcomeBadge = useMemo(() => {
    const o = rec.derived_outcome
    if (o === 'completed') return { label: '[done] 已完成', cls: 'text-accent bg-accent-soft' }
    if (o === 'dropped')   return { label: '[drop] 流产',    cls: 'text-danger bg-danger-soft' }
    return                        { label: '[-] 待办',   cls: 'text-ink-faint bg-panel-soft/60' }
  }, [rec.derived_outcome])

  const primaryNode = rec.primary_node_id && treeData
    ? findNodeById(treeData, rec.primary_node_id)
    : null

  const thinking = rec.thinking || {}

  return (
    <div className="border border-line rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-3 py-2.5 flex items-start justify-between gap-3 hover:bg-panel-soft/40 transition-colors text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] text-ink-faint">
            <span>{formatDate(rec.created_at)}</span>
            <span>·</span>
            <span className={`px-1.5 py-0.5 rounded ${outcomeBadge.cls}`}>{outcomeBadge.label}</span>
          </div>
          <div className="mt-1 text-sm text-ink-soft truncate">
            {rec.message}
          </div>
          {primaryNode && (
            <div className="mt-1 text-[11px] text-ink-faint">
              主推荐 → <span className="text-accent">{primaryNode.name}</span>
            </div>
          )}
          {!primaryNode && rec.primary_node_id && (
            <div className="mt-1 text-[11px] text-ink-faint italic">
              主推荐节点已删除
            </div>
          )}
        </div>
        <span className="text-[11px] text-ink-faint mt-1">{isOpen ? '[-]' : '[+]'}</span>
      </button>

      {isOpen && (
        <div className="px-3 py-3 border-t border-line bg-panel/50 space-y-2 text-[11px] leading-relaxed">
          {rec.reply && (
            <div>
              <div className="text-ink-faint mb-0.5">AI 回复</div>
              <div className="text-ink-soft whitespace-pre-wrap pl-1">{rec.reply}</div>
            </div>
          )}
          {thinking.user_goal && (
            <Field label="目标" value={thinking.user_goal} color="text-ink-soft" />
          )}
          {thinking.next_concrete_step && (
            <Field label="下一步" value={thinking.next_concrete_step} color="text-accent" emphasis />
          )}
          {thinking.tradeoff_analysis && (
            <Field label="权衡" value={thinking.tradeoff_analysis} color="text-ink-soft" multi />
          )}
          {Array.isArray(thinking.traps_avoided) && thinking.traps_avoided.length > 0 && (
            <div>
              <div className="text-ink-faint">规避陷阱</div>
              <ul className="space-y-0.5 pl-1">
                {thinking.traps_avoided.map((t, i) => (
                  <li key={i} className="text-warn">· {t}</li>
                ))}
              </ul>
            </div>
          )}
          {thinking.leverage_insight && (
            <Field label="杠杆点" value={thinking.leverage_insight} color="text-accent" />
          )}
          {thinking.risk_if_skipped && (
            <Field label="不做的代价" value={thinking.risk_if_skipped} color="text-danger" />
          )}
        </div>
      )}
    </div>
  )
}

function Field({ label, value, color = 'text-ink-soft', emphasis, multi }) {
  return (
    <div className={emphasis ? 'border-l-2 border-accent/40 pl-2' : ''}>
      <span className="text-ink-faint">{label} · </span>
      {multi
        ? <div className={`mt-0.5 ${color}`}>{value}</div>
        : <span className={color}>{value}</span>
      }
    </div>
  )
}

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const today = new Date()
  const isToday = d.toDateString() === today.toDateString()
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()
  const time = d.toTimeString().slice(0, 5)
  if (isToday)     return `今天 ${time}`
  if (isYesterday) return `昨天 ${time}`
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`
}
