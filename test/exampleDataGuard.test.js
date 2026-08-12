import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const treeSource = readFileSync(new URL('../src/hooks/useTree.js', import.meta.url), 'utf8')

// 2026-08-12：「重新看一遍引导」走的示例分支直接调用 loadExampleData，
// 而它会硬删该用户的全部节点且不进撤销栈，导致真实数据无声丢失。
test('loading example data over a non-empty tree needs confirmation and a snapshot', () => {
  const loadExample = appSource.slice(
    appSource.indexOf('const loadExample = useCallback'),
    appSource.indexOf('const onboarding = useOnboarding'),
  )
  assert.ok(loadExample.length > 0, 'loadExample 未找到')

  // 非空时必须先问，再留快照，最后才允许删。
  assert.match(loadExample, /countUserNodes\(treeData\)/)
  assert.match(loadExample, /window\.confirm/)
  assert.match(loadExample, /preDestructiveBackup/)

  // 确认被拒绝时必须直接返回，不能继续走到删除。
  assert.match(loadExample, /if \(!confirmed\) return false/)

  const confirmAt = loadExample.indexOf('window.confirm')
  const backupAt = loadExample.indexOf('preDestructiveBackup')
  const deleteAt = loadExample.indexOf('loadExampleData()')
  assert.ok(confirmAt < backupAt, '确认要早于快照')
  assert.ok(backupAt < deleteAt, '快照要早于真正的删除')
})

test('loadExampleData still deletes every node, so the guard above is load-bearing', () => {
  // 这条不是要求它删，而是钉住「它确实会删」这个前提。
  // 哪天它改成不删了，上面那道防护就该重新评估而不是默默留着。
  assert.match(treeSource, /const loadExampleData = useCallback/)
  assert.match(treeSource, /supabase[\s\S]{0,400}\.from\('nodes'\)\.delete\(\)/)
})

test('theme has only dark and light, and stale system values fall back to dark', () => {
  const topBar = readFileSync(new URL('../src/components/Shell/TopBar.jsx', import.meta.url), 'utf8')
  const bootstrap = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

  assert.doesNotMatch(topBar, /value: 'system'/)
  assert.doesNotMatch(appSource, /themeMode === 'system'/)
  assert.doesNotMatch(bootstrap, /mode === 'system'/)

  // 首屏 bootstrap 和 App 的读取必须同口径，否则会闪一下错误主题。
  assert.match(appSource, /localStorage\.getItem\('ft_theme'\) === 'light' \? 'light' : 'dark'/)
  assert.match(bootstrap, /localStorage\.getItem\('ft_theme'\) === 'light'/)
})
