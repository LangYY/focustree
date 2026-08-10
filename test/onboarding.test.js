import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildExampleNodes, EXAMPLE_GOAL } from '../src/lib/exampleData.js'
import { ONBOARDING_STEPS, createOnboardingState, shouldStartOnboarding, transitionOnboarding } from '../src/lib/onboarding.js'
import { flatToTree, getDerivedWeightMeta, getDerivedWeightMetaMap } from '../src/lib/treeUtils.js'

test('starts the onboarding decision only for an empty, uncompleted account', () => {
  assert.equal(shouldStartOnboarding({ nodeCount: 0, onboarded: false }), true)
  assert.equal(shouldStartOnboarding({ nodeCount: 2, onboarded: false }), false)
  assert.equal(shouldStartOnboarding({ nodeCount: 0, onboarded: true }), false)
  assert.equal(ONBOARDING_STEPS.DECISION, 'decision')
})

test('walks the real-input path through proposal confirmation and today recommendation', () => {
  const decision = createOnboardingState()
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
