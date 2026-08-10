import { ChevronDown, Database, Moon, Redo2, Sun, Undo2, UserRound } from 'lucide-react'
import { useState } from 'react'
import GoalChip from './GoalChip'
import Segmented from '../ui/Segmented'
import { branchColorAt } from '../../lib/branchPalette'

export default function TopBar({
  goal, goalText, goalExpired, onEditGoal,
  user, canUndo, canRedo, lastAction, nextAction, onUndo, onRedo,
  onOpenModal, backupWarning, themeMode, onThemeChange, onSignOut,
  onLoadExample, onClearAll, onRestartOnboarding,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const initial = String(user?.email || 'F').slice(0, 1).toUpperCase()
  return (
    <header className="ft-topbar">
      <div className="ft-brand-lockup">
        <BrandMark />
        <span>专注树</span>
        <span className="ft-brand-caption">FOCUSTREE</span>
      </div>

      <div className="ft-topbar-goal">
        <GoalChip goal={goal} goalText={goalText} expired={goalExpired} onEdit={onEditGoal} />
      </div>

      <div className="ft-topbar-actions">
        <div className="ft-history-segment" aria-label="编辑历史">
          <button type="button" onClick={canUndo ? onUndo : undefined} disabled={!canUndo} title={canUndo ? `撤销：${lastAction}` : '没有可撤销的操作'}>
            <Undo2 size={15} strokeWidth={1.7} />
            <span>{canUndo ? truncate(lastAction) : '撤销'}</span>
          </button>
          <button type="button" onClick={canRedo ? onRedo : undefined} disabled={!canRedo} title={canRedo ? `前进：${nextAction}` : '没有可前进的操作'}>
            <Redo2 size={15} strokeWidth={1.7} />
            <span>{canRedo ? truncate(nextAction) : '前进'}</span>
          </button>
        </div>

        <button type="button" className={`ft-backup-status ${backupWarning ? 'is-warning' : ''}`} onClick={() => onOpenModal?.('backup')} title={backupWarning ? '超过 7 天没有手动导出' : '数据备份'}>
          <span className="ft-status-dot" />
          <Database size={14} strokeWidth={1.7} />
          <span>数据</span>
        </button>

        <div className="ft-account-wrap">
          <button type="button" className="ft-avatar-button" onClick={() => setMenuOpen(open => !open)} aria-expanded={menuOpen}>
            <span className="ft-avatar" style={{ background: branchColorAt(hashEmail(user?.email), 'dark') }}>{initial}</span>
            <ChevronDown size={13} strokeWidth={1.7} aria-hidden="true" />
          </button>
          {menuOpen ? (
            <>
              <button type="button" className="ft-menu-scrim" aria-label="关闭账户菜单" onClick={() => setMenuOpen(false)} />
              <div className="ft-account-menu">
                <div className="ft-account-heading"><UserRound size={14} /><span>{user?.email || '当前账户'}</span></div>
                <div className="ft-menu-divider" />
                <div className="ft-menu-label">主题</div>
                <Segmented
                  className="ft-theme-segment"
                  ariaLabel="主题模式"
                  value={themeMode}
                  onChange={onThemeChange}
                  options={[
                    { value: 'dark', label: '深色', icon: Moon },
                    { value: 'light', label: '浅色', icon: Sun },
                    { value: 'system', label: '系统' },
                  ]}
                />
                <div className="ft-menu-divider" />
                <MenuItem label="AI 记忆" onClick={() => { onOpenModal?.('memory'); setMenuOpen(false) }} />
                <MenuItem label="推荐记录" onClick={() => { onOpenModal?.('recommendations'); setMenuOpen(false) }} />
                <MenuItem label="会话历史" onClick={() => { onOpenModal?.('history'); setMenuOpen(false) }} />
                <MenuItem label="数据备份" onClick={() => { onOpenModal?.('backup'); setMenuOpen(false) }} />
                <MenuItem label="整棵树审计" onClick={() => { onOpenModal?.('priorityAudit'); setMenuOpen(false) }} />
                <MenuItem label="重新看一遍引导" onClick={() => { onRestartOnboarding?.(); setMenuOpen(false) }} />
                <MenuItem label="载入示例数据" onClick={() => { onLoadExample?.(); setMenuOpen(false) }} />
                <MenuItem label="清空全部" tone="danger" onClick={() => { onClearAll?.(); setMenuOpen(false) }} />
                <div className="ft-menu-divider" />
                <MenuItem label="退出登录" tone="danger" onClick={onSignOut} />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </header>
  )
}

function MenuItem({ label, onClick, tone = 'default' }) {
  return <button type="button" className={`ft-menu-item is-${tone}`} onClick={onClick}>{label}</button>
}

function BrandMark() {
  return (
    <svg className="ft-brand-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20V5M12 10 6 5M12 13l6-5M12 16l-4-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="4" r="1.5" fill="currentColor" />
    </svg>
  )
}

function truncate(value) {
  const text = String(value || '')
  return text.length > 12 ? `${text.slice(0, 12)}…` : text
}

function hashEmail(email) {
  return [...String(email || '')].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % 9
}
