import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { layoutLabelPositions, splitLabelLines } from '../src/components/Tree/render/labels.js'

test('splits long labels into at most two eleven-character lines', () => {
  assert.deepEqual(
    splitLabelLines('一二三四五六七八九十一二三四五六七八九十'),
    ['一二三四五六七八九十一', '二三四五六七八九十'],
  )
  assert.deepEqual(
    splitLabelLines('一二三四五六七八九十一二三四五六七八九十一二三'),
    ['一二三四五六七八九十一', '二三四五六七八九十一…'],
  )
})

test('moves a later same-level label down until its estimated box clears the earlier one', () => {
  const positions = layoutLabelPositions([
    { depth: 1, x: 0, y: 100, data: { id: 'first', type: 'project', name: '项目一' } },
    { depth: 1, x: 12, y: 100, data: { id: 'second', type: 'project', name: '项目二' } },
  ], { getRadius: () => 16 })
  const first = positions.get('first')
  const second = positions.get('second')

  assert.equal(first.y, 0)
  assert.ok(second.y > 0)
  assert.ok(second.top >= first.bottom + 4)
})

test('tree labels no longer expose a numeric score layer', () => {
  const treeSource = readFileSync(new URL('../src/components/Tree/TreeView.jsx', import.meta.url), 'utf8')
  const controlsSource = readFileSync(new URL('../src/components/Tree/CanvasControls.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(treeSource, /node-score-label/)
  assert.doesNotMatch(treeSource, /layers\?\.labels/)
  assert.doesNotMatch(controlsSource, /分数标签/)
})

test('tree label styles keep the serif/sans hierarchy and thinner done treatment', () => {
  const labelsSource = readFileSync(new URL('../src/components/Tree/render/labels.js', import.meta.url), 'utf8')
  const treeSource = readFileSync(new URL('../src/components/Tree/TreeView.jsx', import.meta.url), 'utf8')
  assert.match(labelsSource, /fontFamily: 'var\(--ft-font-serif\)'[\s\S]*fontSize: 16[\s\S]*fontWeight: 500/)
  assert.match(labelsSource, /fontFamily: 'var\(--ft-font-sans\)'[\s\S]*fontSize: 12\.5[\s\S]*fontWeight: 400/)
  assert.match(labelsSource, /const x = radius \+ 12/)
  assert.match(treeSource, /\.attr\('stroke-width', 2\)/)
  assert.match(treeSource, /node-label.*is-done/)
})
