import { useRef } from 'react'

/**
 * 数据备份与恢复面板
 */
export default function BackupPanel({
  list, lastAuto, lastManual, working, progress,
  onExport, onRestoreFile, onRestoreLocal,
  onClose,
}) {
  const fileInputRef = useRef(null)

  function handlePickFile() {
    fileInputRef.current?.click()
  }
  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!window.confirm(
      '从文件恢复会替换当前所有数据（当前数据会先自动存一份快照）。\n确认继续？'
    )) {
      e.target.value = ''
      return
    }
    onRestoreFile(file)
    e.target.value = ''
  }

  function handleRestoreLocal(key, meta) {
    const when = formatRelative(meta?.exported_at)
    const stats = meta?.stats || {}
    const counts = `${stats.nodes || 0} 节点 / ${stats.conversations || 0} 条对话`
    if (!window.confirm(
      `恢复到 ${when} 的备份？\n${counts}\n\n当前数据会先自动存一份快照。`
    )) return
    onRestoreLocal(key)
  }

  const autoCount   = list.filter(b => b.type === 'auto').length
  const preCount    = list.filter(b => b.type === 'pre').length

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl w-[640px] max-h-[85vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <div>
            <div className="text-base font-semibold text-gray-200">数据备份与恢复</div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              你的数据可以随时导出、恢复，不怕意外丢失
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-sm">关闭 ✕</button>
        </div>

        {/* Status row */}
        <div className="px-5 py-3 border-b border-gray-800 bg-gray-900/60 space-y-1.5 text-[12px]">
          <div className="flex items-center gap-2">
            <span className="text-emerald-400">●</span>
            <span className="text-gray-300">自动备份已启用</span>
            <span className="text-gray-500">·</span>
            <span className="text-gray-400">每小时一次，存在浏览器本地</span>
          </div>
          <div className="flex items-center gap-3 text-gray-400">
            <span>上次自动: {lastAuto ? formatRelative(new Date(lastAuto).toISOString()) : '尚未'}</span>
            <span>·</span>
            <span>上次手动导出: {lastManual ? formatRelative(new Date(lastManual).toISOString()) : <span className="text-amber-400">从未</span>}</span>
          </div>
        </div>

        {/* Manual export / import */}
        <div className="px-5 py-4 border-b border-gray-800 space-y-2.5">
          <button
            onClick={onExport}
            disabled={working}
            className="w-full px-3 py-2.5 rounded-lg bg-blue-700/40 hover:bg-blue-700/60 disabled:opacity-50 text-sm text-blue-200 border border-blue-700/50 transition-colors text-left flex items-center justify-between"
          >
            <span>📥 导出全部数据到文件</span>
            <span className="text-[11px] text-blue-300">.json</span>
          </button>
          <button
            onClick={handlePickFile}
            disabled={working}
            className="w-full px-3 py-2.5 rounded-lg bg-amber-900/30 hover:bg-amber-900/50 disabled:opacity-50 text-sm text-amber-200 border border-amber-800/50 transition-colors text-left flex items-center justify-between"
          >
            <span>📤 从文件恢复...</span>
            <span className="text-[11px] text-amber-300">会先自动备份现状</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleFileChange}
          />
          {progress && (
            <div className="text-xs text-gray-400 px-1">{progress}</div>
          )}
        </div>

        {/* Local backups list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Pre-destructive snapshots */}
          {preCount > 0 && (
            <Section
              title={`操作前快照（30 天保留 · ${preCount} 份）`}
              items={list.filter(b => b.type === 'pre')}
              onRestore={handleRestoreLocal}
              working={working}
              accent="text-rose-300"
            />
          )}
          {/* Auto backups */}
          <Section
            title={autoCount ? `自动备份（保留最近 7 份 · ${autoCount} 份）` : '自动备份'}
            items={list.filter(b => b.type === 'auto')}
            onRestore={handleRestoreLocal}
            working={working}
            accent="text-emerald-300"
            emptyText="还没有自动备份，应用启动 5 秒后会生成第一份"
          />
        </div>
      </div>
    </div>
  )
}

function Section({ title, items, onRestore, working, accent, emptyText }) {
  return (
    <div>
      <div className={`text-[11px] uppercase tracking-wider mb-1.5 ${accent}`}>{title}</div>
      {items.length === 0 && emptyText && (
        <div className="text-xs text-gray-600 px-1">{emptyText}</div>
      )}
      <div className="space-y-1.5">
        {items.map(b => {
          const meta = b.meta
          const when = meta?.exported_at ? formatRelative(meta.exported_at) : '—'
          const stats = meta?.stats || {}
          const counts = `${stats.nodes || 0} 节点`
          return (
            <div
              key={b.key}
              className="flex items-center justify-between px-3 py-2 bg-gray-800/40 hover:bg-gray-800/60 rounded-lg border border-gray-800 transition-colors"
            >
              <div className="min-w-0">
                <div className="text-xs text-gray-300">
                  {when}
                  {meta?.reason && meta.reason !== 'periodic' && (
                    <span className="text-[10px] text-gray-500 ml-2">· {meta.reason}</span>
                  )}
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  {counts}
                  {stats.conversations ? ` · ${stats.conversations} 条对话` : ''}
                </div>
              </div>
              <button
                onClick={() => onRestore(b.key, meta)}
                disabled={working}
                className="text-[11px] text-blue-300 hover:text-blue-200 disabled:opacity-50 px-2 py-1 rounded border border-blue-800/50 hover:border-blue-700"
              >
                恢复
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function formatRelative(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const min = Math.floor(diffMs / 60000)
  if (min < 1)  return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24)  return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 7)  return `${day} 天前`
  return d.toISOString().slice(0, 10)
}
