import { useState } from 'react'

const TIER_STYLES = {
  '早上':  { color: 'text-warn',        bg: 'bg-warn-soft/60',     icon: 'AM' },
  '中午':  { color: 'text-[#B06A2C]',   bg: 'bg-[#C07840]/12',     icon: 'NOON' },
  '下午':  { color: 'text-[#3E6E97]',   bg: 'bg-[#3E6E97]/10',     icon: 'PM' },
  '傍晚':  { color: 'text-danger',      bg: 'bg-danger-soft/60',   icon: 'EVE' },
  '晚上':  { color: 'text-accent',      bg: 'bg-accent-soft/60',   icon: 'NITE' },
  '任意':  { color: 'text-ink-soft',    bg: 'bg-panel-soft/50',    icon: 'ANY' },
}

/**
 * 今日聚焦卡：钉在树视图顶部
 * - 没生成：显示生成按钮
 * - 已生成：3 件事 + 完成进度 + 操作
 */
export default function TodayCard({
  focus, loading, generating,
  onGenerate, onToggle, onRemove, onDismiss,
  onHoverNode,
}) {
  const [collapsed, setCollapsed] = useState(false)

  if (loading) return null

  // 未生成今天的聚焦
  if (!focus) {
    return (
      <div className="absolute top-3 left-3 right-3 z-10 max-w-xl mx-auto pointer-events-none">
        <button
          onClick={onGenerate}
          disabled={generating}
          className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-panel-soft/40 transition-colors rounded-xl disabled:opacity-60 bg-panel/95 border border-line rounded-xl shadow-lg backdrop-blur-sm pointer-events-auto"
        >
          <div>
            <div className="text-xs text-ink-faint uppercase tracking-wider">今日聚焦</div>
            <div className="text-sm text-ink-soft mt-0.5">
              {generating ? '思考中…' : '点击让 AI 生成今天最该做的 3 件事'}
            </div>
          </div>
          {!generating && <span className="text-xs text-accent">↻ 生成</span>}
        </button>
      </div>
    )
  }

  const tasks = focus.tasks || []
  const doneCount = tasks.filter(t => t.done).length
  const total = tasks.length

  return (
    <div className="absolute top-3 left-3 right-3 z-10 max-w-2xl mx-auto pointer-events-none">
      <div className="bg-panel/95 border border-line rounded-xl shadow-lg backdrop-blur-sm pointer-events-auto">
      {/* Header */}
      <div className="px-4 py-2 flex items-center justify-between border-b border-line">
        <button onClick={() => setCollapsed(c => !c)} className="flex items-center gap-2 text-left flex-1">
          <span className="text-xs text-ink-faint">{collapsed ? '▸' : '▾'}</span>
          <span className="text-xs text-ink-faint uppercase tracking-wider">今日聚焦</span>
          <span className="text-xs text-accent font-mono">
            {doneCount}/{total}
          </span>
          {focus.summary && !collapsed && (
            <span className="text-xs text-ink-faint truncate ml-2">· {focus.summary}</span>
          )}
        </button>
        <div className="flex items-center gap-2 ml-2">
          <button
            onClick={onGenerate}
            disabled={generating}
            title="重新生成"
            className="text-[11px] text-ink-faint hover:text-ink-soft disabled:opacity-50"
          >
            {generating ? '…' : '↻ 重生成'}
          </button>
          <button
            onClick={onDismiss}
            title="清空今天的聚焦"
            className="text-[11px] text-ink-ghost hover:text-danger"
          >
            清空
          </button>
        </div>
      </div>

      {/* Tasks */}
      {!collapsed && (
        <div className="px-3 py-2 space-y-1.5">
          {tasks.length === 0 && (
            <div className="text-xs text-ink-faint py-2 text-center">没有任务，可以重新生成</div>
          )}
          {tasks.map((t, i) => {
            const tier = TIER_STYLES[t.energy_tier] || TIER_STYLES['任意']
            return (
              <div
                key={i}
                className={`flex items-start gap-2 px-2 py-2 rounded-lg ${tier.bg} group ${t.done ? 'opacity-50' : ''}`}
                onMouseEnter={() => t.node_id && onHoverNode?.(t.node_id)}
                onMouseLeave={() => onHoverNode?.(null)}
              >
                {/* 完成 checkbox */}
                <button
                  onClick={() => onToggle(i)}
                  className="flex-shrink-0 mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors"
                  style={{
                    borderColor: t.done ? '#4A8C5C' : '#CBC0A4',
                    background: t.done ? '#4A8C5C' : 'transparent',
                  }}
                >
                  {t.done && <span className="text-white text-[10px] leading-none">✓</span>}
                </button>

                {/* 内容 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs">{tier.icon}</span>
                    <span className={`text-xs ${tier.color}`}>{t.energy_tier}</span>
                    <span className={`text-sm font-medium ${t.done ? 'line-through text-ink-faint' : 'text-ink'}`}>
                      {t.name}
                    </span>
                    {t.node_id && !t.done && (
                      <span className="text-[10px] text-accent bg-accent-soft px-1 rounded">已在树</span>
                    )}
                    {!t.node_id && (
                      <span className="text-[10px] text-ink-faint bg-panel-soft px-1 rounded">建议</span>
                    )}
                  </div>
                  <div className="text-[11px] text-ink-faint mt-0.5 leading-relaxed">{t.why}</div>
                </div>

                {/* 删除 */}
                <button
                  onClick={() => onRemove(i)}
                  className="opacity-0 group-hover:opacity-100 text-[11px] text-ink-ghost hover:text-danger transition-opacity flex-shrink-0"
                  title="移除这条"
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      )}
      </div>
    </div>
  )
}
