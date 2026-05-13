import { useState, useEffect } from 'react'

/**
 * 对话历史面板
 * - 列出所有 session，按时间倒序
 * - 点开看 session 内全部消息（只读）
 * - 单 session 删除
 */
export default function ChatHistoryPanel({
  sessions, fetchSessionMessages, deleteSession,
  currentSessionId, onClose,
}) {
  const [expanded, setExpanded] = useState(null)
  const [expandedMsgs, setExpandedMsgs] = useState([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)

  async function toggle(sid) {
    if (expanded === sid) { setExpanded(null); setExpandedMsgs([]); return }
    setExpanded(sid)
    setLoadingMsgs(true)
    const msgs = await fetchSessionMessages(sid)
    setExpandedMsgs(msgs)
    setLoadingMsgs(false)
  }

  function handleDelete(sid, e) {
    e.stopPropagation()
    if (window.confirm('彻底删除这段对话？无法恢复。')) {
      deleteSession(sid)
      if (expanded === sid) setExpanded(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl w-[640px] max-h-[80vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <div>
            <div className="text-base font-semibold text-gray-200">对话历史</div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              一段没说话超过 30 分钟就开新对话。共 {sessions.length} 段
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-sm">关闭 [x]</button>
        </div>

        {/* Sessions list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {sessions.length === 0 && (
            <div className="text-center text-gray-500 text-sm py-12">还没有任何对话</div>
          )}
          {sessions.map(s => {
            const isCurrent = s.session_id === currentSessionId
            const isOpen = expanded === s.session_id
            return (
              <div
                key={s.session_id}
                className="border border-gray-800 rounded-lg overflow-hidden"
              >
                <button
                  onClick={() => toggle(s.session_id)}
                  className="w-full px-3 py-2.5 flex items-start justify-between gap-3 hover:bg-gray-800/50 transition-colors text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[11px] text-gray-500">
                      <span>{formatDate(s.ended_at)}</span>
                      <span>·</span>
                      <span>{s.count} 条消息</span>
                      {isCurrent && (
                        <span className="text-emerald-400 bg-emerald-900/40 px-1.5 rounded">当前</span>
                      )}
                    </div>
                    <div className="mt-1 text-sm text-gray-300 leading-relaxed">
                      {s.summary || <span className="text-gray-500 italic">（无摘要，会在新对话开始时自动生成）</span>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-[11px] text-gray-500">{isOpen ? '▾' : '▸'}</span>
                    {!isCurrent && (
                      <button
                        onClick={e => handleDelete(s.session_id, e)}
                        className="text-[11px] text-gray-600 hover:text-red-400"
                        title="删除这段对话"
                      >
                        删除
                      </button>
                    )}
                  </div>
                </button>

                {isOpen && (
                  <div className="px-3 py-3 border-t border-gray-800 bg-gray-950/40 space-y-2 max-h-72 overflow-y-auto">
                    {loadingMsgs && <div className="text-xs text-gray-500">载入中…</div>}
                    {!loadingMsgs && expandedMsgs.map(m => (
                      <div key={m.id} className={`text-xs leading-relaxed ${m.role === 'user' ? 'text-blue-300' : 'text-gray-300'}`}>
                        <span className="text-[10px] text-gray-500 uppercase mr-1.5">
                          {m.role === 'user' ? '你' : 'AI'}
                        </span>
                        <span className="whitespace-pre-wrap">{m.content}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const today = new Date()
  const isToday = d.toDateString() === today.toDateString()
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()
  const time = d.toTimeString().slice(0, 5)
  if (isToday)     return `今天 ${time}`
  if (isYesterday) return `昨天 ${time}`
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`
}
