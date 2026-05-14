import { useState, useCallback, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { treeToPromptText, flattenTree } from '../lib/treeUtils'
import { getClientTime } from '../lib/clientTime'
import { classifyIntent } from '../lib/intentClassifier'

const WELCOME = {
  id: 'welcome',
  role: 'assistant',
  content: '你好，我是你的专注树助理。说说现在想做什么？',
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
  // 保存最后一条用户消息，失败后可重试
  const lastUserMessageRef = useRef('')
  // 防竞态：initSession 异步调用序号，只取最新一次的结果
  const initGenRef = useRef(0)
  // 取消在途请求
  const abortRef = useRef(null)
  // 消息队列：AI 处理中用户提交的新消息暂存于此
  const [pendingQueue, setPendingQueue] = useState([])

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
    const gen = ++initGenRef.current
    initSession(gen)
    loadRecentSummaries()
    loadLearnedPatterns()
    loadSessionsList()
    loadRecommendations()
  }, [user?.id])

  async function initSession(gen) {
    // 始终恢复最近一个 session，不在此处做 gap 切分
    // gap 切分只在用户主动发消息时（sendMessage）触发
    const { data: latest, error: err1 } = await supabase
      .from('conversations')
      .select('session_id, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)

    if (gen !== initGenRef.current) return
    if (err1) {
      console.warn('[initSession] query latest failed, keeping current state:', err1.message)
      return
    }

    const activeSession = (latest?.length && latest[0].session_id)
      ? latest[0].session_id
      : uuid()
    setSessionId(activeSession)
    lastMsgTimeRef.current = latest?.[0]?.created_at ? new Date(latest[0].created_at).getTime() : 0

    // 加载本 session 的消息
    const { data, error: err2 } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', user.id)
      .eq('session_id', activeSession)
      .order('created_at', { ascending: true })
      .limit(50)

    if (gen !== initGenRef.current) return
    if (err2) {
      console.warn('[initSession] query messages failed, keeping current state:', err2.message)
      return
    }

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
    // 若 AI 正在处理，将消息加入队列
    if (isLoading) {
      setPendingQueue(prev => [...prev, content])
      return
    }

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
    lastUserMessageRef.current = content
    setMessages(prev => [...prev, userMsg])
    setIsLoading(true)

    // 创建取消控制器
    const controller = new AbortController()
    abortRef.current = controller

    if (user) {
      await supabase.from('conversations').insert({
        user_id: user.id, role: 'user', content,
        session_id: activeSession,
      })
    }

    // ⚡ 算法层短路：明确指令（加/删/改/标记 等）直接本地执行，不打 LLM
    //   节省 token、消除模型差异、零延迟。只有推理类问题才下沉到 LLM。
    const intent = classifyIntent(content, treeData)
    if (intent.matched) {
      try {
        // 特殊操作（展开/折叠所有）
        if (intent.special === 'expandAll'   && treeActions?.expandAll)   { treeActions.expandAll();   }
        if (intent.special === 'collapseAll' && treeActions?.collapseAll) { treeActions.collapseAll(); }

        // 算法解析出 reply（比如歧义提示），直接显示
        if (intent.reply) {
          const assistantMsg = {
            id: uuid(), role: 'assistant', content: intent.reply,
            kind: 'local',
          }
          setMessages(prev => [...prev, assistantMsg])
          if (user) {
            supabase.from('conversations').insert({
              user_id: user.id, role: 'assistant', content: intent.reply,
              session_id: activeSession,
            })
          }
          setIsLoading(false)
          return
        }

        // 执行 actions
        const actionLogs = []
        const newIdByName = {}
        if (intent.actions?.length && treeActions) {
          for (const action of intent.actions) {
            if (action.parent && newIdByName[action.parent]) {
              action.parent = newIdByName[action.parent]
            }
            const r = await executeAction(action, treeActions)
            if (r?.log) actionLogs.push(r.log)
            if (r?.newId && action.name) newIdByName[action.name] = r.newId
          }
        }

        // 用一条极简的本地 reply 替代 LLM 的回复
        const replyText = intent.special
          ? '✓ 已操作'
          : (actionLogs.length
              ? actionLogs.map(l => `✅ ${l}`).join('\n')
              : '✓ 已处理')

        const assistantMsg = {
          id: uuid(), role: 'assistant', content: replyText,
          kind: 'local',
        }
        setMessages(prev => [...prev, assistantMsg])

        if (user && !intent.special) {
          supabase.from('conversations').insert({
            user_id: user.id, role: 'assistant', content: replyText,
            session_id: activeSession,
          })
        }
      } catch (err) {
        console.error('[useChat] local intent execution failed:', err)
        setMessages(prev => [...prev, {
          id: uuid(), role: 'assistant',
          content: `操作出错：${err.message || err}`,
        }])
      } finally {
        setIsLoading(false)
      }
      return  // 短路成功，不打 LLM
    }

    try {
      const treeText = treeToPromptText(treeData)
      const nodeIds  = treeData
        ? flattenTree(treeData).map(n => n.id).filter(Boolean)
        : []

      // 当前 session 内的近期对话（服务端会做 sanitize，这里只传原始消息）
      const history = messages
        .filter(m => m.id !== 'welcome' && (m.role === 'user' || m.role === 'assistant'))
        .slice(-10)

      const result = await callAgent({
        content, treeText, nodeIds, history, userGoal, model,
        recentSummaries, learnedPatterns, hitRate,
        clientTime: getClientTime(),
        signal: controller.signal,
      })
      const { reply, actions, thinking, model_used, error, aborted } = result

      // 用户主动停止，静默退出
      if (aborted) return

      // 执行树操作 + 记忆 action
      const newIdByName = {}
      const learnedToAdd = []

      // 清空操作需用户二次确认
      if (actions?.some(a => a.type === 'clear_all')) {
        if (!window.confirm('确定要清空所有项目吗？此操作可撤销。')) {
          // 用户取消：跳过所有操作，只保留 AI 的消息提示
          const cancelMsg = {
            id: uuid(),
            role: 'assistant',
            content: '已取消清空操作。',
          }
          setMessages(prev => [...prev, cancelMsg])
          setIsLoading(false)
          abortRef.current = null
          return
        }
      }

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
            continue
          }

          if (!treeActions) continue
          const r = await executeAction(action, treeActions)
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

      const assistantMsg = {
        id: uuid(),
        role: 'assistant',
        content: reply,
        thinking: thinking || null,
        model_used: model_used || null,
        isError: !!error,
      }
      setMessages(prev => [...prev, assistantMsg])

      if (user) {
        await supabase.from('conversations').insert({
          user_id: user.id, role: 'assistant', content: reply,
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
            reply: reply,
            primary_node_id: primary,
            alternative_node_ids: alternatives.length ? alternatives : null,
          }).then(() => {
            // 推荐落库成功后刷新 UI 与命中率
            loadRecommendations()
          })
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return  // 用户主动停止
      console.error('[useChat]', err)
      setMessages(prev => [...prev, {
        id: uuid(),
        role: 'assistant',
        content: '抱歉，出了点问题，请稍后再试。',
        isError: true,
      }])
    } finally {
      abortRef.current = null
      // 处理队列中的下一条消息
      setPendingQueue(prev => {
        if (prev.length > 0) {
          const next = prev[0]
          const rest = prev.slice(1)
          // 延迟一 tick 保证 state 更新
          setTimeout(() => sendMessage(next, treeData), 0)
          return rest
        }
        setIsLoading(false)
        return prev
      })
    }
  }, [user, messages, treeActions, userGoal, model, sessionId, recentSummaries, learnedPatterns, hitRate, isLoading])

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

  /**
   * 取消当前请求并清空队列
   */
  const cancelRequest = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setPendingQueue([])
    setIsLoading(false)
  }, [])

  /**
   * 重试最后一条用户消息
   */
  const retryLastMessage = useCallback(async (treeData) => {
    const content = lastUserMessageRef.current
    if (!content || isLoading) return
    await sendMessage(content, treeData)
  }, [sendMessage, isLoading])

  return {
    messages, isLoading, sendMessage,
    retryLastMessage,
    cancelRequest, pendingQueue,
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

// 客户端不再做 sanitize——服务端 agent.js 已统一处理配对过滤和装饰行剥离

// ── 调用服务端 Agent ──────────────────────────────────

async function callAgent({ content, treeText, nodeIds, history, userGoal, model, recentSummaries, learnedPatterns, hitRate, clientTime, signal }) {
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
    signal,
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
          weight: action.weight,
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
