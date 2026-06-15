import test from 'node:test'
import assert from 'node:assert/strict'
import { computePriorityMetaMap, getPriorityMeta, nodePriorityFingerprint } from '../src/lib/priorityEngine.js'

const NOW = new Date('2026-06-15T12:00:00+08:00')

function node(id, name, options = {}) {
  return {
    id,
    name,
    type: options.type || 'task',
    status: options.status || 'active',
    parent_id: options.parent_id || null,
    current_priority: options.current_priority || null,
    target_completion_date: options.target_completion_date || null,
    annotations: options.annotations || null,
    children: options.children || [],
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-10T00:00:00Z',
  }
}

function root(children) {
  return node('root', 'root', { type: 'root', children })
}

test('opposite goals change related branch priorities', () => {
  const tree = root([
    node('cash', '完成客户回款', { type: 'project' }),
    node('content', '制作 B站 视频内容', { type: 'project' }),
  ])
  const cashMeta = computePriorityMetaMap(tree, { goal: { text: '本月优先赚钱增加现金收入', version: 'g1' }, now: NOW })
  const contentMeta = computePriorityMetaMap(tree, { goal: { text: '本月暂停商业化，专注 B站 视频内容', version: 'g2' }, now: NOW })

  assert.ok(getPriorityMeta(cashMeta, 'cash').directPriority > getPriorityMeta(cashMeta, 'content').directPriority)
  assert.ok(getPriorityMeta(contentMeta, 'content').directPriority > getPriorityMeta(contentMeta, 'cash').directPriority)
})

test('inserting a normal structural node does not change the critical path result', () => {
  const leaf = node('leaf', '收取尾款', { current_priority: 'urgent' })
  const flat = root([node('project', '客户项目', { type: 'project', children: [leaf] })])
  const nested = root([
    node('project', '客户项目', {
      type: 'project',
      children: [node('wrapper', '交付阶段', { type: 'category', children: [leaf] })],
    }),
  ])
  const flatMeta = computePriorityMetaMap(flat, { now: NOW })
  const nestedMeta = computePriorityMetaMap(nested, { now: NOW })

  assert.equal(getPriorityMeta(flatMeta, 'project').upwardCritical, getPriorityMeta(nestedMeta, 'project').upwardCritical)
  assert.equal(getPriorityMeta(flatMeta, 'leaf').branchPriority, getPriorityMeta(nestedMeta, 'leaf').branchPriority)
})

test('duplicating ordinary children does not inflate parent priority', () => {
  const one = root([node('project', '普通项目', { type: 'project', children: [node('a', '整理资料')] })])
  const many = root([
    node('project', '普通项目', {
      type: 'project',
      children: [node('a', '整理资料'), node('b', '整理资料'), node('c', '整理资料')],
    }),
  ])
  const oneMeta = computePriorityMetaMap(one, { now: NOW })
  const manyMeta = computePriorityMetaMap(many, { now: NOW })
  assert.equal(getPriorityMeta(oneMeta, 'project').upwardCritical, getPriorityMeta(manyMeta, 'project').upwardCritical)
  assert.ok(getPriorityMeta(manyMeta, 'project').cultivationScore > getPriorityMeta(oneMeta, 'project').cultivationScore)
})

test('a critical terminal strengthens only its ancestor path', () => {
  const tree = root([
    node('project', '客户项目', {
      type: 'project',
      children: [
        node('delivery', '交付', { type: 'category', children: [node('payment', '收取尾款', { current_priority: 'urgent' })] }),
        node('ideas', '未来想法', { type: 'category', children: [node('idea', '记录灵感')] }),
      ],
    }),
  ])
  const meta = computePriorityMetaMap(tree, { now: NOW })
  assert.ok(getPriorityMeta(meta, 'payment').branchPriority > getPriorityMeta(meta, 'idea').branchPriority)
  assert.ok(getPriorityMeta(meta, 'delivery').branchPriority > getPriorityMeta(meta, 'ideas').branchPriority)
  assert.equal(getPriorityMeta(meta, 'project').upwardCritical, getPriorityMeta(meta, 'delivery').upwardCritical)
})

test('completed nodes leave current priority but retain cultivation', () => {
  const activeTree = root([node('task', '完成关键交付', { current_priority: 'urgent' })])
  const doneTree = root([node('task', '完成关键交付', { current_priority: 'urgent', status: 'done' })])
  const activeMeta = computePriorityMetaMap(activeTree, { now: NOW })
  const doneMeta = computePriorityMetaMap(doneTree, { now: NOW })
  assert.ok(getPriorityMeta(activeMeta, 'task').directPriority > 0)
  assert.equal(getPriorityMeta(doneMeta, 'task').directPriority, 0)
  assert.ok(getPriorityMeta(doneMeta, 'task').cultivationScore > 0)
})

test('manual priority is strong but status can correct it', () => {
  const activeTree = root([node('task', '旧的紧急事项', { current_priority: 'urgent' })])
  const dormantTree = root([node('task', '旧的紧急事项', { current_priority: 'urgent', status: 'dormant' })])
  const doneTree = root([node('task', '旧的紧急事项', { current_priority: 'urgent', status: 'done' })])
  const activeMeta = computePriorityMetaMap(activeTree, { now: NOW })
  const dormantMeta = computePriorityMetaMap(dormantTree, { now: NOW })
  const doneMeta = computePriorityMetaMap(doneTree, { now: NOW })
  assert.ok(getPriorityMeta(activeMeta, 'task').directPriority >= 70)
  assert.ok(getPriorityMeta(dormantMeta, 'task').directPriority <= 25)
  assert.equal(getPriorityMeta(doneMeta, 'task').directPriority, 0)
})

test('clearing or replacing a goal invalidates confirmed goal semantics', () => {
  const goal = { text: '优先增加现金收入', version: 'cash-goal' }
  const analyzed = node('task', '完成客户回款', {
    annotations: {
      priority_analysis: {
        confirmed: true,
        goal_version: 'cash-goal',
        goal_alignment: 1,
        necessity: 1,
        delay_cost: 1,
        relation_type: 'required',
        confidence: 0.9,
      },
    },
  })
  analyzed.annotations.priority_analysis.node_fingerprint = nodePriorityFingerprint(analyzed)
  const tree = root([analyzed])
  const current = computePriorityMetaMap(tree, { goal, now: NOW })
  const cleared = computePriorityMetaMap(tree, { goal: null, now: NOW })

  assert.equal(getPriorityMeta(current, 'task').staleReasons.length, 0)
  assert.ok(getPriorityMeta(cleared, 'task').staleReasons.includes('goal_changed'))
  assert.equal(getPriorityMeta(cleared, 'task').relationType, 'normal')
})
