import { useEffect, useRef } from 'react'

const STATUS_LABELS = { active: '进行中', done: '已完成', dormant: '暂停', dropped: '废弃' }
const TYPE_LABELS   = { project: '项目', category: '分类', task: '任务' }

function safeRatio(value, fallback = 1) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback
}

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
    top:  Math.max(8, Math.min(y, window.innerHeight - 340)),
    zIndex: 1000,
  }

  const childType = node.type === 'project' ? 'category' : 'task'
  const childLabel = node.type === 'project' ? '分类' : '任务'
  const siblingLabel = node.type === 'project' ? '项目' : node.type === 'category' ? '分类' : '任务'

  const canRestore = node.status === 'done' || node.status === 'dormant' || node.status === 'dropped'
  const localShare = safeRatio(node.__localShare ?? node.weight ?? 1)
  const effectiveShare = safeRatio(node.__flow ?? localShare, localShare)
  const effectivePct = Math.round(effectiveShare * 100)

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
          {TYPE_LABELS[node.type]} · {STATUS_LABELS[node.status] || '进行中'}
        </div>
      </div>

      <div className="py-1">
        {/* 添加节点 */}
        <MenuItem
          icon="＋"
          label={`添加子${childLabel}`}
          onClick={() => { onAction('add-child', { node, childType }); onClose() }}
        />
        <MenuItem
          icon="＋"
          label={`添加同级${siblingLabel}`}
          onClick={() => { onAction('add-sibling', { node, childType: node.type }); onClose() }}
        />

        {/* 重命名 */}
        <MenuItem
          icon="✏"
          label="重命名"
          onClick={() => { onAction('rename', { node }); onClose() }}
        />

        {/* 改状态 */}
        {canRestore && (
          <MenuItem
            icon="↩"
            label="恢复为进行中"
            onClick={() => { onAction('status', { node, status: 'active' }); onClose() }}
          />
        )}

        {node.status !== 'done' && (
          <MenuItem
            icon="✓"
            label="标记为已完成"
            onClick={() => { onAction('status', { node, status: 'done' }); onClose() }}
          />
        )}

        {/* 暂停（只对 active 节点） */}
        {node.status !== 'dormant' && node.status !== 'dropped' && (
          <MenuItem
            icon="||"
            label="标记为暂停"
            onClick={() => { onAction('status', { node, status: 'dormant' }); onClose() }}
          />
        )}

        {node.status !== 'dropped' && (
          <MenuItem
            icon="×"
            label="标记为废弃"
            onClick={() => { onAction('status', { node, status: 'dropped' }); onClose() }}
          />
        )}

        {/* 调整权重 */}
        <MenuItem
          icon="W"
          label={`调整权重 (有效 ${effectivePct}%)`}
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
