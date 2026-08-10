import { GripVertical, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export default function Drawer({ open, onClose, children }) {
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
    const onUp = () => {
      resizing.current = false
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  return (
    <aside
      className={`ft-drawer ${open ? 'is-open' : ''}`}
      style={{ '--ft-current-drawer-w': `${width}px` }}
      role="complementary"
      aria-label="Focus Agent 对话面板"
      aria-hidden={!open}
    >
      <div
        className="ft-drawer-resize"
        onMouseDown={() => {
          resizing.current = true
          document.body.style.cursor = 'col-resize'
        }}
        onDoubleClick={() => setWidth(380)}
        aria-label="调整对话面板宽度"
      >
        <GripVertical size={14} />
      </div>
      <div className="ft-drawer-head">
        <span className="ft-drawer-head-spacer" />
        <button type="button" className="ft-drawer-close" onClick={onClose} aria-label="收起对话面板"><X size={16} /></button>
      </div>
      <div className="ft-drawer-content">
        {open ? children : null}
      </div>
    </aside>
  )
}
