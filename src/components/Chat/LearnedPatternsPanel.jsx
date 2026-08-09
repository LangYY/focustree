/**
 * 已学到的用户模式面板
 * - 显示 AI 通过对话沉淀下来的事实
 * - 用户可以删除"错的"，逐步校准 AI 对自己的认知
 */
export default function LearnedPatternsPanel({ patterns, onRemove, onClose }) {
  const sorted = [...(patterns || [])]
    .map((p, i) => ({ ...p, _index: i }))
    .sort((a, b) => (b.confidence ?? 0.5) - (a.confidence ?? 0.5))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--ft-overlay-scrim)' }}
      onClick={onClose}
    >
      <div
        className="ft-chat-surface border ft-chat-border rounded-2xl w-[560px] max-h-[80vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b ft-chat-border-subtle flex items-center justify-between">
          <div>
            <div className="text-base font-semibold ft-chat-text-primary">AI 已学到的</div>
            <div className="text-[11px] ft-chat-text-tertiary mt-0.5">
              这些是 AI 从对话中沉淀的事实。错的可以删掉。共 {sorted.length} 条
            </div>
          </div>
          <button onClick={onClose} className="ft-chat-text-tertiary ft-chat-hover-text-secondary text-sm">关闭 [x]</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {sorted.length === 0 && (
            <div className="text-center ft-chat-text-tertiary text-sm py-12">
              还没学到任何东西。<br />
              <span className="text-xs ft-chat-text-secondary">和 AI 多聊聊你的工作习惯/偏好，它会自动沉淀。</span>
            </div>
          )}
          <div className="space-y-2">
            {sorted.map(p => (
              <div
                key={p._index}
                className="group flex items-start gap-2 p-2.5 rounded-lg ft-chat-surface-hover-40 ft-chat-hover-surface transition-colors"
              >
                <div className="flex-shrink-0 mt-0.5">
                  <ConfidenceBadge confidence={p.confidence} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm ft-chat-text-primary leading-relaxed">{p.observation}</div>
                  <div className="flex items-center gap-2 mt-1">
                    {p.topic && <span className="text-[10px] ft-chat-text-tertiary ft-chat-surface-hover px-1.5 rounded">{p.topic}</span>}
                    {p.created_at && (
                      <span className="text-[10px] ft-chat-text-faint">{new Date(p.created_at).toISOString().slice(0, 10)}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (window.confirm('删除这条记忆？AI 以后不会再依据它推断。')) onRemove(p._index)
                  }}
                  className="opacity-0 group-hover:opacity-100 text-[11px] ft-chat-text-tertiary ft-chat-hover-text-danger transition-opacity"
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ConfidenceBadge({ confidence }) {
  const c = confidence ?? 0.5
  const color =
    c >= 0.8 ? 'ft-chat-bg-accent' :
    c >= 0.6 ? 'ft-chat-bg-accent-80' :
    'ft-chat-bg-muted'
  return (
    <div className="flex items-center gap-1">
      <div className={`w-1.5 h-1.5 rounded-full ${color}`} />
      <span className="text-[10px] ft-chat-text-tertiary">{Math.round(c * 100)}%</span>
    </div>
  )
}
