import express from 'express'
import cors from 'cors'
import { createClient } from '@supabase/supabase-js'
import { runAgent } from './agent.js'
import { summarizeSession } from './summarizer.js'
import { generateDailyFocus } from './dailyFocus.js'
import { generateWeeklyReview } from './weeklyReview.js'

const app = express()
app.use(cors())
app.use(express.json())

const API_KEY  = process.env.DEEPSEEK_API_KEY
const SUPA_URL = process.env.SUPABASE_URL
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!API_KEY)  console.error('❌ DEEPSEEK_API_KEY not set')
if (!SUPA_URL) console.warn('⚠️ SUPABASE_URL not set — summarizer disabled')
if (!SUPA_KEY) console.warn('⚠️ SUPABASE_SERVICE_ROLE_KEY not set — summarizer disabled')

// 服务端 supabase client（bypass RLS，用 service role）
const supa = (SUPA_URL && SUPA_KEY) ? createClient(SUPA_URL, SUPA_KEY) : null

// ── /api/agent ────────────────────────────────────────

app.post('/api/agent', async (req, res) => {
  const { message, treeText, nodeIds, history, userGoal, model, recentSummaries, learnedPatterns, hitRate, clientTime } = req.body

  if (!message) return res.status(400).json({ error: 'message is required' })
  if (!API_KEY)  return res.status(500).json({ error: 'API key not configured' })

  console.log('\n──── [/api/agent] ────')
  console.log('msg:', message.slice(0, 60))
  console.log('model:', model || 'auto')
  console.log('goal:', userGoal?.text || '(none)')
  console.log('summaries:', recentSummaries?.length || 0, '·', 'learned:', learnedPatterns?.length || 0)
  console.log('hitRate:', hitRate ? `${hitRate.completed}/${hitRate.total}` : '(none)')
  console.log('nodeIds:', nodeIds?.length || 0, 'ids')

  try {
    const nodeIdSet = new Set(nodeIds || [])
    const result = await runAgent({
      message,
      treeText: treeText || '（暂无项目）',
      nodeIdSet,
      history:  history || [],
      userGoal: userGoal || null,
      recentSummaries: recentSummaries || [],
      learnedPatterns: learnedPatterns || [],
      hitRate:  hitRate || null,
      clientTime: clientTime || null,
      model:    model || 'auto',
      apiKey:   API_KEY,
    })
    res.json(result)
  } catch (err) {
    console.error('[/api/agent] error:', err)
    res.status(500).json({
      intent:  'query',
      reply:   '服务暂时出现问题，请稍后再试。',
      actions: [],
    })
  }
})

// ── /api/summarize-session ─────────────────────────────

app.post('/api/summarize-session', async (req, res) => {
  const { user_id, session_id } = req.body
  if (!user_id || !session_id) return res.status(400).json({ error: 'user_id and session_id required' })
  if (!supa) return res.status(503).json({ error: 'summarizer unavailable' })
  if (!API_KEY) return res.status(500).json({ error: 'API key not configured' })

  try {
    // 已经摘要过则跳过
    const { data: existing } = await supa
      .from('session_summaries')
      .select('session_id')
      .eq('session_id', session_id)
      .maybeSingle()
    if (existing) {
      console.log('[summarize] already exists for', session_id)
      return res.json({ skipped: true })
    }

    // 拉这个 session 的全部消息
    const { data: msgs, error: msgErr } = await supa
      .from('conversations')
      .select('role, content, created_at')
      .eq('user_id', user_id)
      .eq('session_id', session_id)
      .order('created_at', { ascending: true })
    if (msgErr) throw msgErr
    if (!msgs?.length) return res.json({ skipped: 'no messages' })

    // 太短的 session（< 4 条）不值得摘要
    if (msgs.length < 4) {
      console.log('[summarize] session too short:', msgs.length)
      return res.json({ skipped: 'too short' })
    }

    console.log('[summarize] starting for session', session_id, 'with', msgs.length, 'messages')
    const summary = await summarizeSession({ messages: msgs, apiKey: API_KEY })
    if (!summary) return res.status(500).json({ error: 'summary generation failed' })

    const { error: insertErr } = await supa.from('session_summaries').insert({
      user_id,
      session_id,
      summary: summary.summary,
      key_decisions: summary.key_decisions,
      topics: summary.topics,
      message_count: msgs.length,
      started_at: msgs[0].created_at,
      ended_at: msgs[msgs.length - 1].created_at,
    })
    if (insertErr) throw insertErr

    console.log('[summarize] done:', summary.summary.slice(0, 80))
    res.json({ ok: true, summary })
  } catch (err) {
    console.error('[/api/summarize-session]', err)
    res.status(500).json({ error: err.message })
  }
})

// ── /api/daily-focus ──────────────────────────────────

app.post('/api/daily-focus', async (req, res) => {
  const { treeText, userGoal, recentSummaries, learnedPatterns, hitRate, clientTime } = req.body
  if (!API_KEY) return res.status(500).json({ error: 'API key not configured' })

  console.log('\n──── [/api/daily-focus] ────')
  console.log('goal:', userGoal?.text || '(none)')
  console.log('time:', clientTime?.period || '(none)')

  try {
    const result = await generateDailyFocus({
      treeText: treeText || '（暂无项目）',
      userGoal: userGoal || null,
      recentSummaries: recentSummaries || [],
      learnedPatterns: learnedPatterns || [],
      hitRate:  hitRate || null,
      clientTime: clientTime || null,
      apiKey:   API_KEY,
    })
    if (!result) return res.status(500).json({ error: 'generation failed' })
    res.json(result)
  } catch (err) {
    console.error('[/api/daily-focus]', err)
    res.status(500).json({ error: err.message })
  }
})

// ── /api/weekly-review ────────────────────────────────

app.post('/api/weekly-review', async (req, res) => {
  const { weekStart, weekEnd, userGoal, stats } = req.body
  if (!API_KEY) return res.status(500).json({ error: 'API key not configured' })
  if (!weekStart || !weekEnd) return res.status(400).json({ error: 'weekStart and weekEnd required' })

  console.log('\n──── [/api/weekly-review] ────')
  console.log('window:', weekStart, '→', weekEnd)
  console.log('completed:', stats?.completed_tasks?.length || 0,
              '· hitRate:', stats?.hit_rate ? `${stats.hit_rate.completed}/${stats.hit_rate.total}` : '-',
              '· dormant:', stats?.dormant_projects?.length || 0)

  try {
    const review = await generateWeeklyReview({
      weekStart, weekEnd,
      userGoal: userGoal || null,
      stats:    stats || {},
      apiKey:   API_KEY,
    })
    if (!review) return res.status(500).json({ error: 'review generation failed' })
    res.json(review)
  } catch (err) {
    console.error('[/api/weekly-review]', err)
    res.status(500).json({ error: err.message })
  }
})

// ── /api/chat (legacy) ─────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { messages, system } = req.body
  if (!API_KEY) return res.status(500).json({ error: 'API key not configured' })

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'system', content: system }, ...messages],
        max_tokens: 500,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      }),
    })
    if (!response.ok) {
      const err = await response.text()
      return res.status(response.status).json({ error: err })
    }
    const data = await response.json()
    res.json({ content: data.choices?.[0]?.message?.content || '' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`🤖 Agent server running on http://localhost:${PORT}`)
})
