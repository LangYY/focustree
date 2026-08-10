import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../src/components/Tree/TreeView.jsx', import.meta.url), 'utf8')
const mainCircleBlockStart = source.indexOf("const mainCircle = node.selectAll('.node-main-circle')")
const doneMarkStart = source.indexOf('const doneMark', mainCircleBlockStart)

test('binds node mouseleave on the selection before the circle transition', () => {
  assert.notEqual(mainCircleBlockStart, -1, 'main circle selection should be explicit')
  assert.notEqual(doneMarkStart, -1, 'main circle block should have a stable end')

  const mainCircleBlock = source.slice(mainCircleBlockStart, doneMarkStart)
  const leaveBindingMatch = mainCircleBlock.match(/mainCircle\s*\.on\('mouseleave'/)
  const transitionIndex = mainCircleBlock.indexOf('.transition()')

  assert.ok(leaveBindingMatch, 'mouseleave must be bound to the selection')
  assert.ok(leaveBindingMatch.index < transitionIndex, 'mouseleave must be bound before the animation transition')
  assert.doesNotMatch(mainCircleBlock.slice(transitionIndex), /\.on\(['"]mouseleave['"]/)
})
