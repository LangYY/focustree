import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { layoutLabelPositions } from '../src/components/Tree/render/labels.js'

const treeSource = readFileSync(new URL('../src/components/Tree/TreeView.jsx', import.meta.url), 'utf8')

test('direct glow uses the node branch color in both themes with the light opacity scale', () => {
  assert.match(treeSource, /node\.__glowColor = node\.__displayColor/)
  assert.match(treeSource, /node\.__glowOpacityScale = theme === 'light' \? \.58 : 1/)
  assert.doesNotMatch(treeSource, /node\.__glowColor = theme === 'light'/)
})

test('label sits above its node, anchored at the node centre', () => {
  const positions = layoutLabelPositions([
    { depth: 1, x: 0, y: 100, data: { id: 'above', type: 'project', name: '上方标签' } },
  ], { getRadius: () => 16 })
  const position = positions.get('above')

  // 文字从节点圆心向右起排，基线抬到圆点上方，不再伸进右侧的出枝方向。
  assert.equal(position.x, 0)
  assert.equal(position.y, -(16 + 9))
  assert.equal(position.left, 100)
  assert.ok(position.bottom < 0)
})
