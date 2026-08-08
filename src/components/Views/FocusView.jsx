import { CheckCircle2, Compass, RefreshCw, TreePine } from 'lucide-react'

export default function FocusView({ focus, generating, onGenerate, onToggle, onGoTree }) {
  const tasks = Array.isArray(focus?.tasks) ? focus.tasks : []
  const done = tasks.filter(task => task.done).length
  return (
    <section className="ft-focus-view">
      <div className="ft-focus-head">
        <span className="ft-eyebrow">TODAY / {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</span>
        <h1>{tasks.length ? (done >= tasks.length ? '今天收得很好。' : '今天从这里开始。') : '早上好，今天从这里开始'}</h1>
        <p>{tasks.length ? '只保留眼前的一步，剩下的交给树。' : '让 AI 从你的树里挑出三件值得现在动手的事。'}</p>
      </div>
      {!tasks.length ? (
        <div className="ft-focus-empty"><Compass size={30} /><button type="button" className="ft-primary-button" onClick={onGenerate} disabled={generating}>{generating ? '正在生成…' : '生成今天的 3 件事'}</button><span>不会自动消耗 token，点击后才会生成。</span></div>
      ) : (
        <>
          <div className="ft-focus-list">
            {tasks.map((task, index) => <FocusTask key={`${task.node_id || task.name}-${index}`} task={task} onToggle={() => onToggle?.(index)} />)}
          </div>
          <div className="ft-focus-footer">
            <span className="ft-mono">已完成 {done} / {tasks.length}</span>
            <div><button type="button" className="ft-quiet-button" onClick={onGenerate} disabled={generating}><RefreshCw size={14} />重新生成</button><button type="button" className="ft-quiet-button" onClick={onGoTree}><TreePine size={14} />去看树</button></div>
          </div>
        </>
      )}
    </section>
  )
}

function FocusTask({ task, onToggle }) {
  return (
    <article className={`ft-focus-task ${task.done ? 'is-done' : ''}`}>
      <div className="ft-focus-task-copy"><span className="ft-focus-time">{task.time_of_day || task.time || '任意'}</span><h2>{task.name || '未命名任务'}</h2><p>{task.why || task.reason || '这是当前阶段最值得推进的一步。'}</p></div>
      <button type="button" className="ft-focus-check" onClick={onToggle} aria-label={task.done ? '标记未完成' : '标记完成'}>{task.done ? <CheckCircle2 size={31} /> : <span />}</button>
    </article>
  )
}
