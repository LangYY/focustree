import assert from 'node:assert/strict'
import test from 'node:test'
import { collectProposalEntries, getPendingProposalCount } from '../src/lib/chatProposals.js'

test('chat proposal entries keep the three proposal types and mark duplicate draft nodes', () => {
  const tree = {
    id: 'root',
    type: 'root',
    children: [{ id: 'project-1', type: 'project', name: '项目 A', parent_id: null, children: [{ id: 'task-1', type: 'task', name: '任务 A', parent_id: 'project-1', children: [] }] }],
  }
  const messages = [{
    id: 'message-1',
    role: 'assistant',
    thinking: {
      draft_actions: [{ type: 'add_task', name: '任务 A', parent: '项目 A' }],
      goal_analysis: { outcome: '完成项目 A', kind: 'stage' },
      node_priority_proposals: [{ node_id: 'task-1', name: '任务 A', goal_alignment: .8 }],
    },
  }]

  const entries = collectProposalEntries(messages, tree, { text: '当前目标' })
  assert.deepEqual(entries.map(entry => entry.type), ['draft', 'goal', 'priority'])
  assert.equal(entries[0].actions[0].existing, true)
  assert.equal(getPendingProposalCount(entries, {}), 3)
})

test('processed entries stay attached to their source message while leaving the pending count at zero', () => {
  const message = {
    id: 'message-2',
    role: 'assistant',
    applied_draft_actions: true,
    thinking: { draft_actions: [{ type: 'add_task', name: '已处理任务' }] },
  }
  const entries = collectProposalEntries([message], { id: 'root', type: 'root', children: [] }, null)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].applied, true)
  assert.equal(getPendingProposalCount(entries, {}), 0)
})
