import express from 'express'
import cors from 'cors'
import { createClient } from '@supabase/supabase-js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runAgent } from './agent.js'
import { summarizeSession } from './summarizer.js'
import { generateDailyFocus } from './dailyFocus.js'
import { generateWeeklyReview } from './weeklyReview.js'
import { postChatCompletion } from './llmClient.js'
import { analyzePriorityNodes, estimatePriorityAnalysisTokens } from './priorityAnalysis.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.resolve(__dirname, '../dist')

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

const LLM_PROVIDER = process.env.LLM_PROVIDER === 'openai' ? 'openai' : 'deepseek'
const API_KEY  = LLM_PROVIDER === 'openai' ? process.env.OPENAI_API_KEY : process.env.DEEPSEEK_API_KEY
const SUPA_URL = process.env.SUPABASE_URL
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const PUBLIC_SUPA_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const PUBLIC_SUPA_KEY = process.env.VITE_SUPABASE_ANON_KEY || ''
const REQUIRED_TABLES = [
  'nodes',
  'node_annotations',
  'conversations',
  'session_summaries',
  'user_profile',
  'recommendation_log',
  'daily_focus',
  'weekly_reviews',
  'goal_history',
  'priority_analysis_runs',
]

if (!API_KEY)  console.error(`❌ ${LLM_PROVIDER === 'openai' ? 'OPENAI_API_KEY' : 'DEEPSEEK_API_KEY'} not set`)
if (!SUPA_URL) console.warn('⚠️ SUPABASE_URL not set — summarizer disabled')
if (!SUPA_KEY) console.warn('⚠️ SUPABASE_SERVICE_ROLE_KEY not set — summarizer disabled')
console.log(`[llm] provider=${LLM_PROVIDER}`)

// 服务端 supabase client（bypass RLS，用 service role）
const supa = (SUPA_URL && SUPA_KEY) ? createClient(SUPA_URL, SUPA_KEY) : null

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    provider: LLM_PROVIDER,
    llm_configured: Boolean(API_KEY),
    public_supabase_configured: Boolean(PUBLIC_SUPA_URL && PUBLIC_SUPA_KEY),
    service_supabase_configured: Boolean(supa),
    supabase_configured: Boolean(PUBLIC_SUPA_URL && PUBLIC_SUPA_KEY && supa),
  })
})

app.get('/readiness', async (req, res) => {
  const env = {
    llm_configured: Boolean(API_KEY),
    public_supabase_configured: Boolean(PUBLIC_SUPA_URL && PUBLIC_SUPA_KEY),
    service_supabase_configured: Boolean(supa),
  }
  const tables = {}
  const result = {
    ok: false,
    env,
    database: {
      checked: false,
      ok: false,
      tables,
    },
  }

  if (supa) {
    result.database.checked = true
    await Promise.all(REQUIRED_TABLES.map(async (table) => {
      const { error } = await supa
        .from(table)
        .select('user_id', { head: true, count: 'exact' })
        .limit(1)
      tables[table] = error ? { ok: false, message: error.message } : { ok: true }
    }))
    result.database.ok = Object.values(tables).every(item => item.ok)
  }

  result.ok = Object.values(env).every(Boolean) && result.database.ok
  res.status(result.ok ? 200 : 503).json(result)
})

app.get('/runtime-config.js', (req, res) => {
  res
    .type('application/javascript')
    .set('Cache-Control', 'no-store')
    .send(`window.__FOCUSTREE_CONFIG__=${JSON.stringify({
      supabaseUrl: PUBLIC_SUPA_URL,
      supabaseAnonKey: PUBLIC_SUPA_KEY,
    })};`)
})

// ── /api/priority-analysis ────────────────────────────

app.post('/api/priority-analysis', async (req, res) => {
  const { nodes, goal, mode = 'missing' } = req.body || {}
  if (!API_KEY) return res.status(500).json({ error: 'API key not configured' })
  if (!goal?.text) return res.status(400).json({ error: '请先设置当前目标。' })
  if (!Array.isArray(nodes) || nodes.length === 0) return res.status(400).json({ error: '没有需要分析的节点。' })

  const controller = new AbortController()
  const abort = () => {
    if (!res.writableEnded) controller.abort()
  }
  req.on('aborted', abort)
  res.on('close', abort)

  try {
    console.log(`[/api/priority-analysis] mode=${mode}, nodes=${nodes.length}, estimate=${estimatePriorityAnalysisTokens(nodes, goal)}`)
    const result = await analyzePriorityNodes({
      nodes,
      goal,
      provider: LLM_PROVIDER,
      apiKey: API_KEY,
      signal: controller.signal,
    })
    if (!controller.signal.aborted) {
      res.json({
        proposals: result.proposals,
        usage: result.usage,
        usage_cost: result.usageCost,
        model_used: result.modelUsed,
        batches: result.batches,
        estimated_tokens: result.estimatedTokens,
      })
    }
  } catch (error) {
    console.error('[/api/priority-analysis]', error.message)
    if (!controller.signal.aborted) res.status(500).json({ error: error.message || '优先级分析失败。' })
  }
})

// ── /api/agent ────────────────────────────────────────

app.post('/api/agent', async (req, res) => {
  const { message, treeText, nodeIds, history, userGoal, model, recentSummaries, learnedPatterns, userMemory, contextMode, hitRate, clientTime } = req.body

  if (!message) return res.status(400).json({ error: 'message is required' })
  if (!API_KEY)  return res.status(500).json({ error: 'API key not configured' })

  console.log('\n──── [/api/agent] ────')
  console.log('msg:', message.slice(0, 60))
  console.log('model:', model || 'auto')
  console.log('contextMode:', contextMode || 'legacy')
  console.log('goal:', userGoal?.text || '(none)')
  console.log('summaries:', recentSummaries?.length || 0, '·', 'learned:', learnedPatterns?.length || 0)
  console.log('hitRate:', hitRate ? `${hitRate.completed}/${hitRate.total}` : '(none)')
  console.log('nodeIds:', nodeIds?.length || 0, 'ids')

  const controller = new AbortController()

  // 客户端真正断开连接（停止按钮/关标签页）时取消 LLM 调用。
  // req.close 会在请求体读取完成后触发，不能拿来判断断连。
  const abortClientRequest = () => {
    if (!res.writableEnded) {
      console.log('[/api/agent] client disconnected, aborting')
      controller.abort()
    }
  }
  req.on('aborted', abortClientRequest)
  res.on('close', () => {
    if (!res.writableEnded) abortClientRequest()
  })

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
      userMemory: userMemory || null,
      contextMode: contextMode || 'global_tree',
      hitRate:  hitRate || null,
      clientTime: clientTime || null,
      model:    model || 'auto',
      provider: LLM_PROVIDER,
      apiKey:   API_KEY,
      signal:   controller.signal,
    })
    if (!controller.signal.aborted) {
      res.json(result)
    }
  } catch (err) {
    console.error('[/api/agent] error:', err)
    if (!controller.signal.aborted) {
      res.status(500).json({
        intent:  'query',
        reply:   '服务暂时出现问题，请稍后再试。',
        actions: [],
      })
    }
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
    const summary = await summarizeSession({ messages: msgs, apiKey: API_KEY, provider: LLM_PROVIDER })
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
      provider: LLM_PROVIDER,
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
      provider: LLM_PROVIDER,
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
    const data = await postChatCompletion(LLM_PROVIDER, {
      model: LLM_PROVIDER === 'openai'
        ? (process.env.OPENAI_MODEL_CHAT || process.env.OPENAI_MODEL || 'gpt-4o-mini')
        : 'deepseek-chat',
      messages: [{ role: 'system', content: system }, ...messages],
      max_tokens: 500,
      temperature: 0.7,
      response_format: { type: 'json_object' },
    }, {
      apiKey: API_KEY,
    })
    res.json({ content: data.choices?.[0]?.message?.content || '' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.use(express.static(DIST_DIR))

app.get('/', (req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'))
})

app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'))
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`🤖 Agent server running on http://localhost:${PORT}`)
})
