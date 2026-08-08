import { Activity, BookOpen, Inbox, ListChecks, MessageSquare, Moon, Network, Sun, Zap } from 'lucide-react'
import IconButton from '../ui/IconButton'

export default function LeftRail({ mode, onModeChange, drawerTab, onDrawerTab, pendingCount, themeMode, onThemeChange, onAccount }) {
  const modes = [
    { value: 'tree', label: '结构', shortcut: '1', icon: Network },
    { value: 'focus', label: '聚焦', shortcut: '2', icon: Sun },
    { value: 'list', label: '清单', shortcut: '3', icon: ListChecks },
    { value: 'review', label: '回顾', shortcut: '4', icon: BookOpen },
  ]
  return (
    <aside className="ft-left-rail" aria-label="主导航">
      <div className="ft-rail-group">
        {modes.map(item => (
          <RailButton key={item.value} {...item} active={mode === item.value} onClick={() => onModeChange(item.value)} />
        ))}
      </div>
      <div className="ft-rail-divider" />
      <div className="ft-rail-group">
        <RailButton label="对话" shortcut="C" icon={MessageSquare} active={drawerTab === 'chat'} onClick={() => onDrawerTab('chat')} />
        <RailButton label="待确认" shortcut="I" icon={Inbox} active={drawerTab === 'inbox'} badge={pendingCount} onClick={() => onDrawerTab('inbox')} />
        <RailButton label="审计" shortcut="A" icon={Activity} active={drawerTab === 'audit'} onClick={() => onDrawerTab('audit')} />
      </div>
      <div className="ft-rail-bottom">
        <IconButton icon={themeMode === 'light' ? Sun : Moon} label={themeMode === 'light' ? '切换深色主题' : '切换浅色主题'} onClick={() => onThemeChange(themeMode === 'light' ? 'dark' : 'light')} />
        <button type="button" className="ft-rail-avatar" onClick={onAccount} aria-label="账户菜单"><Zap size={16} strokeWidth={1.8} /></button>
      </div>
    </aside>
  )
}

function RailButton({ icon: Icon, label, shortcut, active, badge, onClick }) {
  return (
    <div className="ft-rail-button-wrap">
      <IconButton icon={Icon} label={`${label} · ${shortcut}`} active={active} badge={badge} onClick={onClick} />
      <span className="ft-rail-tooltip">{label}<kbd>{shortcut}</kbd></span>
    </div>
  )
}
