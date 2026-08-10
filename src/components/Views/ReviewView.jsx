import { BookOpen, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatReviewContent } from './reviewFormat.js'

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
  const content = formatReviewContent(review)
  const hasContent = content.opening || content.wins.length || content.patterns.length || content.challenges.length || content.proposals.length || content.closing

  return <>
    <span className="ft-review-period">{review.week_start || '最近七天'} — {review.week_end || '今天'}</span>
    <div className="ft-review-content">
      {content.opening ? <p className="ft-review-opening">{content.opening}</p> : null}
      <ReviewSection title="WINS" items={content.wins} />
      <ReviewSection title="PATTERNS" items={content.patterns} />
      <ReviewSection title="CHALLENGES" items={content.challenges} />
      <ReviewSection title="PROPOSALS" proposals={content.proposals} />
      {content.closing ? <p className="ft-review-closing">{content.closing}</p> : null}
      {!hasContent ? <p className="ft-review-empty-copy">这周还没有可读的回顾内容。</p> : null}
    </div>
  </>
}

function ReviewSection({ title, items = [], proposals }) {
  const content = proposals || items
  if (!content.length) return null

  return <section className="ft-review-section">
    <h2 className="ft-review-section-title">{title}</h2>
    <div className="ft-review-section-body">
      {proposals
        ? proposals.map((proposal, index) => <div className="ft-review-proposal" key={`${proposal.action}-${index}`}><p>{proposal.action}</p>{proposal.rationale ? <p className="ft-review-rationale">{proposal.rationale}</p> : null}</div>)
        : items.map((item, index) => <p key={`${item}-${index}`}>{item}</p>)}
    </div>
  </section>
}
