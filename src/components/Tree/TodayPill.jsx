import { Check, Clock3, Pin, PinOff, Sun, X } from 'lucide-react'
import { useState } from 'react'

export default function TodayPill({ focus, loading, generating, onGenerate, onToggle, onRemove, onHoverNode }) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const tasks = Array.isArray(focus?.tasks) ? focus.tasks : []
  const done = tasks.filter(task => task.done).length
  const label = loading ? '正在读取今天的聚焦' : tasks.length ? `今天 ${tasks.length} 件事 · 已完成 ${done}` : '生成今天的 3 件事'
  return (
    <div className={`ft-today-wrap ${open ? 'is-open' : ''}`} onMouseDown={event => event.stopPropagation()}>
      <button type="button" className={`ft-today-pill ${done === tasks.length && tasks.length ? 'is-complete' : ''}`} onClick={() => setOpen(value => !value)} disabled={loading}>
        <Sun size={15} strokeWidth={1.7} />
        <span>{label}</span>
        {generating ? <span className="ft-today-spinner" /> : null}
      </button>
      {open ? (
        <div className="ft-today-card">
          <div className="ft-today-head">
            <div><span className="ft-eyebrow">TODAY</span><h2>今天从这里开始</h2></div>
            <div className="ft-today-head-actions">
              <button type="button" onClick={() => setPinned(value => !value)} title={pinned ? '取消钉住' : '钉住'}>{pinned ? <PinOff size={14} /> : <Pin size={14} />}</button>
              <button type="button" onClick={() => setOpen(false)} aria-label="收起今日聚焦"><X size={14} /></button>
            </div>
          </div>
          {!tasks.length ? (
            <div className="ft-today-empty"><Clock3 size={17} /><span>还没有今天的清单。</span><button type="button" onClick={onGenerate} disabled={generating}>{generating ? '生成中…' : '生成 3 件事'}</button></div>
          ) : (
            <div className="ft-today-tasks">
              {tasks.map((task, index) => (
                <div key={`${task.node_id || task.name}-${index}`} className={`ft-today-task ${task.done ? 'is-done' : ''}`} onMouseEnter={() => onHoverNode?.(task.node_id)} onMouseLeave={() => onHoverNode?.(null)}>
                  <button type="button" className="ft-task-check" onClick={() => onToggle?.(index)} aria-label={task.done ? '标记未完成' : '标记完成'}>{task.done ? <Check size={13} /> : null}</button>
                  <span className="ft-task-copy"><strong>{task.name || '未命名任务'}</strong><small>{task.why || task.reason || '从你的当前阶段目标中挑出的下一步。'}</small></span>
                  <button type="button" className="ft-task-remove" onClick={() => onRemove?.(index)} aria-label="移除任务"><X size={13} /></button>
                </div>
              ))}
            </div>
          )}
          {tasks.length ? <button type="button" className="ft-today-regenerate" onClick={onGenerate} disabled={generating}>{generating ? '生成中…' : '重新生成'}</button> : null}
        </div>
      ) : null}
      {pinned && open ? <span className="ft-today-pin-note">已钉住</span> : null}
    </div>
  )
}
