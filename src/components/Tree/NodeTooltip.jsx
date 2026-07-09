import { PRIORITY_LABELS, getNodeDueState } from '../../lib/treeUtils'

const STATUS_COLOR = { active: '#3E7050', done: '#4A8C5C', dormant: '#A8862E' }
const STATUS_LABEL = { active: '进行中', done: '已完成', dormant: '暂停中' }

function safeRatio(value, fallback = 1) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback
}

export default function NodeTooltip({ x, y, node }) {
  if (!node) return null

  const localShare = safeRatio(node.__localShare ?? node.weight ?? 1)
  const effectiveShare = safeRatio(node.__flow ?? localShare, localShare)
  const localPct = Math.round(localShare * 100)
  const effectivePct = Math.round(effectiveShare * 100)
  const showLocalShare = Math.abs(effectiveShare - localShare) > 0.005
  const completenessPct = Math.round(safeRatio(node.__completeness ?? 1) * 100)
  const rankPct = Math.round(safeRatio(node.__recommendationRank ?? 0, 0) * 100)
  const pressure = Number(node.__branchPressure)
  const missingSlots = Array.isArray(node.__missingSlots) ? node.__missingSlots : []
  const priorityLabel = PRIORITY_LABELS[node.current_priority] || ''
  const dueState = getNodeDueState(node)

  const style = {
    position: 'fixed',
    left: x + 14,
    top:  y - 8,
    zIndex: 999,
    pointerEvents: 'none',
    transform: x > window.innerWidth - 200 ? 'translateX(-110%)' : undefined,
  }

  return (
    <div
      style={style}
      className="bg-panel border border-line rounded-xl shadow-lift px-3 py-2.5 text-xs max-w-48"
    >
      <div className="font-semibold text-ink mb-1">{node.name}</div>

      <div className="flex items-center gap-1.5 mb-1">
        <span
          style={{
            display: 'inline-block',
            width: 6, height: 6,
            borderRadius: '50%',
            background: STATUS_COLOR[node.status] || '#8A9489',
          }}
        />
        <span className="text-ink-faint">{STATUS_LABEL[node.status] || node.status}</span>
      </div>

      {(node.weight != null || node.__localShare != null || node.__flow != null) && (
        <div className="text-ink-faint">
          有效权重 {effectivePct}%
          {showLocalShare && (
            <span className="text-ink-ghost"> · 本级 {localPct}%</span>
          )}
        </div>
      )}

      <div className="text-ink-faint mt-0.5">
        完整度 {completenessPct}% · 推荐分 {rankPct}%
      </div>

      {(priorityLabel || node.target_completion_date) && (
        <div className="text-ink-faint mt-0.5">
          {priorityLabel && <span>优先级 {priorityLabel}</span>}
          {priorityLabel && node.target_completion_date && <span className="text-ink-ghost"> · </span>}
          {node.target_completion_date && (
            <span className={dueState?.state && dueState.state !== 'later' ? 'text-warn/90' : ''}>
              {dueState?.label || node.target_completion_date}
            </span>
          )}
        </div>
      )}

      {Number.isFinite(pressure) && (
        <div className="text-ink-ghost mt-0.5">
          分支压力 {pressure.toFixed(1)}
        </div>
      )}

      {missingSlots.length > 0 && (
        <div className="text-warn/80 mt-1">
          缺：{missingSlots.slice(0, 3).join('、')}
        </div>
      )}

      {node.summary && (
        <div className="text-ink-faint mt-1.5 border-t border-line pt-1.5 leading-relaxed">
          {node.summary}
        </div>
      )}
    </div>
  )
}
