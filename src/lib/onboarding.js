export const ONBOARDING_STEPS = Object.freeze({
  // 先回答「这是什么、我为什么要用」，再谈让用户输入。
  WELCOME: 'welcome',
  // 三个视觉通道不解释没人能读懂，这一步专门讲怎么看这棵树。
  READING: 'reading',
  DECISION: 'decision',
  SPEAK: 'speak',
  WAITING: 'waiting',
  // AI 没给出提案时的出口，避免永远停在 WAITING。
  RETRY: 'retry',
  CONFIRM: 'confirm',
  WITNESS: 'witness',
  TODAY: 'today',
  RECOMMENDATION_WAITING: 'recommendation-waiting',
  CLOSING: 'closing',
})

// READING 一次讲一个通道，讲完三个才进入下一步。
export const READING_CHANNELS = Object.freeze(['size', 'thickness', 'rings'])

export function createOnboardingState({ active = true, step = ONBOARDING_STEPS.WELCOME } = {}) {
  return {
    active,
    step: active ? step : null,
    channelIndex: 0,
    submittedText: '',
    proposalAttention: false,
  }
}

// 每一步能退回到哪里。没列出的步骤不可退——已经写库或已经发出请求的，退回去没有意义。
const BACK_TARGETS = Object.freeze({
  [ONBOARDING_STEPS.READING]: ONBOARDING_STEPS.WELCOME,
  [ONBOARDING_STEPS.DECISION]: ONBOARDING_STEPS.READING,
  [ONBOARDING_STEPS.SPEAK]: ONBOARDING_STEPS.DECISION,
  [ONBOARDING_STEPS.RETRY]: ONBOARDING_STEPS.SPEAK,
})

export function canGoBack(state) {
  const step = state?.step
  if (!state?.active || !step) return false
  if (step === ONBOARDING_STEPS.READING && (state.channelIndex || 0) > 0) return true
  return Boolean(BACK_TARGETS[step])
}

export function transitionOnboarding(state, event = {}) {
  const current = state || createOnboardingState()
  if (event.type === 'RESTART') return createOnboardingState()
  if (event.type === 'SKIP' || event.type === 'FINISH') {
    return { ...current, active: false, step: null, proposalAttention: false }
  }
  if (!current.active) return current

  if (event.type === 'BACK') {
    if (current.step === ONBOARDING_STEPS.READING && (current.channelIndex || 0) > 0) {
      return { ...current, channelIndex: current.channelIndex - 1 }
    }
    const target = BACK_TARGETS[current.step]
    if (!target) return current
    return { ...current, step: target, proposalAttention: false }
  }

  if (current.step === ONBOARDING_STEPS.WELCOME && event.type === 'NEXT') {
    return { ...current, step: ONBOARDING_STEPS.READING, channelIndex: 0 }
  }
  if (current.step === ONBOARDING_STEPS.READING && event.type === 'NEXT') {
    const next = (current.channelIndex || 0) + 1
    if (next < READING_CHANNELS.length) return { ...current, channelIndex: next }
    return { ...current, step: ONBOARDING_STEPS.DECISION }
  }

  if (current.step === ONBOARDING_STEPS.DECISION && event.type === 'CHOOSE_REAL') {
    return { ...current, step: ONBOARDING_STEPS.SPEAK }
  }
  if (current.step === ONBOARDING_STEPS.DECISION && event.type === 'CHOOSE_EXAMPLE') {
    return { ...current, step: ONBOARDING_STEPS.TODAY }
  }
  if (current.step === ONBOARDING_STEPS.SPEAK && event.type === 'SUBMIT_INPUT') {
    return {
      ...current,
      step: ONBOARDING_STEPS.WAITING,
      submittedText: String(event.text || '').trim(),
      proposalAttention: false,
    }
  }
  if (current.step === ONBOARDING_STEPS.WAITING && event.type === 'RESPONSE_READY') {
    return { ...current, step: ONBOARDING_STEPS.CONFIRM, proposalAttention: true }
  }
  // AI 回了但没有提案，或者等太久：给一个能自己走出去的状态，而不是卡死。
  if (current.step === ONBOARDING_STEPS.WAITING && event.type === 'RESPONSE_WITHOUT_PROPOSAL') {
    return { ...current, step: ONBOARDING_STEPS.RETRY }
  }
  if (current.step === ONBOARDING_STEPS.WAITING && event.type === 'TIMEOUT') {
    return { ...current, step: ONBOARDING_STEPS.RETRY }
  }
  // 卡住之后 AI 又补上了提案，仍然接得回主线。
  if (current.step === ONBOARDING_STEPS.RETRY && event.type === 'RESPONSE_READY') {
    return { ...current, step: ONBOARDING_STEPS.CONFIRM, proposalAttention: true }
  }
  if (current.step === ONBOARDING_STEPS.RETRY && event.type === 'SUBMIT_INPUT') {
    return {
      ...current,
      step: ONBOARDING_STEPS.WAITING,
      submittedText: String(event.text || '').trim(),
      proposalAttention: false,
    }
  }
  if (current.step === ONBOARDING_STEPS.CONFIRM && event.type === 'APPLY_ALL') {
    return { ...current, step: ONBOARDING_STEPS.WITNESS, proposalAttention: false }
  }
  if (current.step === ONBOARDING_STEPS.WITNESS && event.type === 'FIT_COMPLETE') {
    return { ...current, step: ONBOARDING_STEPS.TODAY }
  }
  if (current.step === ONBOARDING_STEPS.TODAY && event.type === 'TODAY_SENT') {
    return { ...current, step: ONBOARDING_STEPS.RECOMMENDATION_WAITING }
  }
  if (current.step === ONBOARDING_STEPS.RECOMMENDATION_WAITING && event.type === 'RECOMMENDATION_READY') {
    return { ...current, step: ONBOARDING_STEPS.CLOSING }
  }
  // 推荐迟迟不来也要能收尾，否则最后一步同样会卡住。
  if (current.step === ONBOARDING_STEPS.RECOMMENDATION_WAITING && event.type === 'TIMEOUT') {
    return { ...current, step: ONBOARDING_STEPS.CLOSING }
  }
  return current
}

export function shouldStartOnboarding({ nodeCount = 0, onboarded = false } = {}) {
  return Number(nodeCount) === 0 && !onboarded
}
