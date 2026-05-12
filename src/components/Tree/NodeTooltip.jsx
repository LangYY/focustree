const STATUS_COLOR = { active: '#3b82f6', done: '#22c55e', dormant: '#eab308' }
const STATUS_LABEL = { active: '进行中', done: '已完成', dormant: '暂停中' }

export default function NodeTooltip({ x, y, node }) {
  if (!node) return null

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
      className="bg-gray-900 border border-gray-700 rounded-xl shadow-xl px-3 py-2.5 text-xs max-w-48"
    >
      <div className="font-semibold text-gray-100 mb-1">{node.name}</div>

      <div className="flex items-center gap-1.5 mb-1">
        <span
          style={{
            display: 'inline-block',
            width: 6, height: 6,
            borderRadius: '50%',
            background: STATUS_COLOR[node.status] || '#6b7280',
          }}
        />
        <span className="text-gray-400">{STATUS_LABEL[node.status] || node.status}</span>
      </div>

      {node.weight != null && (
        <div className="text-gray-500">
          权重 {Math.round(node.weight * 100)}%
        </div>
      )}

      {node.summary && (
        <div className="text-gray-400 mt-1.5 border-t border-gray-800 pt-1.5 leading-relaxed">
          {node.summary}
        </div>
      )}
    </div>
  )
}
