import { ArrowRight, Sparkles } from 'lucide-react'
import { ONBOARDING_STEPS } from '../../lib/onboarding.js'

const EXAMPLES = [
  '我在做一个 B 站频道，同时在找工作，还接了个外包',
  '手上三个项目同时推进，感觉哪个都没进展',
  '我想理清下个季度该把精力放哪',
]

export function OnboardingDecision({ onChooseReal, onChooseExample, onSkip, exampleLoading }) {
  return (
    <div className="ft-onboarding-decision">
      <button type="button" className="ft-onboarding-skip" onClick={onSkip}>跳过</button>
      <div className="ft-onboarding-decision-content">
        <p className="ft-onboarding-kicker">先从一件事开始</p>
        <h1>把现在脑子里的事，放到一棵树上。</h1>
        <div className="ft-onboarding-choices">
          <button type="button" className="ft-onboarding-choice is-primary" onClick={onChooseReal}>
            <span>说说我在忙什么</span>
            <ArrowRight size={16} aria-hidden="true" />
          </button>
          <button type="button" className="ft-onboarding-choice" onClick={onChooseExample} disabled={exampleLoading}>
            <span>{exampleLoading ? '正在长出示例树…' : '先看个示例'}</span>
            <Sparkles size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}

export function OnboardingChatGuide({ step, onPrefill, onToday, onSkip }) {
  if (!step || step === ONBOARDING_STEPS.DECISION) return null

  return (
    <div className="ft-onboarding-chat-guide" aria-live="polite">
      <button type="button" className="ft-onboarding-skip" onClick={onSkip}>跳过</button>
      {step === ONBOARDING_STEPS.SPEAK ? <SpeakGuide onPrefill={onPrefill} /> : null}
      {step === ONBOARDING_STEPS.WAITING ? <p className="ft-onboarding-guide-copy">我先把这些事拆成几条主线。</p> : null}
      {step === ONBOARDING_STEPS.CONFIRM ? (
        <p className="ft-onboarding-proposal-note">确认后，它们就会长到左边的树上。</p>
      ) : null}
      {step === ONBOARDING_STEPS.WITNESS ? <p className="ft-onboarding-guide-copy">看，树正在长出来。</p> : null}
      {step === ONBOARDING_STEPS.TODAY ? (
        <button type="button" className="ft-onboarding-today-action" onClick={onToday}>
          <span className="ft-onboarding-today-dot" />
          <span>问问今天该做什么</span>
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      ) : null}
      {step === ONBOARDING_STEPS.RECOMMENDATION_WAITING ? <p className="ft-onboarding-guide-copy">我来替你挑今天最值得做的三件事。</p> : null}
      {step === ONBOARDING_STEPS.CLOSING ? <p className="ft-onboarding-closing">从这里开始，今天就有下一步了。</p> : null}
    </div>
  )
}

function SpeakGuide({ onPrefill }) {
  return (
    <>
      <p className="ft-onboarding-guide-copy">先说说你最近同时在忙哪些事？一股脑说出来就行，不用组织语言。</p>
      <div className="ft-onboarding-examples">
        {EXAMPLES.map(example => (
          <button type="button" key={example} onClick={() => onPrefill?.(example)}>
            {example}
          </button>
        ))}
      </div>
    </>
  )
}
