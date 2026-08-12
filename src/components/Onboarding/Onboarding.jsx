import { ArrowRight, ArrowLeft, Sparkles } from 'lucide-react'
import { ONBOARDING_STEPS, READING_CHANNELS } from '../../lib/onboarding.js'

const EXAMPLES = [
  '我在做一个 B 站频道，同时在找工作，还接了个外包',
  '手上三个项目同时推进，感觉哪个都没进展',
  '我想理清下个季度该把精力放哪',
]

// 三个视觉通道，和画布左下角的图例、DESIGN.md §7.1 保持同一套说法。
const CHANNELS = {
  size: {
    title: '圆点越大越亮，越值得现在做',
    body: '它综合了你标的优先级、期限远近，和这条线最近有没有在动。',
  },
  thickness: {
    title: '枝干越粗，这条路通向的意义越大',
    body: '一件小事如果通向你真正在乎的目标，它的枝干也会粗。',
  },
  rings: {
    title: '外圈年轮，是你已经投入了多少',
    body: '投入多不代表该继续。年轮和光晕分开看，才看得出哪条线在空转。',
  },
}

export function OnboardingWelcome({ onNext, onSkip }) {
  return (
    <div className="ft-onboarding-decision">
      <button type="button" className="ft-onboarding-skip" onClick={onSkip}>跳过</button>
      <div className="ft-onboarding-decision-content">
        <SeedlingMark />
        <p className="ft-onboarding-kicker">专注树</p>
        <h1>你同时在忙的那些事，正在抢同一份注意力。</h1>
        <p className="ft-onboarding-lede">
          把它们摊成一棵树，你就能看见哪条线在长、哪条线在空转，
          <br />
          然后每天只挑最值得做的几件去做。
        </p>
        <div className="ft-onboarding-choices">
          <button type="button" className="ft-onboarding-choice is-primary" onClick={onNext}>
            <span>看看怎么用</span>
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
        <p className="ft-onboarding-meta">大约一分钟</p>
      </div>
    </div>
  )
}

export function OnboardingReading({ channelIndex = 0, onNext, onBack, onSkip }) {
  const key = READING_CHANNELS[channelIndex] || READING_CHANNELS[0]
  const channel = CHANNELS[key]
  const isLast = channelIndex >= READING_CHANNELS.length - 1

  return (
    <div className="ft-onboarding-decision">
      <button type="button" className="ft-onboarding-skip" onClick={onSkip}>跳过</button>
      <div className="ft-onboarding-decision-content ft-onboarding-reading">
        <p className="ft-onboarding-kicker">怎么读这棵树</p>
        <ChannelDiagram channel={key} />
        <h2 className="ft-onboarding-channel-title">{channel.title}</h2>
        <p className="ft-onboarding-lede">{channel.body}</p>
        <div className="ft-onboarding-progress" role="presentation">
          {READING_CHANNELS.map((name, index) => (
            <span key={name} className={index === channelIndex ? 'is-active' : ''} />
          ))}
        </div>
        <div className="ft-onboarding-choices">
          <button type="button" className="ft-onboarding-choice ft-onboarding-back" onClick={onBack}>
            <ArrowLeft size={15} aria-hidden="true" />
            <span>上一步</span>
          </button>
          <button type="button" className="ft-onboarding-choice is-primary" onClick={onNext}>
            <span>{isLast ? '我大概懂了' : '下一个'}</span>
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}

export function OnboardingDecision({ onChooseReal, onChooseExample, onBack, onSkip, exampleLoading }) {
  return (
    <div className="ft-onboarding-decision">
      <button type="button" className="ft-onboarding-skip" onClick={onSkip}>跳过</button>
      <div className="ft-onboarding-decision-content">
        <h1>现在轮到你的事</h1>
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
        <button type="button" className="ft-onboarding-textlink" onClick={onBack}>上一步</button>
      </div>
    </div>
  )
}

export function OnboardingChatGuide({ step, onPrefill, onToday, onSkip, onBack }) {
  if (!step || step === ONBOARDING_STEPS.DECISION) return null
  if (step === ONBOARDING_STEPS.WELCOME || step === ONBOARDING_STEPS.READING) return null

  return (
    <div className="ft-onboarding-chat-guide" aria-live="polite">
      <button type="button" className="ft-onboarding-skip" onClick={onSkip}>跳过</button>
      {step === ONBOARDING_STEPS.SPEAK ? <SpeakGuide onPrefill={onPrefill} onBack={onBack} /> : null}
      {step === ONBOARDING_STEPS.WAITING ? <p className="ft-onboarding-guide-copy">我先把这些事拆成几条主线。</p> : null}
      {step === ONBOARDING_STEPS.RETRY ? <RetryGuide onPrefill={onPrefill} /> : null}
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

function SpeakGuide({ onPrefill, onBack }) {
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
      <button type="button" className="ft-onboarding-textlink" onClick={onBack}>上一步</button>
    </>
  )
}

// AI 没能给出提案时的出口。不解释失败原因，只给下一步动作。
function RetryGuide({ onPrefill }) {
  return (
    <>
      <p className="ft-onboarding-guide-copy">
        这次没能拆出主线。换一种说法通常就好了——把「在忙哪几件事」直接列出来最有效。
      </p>
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

// 讲解用的极简树，不读真实数据：新用户此刻还没有树，示例用户的树也不该被这层盖住。
function ChannelDiagram({ channel }) {
  return (
    <svg className="ft-onboarding-diagram" viewBox="0 0 260 108" role="img" aria-label={CHANNELS[channel].title}>
      <path d="M18,54 C70,54 78,26 128,26" className="ft-od-branch" strokeWidth={channel === 'thickness' ? 7 : 2.5} />
      <path d="M18,54 C70,54 78,82 128,82" className="ft-od-branch is-dim" strokeWidth={2.5} />
      <circle cx="18" cy="54" r="5" className="ft-od-root" />
      {channel === 'size' ? <circle cx="128" cy="26" r="21" className="ft-od-glow" /> : null}
      <circle cx="128" cy="26" r={channel === 'size' ? 12 : 8} className="ft-od-node" />
      {channel === 'rings' ? <circle cx="128" cy="26" r="14.5" className="ft-od-ring" /> : null}
      {channel === 'rings' ? <circle cx="128" cy="26" r="18" className="ft-od-ring is-faint" /> : null}
      <circle cx="128" cy="82" r="7" className="ft-od-node is-dim" />
    </svg>
  )
}

function SeedlingMark() {
  return (
    <svg className="ft-onboarding-seedling" viewBox="0 0 64 64" role="img" aria-label="一株嫩芽">
      <path d="M32,58 L32,30" />
      <path d="M32,34 C32,22 22,18 14,18 C14,28 22,34 32,34 Z" />
      <path d="M32,40 C32,30 41,26 49,26 C49,35 41,40 32,40 Z" />
    </svg>
  )
}
