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
    left: Math.min(x, window.innerWidth - 208),
    top:  Math.min(y, window.innerHeight - 280),
    zIndex: 1000,
  }

  const childType = node.type === 'project' ? 'category' : 'task'
  const childLabel = node.type === 'project' ? '分类' : '任务'
  const siblingLabel = node.type === 'project' ? '项目' : node.type === 'category' ? '分类' : '任务'

  const nextStatus = node.status === 'done' ? 'active'
    : node.status === 'active' ? 'done' : 'active'
  const statusActionLabel = node.status === 'done' ? '标记为进行中' : '标记为已完成'
  const hasChildren = (node.children?.length || 0) > 0

  return (
    <div
      ref={ref}
      style={style}
      className="ft-context-menu border rounded-xl shadow-2xl py-1 w-52 text-sm"
    >
      {/* 节点信息头 */}
      <div className="px-3 py-2 border-b ft-context-border-subtle">
        <div className="font-medium ft-context-text-primary truncate">{node.name}</div>
        <div className="text-xs ft-context-text-tertiary mt-0.5">
          {TYPE_LABELS[node.type]} · {STATUS_LABELS[node.status]}
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

        <div className="border-t ft-context-border-subtle my-1" />

        {/* 删除 */}
        {hasChildren && node.parent_id && (
          <MenuItem
            icon="CUT"
            label="只删除此节点"
            onClick={() => { onAction('delete-only', { node }); onClose() }}
          />
        )}
        <MenuItem
          icon="DEL"
          label={hasChildren ? '删除整支' : '删除'}
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
          ? 'ft-context-danger'
          : 'ft-context-text-secondary ft-context-hover-surface'
      }`}
    >
      <span className="text-xs w-4 text-center">{icon}</span>
      <span>{label}</span>
    </button>
  )
}
