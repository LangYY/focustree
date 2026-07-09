import { useMemo } from 'react'
import { getDerivedWeightMeta, getDerivedWeightMetaMap, getNodeDueState, PRIORITY_LABELS } from '../../lib/treeUtils'

const STATUS_COLOR = { active: '#3E7050', done: '#4A8C5C', dormant: '#A8862E' }

function safePercent(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric * 100)) : 0
}

export default function LeafView({ treeData, userGoal, onStatusChange }) {
  const tasks = useMemo(() => {
    const result = []
    const metaById = getDerivedWeightMetaMap(treeData, { userGoal })

    function collect(node, projectName, projectColor) {
      if (node.type === 'task') {
        const meta = getDerivedWeightMeta(metaById, node)
        result.push({
          ...node,
          projectName,
          projectColor,
          effectiveWeight: meta?.flow ?? node.weight ?? 0,
          localShare: meta?.localShare ?? node.weight ?? 0,
          recommendationRank: meta?.recommendationRank ?? 0,
          completeness: meta?.completeness ?? 1,
          missingSlots: meta?.missingSlots ?? [],
        })
      }
      const pName  = node.type === 'project' ? node.name  : projectName
      const pColor = node.type === 'project' ? node.color : projectColor
      node.children?.forEach(c => collect(c, pName, pColor))
    }
    if (treeData) collect(treeData, '', '#8A9489')
    return result.sort((a, b) => (b.recommendationRank || 0) - (a.recommendationRank || 0))
  }, [treeData, userGoal])

  const active  = tasks.filter(t => t.status === 'active')
  const dormant = tasks.filter(t => t.status === 'dormant')
  const done    = tasks.filter(t => t.status === 'done')

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--color-surface)' }}>
      <div className="max-w-2xl mx-auto">
        <h2 className="text-lg font-semibold font-display text-ink mb-1">末端视图</h2>
        <p className="text-sm text-ink-faint mb-6">所有任务，按推荐分排序</p>

        <Section title="进行中" tasks={active}   onStatusChange={onStatusChange} />
        <Section title="暂停中" tasks={dormant}  onStatusChange={onStatusChange} />
        <Section title="已完成" tasks={done}     onStatusChange={onStatusChange} dimmed />
      </div>
    </div>
  )
}

function Section({ title, tasks, onStatusChange, dimmed }) {
  if (tasks.length === 0) return null
  return (
    <div className="mb-8">
      <div className="text-xs font-semibold text-ink-faint uppercase tracking-wider mb-3">
        {title} · {tasks.length}
      </div>
      <div className="space-y-2">
        {tasks.map(task => (
          <TaskRow key={task.id} task={task} onStatusChange={onStatusChange} dimmed={dimmed} />
        ))}
      </div>
    </div>
  )
}

function TaskRow({ task, onStatusChange, dimmed }) {
  const priorityLabel = PRIORITY_LABELS[task.current_priority] || ''
  const dueState = getNodeDueState(task)
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
        dimmed
          ? 'bg-panel-soft/50 border-line opacity-50'
          : 'bg-panel border-line hover:border-line'
      }`}
    >
      {/* 完成圆圈 */}
      <button
        onClick={() => onStatusChange(task.id, task.status === 'done' ? 'active' : 'done')}
        className="flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors"
        style={{
          borderColor: task.status === 'done' ? '#4A8C5C' : '#CBC0A4',
          background:  task.status === 'done' ? '#4A8C5C' : 'transparent',
        }}
      >
        {task.status === 'done' && <span className="text-white text-xs">✓</span>}
      </button>

      {/* 任务名 */}
      <div className="flex-1 min-w-0">
        <div className={`text-sm text-ink truncate ${task.status === 'done' ? 'line-through text-ink-faint' : ''}`}>
          {task.name}
        </div>
        {task.projectName && (
          <div className="flex items-center gap-1.5 mt-0.5">
            <span
              style={{ background: task.projectColor }}
              className="inline-block w-2 h-2 rounded-full flex-shrink-0"
            />
            <span className="text-xs text-ink-faint">{task.projectName}</span>
            {priorityLabel && (
              <span className={`text-xs ${task.current_priority === 'urgent' ? 'text-danger' : 'text-ink-faint'}`}>
                · {priorityLabel}
              </span>
            )}
            {task.target_completion_date && (
              <span className={`text-xs ${
                dueState?.state && dueState.state !== 'later' ? 'text-warn' : 'text-ink-faint'
              }`}>
                · {dueState?.label || task.target_completion_date}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 权重条 */}
      <div className="flex-shrink-0 w-16">
        <div className="h-1.5 bg-panel-soft rounded-full overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${safePercent(task.recommendationRank || task.effectiveWeight)}%`,
              background: STATUS_COLOR[task.status] || '#8A9489',
            }}
          />
        </div>
      </div>
    </div>
  )
}
