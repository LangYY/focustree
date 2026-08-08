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
      style={{ background: 'var(--ft-overlay-scrim)' }}
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl w-[720px] max-h-[85vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-800 flex items-start justify-between">
          <div className="flex-1">
            <div className="text-base font-semibold text-gray-200 mb-1">AI 推荐记录</div>
            <div className="text-[11px] text-gray-500">
              近 30 天 AI 给你的推荐，标记完成的会自动回填到这里
            </div>
            {/* 命中率统计 */}
            {totalMeaningful > 0 && (
              <div className="mt-3 flex items-center gap-3 text-xs">
                <span className="text-gray-300 font-medium">
                  命中率 <span className="text-emerald-400 text-base font-semibold">{rate}%</span>
                </span>
                <span className="text-gray-600">·</span>
                <span className="text-emerald-400">[done] {completed} 完成</span>
                <span className="text-gray-600">·</span>
                <span className="text-gray-400">[-] {pending} 待办</span>
                <span className="text-gray-600">·</span>
                <span className="text-rose-400">[drop] {dropped} 流产</span>
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-sm ml-3 flex-shrink-0">
            关闭 [x]
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {items.length === 0 && (
            <div className="text-center text-gray-500 text-sm py-12">
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
    if (o === 'completed') return { label: '[done] 已完成', cls: 'text-emerald-400 bg-emerald-900/30' }
    if (o === 'dropped')   return { label: '[drop] 流产',    cls: 'text-rose-400 bg-rose-900/30' }
    return                        { label: '[-] 待办',   cls: 'text-gray-400 bg-gray-800/60' }
  }, [rec.derived_outcome])

  const primaryNode = rec.primary_node_id && treeData
    ? findNodeById(treeData, rec.primary_node_id)
    : null

  const thinking = rec.thinking || {}

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-3 py-2.5 flex items-start justify-between gap-3 hover:bg-gray-800/40 transition-colors text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] text-gray-500">
            <span>{formatDate(rec.created_at)}</span>
            <span>·</span>
            <span className={`px-1.5 py-0.5 rounded ${outcomeBadge.cls}`}>{outcomeBadge.label}</span>
          </div>
          <div className="mt-1 text-sm text-gray-300 truncate">
            {rec.message}
          </div>
          {primaryNode && (
            <div className="mt-1 text-[11px] text-gray-500">
              主推荐 → <span className="text-blue-300">{primaryNode.name}</span>
            </div>
          )}
          {!primaryNode && rec.primary_node_id && (
            <div className="mt-1 text-[11px] text-gray-500 italic">
              主推荐节点已删除
            </div>
          )}
        </div>
        <span className="text-[11px] text-gray-500 mt-1">{isOpen ? '[-]' : '[+]'}</span>
      </button>

      {isOpen && (
        <div className="px-3 py-3 border-t border-gray-800 bg-gray-950/50 space-y-2 text-[11px] leading-relaxed">
          {rec.reply && (
            <div>
              <div className="text-gray-500 mb-0.5">AI 回复</div>
              <div className="text-gray-300 whitespace-pre-wrap pl-1">{rec.reply}</div>
            </div>
          )}
          {thinking.user_goal && (
            <Field label="目标" value={thinking.user_goal} color="text-gray-300" />
          )}
          {thinking.next_concrete_step && (
            <Field label="下一步" value={thinking.next_concrete_step} color="text-blue-300" emphasis />
          )}
          {thinking.tradeoff_analysis && (
            <Field label="权衡" value={thinking.tradeoff_analysis} color="text-gray-300" multi />
          )}
          {Array.isArray(thinking.traps_avoided) && thinking.traps_avoided.length > 0 && (
            <div>
              <div className="text-gray-500">规避陷阱</div>
              <ul className="space-y-0.5 pl-1">
                {thinking.traps_avoided.map((t, i) => (
                  <li key={i} className="text-amber-300">· {t}</li>
                ))}
              </ul>
            </div>
          )}
          {thinking.leverage_insight && (
            <Field label="杠杆点" value={thinking.leverage_insight} color="text-emerald-300" />
          )}
          {thinking.risk_if_skipped && (
            <Field label="不做的代价" value={thinking.risk_if_skipped} color="text-rose-300" />
          )}
        </div>
      )}
    </div>
  )
}

function Field({ label, value, color = 'text-gray-300', emphasis, multi }) {
  return (
    <div className={emphasis ? 'border-l-2 border-blue-500/40 pl-2' : ''}>
      <span className="text-gray-500">{label} · </span>
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
