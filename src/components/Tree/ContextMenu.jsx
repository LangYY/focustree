import { useEffect, useRef } from 'react'

const STATUS_LABELS = { active: '进行中', done: '已完成', dormant: '暂停' }
const TYPE_LABELS   = { project: '项目', category: '分类', task: '任务' }

export default function ContextMenu({ x, y, node, onClose, onAction }) {
  const ref = useRef(null)

  // 点击外部关闭
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // 保证不超出屏幕右/下边界
  const style = {
    position: 'fixed',
    left: Math.min(x, window.innerWidth - 180),
    top:  Math.min(y, window.innerHeight - 240),
    zIndex: 1000,
  }

  const canHaveChildren = node.type === 'project' || node.type === 'category'
  const childType = node.type === 'project' ? 'category' : 'task'
  const childLabel = node.type === 'project' ? '分类' : '任务'

  const nextStatus = node.status === 'done' ? 'active'
    : node.status === 'active' ? 'done' : 'active'
  const statusActionLabel = node.status === 'done' ? '标记为进行中' : '标记为已完成'

  return (
    <div
      ref={ref}
      style={style}
      className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl py-1 w-44 text-sm"
    >
      {/* 节点信息头 */}
      <div className="px-3 py-2 border-b border-gray-800">
        <div className="font-medium text-gray-200 truncate">{node.name}</div>
        <div className="text-xs text-gray-500 mt-0.5">
          {TYPE_LABELS[node.type]} · {STATUS_LABELS[node.status]}
        </div>
      </div>

      <div className="py-1">
        {/* 添加子节点 */}
        {canHaveChildren && (
          <MenuItem
            icon="＋"
            label={`添加${childLabel}`}
            onClick={() => { onAction('add-child', { node, childType }); onClose() }}
          />
        )}

        {/* 重命名 */}
        <MenuItem
          icon="✏"
          label="重命名"
          onClick={() => { onAction('rename', { node }); onClose() }}
        />

        {/* 改状态 */}
        <MenuItem
          icon={node.status === 'done' ? '↩' : '✓'}
          label={statusActionLabel}
          onClick={() => { onAction('status', { node, status: nextStatus }); onClose() }}
        />

        {/* 暂停（只对 active 节点） */}
        {node.status === 'active' && (
          <MenuItem
            icon="||"
            label="标记为暂停"
            onClick={() => { onAction('status', { node, status: 'dormant' }); onClose() }}
          />
        )}

        {/* 调整权重 */}
        <MenuItem
          icon="W"
          label={`调整权重 (${Math.round((node.weight ?? 1) * 100)}%)`}
          onClick={() => { onAction('weight', { node }); onClose() }}
        />

        <div className="border-t border-gray-800 my-1" />

        {/* 删除 */}
        <MenuItem
          icon="DEL"
          label="删除"
          danger
          onClick={() => { onAction('delete', { node }); onClose() }}
        />
      </div>
    </div>
  )
}

function MenuItem({ icon, label, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors ${
        danger
          ? 'text-red-400 hover:bg-red-900/30'
          : 'text-gray-300 hover:bg-gray-800'
      }`}
    >
      <span className="text-xs w-4 text-center">{icon}</span>
      <span>{label}</span>
    </button>
  )
}
