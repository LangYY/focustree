import { CalendarClock, Target } from 'lucide-react'

export default function GoalChip({ goal, goalText, expired, onEdit }) {
  const remaining = daysRemaining(goal?.deadline)
  const label = expired ? '已过期' : remaining == null ? '长期' : `剩 ${remaining} 天`
  return (
    <button type="button" className={`ft-goal-chip ${!goalText ? 'is-empty' : ''} ${expired ? 'is-expired' : ''}`} onClick={onEdit}>
      <span className="ft-goal-chip-marker" aria-hidden="true" />
      <Target size={15} strokeWidth={1.7} aria-hidden="true" />
      <span className="ft-goal-chip-copy">
        <span className="ft-goal-chip-label">{goalText || '未设定阶段目标 · 点击设定'}</span>
        {goalText ? <span className="ft-goal-chip-meta">{label}</span> : null}
      </span>
      {goalText && goal?.deadline ? <CalendarClock size={14} strokeWidth={1.6} aria-hidden="true" /> : null}
    </button>
  )
}

function daysRemaining(deadline) {
  if (!deadline) return null
  const today = new Date()
  const end = new Date(`${deadline}T23:59:59`)
  return Math.ceil((end.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000)
}
