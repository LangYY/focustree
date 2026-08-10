import { HelpCircle, PanelLeftClose } from 'lucide-react'
import { useState } from 'react'

const ITEMS = [
  { key: 'direct', title: '大小 · 辉光', description: '现在多值得做', example: <circle cx="12" cy="12" r="7" fill="var(--ft-accent)" /> },
  { key: 'branch', title: '枝干粗细', description: '这条路通向的意义', example: <path d="M2 20C10 14 12 10 22 4" stroke="var(--ft-accent)" strokeWidth="6" strokeLinecap="round" /> },
  { key: 'cultivation', title: '外圈年轮', description: '已经投入多少', example: <><circle cx="12" cy="12" r="5" fill="none" stroke="var(--ft-accent)" strokeWidth="1" /><circle cx="12" cy="12" r="9" fill="none" stroke="var(--ft-accent)" strokeWidth="1" /></> },
  { key: 'due', title: '期限外弧', description: '离截止日期有多近', example: <path d="M4 12a8 8 0 0 1 16 0" fill="none" stroke="var(--ft-warn)" strokeWidth="2" strokeLinecap="round" /> },
  { key: 'urgent', title: '芽尖', description: '你标了紧急', example: <path d="M12 3 16 10H8Z" fill="var(--ft-text-primary)" /> },
  { key: 'status', title: '形状', description: '空心暂停 · 对勾完成', example: <><circle cx="8" cy="12" r="4" fill="none" stroke="var(--ft-text-secondary)" strokeDasharray="2 2" /><path d="m14 12 2 2 4-5" fill="none" stroke="var(--ft-accent)" strokeWidth="1.5" strokeLinecap="round" /></> },
]

export default function Legend({ onHover }) {
  const [open, setOpen] = useState(() => localStorage.getItem('ft_legend') === 'open')
  const toggle = () => {
    setOpen(value => {
      const next = !value
      localStorage.setItem('ft_legend', next ? 'open' : 'closed')
      return next
    })
  }
  if (!open) return <button type="button" className="ft-legend-collapsed" onClick={toggle} aria-label="展开图例"><HelpCircle size={15} /></button>
  return (
    <section className="ft-legend" aria-label="树图例">
      <div className="ft-legend-head"><span>怎么读这棵树</span><button type="button" onClick={toggle} aria-label="收起图例"><PanelLeftClose size={14} /></button></div>
      <div className="ft-legend-list">
        {ITEMS.map(item => (
          <button type="button" className="ft-legend-row" key={item.key} onMouseEnter={() => onHover?.(item.key)} onMouseLeave={() => onHover?.(null)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">{item.example}</svg>
            <span><strong>{item.title}</strong><small>{item.description}</small></span>
          </button>
        ))}
      </div>
    </section>
  )
}
