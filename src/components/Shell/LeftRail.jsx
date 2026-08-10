import { BookOpen, ListChecks, MessageSquare, Moon, Network, Sun } from 'lucide-react'
import IconButton from '../ui/IconButton'

export default function LeftRail({ mode, onModeChange, drawerOpen, onToggleDrawer, themeMode, onThemeChange, onAccount }) {
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
        <RailButton label="对话" shortcut="C" icon={MessageSquare} active={drawerOpen} onClick={onToggleDrawer} />
      </div>
      <div className="ft-rail-bottom">
        <IconButton icon={themeMode === 'light' ? Sun : Moon} label={themeMode === 'light' ? '切换深色主题' : '切换浅色主题'} onClick={() => onThemeChange(themeMode === 'light' ? 'dark' : 'light')} />
        <button type="button" className="ft-rail-avatar" onClick={onAccount} aria-label="账户菜单"><span aria-hidden="true">F</span></button>
      </div>
    </aside>
  )
}

function RailButton({ icon: Icon, label, shortcut, active, onClick }) {
  return (
    <div className="ft-rail-button-wrap">
      <IconButton icon={Icon} label={`${label} · ${shortcut}`} active={active} onClick={onClick} />
      <span className="ft-rail-tooltip">{label}<kbd>{shortcut}</kbd></span>
    </div>
  )
}
