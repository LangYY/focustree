import { useState, useCallback, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { treeToPromptText, flattenTree } from '../lib/treeUtils'
import { getClientTime } from '../lib/clientTime'

const WELCOME = {
  id: 'welcome',
  role: 'assistant',
  content: '你好！我是你的专注树助理。\n\n你可以说：\n· 「现在该做什么？」\n· 「第2集脚本写完了」\n· 「在熊猫团团下加任务：剪辑第1集」\n· 「把求职项目暂停」\n\n我会直接帮你更新树。',
}

// Session 划分阈值：超过这个间隔没说话，开新 session
const SESSION_GAP_MS = 30 * 60 * 1000  // 30 分钟

/**
 * 浏览器内生成 UUIDv4
 */
function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

export function useChat(user, treeActions, userGoal, model = 'auto') {
  const [messages, setMessages] = useState([WELCOME])
  const [isLoading, setIsLoading] = useState(false)

  // 当前 session：组件挂载时确定，gap 检测后可能换新
  const [sessionId, setSessionId] = useState(null)
  // 用 ref 存最近一条消息时间，方便 sendMessage 里同步判断 gap
  const lastMsgTimeRef = useRef(0)

  // 摘要 + 学习模式：注入 agent 用
  const [recentSummaries, setRecentSummaries] = useState([])
  const [learnedPatterns, setLearnedPatterns] = useState([])

  // 历史会话列表（给 UI 用，不喂给 AI）
  const [sessions, setSessions] = useState([])

  // 推荐命中率 + 推荐记录列表
  const [hitRate, setHitRate] = useState(null)
  const [recommendations, setRecommendations] = useState([])

  // ── 初始加载：决定 currentSession、拉本 session 消息、拉摘要、拉学习模式 ──

  useEffect(() => {
    if (!user) {
      setSessionId(null)
      setMessages([WELCOME])
      setSessions([])
      return
    }
    initSession()
    loadRecentSummaries()
    loadLearnedPatterns()
    loadSessionsList()
    loadRecommendations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function initSession() {
    // 找用户最近一条消息：< 30 分钟则续上，否则开新 session
    const { data: latest } = await supabase
      .from('conversations')
      .select('session_id, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)

    let activeSession
    if (latest?.length && latest[0].session_id) {
      const ageMs = Date.now() - new Date(latest[0].created_at).getTime()
      if (ageMs < SESSION_GAP_MS) {
        activeSession = latest[0].session_id
      } else {
        activeSession = uuid()
        // 顺手触发对上一个 session 的摘要（如果还没摘要）
        fireSummarize(latest[0].session_id)
      }
    } else {
      activeSession = uuid()
    }
    setSessionId(activeSession)
    lastMsgTimeRef.current = latest?.[0]?.created_at ? new Date(latest[0].created_at).getTime() : 0

    // 加载本 session 的消息
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', user.id)
      .eq('session_id', activeSession)
      .order('created_at', { ascending: true })
      .limit(50)

    if (data?.length) {
      setMessages([
        WELCOME,
        ...data.map(r => ({ id: r.id, role: r.role, content: r.content })),
      ])
    } else {
      setMessages([WELCOME])
    }
  }

  async function loadRecentSummaries() {
    const { data } = await supabase
      .from('session_summaries')
      .select('summary, key_decisions, topics, ended_at')
      .eq('user_id', user.id)
      .order('ended_at', { ascending: false })
      .limit(5)
    setRecentSummaries(data || [])
  }

  async function loadLearnedPatterns() {
    const { data } = await supabase
      .from('user_profile')
      .select('learned_patterns')
      .eq('user_id', user.id)
      .maybeSingle()
    setLearnedPatterns(data?.learned_patterns || [])
  }

  /**
   * 拉近 30 天推荐记录 + 计算命中率
   *
   * outcome 字段语义：
   *   - 'completed' = 用户完成了 primary 任务
   *   - 'dropped'   = 推荐后 7+ 天未完成（运行时计算，不存库）
   *   - null        = 仍在 7 天窗口内待办
   */
  async function loadRecommendations() {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
    const { data } = await supabase
      .from('recommendation_log')
      .select('*')
      .eq('user_id', user.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(50)
    const rows = data || []

    // 运行时计算 dropped：未完成 + 已超 7 天
    const SEVEN_DAYS = 7 * 24 * 3600 * 1000
    const now = Date.now()
    const enriched = rows.map(r => {
      const age = now - new Date(r.created_at).getTime()
      let derivedOutcome = r.outcome
      if (!derivedOutcome && age > SEVEN_DAYS) derivedOutcome = 'dropped'
      return { ...r, derived_outcome: derivedOutcome }
    })

    setRecommendations(enriched)

    // 命中率：只计算有 primary_node_id 的推荐（其它的不算推荐而是空泛建议）
    const meaningful = enriched.filter(r => r.primary_node_id)
    const total     = meaningful.length
    const completed = meaningful.filter(r => r.derived_outcome === 'completed').length
    const dropped   = meaningful.filter(r => r.derived_outcome === 'dropped').length
    const pending   = total - completed - dropped
    // 取 3 个流产案例（题目/原 message）做 prompt 反馈用
    const dropped_examples = enriched
      .filter(r => r.derived_outcome === 'dropped')
      .slice(0, 3)
      .map(r => (r.message || '').slice(0, 30))

    setHitRate({ total, completed, dropped, pending, dropped_examples })
  }

  async function loadSessionsList() {
    // 聚合：每个 session 的起止时间、消息数
    const { data } = await supabase
      .from('conversations')
      .select('session_id, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(500)
    if (!data) { setSessions([]); return }
    const grouped = {}
    for (const r of data) {
      const sid = r.session_id
      if (!sid) continue
      if (!grouped[sid]) grouped[sid] = { session_id: sid, count: 0, started_at: r.created_at, ended_at: r.created_at }
      grouped[sid].count++
      if (r.created_at < grouped[sid].started_at) grouped[sid].started_at = r.created_at
      if (r.created_at > grouped[sid].ended_at)   grouped[sid].ended_at   = r.created_at
    }
    // 加上摘要文本
    const { data: sums } = await supabase
      .from('session_summaries')
      .select('session_id, summary')
      .eq('user_id', user.id)
    const sumMap = {}
    ;(sums || []).forEach(s => { sumMap[s.session_id] = s.summary })

    const list = Object.values(grouped)
      .map(g => ({ ...g, summary: sumMap[g.session_id] || null }))
      .sort((a, b) => b.ended_at.localeCompare(a.ended_at))
    setSessions(list)
  }

  // ── 摘要触发（fire-and-forget） ─────────────────────────

  async function fireSummarize(targetSessionId) {
    if (!targetSessionId || !user) return
    try {
      await fetch('/api/summarize-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, session_id: targetSessionId }),
      })
      // 异步刷新本地摘要缓存
      loadRecentSummaries()
      loadSessionsList()
    } catch (e) {
      console.warn('[summarize] failed', e)
    }
  }

  // ── 发消息 ───────────────────────────────────────────────

  const sendMessage = useCallback(async (content, treeData) => {
    // gap 检测：如果距上次消息 > 阈值，开新 session，并触发对旧 session 的摘要
    let activeSession = sessionId
    const now = Date.now()
    if (lastMsgTimeRef.current && now - lastMsgTimeRef.current > SESSION_GAP_MS) {
      const oldSession = activeSession
      activeSession = uuid()
      setSessionId(activeSession)
      setMessages([WELCOME])  // 视觉上清空，但 DB 里的旧 session 保留
      if (oldSession) fireSummarize(oldSession)
    }
    lastMsgTimeRef.current = now

    const userMsg = { id: uuid(), role: 'user', content }
    setMessages(prev => [...prev, userMsg])
    setIsLoading(true)

    if (user) {
      supabase.from('conversations').insert({
        user_id: user.id, role: 'user', content,
        session_id: activeSession,
      })
    }

    try {
      const treeText = treeToPromptText(treeData)
      const nodeIds  = treeData
        ? flattenTree(treeData).map(n => n.id).filter(Boolean)
        : []

      // 当前 session 内的近期对话（已经过滤）
      const history = sanitizeHistoryPairs(
        messages.filter(m => m.id !== 'welcome' && (m.role === 'user' || m.role === 'assistant'))
      )

      const result = await callAgent({
        content, treeText, nodeIds, history, userGoal, model,
        recentSummaries, learnedPatterns, hitRate,
        clientTime: getClientTime(),
      })
      const { reply, actions, thinking, model_used } = result

      // 执行树操作 + 记忆 action
      const newIdByName = {}
      const actionLogs = []
      const learnedToAdd = []

      if (actions?.length) {
        for (const action of actions) {
          if (action.parent && newIdByName[action.parent]) {
            action.parent = newIdByName[action.parent]
          }

          if (action.type === 'remember') {
            // 记忆 action 不动树，写入 learned_patterns
            learnedToAdd.push({
              observation: action.observation,
              confidence: typeof action.confidence === 'number' ? action.confidence : 0.5,
              topic: action.topic || 'general',
              created_at: new Date().toISOString(),
              source_session: activeSession,
            })
            actionLogs.push(`记住了：${action.observation}`)
            continue
          }

          if (!treeActions) continue
          const r = await executeAction(action, treeActions)
          if (r?.log)   actionLogs.push(r.log)
          if (r?.newId && action.name) newIdByName[action.name] = r.newId
        }
      }

      // 持久化新学到的模式
      if (learnedToAdd.length && user) {
        const merged = [...learnedPatterns, ...learnedToAdd].slice(-50)
        setLearnedPatterns(merged)
        supabase.from('user_profile').upsert({
          user_id: user.id, learned_patterns: merged,
        }, { onConflict: 'user_id' })
      }

      const fullReply = actionLogs.length
        ? `${reply}\n\n${actionLogs.map(l => `✅ ${l}`).join('\n')}`
        : reply

      const assistantMsg = {
        id: uuid(),
        role: 'assistant',
        content: fullReply,
        thinking: thinking || null,
        model_used: model_used || null,
      }
      setMessages(prev => [...prev, assistantMsg])

      if (user) {
        supabase.from('conversations').insert({
          user_id: user.id, role: 'assistant', content: fullReply,
          session_id: activeSession,
        })

        if (thinking) {
          // 提取 primary + alternative ids，落到结构化列里方便查询
          const primary = thinking.recommended_primary_id || null
          const alternatives = Array.isArray(thinking.recommended_alternative_ids)
            ? thinking.recommended_alternative_ids.filter(Boolean)
            : []

          supabase.from('recommendation_log').insert({
            user_id: user.id,
            message: content,
            goal_snapshot: userGoal || null,
            thinking,
            reply: fullReply,
            primary_node_id: primary,
            alternative_node_ids: alternatives.length ? alternatives : null,
          }).then(() => {
            // 推荐落库成功后刷新 UI 与命中率
            loadRecommendations()
          })
        }
      }
    } catch (err) {
      console.error('[useChat]', err)
      setMessages(prev => [...prev, {
        id: uuid(),
        role: 'assistant',
        content: '抱歉，出了点问题，请稍后再试。',
      }])
    } finally {
      setIsLoading(false)
    }
  }, [user, messages, treeActions, userGoal, model, sessionId, recentSummaries, learnedPatterns, hitRate])

  /**
   * 清空当前 session 的对话（DB 中保留旧 session 历史，可在历史面板查阅）
   * 同时开一个新 session
   */
  const resetConversation = useCallback(async () => {
    if (!user) { setMessages([WELCOME]); return }
    // 软重置：不删 DB，只开新 session
    const newSid = uuid()
    setSessionId(newSid)
    setMessages([WELCOME])
    lastMsgTimeRef.current = 0
    // 顺手对刚被切掉的 session 做摘要
    if (sessionId) fireSummarize(sessionId)
  }, [user, sessionId])

  /**
   * 彻底删除某个 session（含 conversations 行和 summary 行）
   */
  const deleteSession = useCallback(async (sid) => {
    if (!user || !sid) return
    await supabase.from('conversations').delete().eq('user_id', user.id).eq('session_id', sid)
    await supabase.from('session_summaries').delete().eq('user_id', user.id).eq('session_id', sid)
    if (sid === sessionId) {
      setSessionId(uuid())
      setMessages([WELCOME])
    }
    loadSessionsList()
    loadRecentSummaries()
  }, [user, sessionId])

  /**
   * 获取某个 session 的全部消息（给 UI 历史面板用）
   */
  const fetchSessionMessages = useCallback(async (sid) => {
    if (!user || !sid) return []
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', user.id)
      .eq('session_id', sid)
      .order('created_at', { ascending: true })
    return data || []
  }, [user])

  /**
   * 删除一条已学到的模式（用户纠错）
   */
  const removeLearnedPattern = useCallback(async (index) => {
    if (!user) return
    const next = learnedPatterns.filter((_, i) => i !== index)
    setLearnedPatterns(next)
    await supabase.from('user_profile').upsert({
      user_id: user.id, learned_patterns: next,
    }, { onConflict: 'user_id' })
  }, [user, learnedPatterns])

  /**
   * 注入一条 weekly review 消息到当前对话（带特殊样式标识）
   */
  const injectReviewMessage = useCallback((review) => {
    if (!review) return
    const msg = {
      id: uuid(),
      role: 'assistant',
      content: review.summary || '',
      kind: 'weekly_review',
      review_id: review.id || null,
    }
    setMessages(prev => [...prev, msg])
    // 不写到 conversations，避免污染普通对话流
  }, [])

  return {
    messages, isLoading, sendMessage,
    resetConversation,
    // session 管理
    sessionId, sessions,
    deleteSession, fetchSessionMessages,
    // 学习模式
    learnedPatterns, removeLearnedPattern,
    // 摘要
    recentSummaries,
    // 推荐记录
    recommendations, hitRate, reloadRecommendations: loadRecommendations,
    // 周末回顾
    injectReviewMessage,
  }
}

/**
 * 配对过滤历史消息（防 AI 自我污染）
 */
const STALE_PATTERNS = [
  /已清空(项目)?树/, /已清空所有项目/, /(现在)?是一张白纸/,
  /树已经?清空/, /没有任何项目了?/, /项目树已清空/, /已删除全部/,
]
const DECO_PREFIXES = ['✅', '🎯', '⚠️']

function sanitizeHistoryPairs(arr) {
  const out = []
  for (const m of arr) {
    if (m.role === 'assistant') {
      if (STALE_PATTERNS.some(re => re.test(m.content))) {
        if (out.length && out[out.length - 1].role === 'user') out.pop()
        continue
      }
      const stripped = m.content
        .split('\n')
        .filter(line => !DECO_PREFIXES.some(p => line.trim().startsWith(p)))
        .join('\n').trim()
      if (!stripped) {
        if (out.length && out[out.length - 1].role === 'user') out.pop()
        continue
      }
      out.push({ role: 'assistant', content: stripped })
    } else {
      out.push({ role: m.role, content: m.content })
    }
  }
  return out.slice(-6)
}

// ── 调用服务端 Agent ──────────────────────────────────

async function callAgent({ content, treeText, nodeIds, history, userGoal, model, recentSummaries, learnedPatterns, hitRate, clientTime }) {
  const res = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message:  content,
      treeText, nodeIds, history,
      userGoal, model,
      recentSummaries,
      learnedPatterns,
      hitRate,
      clientTime,
    }),
  })
  if (!res.ok) throw new Error(`Agent request failed: ${res.status}`)
  return res.json()
}

// ── 执行 Action ───────────────────────────────────────

async function executeAction(action, treeActions) {
  const id = action.id || action.task_id || action.node_id
  try {
    switch (action.type) {
      case 'mark_done':
        await treeActions.updateStatus(id, 'done')
        return { log: `已将「${action.name || id}」标记为完成` }
      case 'mark_active':
        await treeActions.updateStatus(id, 'active')
        return { log: `已将「${action.name || id}」恢复为进行中` }
      case 'mark_dormant':
        await treeActions.updateStatus(id, 'dormant')
        return { log: `已将「${action.name || id}」标记为暂停` }
      case 'add_task': {
        const newId = await treeActions.addNode({
          name: action.name, type: 'task', parentId: action.parent,
          annotations: action.annotations,
        })
        return { log: `已添加任务「${action.name}」`, newId }
      }
      case 'add_category': {
        const newId = await treeActions.addNode({
          name: action.name, type: 'category', parentId: action.parent,
          annotations: action.annotations,
        })
        return { log: `已添加分类「${action.name}」`, newId }
      }
      case 'add_project': {
        const newId = await treeActions.addNode({
          name: action.name, type: 'project', color: action.color || '#4A8C5C',
          annotations: action.annotations,
        })
        return { log: `已创建项目「${action.name}」`, newId }
      }
      case 'rename':
        await treeActions.renameNode(id, action.name)
        return { log: `已重命名为「${action.name}」` }
      case 'delete':
        await treeActions.deleteNode(id)
        return { log: `已删除「${action.name || id}」` }
      case 'clear_all':
        await treeActions.clearAll()
        return { log: '已清空所有项目（可点撤销恢复）' }
      case 'annotate':
        await treeActions.annotateNode(id, action.annotations)
        return { log: `已为「${action.name || id}」更新策略标签` }
      default:
        console.warn('[executeAction] unknown type:', action.type)
        return null
    }
  } catch (err) {
    console.error('[executeAction] failed:', action, err)
    return { log: `操作失败：${action.name || id}` }
  }
}
