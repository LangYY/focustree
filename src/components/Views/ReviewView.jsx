import { BookOpen, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'

export default function ReviewView({ review, history = [], generating, onGenerate }) {
  const [selectedId, setSelectedId] = useState(null)
  useEffect(() => setSelectedId(null), [review?.id])
  const activeReview = history.find(item => item.id === selectedId) || review
  return (
    <section className="ft-review-view">
      <div className="ft-review-topline"><span className="ft-eyebrow">WEEKLY REVIEW</span><button type="button" className="ft-quiet-button" onClick={onGenerate} disabled={generating}><RefreshCw size={14} />{generating ? '生成中…' : '生成新回顾'}</button></div>
      <div className="ft-review-layout">
        <nav className="ft-review-history"><div className="ft-review-history-title">过去的回顾</div>{history.map(item => <button type="button" key={item.id || item.week_start} className={item.id === activeReview?.id ? 'is-active' : ''} onClick={() => setSelectedId(item.id)}>{item.week_start || '本周'}<span>{item.week_end || ''}</span></button>)}</nav>
        <article className="ft-review-paper">
          <div className="ft-review-icon"><BookOpen size={18} /></div>
          {activeReview ? <ReviewContent review={activeReview} /> : <div className="ft-review-empty"><Sparkles size={28} /><h1>还没有一份周回顾</h1><p>让它把过去七天的进展、模式和卡点慢慢整理出来。</p><button type="button" className="ft-primary-button" onClick={onGenerate} disabled={generating}>现在就生成</button></div>}
        </article>
      </div>
    </section>
  )
}

function ReviewContent({ review }) {
  const summary = review.parsed || review.summary || '这周还没有可读的回顾内容。'
  if (typeof summary !== 'string') return <pre className="ft-review-text">{JSON.stringify(summary, null, 2)}</pre>
  return <><span className="ft-review-period">{review.week_start || '最近七天'} — {review.week_end || '今天'}</span><div className="ft-review-text">{summary.split('\n').map((line, index) => line.trim() ? <p key={`${line}-${index}`} className={index === 0 ? 'is-opening' : ''}>{line}</p> : <br key={index} />)}</div></>
}
