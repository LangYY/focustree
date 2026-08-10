export const ONBOARDING_STEPS = Object.freeze({
  DECISION: 'decision',
  SPEAK: 'speak',
  WAITING: 'waiting',
  CONFIRM: 'confirm',
  WITNESS: 'witness',
  TODAY: 'today',
  RECOMMENDATION_WAITING: 'recommendation-waiting',
  CLOSING: 'closing',
})

export function createOnboardingState({ active = true, step = ONBOARDING_STEPS.DECISION } = {}) {
  return {
    active,
    step: active ? step : null,
    submittedText: '',
    proposalAttention: false,
  }
}

export function transitionOnboarding(state, event = {}) {
  const current = state || createOnboardingState()
  if (event.type === 'RESTART') return createOnboardingState()
  if (event.type === 'SKIP' || event.type === 'FINISH') {
    return { ...current, active: false, step: null, proposalAttention: false }
  }
  if (!current.active) return current

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
  return current
}

export function shouldStartOnboarding({ nodeCount = 0, onboarded = false } = {}) {
  return Number(nodeCount) === 0 && !onboarded
}
