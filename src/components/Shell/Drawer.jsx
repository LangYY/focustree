import { GripVertical, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Inbox, MessageSquare, Activity, PanelRight, UserRound } from 'lucide-react'

const FIXED_TABS = [
  { value: 'chat', label: '对话', icon: MessageSquare, shortcut: 'C' },
  { value: 'inbox', label: '待确认', icon: Inbox, shortcut: 'I' },
  { value: 'detail', label: '详情', icon: UserRound, shortcut: 'D' },
  { value: 'audit', label: '审计', icon: Activity, shortcut: 'A' },
]

export default function Drawer({ activeTab, onTabChange, onClose, hasSelection, pendingCount, temporaryTabs = [], renderTab }) {
  const [width, setWidth] = useState(() => Number(localStorage.getItem('ft_drawer_w')) || 380)
  const resizing = useRef(false)

  useEffect(() => {
    localStorage.setItem('ft_drawer_w', String(width))
  }, [width])

  useEffect(() => {
    const onMove = event => {
      if (!resizing.current) return
      setWidth(Math.max(320, Math.min(560, window.innerWidth - event.clientX)))
    }
    const onUp = () => { resizing.current = false; document.body.style.cursor = '' }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const tabItems = [...FIXED_TABS, ...temporaryTabs]
  const open = Boolean(activeTab)
  return (
    <aside className={`ft-drawer ${open ? 'is-open' : ''}`} style={{ '--ft-current-drawer-w': `${width}px` }} role="complementary" aria-label="专注树侧边抽屉">
      <div className="ft-drawer-resize" onMouseDown={() => { resizing.current = true; document.body.style.cursor = 'col-resize' }} onDoubleClick={() => setWidth(380)} aria-label="调整抽屉宽度"><GripVertical size={14} /></div>
      <div className="ft-drawer-head">
        <div className="ft-drawer-tabs" role="tablist" aria-label="抽屉面板">
          {tabItems.map(tab => {
            const Icon = tab.icon || PanelRight
            const disabled = tab.value === 'detail' && !hasSelection
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                id={`ft-drawer-tab-${tab.value}`}
                aria-selected={activeTab === tab.value}
                aria-controls="ft-drawer-panel"
                disabled={disabled}
                className={`${activeTab === tab.value ? 'is-active' : ''} ${disabled ? 'is-disabled' : ''}`}
                onClick={() => onTabChange(activeTab === tab.value ? null : tab.value)}
                title={`${tab.label} · ${tab.shortcut || ''}`}
              >
                <Icon size={14} strokeWidth={1.7} />
                <span>{tab.label}</span>
                {tab.value === 'inbox' && pendingCount > 0 ? <em>{pendingCount > 9 ? '9+' : pendingCount}</em> : null}
                {tab.temporary ? <X size={12} onClick={event => { event.stopPropagation(); tab.onClose?.() }} /> : null}
              </button>
            )
          })}
        </div>
        <button type="button" className="ft-drawer-close" onClick={onClose} aria-label="收起抽屉"><X size={16} /></button>
      </div>
      <div
        id="ft-drawer-panel"
        className="ft-drawer-content"
        role="tabpanel"
        aria-labelledby={activeTab ? `ft-drawer-tab-${activeTab}` : undefined}
      >
        {open ? renderTab?.(activeTab) : <div className="ft-drawer-placeholder"><PanelRight size={28} /><span>从左侧选择一个面板</span></div>}
      </div>
    </aside>
  )
}
