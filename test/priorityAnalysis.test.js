import test from 'node:test'
import assert from 'node:assert/strict'
import {
  collectPriorityAnalysisNodes,
  estimatePriorityAnalysisTokens,
  formatTokenEstimate,
} from '../src/lib/priorityAnalysis.js'

const tree = {
  id: 'root',
  name: 'root',
  type: 'root',
  children: [
    {
      id: 'project',
      name: '客户项目',
      type: 'project',
      status: 'active',
      annotations: { ai_notes: '完成交付并收回尾款' },
      children: [
        { id: 'active', name: '申请回款', type: 'task', status: 'active', children: [] },
        { id: 'done', name: '发送发票', type: 'task', status: 'done', children: [] },
      ],
    },
  ],
}

test('priority analysis payload excludes completed nodes and preserves path context', () => {
  const nodes = collectPriorityAnalysisNodes(tree)
  assert.deepEqual(nodes.map(node => node.id), ['project', 'active'])
  assert.equal(nodes[1].parent_name, '客户项目')
  assert.equal(nodes[1].path, '客户项目 > 申请回款')
  assert.equal(nodes[0].details, '完成交付并收回尾款')
})

test('priority analysis can target only stale node ids', () => {
  const nodes = collectPriorityAnalysisNodes(tree, ['active', 'done'])
  assert.deepEqual(nodes.map(node => node.id), ['active'])
})

test('token estimate scales with node count and has a readable label', () => {
  const nodes = collectPriorityAnalysisNodes(tree)
  const small = estimatePriorityAnalysisTokens(nodes.slice(0, 1), { text: '完成客户回款' })
  const large = estimatePriorityAnalysisTokens(Array(20).fill(nodes[0]), { text: '完成客户回款' })
  assert.ok(large > small)
  assert.match(formatTokenEstimate(large), /tokens/)
})
