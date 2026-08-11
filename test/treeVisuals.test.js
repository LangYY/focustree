import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { branchTangent } from '../src/components/Tree/render/branchPath.js'
import { layoutLabelPositions } from '../src/components/Tree/render/labels.js'

const treeSource = readFileSync(new URL('../src/components/Tree/TreeView.jsx', import.meta.url), 'utf8')

test('direct glow uses the node branch color in both themes with the light opacity scale', () => {
  assert.match(treeSource, /node\.__glowColor = node\.__displayColor/)
  assert.match(treeSource, /node\.__glowOpacityScale = theme === 'light' \? \.58 : 1/)
  assert.doesNotMatch(treeSource, /node\.__glowColor = theme === 'light'/)
})

test('branch tangent exposes a normalized forward direction near the child node', () => {
  const tangent = branchTangent({
    source: { x: 0, y: 0 },
    target: { x: 40, y: 24 },
  }, 0.88)

  assert.ok(tangent.x > 0)
  assert.ok(tangent.y > 0)
  assert.ok(Math.abs(Math.hypot(tangent.x, tangent.y) - 1) < 0.0001)
})

test('label layout applies a non-rotating anchor offset before collision resolution', () => {
  const positions = layoutLabelPositions([
    { depth: 1, x: 0, y: 100, data: { id: 'offset', type: 'project', name: '偏移标签' } },
  ], {
    getRadius: () => 16,
    getAnchorOffset: () => ({ x: 8, y: -3 }),
  })
  const position = positions.get('offset')

  assert.equal(position.x, 36)
  assert.equal(position.y, -3)
  assert.equal(position.left, 136)
})
