import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const treeSource = readFileSync(new URL('../src/components/Tree/TreeView.jsx', import.meta.url), 'utf8')

test('renders a capsule backdrop from each label layout box', () => {
  assert.match(treeSource, /node-label-backdrop/)
  assert.match(treeSource, /labelPositions\.get\(d\.data\.id\)\.width/)
  assert.match(treeSource, /labelPositions\.get\(d\.data\.id\)\.height/)
  assert.match(treeSource, /\.attr\('rx', d => .*labelPositions\.get\(d\.data\.id\)\.height.*\/ 2/)
  assert.match(treeSource, /\.attr\('fill', 'var\(--ft-surface-hover\)'\)/)
})
