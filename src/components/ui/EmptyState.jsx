import { Sparkles } from 'lucide-react'

export function SeedIllustration({ className = '' }) {
  return (
    <svg className={`ft-seed-illustration ${className}`} viewBox="0 0 120 120" role="img" aria-label="嫩芽">
      <path d="M60 104V60" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M60 70C42 68 29 56 31 37c18 1 31 12 29 33Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M60 58C67 38 82 27 101 28c0 19-13 31-41 31Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M51 104h18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M45 103c3-7 9-10 15-10s12 3 15 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export default function EmptyState({ title = '先说说你在忙什么', description = '把脑子里的事一股脑说出来，我帮你分成主线。', examples = [], onExample }) {
  return (
    <div className="ft-empty-state">
      <SeedIllustration />
      <h1>{title}</h1>
      <p>{description}</p>
      {examples.length > 0 ? (
        <div className="ft-empty-examples">
          {examples.map(example => (
            <button type="button" key={example} onClick={() => onExample?.(example)}>
              <Sparkles size={13} strokeWidth={1.6} aria-hidden="true" />
              {example}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
