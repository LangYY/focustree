import { useMemo } from 'react'

const STATUS_COLOR = { active: '#3b82f6', done: '#22c55e', dormant: '#eab308' }
const STATUS_LABEL = { active: '进行中', done: '已完成', dormant: '暂停' }

export default function LeafView({ treeData, onStatusChange }) {
  const tasks = useMemo(() => {
    const result = []
    function collect(node, projectName, projectColor) {
      if (node.type === 'task') {
        result.push({ ...node, projectName, projectColor })
      }
      const pName  = node.type === 'project' ? node.name  : projectName
      const pColor = node.type === 'project' ? node.color : projectColor
      node.children?.forEach(c => collect(c, pName, pColor))
    }
    if (treeData) collect(treeData, '', '#6b7280')
    // 按权重降序
    return result.sort((a, b) => (b.weight || 0) - (a.weight || 0))
  }, [treeData])

  const active  = tasks.filter(t => t.status === 'active')
  const dormant = tasks.filter(t => t.status === 'dormant')
  const done    = tasks.filter(t => t.status === 'done')

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: '#0f1117' }}>
      <div className="max-w-2xl mx-auto">
        <h2 className="text-lg font-semibold text-gray-200 mb-1">末端视图</h2>
        <p className="text-sm text-gray-500 mb-6">所有任务，按权重排序</p>

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
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
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
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
        dimmed
          ? 'bg-gray-900/50 border-gray-800/50 opacity-50'
          : 'bg-gray-900 border-gray-800 hover:border-gray-700'
      }`}
    >
      {/* 完成圆圈 */}
      <button
        onClick={() => onStatusChange(task.id, task.status === 'done' ? 'active' : 'done')}
        className="flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors"
        style={{
          borderColor: task.status === 'done' ? '#22c55e' : '#374151',
          background:  task.status === 'done' ? '#22c55e' : 'transparent',
        }}
      >
        {task.status === 'done' && <span className="text-white text-xs">✓</span>}
      </button>

      {/* 任务名 */}
      <div className="flex-1 min-w-0">
        <div className={`text-sm text-gray-200 truncate ${task.status === 'done' ? 'line-through text-gray-500' : ''}`}>
          {task.name}
        </div>
        {task.projectName && (
          <div className="flex items-center gap-1.5 mt-0.5">
            <span
              style={{ background: task.projectColor }}
              className="inline-block w-2 h-2 rounded-full flex-shrink-0"
            />
            <span className="text-xs text-gray-500">{task.projectName}</span>
          </div>
        )}
      </div>

      {/* 权重条 */}
      <div className="flex-shrink-0 w-16">
        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${(task.weight || 0) * 100}%`,
              background: STATUS_COLOR[task.status] || '#6b7280',
            }}
          />
        </div>
      </div>
    </div>
  )
}
