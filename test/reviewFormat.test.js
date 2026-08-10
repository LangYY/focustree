import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { formatReviewContent, stripReviewDecorations } from '../src/components/Views/reviewFormat.js'

test('strips emoji, decorative separators, and serialized bullets from old reviews', () => {
  assert.equal(
    stripReviewDecorations('📌 本周进展：\n· 完成一项\n---\n🔍 模式'),
    '本周进展：\n完成一项\n\n模式',
  )
})

test('normalizes structured reviews into the six display sections', () => {
  assert.deepEqual(
    formatReviewContent({
      parsed: {
        opening: '📌 本周完成了两件事。',
        wins: ['· 完成任务'],
        patterns: ['🔍 开始更早拆分任务'],
        challenges: ['❓ 哪个项目需要减负？'],
        proposals: [{ action: '安排一次复盘', rationale: '把经验沉淀下来' }],
        closing: '💡 你想先回应哪一个？',
      },
    }),
    {
      opening: '本周完成了两件事。',
      wins: ['完成任务'],
      patterns: ['开始更早拆分任务'],
      challenges: ['哪个项目需要减负？'],
      proposals: [{ action: '安排一次复盘', rationale: '把经验沉淀下来' }],
      closing: '你想先回应哪一个？',
    },
  )
})

test('parses the legacy serialized review into sections and proposals', () => {
  assert.deepEqual(
    formatReviewContent({
      summary: '这周完成了两件事。\n\n📌 本周进展：\n· 完成任务\n\n🔍 看到的模式：\n· 开始更早拆分任务\n\n❓ 想问你：\n· 哪个项目需要减负？\n\n💡 下周提议：\n· 安排一次复盘 — 把经验沉淀下来\n\n你想先回应哪一个？',
    }),
    {
      opening: '这周完成了两件事。',
      wins: ['完成任务'],
      patterns: ['开始更早拆分任务'],
      challenges: ['哪个项目需要减负？'],
      proposals: [{ action: '安排一次复盘', rationale: '把经验沉淀下来' }],
      closing: '你想先回应哪一个？',
    },
  )
})

test('keeps the review contract free of emoji instructions and view decorations', () => {
  const viewSource = readFileSync('src/components/Views/ReviewView.jsx', 'utf8')
  const serverSource = readFileSync('server/weeklyReview.js', 'utf8')
  assert.match(viewSource, /formatReviewContent/)
  assert.match(viewSource, /WINS|PATTERNS|CHALLENGES|PROPOSALS/)
  assert.match(serverSource, /严禁输出 emoji/)
  assert.match(serverSource, /装饰性符号/)
  for (const key of ['opening', 'wins', 'patterns', 'challenges', 'proposals', 'closing']) {
    assert.match(serverSource, new RegExp(`"${key}"`))
  }
})
