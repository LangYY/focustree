import { useState } from 'react'

export default function Toolbar({
  density, onDensityChange,
  onExpandAll, onCollapseAll,
  chatOpen, onToggleChat,
  leafView, onToggleLeafView,
  onResetZoom,
  user, onSignOut,
  canUndo, canRedo, lastAction, nextAction, onUndo, onRedo,
  history, future,
  onOpenBackup, backupWarning,
}) {
  const [showHistory, setShowHistory] = useState(false)
  const [showFuture, setShowFuture] = useState(false)

  return (
    <div
      className="flex items-center justify-between px-4 border-b border-line bg-panel flex-shrink-0 relative"
      style={{ height: 44 }}
    >
      {/* 左：Logo */}
      <div className="flex items-center gap-3">
        <span className="font-display font-semibold text-[15px] text-ink tracking-[0.14em]">专注树</span>
      </div>

      {/* 中：视图控制 */}
      <div className="flex items-center gap-1">
        {!leafView && (
          <>
            <ViewBtn label="展开" onClick={onExpandAll} />
            <ViewBtn label="折叠" onClick={onCollapseAll} />
            <div className="w-px h-4 bg-line-strong mx-1" />
            <DensityBtn label="疏" value="sparse" current={density} onChange={onDensityChange} />
            <DensityBtn label="中" value="medium" current={density} onChange={onDensityChange} />
            <DensityBtn label="密" value="dense"  current={density} onChange={onDensityChange} />
            <div className="w-px h-4 bg-line-strong mx-1" />
            <ViewBtn label="全局" onClick={onResetZoom} />
          </>
        )}
        <button
          onClick={onToggleLeafView}
          className={`text-xs px-2 py-1 rounded-lg transition-colors border ${
            leafView ? 'bg-accent-soft border-accent/40 text-accent-strong' : 'border-line text-ink-faint hover:text-ink-soft'
          }`}
        >
          末端视图
        </button>
      </div>

      {/* 右：撤销 + 对话 + 用户 */}
      <div className="flex items-center gap-2">

        {/* 撤销按钮 */}
        <div className="relative">
          <button
            onClick={canUndo ? onUndo : undefined}
            onContextMenu={e => { e.preventDefault(); if (history?.length) setShowHistory(v => !v) }}
            disabled={!canUndo}
            title={canUndo ? `撤销：${lastAction}（Ctrl/Cmd+Z，右键查看历史）` : '没有可撤销的操作'}
            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border transition-colors ${
              canUndo
                ? 'border-line-strong text-ink-soft hover:bg-panel-soft cursor-pointer'
                : 'border-line text-ink-ghost cursor-not-allowed'
            }`}
          >
            <span>↩</span>
            {canUndo && lastAction && (
              <span className="max-w-32 truncate">{lastAction}</span>
            )}
            {!canUndo && <span>撤销</span>}
          </button>

          {/* 历史记录下拉 */}
          {showHistory && history?.length > 0 && (
            <HistoryPanel
              history={history}
              onClose={() => setShowHistory(false)}
              onUndo={() => { onUndo(); setShowHistory(false) }}
            />
          )}
        </div>

        {/* 前进按钮 */}
        <div className="relative">
          <button
            onClick={canRedo ? onRedo : undefined}
            onContextMenu={e => { e.preventDefault(); if (future?.length) setShowFuture(v => !v) }}
            disabled={!canRedo}
            title={canRedo ? `前进：${nextAction}（Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y，右键查看可前进操作）` : '没有可前进的操作'}
            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border transition-colors ${
              canRedo
                ? 'border-line-strong text-ink-soft hover:bg-panel-soft cursor-pointer'
                : 'border-line text-ink-ghost cursor-not-allowed'
            }`}
          >
            <span>↪</span>
            {canRedo && nextAction && (
              <span className="max-w-28 truncate">{nextAction}</span>
            )}
            {!canRedo && <span>前进</span>}
          </button>

          {showFuture && future?.length > 0 && (
            <HistoryPanel
              history={future}
              title="可前进"
              countLabel={`${future.length} 步可前进`}
              actionLabel="前进"
              onClose={() => setShowFuture(false)}
              onUndo={() => { onRedo(); setShowFuture(false) }}
            />
          )}
        </div>

        <div className="w-px h-4 bg-line-strong" />

        {/* 数据备份/恢复 */}
        {onOpenBackup && (
          <button
            onClick={onOpenBackup}
            title={backupWarning ? '⚠️ 建议尽快导出一份数据到文件' : '数据备份与恢复'}
            className={`text-xs px-2 py-1 rounded-lg border transition-colors relative ${
              backupWarning
                ? 'border-warn/50 text-warn hover:bg-warn-soft'
                : 'border-line text-ink-faint hover:text-ink hover:border-line-strong'
            }`}
          >
            数据
            {backupWarning && (
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-warn" />
            )}
          </button>
        )}

        <button
          onClick={onToggleChat}
          className={`text-xs px-3 py-1 rounded-lg transition-colors border ${
            chatOpen
              ? 'bg-accent border-accent-strong text-white'
              : 'border-line text-ink-faint hover:text-ink hover:border-line-strong'
          }`}
        >
          对话 {chatOpen ? '‹' : '›'}
        </button>

        {user && (
          <button
            onClick={onSignOut}
            title={user.email}
            className="text-xs text-ink-faint hover:text-ink-soft border border-line hover:border-line-strong px-2 py-1 rounded-lg transition-colors"
          >
            退出
          </button>
        )}
      </div>
    </div>
  )
}

// ── 历史记录面板 ─────────────────────────────────────

function HistoryPanel({ history, onClose, onUndo, title = '操作历史', countLabel, actionLabel = '撤销' }) {
  // 点击外部关闭
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full mt-1 z-50 bg-panel border border-line rounded-xl shadow-lift w-64 py-2">
        <div className="px-3 pb-2 border-b border-line flex items-center justify-between">
          <span className="text-xs font-semibold text-ink-soft">{title}</span>
          <span className="text-xs text-ink-ghost">{countLabel || `${history.length} 步可撤销`}</span>
        </div>
        <div className="max-h-60 overflow-y-auto">
          {[...history].reverse().map((entry, i) => (
            <div
              key={i}
              className={`px-3 py-2 text-xs flex items-center gap-2 ${
                i === 0 ? 'text-ink bg-panel-soft' : 'text-ink-faint'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${i === 0 ? 'bg-accent' : 'bg-line-strong'}`} />
              <span className="truncate">{entry.label}</span>
              {i === 0 && (
                <button
                  onClick={onUndo}
                  className="ml-auto text-accent hover:text-accent-strong flex-shrink-0"
                >
                  {actionLabel}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

// ── 小组件 ────────────────────────────────────────────

function ViewBtn({ label, onClick }) {
  return (
    <button onClick={onClick} className="text-xs text-ink-faint hover:text-ink px-2 py-1 rounded-lg hover:bg-panel-soft transition-colors">
      {label}
    </button>
  )
}
function DensityBtn({ label, value, current, onChange }) {
  return (
    <button onClick={() => onChange(value)} className={`text-xs px-2 py-1 rounded-lg transition-colors ${current === value ? 'bg-accent-soft text-accent-strong' : 'text-ink-faint hover:text-ink-soft'}`}>
      {label}
    </button>
  )
}
