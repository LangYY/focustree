import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createOnboardingState,
  ONBOARDING_STEPS,
  shouldStartOnboarding,
  transitionOnboarding,
} from '../lib/onboarding.js'

export const ONBOARDING_STORAGE_KEY = 'ft_onboarded'

export function useOnboarding({ user, treeData, treeLoading, messages = [], onLoadExample, onOpenChat, fitToView }) {
  const [state, setState] = useState(() => createOnboardingState({ active: false }))
  const [exampleLoading, setExampleLoading] = useState(false)
  const initializedUserRef = useRef(null)
  const messageCursorRef = useRef(0)

  useEffect(() => {
    if (!user?.id) {
      initializedUserRef.current = null
      setState(createOnboardingState({ active: false }))
      return
    }
    if (treeLoading || initializedUserRef.current === user.id) return

    initializedUserRef.current = user.id
    const nodeCount = countTreeNodes(treeData)
    const onboarded = Boolean(localStorage.getItem(ONBOARDING_STORAGE_KEY))
    setState(shouldStartOnboarding({ nodeCount, onboarded }) ? createOnboardingState() : createOnboardingState({ active: false }))
  }, [treeData, treeLoading, user?.id])

  useEffect(() => {
    if (!state.active || state.step === ONBOARDING_STEPS.CLOSING) return undefined
    const cursor = messageCursorRef.current
    const nextMessage = messages.slice(cursor).find(message => message?.role === 'assistant' && message.id !== 'welcome')
    if (!nextMessage) return undefined

    if (state.step === ONBOARDING_STEPS.WAITING && hasProposal(nextMessage)) {
      setState(current => transitionOnboarding(current, { type: 'RESPONSE_READY' }))
    }
    if (state.step === ONBOARDING_STEPS.RECOMMENDATION_WAITING) {
      setState(current => transitionOnboarding(current, { type: 'RECOMMENDATION_READY' }))
    }
    return undefined
  }, [messages, state.active, state.step])

  useEffect(() => {
    if (!state.active || state.step !== ONBOARDING_STEPS.CLOSING) return undefined
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '1')
    const timer = window.setTimeout(() => {
      setState(current => transitionOnboarding(current, { type: 'FINISH' }))
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [state.active, state.step])

  const dispatch = useCallback(event => {
    setState(current => transitionOnboarding(current, event))
  }, [])

  const skip = useCallback(() => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '1')
    dispatch({ type: 'SKIP' })
  }, [dispatch])

  const restart = useCallback(() => {
    messageCursorRef.current = messages.length
    dispatch({ type: 'RESTART' })
  }, [dispatch, messages.length])

  const chooseReal = useCallback(() => {
    dispatch({ type: 'CHOOSE_REAL' })
    onOpenChat?.()
  }, [dispatch, onOpenChat])

  const chooseExample = useCallback(async () => {
    if (exampleLoading) return
    setExampleLoading(true)
    try {
      const loaded = await onLoadExample?.()
      const shouldAdvance = state.active && state.step === ONBOARDING_STEPS.DECISION
      if (loaded && shouldAdvance) {
        dispatch({ type: 'CHOOSE_EXAMPLE' })
        onOpenChat?.()
      }
    } finally {
      setExampleLoading(false)
    }
  }, [dispatch, exampleLoading, onLoadExample, onOpenChat, state.active, state.step])

  const submitUserInput = useCallback(text => {
    if (state.step !== ONBOARDING_STEPS.SPEAK) return
    messageCursorRef.current = messages.length
    dispatch({ type: 'SUBMIT_INPUT', text })
  }, [dispatch, messages.length, state.step])

  const sendTodayQuestion = useCallback(() => {
    if (state.step !== ONBOARDING_STEPS.TODAY) return
    messageCursorRef.current = messages.length
    dispatch({ type: 'TODAY_SENT' })
  }, [dispatch, messages.length, state.step])

  const applyAll = useCallback(() => {
    if (state.step !== ONBOARDING_STEPS.CONFIRM) return
    dispatch({ type: 'APPLY_ALL' })
    const witnessDuration = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 80 : 900
    window.setTimeout(() => {
      fitToView?.()
      window.setTimeout(() => dispatch({ type: 'FIT_COMPLETE' }), witnessDuration)
    }, 80)
  }, [dispatch, fitToView, state.step])

  return {
    ...state,
    exampleLoading,
    chooseReal,
    chooseExample,
    submitUserInput,
    sendTodayQuestion,
    applyAll,
    skip,
    restart,
  }
}

function countTreeNodes(tree) {
  if (!tree) return 0
  return (tree.children || []).reduce((count, node) => count + 1 + countTreeNodes(node), 0)
}

function hasProposal(message) {
  const thinking = message?.thinking
  return Boolean(
    thinking?.goal_analysis ||
    thinking?.draft_actions?.length ||
    thinking?.proposed_panel_changes?.length ||
    thinking?.node_priority_proposals?.length,
  )
}
