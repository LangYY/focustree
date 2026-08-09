import assert from 'node:assert/strict'
import test from 'node:test'
import { computePriorityMetaMap, getPriorityMeta } from '../src/lib/priorityEngine.js'
import { buildPriorityAnalysis, previewPriorityMetaMap } from '../src/lib/priorityProposals.js'

test('priority metadata exposes real cultivation contributions that add up to the score', () => {
  const tree = {
    id: 'root',
    type: 'root',
    children: [
      {
        id: 'sparse',
        type: 'task',
        name: 'x',
        status: 'active',
        children: [],
      },
      {
        id: 'rich',
        type: 'task',
        name: 'Documented task',
        status: 'active',
        current_priority: 'high',
        target_completion_date: '2099-01-01',
        last_active_at: '2026-08-09T00:00:00.000Z',
        annotations: { ai_notes: 'A detailed note with enough evidence.' },
        children: [],
      },
    ],
  }

  const meta = computePriorityMetaMap(tree, { now: new Date('2026-08-09T00:00:00.000Z') })
  const sparse = getPriorityMeta(meta, 'sparse')
  const rich = getPriorityMeta(meta, 'rich')

  assert.equal(rich.cultivationBreakdown.length, 4)
  assert.equal(
    rich.cultivationBreakdown.reduce((sum, item) => sum + item.contribution, 0),
    rich.cultivationScore,
  )
  assert.notDeepEqual(rich.cultivationBreakdown, sparse.cultivationBreakdown)
})

test('priority metadata exposes the child path that actually determines branch priority', () => {
  const tree = {
    id: 'root',
    type: 'root',
    children: [{
      id: 'parent',
      type: 'project',
      name: 'Parent',
      current_priority: 'normal',
      children: [
        { id: 'critical', type: 'task', name: 'Critical', current_priority: 'urgent', children: [] },
        { id: 'other', type: 'task', name: 'Other', current_priority: 'low', children: [] },
      ],
    }],
  }

  const metaMap = computePriorityMetaMap(tree)
  const meta = getPriorityMeta(metaMap, 'parent')
  const criticalMeta = getPriorityMeta(metaMap, 'critical')
  assert.deepEqual(meta.criticalPath, ['parent', 'critical'])
  assert.equal(meta.criticalPathSource, 'descendant')
  assert.deepEqual(meta.criticalPathEdges[0], {
    fromId: 'parent',
    toId: 'critical',
    relationType: 'normal',
    propagationFactor: 1,
    childUpwardCritical: criticalMeta.upwardCritical,
    propagatedPriority: criticalMeta.upwardCritical,
  })
})

test('priority preview survives persisted analysis and a fresh tree rebuild', () => {
  const tree = {
    id: 'root',
    type: 'root',
    name: '根',
    children: [{
      id: 'task-1',
      type: 'task',
      name: '完成报价',
      status: 'active',
      current_priority: 'normal',
      parent_id: 'root',
      annotations: {},
      children: [],
    }],
  }
  const goal = { version: 'goal-v1', text: '本周完成现金流相关工作' }
  const proposal = {
    node_id: 'task-1',
    goal_alignment: 0.85,
    necessity: 0.9,
    delay_cost: 0.75,
    relation_type: 'required',
    confidence: 0.8,
    reason: '直接影响本周回款',
  }
  const now = new Date('2026-08-09T00:00:00.000Z')

  const previewMeta = previewPriorityMetaMap(tree, [proposal], goal, { now })
  const persistedRows = buildPersistedRows(tree, [proposal], goal, now)
  const refreshedTree = refreshTreeFromRows(tree, persistedRows)
  const refreshedMeta = computePriorityMetaMap(refreshedTree, { goal, now })

  assert.equal(
    getPriorityMeta(previewMeta, 'task-1').directPriority,
    getPriorityMeta(refreshedMeta, 'task-1').directPriority,
  )
  assert.deepEqual(refreshedTree.children[0].annotations.priority_analysis, persistedRows[0].priority_analysis)
})

test('priority preview and persistence safely skip a proposal for a missing node', () => {
  const tree = { id: 'root', type: 'root', children: [{ id: 'task-1', type: 'task', name: 'Task', children: [] }] }
  const proposal = { node_id: 'missing', goal_alignment: 0.8, necessity: 0.8, delay_cost: 0.8, confidence: 0.8 }
  const goal = { version: 'goal-v1', text: 'Finish task' }
  const now = new Date('2026-08-09T00:00:00.000Z')
  const previewMeta = previewPriorityMetaMap(tree, [proposal], goal, { now })
  const refreshedMeta = computePriorityMetaMap(refreshTreeFromRows(tree, buildPersistedRows(tree, [proposal], goal, now)), { goal, now })
  assert.equal(buildPersistedRows(tree, [proposal], goal, now).length, 0)
  assert.equal(getPriorityMeta(previewMeta, 'task-1').directPriority, getPriorityMeta(refreshedMeta, 'task-1').directPriority)
})

test('priority preview and persistence safely skip a proposal targeting root', () => {
  const tree = { id: 'root', type: 'root', children: [{ id: 'task-1', type: 'task', name: 'Task', children: [] }] }
  const proposal = { node_id: 'root', goal_alignment: 0.8, necessity: 0.8, delay_cost: 0.8, confidence: 0.8 }
  const goal = { version: 'goal-v1', text: 'Finish task' }
  const now = new Date('2026-08-09T00:00:00.000Z')
  const previewMeta = previewPriorityMetaMap(tree, [proposal], goal, { now })
  const refreshedMeta = computePriorityMetaMap(refreshTreeFromRows(tree, buildPersistedRows(tree, [proposal], goal, now)), { goal, now })
  assert.equal(buildPersistedRows(tree, [proposal], goal, now).length, 0)
  assert.equal(getPriorityMeta(previewMeta, 'task-1').directPriority, getPriorityMeta(refreshedMeta, 'task-1').directPriority)
})

test('priority preview and persistence clamp out-of-range proposal signals identically', () => {
  const tree = { id: 'root', type: 'root', children: [{ id: 'task-1', type: 'task', name: 'Task', children: [] }] }
  const proposal = { node_id: 'task-1', goal_alignment: 1.5, necessity: -0.2, delay_cost: 0.8, relation_type: 'invalid', confidence: 2 }
  const goal = { version: 'goal-v1', text: 'Finish task' }
  const now = new Date('2026-08-09T00:00:00.000Z')
  const previewMeta = previewPriorityMetaMap(tree, [proposal], goal, { now })
  const persistedRows = buildPersistedRows(tree, [proposal], goal, now)
  const refreshedMeta = computePriorityMetaMap(refreshTreeFromRows(tree, persistedRows), { goal, now })
  assert.equal(getPriorityMeta(previewMeta, 'task-1').directPriority, getPriorityMeta(refreshedMeta, 'task-1').directPriority)
  assert.equal(persistedRows[0].priority_analysis.goal_alignment, 1)
  assert.equal(persistedRows[0].priority_analysis.necessity, 0)
  assert.equal(persistedRows[0].priority_analysis.confidence, 1)
  assert.equal(persistedRows[0].priority_analysis.relation_type, 'normal')
})

function buildPersistedRows(tree, proposals, goal, now) {
  return (proposals || []).flatMap(proposal => {
    const node = findNode(tree, proposal.node_id || proposal.id)
    if (!node || node.type === 'root') return []
    return [{
      node_id: node.id,
      user_id: 'test-user',
      priority_analysis: buildPriorityAnalysis(node, proposal, goal, now),
    }]
  })
}

function refreshTreeFromRows(tree, rows) {
  const rowsById = new Map((rows || []).map(row => [String(row.node_id), row.priority_analysis]))
  const walk = node => {
    const analysis = rowsById.get(String(node.id))
    return {
      ...node,
      children: (node.children || []).map(walk),
      ...(analysis ? { annotations: { ...(node.annotations || {}), priority_analysis: analysis } } : {}),
    }
  }
  return walk(tree)
}

function findNode(tree, id) {
  if (!tree || id == null) return null
  if (String(tree.id) === String(id)) return tree
  for (const child of tree.children || []) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}
