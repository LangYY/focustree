import { PRIORITY_LABELS, getNodeDueState } from '../../lib/treeUtils'

const STATUS_LABEL = { active: '进行中', done: '已完成', dormant: '暂停中' }

function statusColor(status) {
  if (status === 'done') return 'var(--ft-accent)'
  if (status === 'dormant') return 'var(--ft-warn)'
  return 'var(--ft-accent)'
}

export default function NodeTooltip({ x, y, node }) {
  if (!node) return null

  const directPriority = Math.round(Number(node.__directPriority) || 0)
  const branchPriority = Math.round(Number(node.__branchPriority) || 0)
  const cultivation = Math.round(Number(node.__cultivationScore) || 0)
  const confidence = Math.round((Number(node.__priorityConfidence) || 0) * 100)
  const staleReasons = Array.isArray(node.__priorityStaleReasons) ? node.__priorityStaleReasons : []
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
      className="ft-node-tooltip border rounded-xl shadow-xl px-3 py-2.5 text-xs max-w-48"
    >
      <div className="font-semibold ft-tooltip-primary mb-1">{node.name}</div>

      <div className="flex items-center gap-1.5 mb-1">
        <span
          style={{
            display: 'inline-block',
            width: 6, height: 6,
            borderRadius: '50%',
            background: statusColor(node.status),
          }}
        />
        <span className="ft-tooltip-secondary">{STATUS_LABEL[node.status] || node.status}</span>
      </div>

      <div className="ft-tooltip-tertiary mt-0.5">
        直接优先级 {directPriority} · 枝干 {branchPriority}
      </div>

      <div className="ft-tooltip-tertiary mt-0.5">
        培育程度 {cultivation} · 置信 {confidence}%
      </div>

      {(priorityLabel || node.target_completion_date) && (
        <div className="ft-tooltip-tertiary mt-0.5">
          {priorityLabel && <span>优先级 {priorityLabel}</span>}
          {priorityLabel && node.target_completion_date && <span className="ft-tooltip-faint"> · </span>}
          {node.target_completion_date && (
            <span className={dueState?.state && dueState.state !== 'later' ? 'ft-tooltip-warn' : ''}>
              {dueState?.label || node.target_completion_date}
            </span>
          )}
        </div>
      )}

      {staleReasons.length > 0 && (
        <div className="ft-tooltip-warn mt-1">
          待复核：{staleReasons.slice(0, 3).join('、')}
        </div>
      )}

      {node.summary && (
        <div className="ft-tooltip-secondary mt-1.5 border-t ft-tooltip-border-subtle pt-1.5 leading-relaxed">
          {node.summary}
        </div>
      )}
    </div>
  )
}
