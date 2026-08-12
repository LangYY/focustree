import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildExampleNodes, EXAMPLE_GOAL } from '../src/lib/exampleData.js'
import { ONBOARDING_STEPS, canGoBack, createOnboardingState, shouldStartOnboarding, transitionOnboarding } from '../src/lib/onboarding.js'
import { flatToTree, getDerivedWeightMeta, getDerivedWeightMetaMap } from '../src/lib/treeUtils.js'

test('starts the onboarding decision only for an empty, uncompleted account', () => {
  assert.equal(shouldStartOnboarding({ nodeCount: 0, onboarded: false }), true)
  assert.equal(shouldStartOnboarding({ nodeCount: 2, onboarded: false }), false)
  assert.equal(shouldStartOnboarding({ nodeCount: 0, onboarded: true }), false)
  assert.equal(ONBOARDING_STEPS.DECISION, 'decision')
})

// 先说清楚产品是干什么的、树怎么读，再让用户输入。
test('opens by explaining the product before asking for any input', () => {
  const start = createOnboardingState()
  assert.equal(start.step, ONBOARDING_STEPS.WELCOME)

  const reading = transitionOnboarding(start, { type: 'NEXT' })
  assert.equal(reading.step, ONBOARDING_STEPS.READING)
  assert.equal(reading.channelIndex, 0)

  // 三个通道逐个讲完才进入选择。
  const second = transitionOnboarding(reading, { type: 'NEXT' })
  const third = transitionOnboarding(second, { type: 'NEXT' })
  assert.deepEqual([second.step, second.channelIndex], [ONBOARDING_STEPS.READING, 1])
  assert.deepEqual([third.step, third.channelIndex], [ONBOARDING_STEPS.READING, 2])

  const decision = transitionOnboarding(third, { type: 'NEXT' })
  assert.equal(decision.step, ONBOARDING_STEPS.DECISION)
})

test('can step back through the explanation, including channel by channel', () => {
  const reading = transitionOnboarding(createOnboardingState(), { type: 'NEXT' })
  const second = transitionOnboarding(reading, { type: 'NEXT' })

  assert.equal(canGoBack(second), true)
  const backToFirst = transitionOnboarding(second, { type: 'BACK' })
  assert.deepEqual([backToFirst.step, backToFirst.channelIndex], [ONBOARDING_STEPS.READING, 0])

  const backToWelcome = transitionOnboarding(backToFirst, { type: 'BACK' })
  assert.equal(backToWelcome.step, ONBOARDING_STEPS.WELCOME)
  assert.equal(canGoBack(backToWelcome), false)
})

test('walks the real-input path through proposal confirmation and today recommendation', () => {
  const decision = transitionOnboarding(
    transitionOnboarding(
      transitionOnboarding(transitionOnboarding(createOnboardingState(), { type: 'NEXT' }), { type: 'NEXT' }),
      { type: 'NEXT' },
    ),
    { type: 'NEXT' },
  )
  assert.equal(decision.step, ONBOARDING_STEPS.DECISION)
  const speaking = transitionOnboarding(decision, { type: 'CHOOSE_REAL' })
  const waiting = transitionOnboarding(speaking, { type: 'SUBMIT_INPUT', text: '我在做一个频道' })
  const confirming = transitionOnboarding(waiting, { type: 'RESPONSE_READY' })
  const witnessing = transitionOnboarding(confirming, { type: 'APPLY_ALL' })
  const today = transitionOnboarding(witnessing, { type: 'FIT_COMPLETE' })
  const recommendationWaiting = transitionOnboarding(today, { type: 'TODAY_SENT' })
  const closing = transitionOnboarding(recommendationWaiting, { type: 'RECOMMENDATION_READY' })

  assert.deepEqual(
    [speaking.step, waiting.step, confirming.step, witnessing.step, today.step, recommendationWaiting.step, closing.step],
    [ONBOARDING_STEPS.SPEAK, ONBOARDING_STEPS.WAITING, ONBOARDING_STEPS.CONFIRM, ONBOARDING_STEPS.WITNESS, ONBOARDING_STEPS.TODAY, ONBOARDING_STEPS.RECOMMENDATION_WAITING, ONBOARDING_STEPS.CLOSING],
  )
  assert.equal(waiting.submittedText, '我在做一个频道')
  assert.equal(confirming.proposalAttention, true)
})

// 改版前 WAITING 只认「带提案的回复」，AI 回了闲聊或请求失败就永远停在那里，只能跳过。
test('waiting never dead-ends when the model returns nothing usable', () => {
  const waiting = createOnboardingState({ step: ONBOARDING_STEPS.WAITING })

  const noProposal = transitionOnboarding(waiting, { type: 'RESPONSE_WITHOUT_PROPOSAL' })
  assert.equal(noProposal.step, ONBOARDING_STEPS.RETRY)

  const timedOut = transitionOnboarding(waiting, { type: 'TIMEOUT' })
  assert.equal(timedOut.step, ONBOARDING_STEPS.RETRY)

  // 重说一次能回到主线。
  const retrying = transitionOnboarding(noProposal, { type: 'SUBMIT_INPUT', text: '我在做频道、找工作、接外包' })
  assert.equal(retrying.step, ONBOARDING_STEPS.WAITING)
  assert.equal(retrying.submittedText, '我在做频道、找工作、接外包')

  // 迟到的提案也仍然接得住。
  const recovered = transitionOnboarding(noProposal, { type: 'RESPONSE_READY' })
  assert.equal(recovered.step, ONBOARDING_STEPS.CONFIRM)
})

test('the closing step is reachable even if the recommendation never arrives', () => {
  const pending = createOnboardingState({ step: ONBOARDING_STEPS.RECOMMENDATION_WAITING })
  assert.equal(transitionOnboarding(pending, { type: 'TIMEOUT' }).step, ONBOARDING_STEPS.CLOSING)
})

test('both waiting steps are guarded by a timeout in the hook', () => {
  const hook = readFileSync(new URL('../src/hooks/useOnboarding.js', import.meta.url), 'utf8')
  assert.match(hook, /WAITING_TIMEOUT_MS/)
  assert.match(hook, /RECOMMENDATION_TIMEOUT_MS/)
  assert.match(hook, /type: 'TIMEOUT'/)
  // 回复不含提案时要转 RETRY，而不是继续干等。
  assert.match(hook, /RESPONSE_WITHOUT_PROPOSAL/)
})

test('example data has three competing branches with planning signals and a stage goal', () => {
  let sequence = 0
  const rows = buildExampleNodes(() => `id-${++sequence}`)
  const projects = rows.filter(row => row.type === 'project')
  const categories = rows.filter(row => row.type === 'category')
  const tasks = rows.filter(row => row.type === 'task')

  assert.equal(rows.length, 22)
  assert.equal(projects.length, 3)
  assert.equal(categories.length, 6)
  assert.equal(tasks.length, 13)
  assert.equal(new Set(rows.map(row => row.parent_id)).has(null), true)
  assert.ok(rows.some(row => row.status === 'done'))
  assert.ok(rows.some(row => row.status === 'dormant'))
  assert.ok(rows.some(row => row.current_priority === 'urgent'))
  assert.ok(rows.some(row => row.current_priority === 'low'))
  assert.equal(rows.filter(row => row.target_completion_date).length, 22)
  assert.equal(EXAMPLE_GOAL.kind, 'stage')
  assert.ok(EXAMPLE_GOAL.text)
  assert.ok(EXAMPLE_GOAL.deadline)
})

test('example branches separate direct priority, branch meaning, and cultivation signals', () => {
  let sequence = 0
  const tree = flatToTree(buildExampleNodes(() => `metric-${++sequence}`))
  const metaById = getDerivedWeightMetaMap(tree, { userGoal: EXAMPLE_GOAL, now: new Date('2026-08-10T00:00:00.000Z') })
  const metrics = Object.fromEntries(tree.children.map(node => {
    const meta = getDerivedWeightMeta(metaById, node)
    return [node.key || node.name, meta]
  }))
  const content = metrics['B 站频道：熊猫团团']
  const cash = metrics['现金流与求职']
  const side = metrics['独立产品副线']

  assert.ok(cash.directPriority > content.directPriority)
  assert.ok(content.directPriority > side.directPriority)
  assert.ok(side.branchPriority > side.directPriority + 20)
  assert.ok(cash.cultivationScore < cash.directPriority)
  assert.ok(content.branchPriority > content.directPriority)
})

test('every onboarding path can be skipped and the guide does not contain a tooltip tour', () => {
  const active = createOnboardingState()
  const skipped = transitionOnboarding(active, { type: 'SKIP' })
  const source = readFileSync('src/components/Onboarding/Onboarding.jsx', 'utf8')

  assert.equal(skipped.active, false)
  assert.equal(skipped.step, null)
  assert.doesNotMatch(source, /tooltip|tour|遮罩|1\/5/i)
})
