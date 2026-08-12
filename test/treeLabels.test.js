import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { layoutLabelPositions, truncateLabel } from '../src/components/Tree/render/labels.js'

test('truncates a long label to one line with an ellipsis', () => {
  assert.equal(truncateLabel('一二三四五', Number.POSITIVE_INFINITY, 16), '一二三四五')

  const truncated = truncateLabel('一二三四五六七八九十一二三四五六七八九十', 96, 16)
  assert.match(truncated, /…$/)
  assert.ok(truncated.length < 20)
})

test('moves a colliding label further up rather than down onto its own node', () => {
  const positions = layoutLabelPositions([
    { depth: 1, x: 0, y: 100, data: { id: 'first', type: 'project', name: '项目一' } },
    { depth: 1, x: 12, y: 100, data: { id: 'second', type: 'project', name: '项目二' } },
  ], { getRadius: () => 16 })
  const first = positions.get('first')
  const second = positions.get('second')

  // 画布下方的先放；上方那个被顶得更高，两个盒子之间至少留 4px。
  assert.ok(first.y < second.y)
  assert.ok(second.top - first.bottom >= 4 - 1e-9)
})

test('caps a long label at the available pixel width and keeps the ellipsis', () => {
  const positions = layoutLabelPositions([
    { depth: 1, x: 0, y: 100, data: { id: 'long', type: 'project', name: '现金流与求职以及回款计划安排' } },
  ], {
    getRadius: () => 16,
    getMaxWidth: () => 96,
  })
  const position = positions.get('long')

  assert.ok(position.width <= 96)
  assert.match(position.text, /…$/)
})

test('separates labels that collide across adjacent depths', () => {
  const positions = layoutLabelPositions([
    { depth: 1, x: 0, y: 100, data: { id: 'parent', type: 'project', name: '第一层标签' } },
    { depth: 2, x: 12, y: 100, data: { id: 'child', type: 'project', name: '第二层标签' } },
  ], {
    getRadius: () => 16,
    getMaxWidth: () => 96,
  })
  const parent = positions.get('parent')
  const child = positions.get('child')

  assert.ok(child.top - parent.bottom >= 4 - 1e-9)
})

test('tree labels no longer expose a numeric score layer', () => {
  const treeSource = readFileSync(new URL('../src/components/Tree/TreeView.jsx', import.meta.url), 'utf8')
  const controlsSource = readFileSync(new URL('../src/components/Tree/CanvasControls.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(treeSource, /node-score-label/)
  assert.doesNotMatch(treeSource, /layers\?\.labels/)
  assert.doesNotMatch(controlsSource, /分数标签/)
})

test('tree labels share the UI font family and carry no text outline', () => {
  const labelsSource = readFileSync(new URL('../src/components/Tree/render/labels.js', import.meta.url), 'utf8')
  const treeSource = readFileSync(new URL('../src/components/Tree/TreeView.jsx', import.meta.url), 'utf8')

  // 字族全应用统一，层级只靠字号和字重。
  assert.doesNotMatch(labelsSource, /ft-font-serif/)
  assert.match(labelsSource, /fontFamily: 'var\(--ft-font-sans\)'[\s\S]*fontSize: 15[\s\S]*fontWeight: 600/)
  assert.match(labelsSource, /fontFamily: 'var\(--ft-font-sans\)'[\s\S]*fontSize: 12\.5[\s\S]*fontWeight: 400/)

  // 描边会在字形外侧留一圈画布色轮廓，中文小字号下看起来像给每个字加了边框。
  assert.doesNotMatch(treeSource, /paint-order/)
  assert.match(treeSource, /node-label.*is-done/)
})

test('no serif token remains anywhere in the app', () => {
  const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')
  assert.doesNotMatch(tokens, /--ft-font-serif/)
})
