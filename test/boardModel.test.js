import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildBoardColumns } from '../src/components/Views/boardModel.js'

test('builds one project column and flattens category tasks by direct priority', () => {
  const tree = {
    id: 'root',
    type: 'root',
    children: [
      {
        id: 'project-a', type: 'project', name: '项目 A', children: [
          {
            id: 'category-a', type: 'category', name: '内容', children: [
              { id: 'task-low', type: 'task', name: '低优先级', status: 'active' },
              { id: 'task-high', type: 'task', name: '高优先级', status: 'active' },
            ],
          },
        ],
      },
    ],
  }
  const metaById = new Map([
    ['task-low', { directPriority: 20 }],
    ['task-high', { directPriority: 80 }],
  ])

  const [column] = buildBoardColumns(tree, metaById)

  assert.equal(column.project.name, '项目 A')
  assert.deepEqual(column.tasks.map(task => task.id), ['task-high', 'task-low'])
  assert.equal(column.tasks[0].categoryName, '内容')
})

test('filters the board to active tasks without removing the project column', () => {
  const tree = {
    id: 'root',
    type: 'root',
    children: [{
      id: 'project-a', type: 'project', name: '项目 A', children: [
        { id: 'active', type: 'task', name: '进行中', status: 'active' },
        { id: 'done', type: 'task', name: '已完成', status: 'done' },
      ],
    }],
  }

  const [column] = buildBoardColumns(tree, new Map(), 'active')

  assert.equal(column.tasks.length, 1)
  assert.equal(column.tasks[0].id, 'active')
})

test('deadline filter keeps a later deadline instead of treating it as undated', () => {
  const tree = {
    id: 'root',
    type: 'root',
    children: [{
      id: 'project-a', type: 'project', name: '项目 A', children: [
        { id: 'later', type: 'task', name: '远期任务', status: 'active', target_completion_date: '2099-01-01' },
        { id: 'none', type: 'task', name: '无期限任务', status: 'active' },
      ],
    }],
  }

  const [column] = buildBoardColumns(tree, new Map(), 'due')

  assert.deepEqual(column.tasks.map(task => task.id), ['later'])
  assert.equal(column.tasks[0].due.state, 'later')
})

test('list view renders the project board with the three requested filters', () => {
  const source = readFileSync(new URL('../src/components/Views/ListView.jsx', import.meta.url), 'utf8')
  assert.match(source, /<h1>看板<\/h1>/)
  assert.match(source, /ft-board-column/)
  assert.match(source, /只看进行中/)
  assert.match(source, /只看有期限的/)
  assert.match(source, /onStatusChange\?\./)
  assert.doesNotMatch(source, /ft-list-controls/)
})
