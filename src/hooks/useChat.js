import { useState, useCallback, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { treeToPromptText, flattenTree, findNodeById } from '../lib/treeUtils'
import { getClientTime } from '../lib/clientTime'
import { classifyIntent } from '../lib/intentClassifier'
import { routeLocalQuery } from '../lib/agentRouter'

const WELCOME = {
  id: 'welcome',
  role: 'assistant',
  content: '你好，我是你的专注树助理。说说现在想做什么？',
}

const SESSION_LOAD_LIMIT = 200
const AGENT_HISTORY_MESSAGE_LIMIT = 14
const AGENT_HISTORY_LIMIT_BY_MODE = {
  global_tree: 6,
  focused_node: 4,
  task_pick: 4,
  minimal: 2,
}

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

function classifyAgentContextMode(content) {
  const text = String(content || '').trim()
  if (!text) return 'minimal'

  const globalWords = /(全局|整体|全部|所有项目|整棵树|项目树|总览|全盘|大盘|重新规划|整体规划|所有分支|所有主线|全局梳理|全局整理|项目总成)/
  if (globalWords.test(text)) return 'global_tree'

  const focusedWords = /(这个|这里|当前|这个节点|这个项目|这件事|这条线|下一步|怎么拆|怎么做|卡住|详情|补充)/
  if (focusedWords.test(text)) return 'focused_node'

  const taskPickWords = /(今天|本周|这周|明天|现在|接下来|下一步|优先级|先做什么|做什么|该做什么|安排|deadline|截止|到期)/
  if (taskPickWords.test(text)) return 'task_pick'

  if (text.length > 80 || /\n/.test(text)) return 'global_tree'
  return 'minimal'
}

function buildAgentTreeContext(treeData, userGoal, mode, selectedNodeId, content) {
  if (!treeData) return { treeText: '（暂无项目）', contextMode: 'minimal' }
  if (mode === 'global_tree') {
    return { treeText: treeToPromptText(treeData, userGoal), contextMode: mode }
  }
  if (mode === 'focused_node') {
    return { treeText: focusedNodeContext(treeData, selectedNodeId, content), contextMode: mode }
  }
  if (mode === 'task_pick') {
    return { treeText: activeTaskContext(treeData), contextMode: mode }
  }
  return { treeText: minimalTreeContext(treeData), contextMode: mode }
}

function buildUserMemory(learnedPatterns, recentSummaries) {
  const patterns = (learnedPatterns || [])
    .slice(-8)
    .map(p => {
      if (typeof p === 'string') return p
      return p?.observation || p?.text || p?.summary || ''
    })
    .filter(Boolean)

  const summaries = (recentSummaries || [])
    .slice(0, 3)
    .map(s => s?.summary || '')
    .filter(Boolean)

  if (!patterns.length && !summaries.length) return null
  return { patterns, recent: summaries }
}

function compactHistoryForMode(messages, mode) {
  const limit = AGENT_HISTORY_LIMIT_BY_MODE[mode] || AGENT_HISTORY_MESSAGE_LIMIT
  return messages
    .filter(m => m.id !== 'welcome' && (m.role === 'user' || m.role === 'assistant'))
    .slice(-limit)
    .map(m => ({ role: m.role, content: String(m.content || '').slice(0, 600) }))
}

function focusedNodeContext(treeData, selectedNodeId, content) {
  const allNodes = flattenTree(treeData).filter(n => n.type !== 'root')
  let node = selectedNodeId ? findNodeById(treeData, selectedNodeId) : null
  if (!node) node = findMentionedNode(allNodes, content)
  if (!node) return activeTaskContext(treeData)

  const parent = node.parent_id ? findNodeById(treeData, node.parent_id) : null
  const siblings = parent?.children?.filter(n => n.id !== node.id) || []
  const children = node.children || []
  const lines = [
    `上下文范围：当前节点局部，不是整棵树。`,
    `当前节点：${nodeLine(node)}`,
  ]
  if (parent) lines.push(`父节点：${nodeLine(parent)}`)
  if (siblings.length) {
    lines.push(`同级节点：${siblings.slice(0, 12).map(nodeLine).join('；')}`)
  }
  if (children.length) {
    lines.push(`子节点：${children.slice(0, 18).map(nodeLine).join('；')}`)
  }
  const details = node.annotations?.ai_notes
  if (details) lines.push(`节点详情：${String(details).slice(0, 800)}`)
  return lines.join('\n')
}

function activeTaskContext(treeData) {
  const rows = []
  walkTree(treeData, [], node => {
    if (node.type === 'root') return
    if (node.status === 'done' || node.status === 'dormant') return
    if (node.type === 'task' || !node.children?.length) {
      rows.push(`${nodePath([...node.__path, node])} (id:${node.id}, type:${node.type})`)
    }
  })
  return [
    '上下文范围：活跃任务候选，不是整棵树。',
    ...(rows.length ? rows.slice(0, 36) : ['暂无活跃任务候选。']),
  ].join('\n')
}

function minimalTreeContext(treeData) {
  const projects = (treeData.children || []).slice(0, 20)
  return [
    '上下文范围：极简项目索引，不是整棵树。',
    ...projects.map(node => `${node.name} (id:${node.id}, status:${node.status || 'active'}, children:${node.children?.length || 0})`),
  ].join('\n')
}

function findMentionedNode(nodes, content) {
  const text = String(content || '')
  const exact = nodes.find(n => n.name && text.includes(n.name))
  if (exact) return exact
  return nodes
    .filter(n => n.name && n.name.length >= 2 && text.includes(n.name.slice(0, Math.min(6, n.name.length))))
    .sort((a, b) => String(b.name).length - String(a.name).length)[0] || null
}

function walkTree(node, path, visit) {
  const current = { ...node, __path: path }
  visit(current)
  for (const child of node.children || []) {
    walkTree(child, [...path, node].filter(n => n.type !== 'root'), visit)
  }
}

function nodeLine(node) {
  return `${node.name} (id:${node.id}, type:${node.type}, status:${node.status || 'active'}, children:${node.children?.length || 0})`
}

function nodePath(nodes) {
  return nodes.filter(Boolean).map(n => n.name).join(' > ')
}

export function useChat(user, treeActions, userGoal, model = 'auto') {
  const [messages, setMessages] = useState([WELCOME])
  const [isLoading, setIsLoading] = useState(false)

  // 当前 session：组件挂载时恢复最近一段；只在用户主动新开对话时更换
  const [sessionId, setSessionId] = useState(null)
  // 用 ref 存最近一条消息时间，仅做状态记录，不自动切 session
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
      .limit(SESSION_LOAD_LIMIT)

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

  const applyConfirmablePlan = useCallback(async (sourceMsg, treeData, activeSession) => {
    const thinking = sourceMsg?.thinking
    if (!thinking || !treeActions) return false

    const draftActions = sourceMsg.applied_draft_actions ? [] : thinking.draft_actions
    const draftResult = await executeDraftActionsSafely(draftActions, treeActions, treeData)
    const weightResult = sourceMsg.applied_weight_plan
      ? { status: 'none' }
      : await applyWeightProposalsSafely(thinking, treeActions, treeData, draftResult.newIdByName)

    const replyParts = []
    if (draftResult.attempted) {
      if (draftResult.createdCount > 0) {
        replyParts.push(`已按上一条草案应用到面板：创建/更新 ${draftResult.createdCount} 个节点。`)
      } else if (draftResult.skippedCount > 0) {
        replyParts.push('上一条草案里的节点已经在面板里，我没有重复创建。')
      }
    }

    if (weightResult.status === 'applied') {
      replyParts.push('已应用这套权重方案。')
    } else if (weightResult.status === 'blocked') {
      replyParts.push('权重方案仍需先确认排序原则，我没有自动写入。')
    } else if (weightResult.status === 'missing') {
      replyParts.push(`权重方案里有分支还没法对应到面板节点：${weightResult.names.join('、')}。`)
    } else if (weightResult.status === 'invalid') {
      replyParts.push(`权重方案里有分支缺少有效百分比：${weightResult.names.join('、')}。`)
    }

    if (!replyParts.length) return false

    const content = replyParts.join('\n')
    const assistantMsg = { id: uuid(), role: 'assistant', content, kind: 'local' }
    setMessages(prev => [
      ...prev.map(m => m.id === sourceMsg.id ? {
        ...m,
        applied_draft_actions: draftResult.attempted ? true : m.applied_draft_actions,
        applied_weight_plan: weightResult.status === 'applied' ? true : m.applied_weight_plan,
      } : m),
      assistantMsg,
    ])
    if (user) {
      supabase.from('conversations').insert({
        user_id: user.id, role: 'assistant', content,
        session_id: activeSession,
      })
    }
    return true
  }, [treeActions, user])

  const applyDraftPlan = useCallback(async (messageId, treeData) => {
    if (!messageId || !treeActions) return
    const sourceMsg = messages.find(m => m.id === messageId)
    const thinking = sourceMsg?.thinking
    if (!sourceMsg || sourceMsg.applied_draft_actions || !Array.isArray(thinking?.draft_actions) || !thinking.draft_actions.length) return

    const draftResult = await executeDraftActionsSafely(thinking.draft_actions, treeActions, treeData)
    const content = draftResult.createdCount > 0
      ? `已按这套结构草案应用到面板：创建/更新 ${draftResult.createdCount} 个节点。`
      : '这套结构草案里的节点已经在面板里，我没有重复创建。'

    setMessages(prev => [
      ...prev.map(m => m.id === messageId ? { ...m, applied_draft_actions: true } : m),
      { id: uuid(), role: 'assistant', content, kind: 'local' },
    ])
    if (user && sessionId) {
      supabase.from('conversations').insert({
        user_id: user.id, role: 'assistant', content,
        session_id: sessionId,
      })
    }
  }, [messages, treeActions, user, sessionId])

  // ── 发消息 ───────────────────────────────────────────────

  const sendMessage = useCallback(async (content, treeData, options = {}) => {
    // 若 AI 正在处理，将消息加入队列
    if (isLoading) {
      setPendingQueue(prev => [...prev, content])
      return
    }

    let activeSession = sessionId || uuid()
    const now = Date.now()
    if (!sessionId) {
      setSessionId(activeSession)
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

    if (isConfirmationText(content)) {
      try {
        const sourceMsg = findLatestConfirmableMessage(messages)
        if (!sourceMsg) {
          const reply = '我没找到上一条可应用的草案。你想确认哪一项？'
          setMessages(prev => [...prev, { id: uuid(), role: 'assistant', content: reply, kind: 'local' }])
          if (user) {
            supabase.from('conversations').insert({
              user_id: user.id, role: 'assistant', content: reply,
              session_id: activeSession,
            })
          }
          setIsLoading(false)
          abortRef.current = null
          return
        }

        const handled = await applyConfirmablePlan(sourceMsg, treeData, activeSession)
        if (handled) {
          setIsLoading(false)
          abortRef.current = null
          return
        }
      } catch (err) {
        console.error('[useChat] confirm previous plan failed:', err)
        setMessages(prev => [...prev, {
          id: uuid(), role: 'assistant',
          content: `确认操作出错：${err.message || err}`,
          kind: 'local',
        }])
        setIsLoading(false)
        abortRef.current = null
        return
      }
    }

    // ⚡ 算法层短路：明确指令（加/删/改/标记 等）直接本地执行，不打 LLM
    //   节省 token、消除模型差异、零延迟。只有推理类问题才下沉到 LLM。
    const intent = classifyIntent(content, treeData)
    if (intent.matched) {
      try {
        // 特殊操作（展开/折叠所有）
        if (intent.special === 'expandAll'   && treeActions?.expandAll)   { treeActions.expandAll();   }
        if (intent.special === 'collapseAll' && treeActions?.collapseAll) { treeActions.collapseAll(); }

        // 算法解析出纯提示（比如歧义/找不到），直接显示；带 actions 的 reply 继续往下执行动作
        if (intent.reply && !intent.actions?.length && !intent.special) {
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

        if (intent.actions?.some(a => a.type === 'clear_all')) {
          if (!window.confirm('确定要清空所有项目吗？此操作可撤销。')) {
            const content = '已取消清空操作。'
            const assistantMsg = {
              id: uuid(), role: 'assistant', content,
              kind: 'local',
            }
            setMessages(prev => [...prev, assistantMsg])
            if (user) {
              supabase.from('conversations').insert({
                user_id: user.id, role: 'assistant', content,
                session_id: activeSession,
              })
            }
            setIsLoading(false)
            return
          }
        }

        // 执行 actions
        const actionLogs = []
        const newIdByName = {}
        if (intent.actions?.length && treeActions) {
          const executableActions = withGeneratedChildWeights(intent.actions.map(normalizeDraftAction))
          for (const action of executableActions) {
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
          : (intent.reply || (actionLogs.length
              ? actionLogs.map(l => `✅ ${l}`).join('\n')
              : '✓ 已处理'))

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

    const localQuery = routeLocalQuery(content, treeData, {
      selectedNodeId: options.selectedNodeId,
      userGoal,
    })
    if (localQuery?.matched) {
      const assistantMsg = {
        id: uuid(),
        role: 'assistant',
        content: localQuery.reply,
        kind: 'local',
        local_route: localQuery.route,
      }
      setMessages(prev => [...prev, assistantMsg])
      if (user) {
        supabase.from('conversations').insert({
          user_id: user.id, role: 'assistant', content: localQuery.reply,
          session_id: activeSession,
        })
      }
      setIsLoading(false)
      abortRef.current = null
      return
    }

    try {
      const requestedContextMode = classifyAgentContextMode(content)
      const { treeText, contextMode } = buildAgentTreeContext(
        treeData,
        userGoal,
        requestedContextMode,
        options.selectedNodeId,
        content
      )
      const nodeIds  = treeData
        ? flattenTree(treeData).map(n => n.id).filter(Boolean)
        : []

      // 当前 session 内的近期对话（服务端会做 sanitize，这里只传原始消息）
      const history = compactHistoryForMode(messages, contextMode)
      const userMemory = buildUserMemory(learnedPatterns, recentSummaries)

      const agentStartedAt = performance.now()
      const result = await callAgent({
        content, treeText, nodeIds, history, userGoal, model,
        recentSummaries: [], learnedPatterns: [],
        userMemory, contextMode, hitRate,
        clientTime: getClientTime(),
        signal: controller.signal,
      })
      const responseMs = Math.round(performance.now() - agentStartedAt)
      const { intent, reply, actions, thinking, model_used, context_policy, usage, usage_cost, error, aborted } = result

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
        const executableActions = withGeneratedChildWeights(actions.map(normalizeDraftAction))
        for (const action of executableActions) {
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
        intent: intent || null,
        thinking: thinking || null,
        model_used: model_used || null,
        context_policy: context_policy || null,
        response_ms: responseMs,
        usage: usage || null,
        usage_cost: usage_cost || null,
        isError: !!error,
      }
      setMessages(prev => [...prev, assistantMsg])

      if (user) {
        await supabase.from('conversations').insert({
          user_id: user.id, role: 'assistant', content: reply,
          session_id: activeSession,
        })

        if (intent === 'query' && thinking) {
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
          setTimeout(() => sendMessage(next, treeData, options), 0)
          return rest
        }
        setIsLoading(false)
        return prev
      })
    }
  }, [user, messages, treeActions, userGoal, model, sessionId, recentSummaries, learnedPatterns, hitRate, isLoading, applyConfirmablePlan])

  /**
   * 应用 AI 在草案卡片里提出的整套权重方案。
   * 权重语义是同级精力配比：应用前按父级分组归一化到 100%。
   */
  const applyWeightPlan = useCallback(async (messageId, treeData) => {
    if (!treeActions?.updateWeight || !messageId) return
    const msg = messages.find(m => m.id === messageId)
    const thinking = msg?.thinking
    const proposals = Array.isArray(thinking?.branch_weight_proposals)
      ? thinking.branch_weight_proposals
      : []
    if (!msg || msg.applied_weight_plan || proposals.length === 0) return

    const conflicts = Array.isArray(thinking.conflicts) ? thinking.conflicts.filter(Boolean) : []
    if (conflicts.length || thinking.weight_strategy?.requires_clarification) {
      const content = '这套权重方案还有未确认的冲突，先确认排序原则后再应用。'
      setMessages(prev => [...prev, { id: uuid(), role: 'assistant', content, kind: 'local' }])
      return
    }

    const allNodes = treeData ? flattenTree(treeData).filter(n => n.type !== 'root') : []
    const byName = new Map()
    for (const node of allNodes) {
      if (node.name && !byName.has(node.name)) byName.set(node.name, node)
    }

    let newIdByName = {}
    const resolveProposals = () => proposals.map(proposal => {
      const name = proposal.name || proposal.branch_name
      const explicitId = proposal.node_id || proposal.id || proposal.nodeId
      const node =
        (explicitId && findNodeById(treeData, explicitId)) ||
        (name && newIdByName[name] ? { id: newIdByName[name], name } : null) ||
        (name ? byName.get(name) : null)
      const share = readSuggestedShare(proposal)
      const group = proposal.parent_id || proposal.parent_name || thinking.weight_strategy?.normalization_parent || 'root'
      return { proposal, node, name, share, group }
    })

    let resolved = resolveProposals()
    let missingTargets = resolved.filter(item => !item.node?.id)
    let invalidShares = resolved.filter(item => typeof item.share !== 'number')

    if (missingTargets.length && Array.isArray(thinking.draft_actions) && thinking.draft_actions.length) {
      const draftResult = await executeDraftActionsSafely(thinking.draft_actions, treeActions, treeData)
      newIdByName = draftResult.newIdByName
      resolved = resolveProposals()
      missingTargets = resolved.filter(item => !item.node?.id)
      invalidShares = resolved.filter(item => typeof item.share !== 'number')
    }

    if (missingTargets.length) {
      const names = missingTargets.map(item => item.name || '未命名分支').join('、')
      const content = `这套权重方案里有分支还没法对应到面板节点：${names}。请先应用结构草案或让我重新生成。`
      setMessages(prev => [...prev, { id: uuid(), role: 'assistant', content, kind: 'local' }])
      return
    }
    if (invalidShares.length) {
      const names = invalidShares.map(item => item.name || '未命名分支').join('、')
      const content = `这套权重方案里有分支缺少有效百分比：${names}。请让我重新生成一版权重草案。`
      setMessages(prev => [...prev, { id: uuid(), role: 'assistant', content, kind: 'local' }])
      return
    }

    const groups = new Map()
    for (const item of resolved) {
      if (!groups.has(item.group)) groups.set(item.group, [])
      groups.get(item.group).push(item)
    }

    for (const items of groups.values()) {
      const total = items.reduce((sum, item) => sum + item.share, 0)
      if (total <= 0) continue
      for (const item of items) {
        const normalizedWeight = item.share / total
        await treeActions.updateWeight(item.node.id, normalizedWeight)
      }
    }

    const content = '已应用这套权重方案。'
    setMessages(prev => [
      ...prev.map(m => m.id === messageId ? { ...m, applied_weight_plan: true } : m),
      { id: uuid(), role: 'assistant', content, kind: 'local' },
    ])
    if (user && sessionId) {
      supabase.from('conversations').insert({
        user_id: user.id, role: 'assistant', content,
        session_id: sessionId,
      })
    }
  }, [messages, treeActions, user, sessionId])

  /**
   * 用户主动新开对话。
   * DB 中保留旧 session 历史，可在历史面板查阅；旧 session 会异步摘要。
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
  const retryLastMessage = useCallback(async (treeData, options = {}) => {
    const content = lastUserMessageRef.current
    if (!content || isLoading) return
    await sendMessage(content, treeData, options)
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
    applyWeightPlan,
    applyDraftPlan,
  }
}

// 客户端不再做 sanitize——服务端 agent.js 已统一处理配对过滤和装饰行剥离

// ── 调用服务端 Agent ──────────────────────────────────

async function callAgent({ content, treeText, nodeIds, history, userGoal, model, recentSummaries, learnedPatterns, userMemory, contextMode, hitRate, clientTime, signal }) {
  const res = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message:  content,
      treeText, nodeIds, history,
      userGoal, model,
      recentSummaries,
      learnedPatterns,
      userMemory,
      contextMode,
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
          weight: readActionWeight(action) ?? 1,
        })
        return { log: `已添加任务「${action.name}」`, newId }
      }
      case 'add_category': {
        const newId = await treeActions.addNode({
          name: action.name, type: 'category', parentId: action.parent,
          annotations: action.annotations,
          weight: readActionWeight(action) ?? 1,
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
      case 'set_weight':
        await treeActions.updateWeight(id, action.weight)
        return { log: `已将「${action.name || id}」权重调整为 ${Math.round(action.weight * 100)}%` }
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

function readSuggestedShare(proposal) {
  const raw =
    proposal?.suggested_share ??
    proposal?.suggested_weight ??
    proposal?.weight ??
    proposal?.share
  const value = typeof raw === 'string' ? Number(raw.replace('%', '').trim()) : raw
  if (!Number.isFinite(value) || value < 0) return null
  return value > 2 ? value / 100 : value
}

function normalizeDraftAction(action) {
  return {
    ...action,
    id: action.id || action.node_id || action.nodeId || action.task_id || action.taskId,
    parent: action.parent || action.parent_id || action.parentId,
  }
}

function readActionWeight(action) {
  const value = typeof action?.weight === 'string'
    ? Number(action.weight.replace('%', '').trim())
    : action?.weight
  if (!Number.isFinite(value) || value < 0) return null
  return value > 2 ? value / 100 : Math.min(2, value)
}

function generatedChildWeightScore(action) {
  const annotations = action?.annotations || {}
  const text = [
    action?.name,
    annotations.strategic_tag,
    annotations.time_horizon,
    annotations.energy_cost,
    annotations.risk,
    annotations.ai_notes,
    annotations.roi_type && typeof annotations.roi_type === 'object'
      ? Object.keys(annotations.roi_type).join(' ')
      : '',
  ].filter(Boolean).join(' ')

  let score = action?.type === 'add_task' ? 1 : 0.8
  if (annotations.time_horizon === '立即') score += 0.75
  if (annotations.time_horizon === '短期') score += 0.4
  if (annotations.strategic_tag === '现金流') score += 0.35
  if (annotations.risk === '确定性') score += 0.12
  if (/今天|明天|本周|截止|答辩|交付|提交|清零|紧急/i.test(text)) score += 0.35
  if (/写|剪|做|发|联系|整理|提交|更新|制作|修复|完成/.test(text)) score += 0.15
  if (/想法|构思|灵感|待定|以后|暂缓/.test(text)) score -= 0.25
  return Math.max(0.1, score)
}

function withGeneratedChildWeights(actions) {
  if (!Array.isArray(actions) || !actions.length) return []
  const prepared = actions.map(action => ({ ...action }))
  const groups = new Map()

  prepared.forEach(action => {
    if (!['add_task', 'add_category'].includes(action.type)) return
    if (!action.parent) return
    const groupKey = String(action.parent)
    if (!groups.has(groupKey)) groups.set(groupKey, [])
    groups.get(groupKey).push(action)
  })

  groups.forEach(groupActions => {
    const explicit = groupActions
      .map(readActionWeight)
      .filter(weight => typeof weight === 'number')
    const explicitTotal = explicit.reduce((sum, weight) => sum + weight, 0)
    const missing = groupActions.filter(action => readActionWeight(action) == null)
    const remaining = Math.max(0, 1 - explicitTotal)
    const missingScores = missing.map(generatedChildWeightScore)
    const missingScoreTotal = missingScores.reduce((sum, score) => sum + score, 0)
    const equalFallback = 1 / groupActions.length

    groupActions.forEach(action => {
      const existingWeight = readActionWeight(action)
      if (existingWeight != null) {
        action.weight = existingWeight
        return
      }
      const missingIndex = missing.indexOf(action)
      const score = missingScores[missingIndex] ?? 0
      action.weight = remaining <= 0
        ? 0
        : (missingScoreTotal > 0 ? remaining * (score / missingScoreTotal) : equalFallback)
    })
  })

  return prepared
}

function isConfirmationText(text) {
  return /^(?:确认|确认执行|应用|应用方案|按这个|按这个执行|按你说的|按你说的做|就这样|落到面板|加到面板|建出来|执行)(?:吧|。|！|!|\.)?\s*$/.test((text || '').trim())
}

function findLatestConfirmableMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.role !== 'assistant' || !msg.thinking) continue
    const hasDraft = Array.isArray(msg.thinking.draft_actions) &&
      msg.thinking.draft_actions.length > 0 &&
      !msg.applied_draft_actions
    const hasWeights = Array.isArray(msg.thinking.branch_weight_proposals) &&
      msg.thinking.branch_weight_proposals.length > 0 &&
      !msg.applied_weight_plan
    if (hasDraft || hasWeights) return msg
  }
  return null
}

async function executeDraftActionsSafely(actions, treeActions, treeData) {
  const allowedDraftTypes = new Set(['add_project', 'add_category', 'add_task', 'annotate'])
  const draftActions = Array.isArray(actions)
    ? withGeneratedChildWeights(actions.filter(action => allowedDraftTypes.has(action?.type)).map(normalizeDraftAction))
    : []
  const result = {
    attempted: draftActions.length > 0,
    createdCount: 0,
    skippedCount: 0,
    newIdByName: {},
  }
  if (!draftActions.length || !treeActions) return result

  const index = createTreeIndex(treeData)
  for (const action of draftActions) {
    const nextAction = { ...action }
    const existing = findExistingDraftNode(nextAction, index, result.newIdByName)
    if (existing?.id) {
      if (nextAction.name) result.newIdByName[nextAction.name] = existing.id
      result.skippedCount += 1
      continue
    }

    if (nextAction.parent) {
      nextAction.parent = resolveDraftParentId(nextAction.parent, index, result.newIdByName)
    }
    const actionResult = await executeAction(nextAction, treeActions)
    if (actionResult?.newId && nextAction.name) result.newIdByName[nextAction.name] = actionResult.newId
    result.createdCount += 1
  }
  return result
}

async function applyWeightProposalsSafely(thinking, treeActions, treeData, newIdByName = {}) {
  const proposals = Array.isArray(thinking?.branch_weight_proposals)
    ? thinking.branch_weight_proposals
    : []
  if (!proposals.length || !treeActions?.updateWeight) return { status: 'none' }

  const conflicts = Array.isArray(thinking.conflicts) ? thinking.conflicts.filter(Boolean) : []
  if (conflicts.length || thinking.weight_strategy?.requires_clarification) {
    return { status: 'blocked' }
  }

  const index = createTreeIndex(treeData)
  const resolved = proposals.map(proposal => {
    const name = proposal.name || proposal.branch_name
    const explicitId = proposal.node_id || proposal.id || proposal.nodeId
    const node =
      (explicitId && findNodeById(treeData, explicitId)) ||
      (name && newIdByName[name] ? { id: newIdByName[name], name } : null) ||
      (name ? index.byName.get(name) : null)
    const share = readSuggestedShare(proposal)
    const group = proposal.parent_id || proposal.parent_name || thinking.weight_strategy?.normalization_parent || 'root'
    return { node, name, share, group }
  })

  const missingTargets = resolved.filter(item => !item.node?.id)
  if (missingTargets.length) {
    return { status: 'missing', names: missingTargets.map(item => item.name || '未命名分支') }
  }
  const invalidShares = resolved.filter(item => typeof item.share !== 'number')
  if (invalidShares.length) {
    return { status: 'invalid', names: invalidShares.map(item => item.name || '未命名分支') }
  }

  const groups = new Map()
  for (const item of resolved) {
    if (!groups.has(item.group)) groups.set(item.group, [])
    groups.get(item.group).push(item)
  }

  for (const items of groups.values()) {
    const total = items.reduce((sum, item) => sum + item.share, 0)
    if (total <= 0) continue
    for (const item of items) {
      await treeActions.updateWeight(item.node.id, item.share / total)
    }
  }
  return { status: 'applied' }
}

function createTreeIndex(treeData) {
  const nodes = treeData ? flattenTree(treeData).filter(n => n.type !== 'root') : []
  const byId = new Map()
  const byName = new Map()
  for (const node of nodes) {
    if (node.id) byId.set(node.id, node)
    if (node.name && !byName.has(node.name)) byName.set(node.name, node)
  }
  return { nodes, byId, byName }
}

function resolveDraftParentId(parent, index, newIdByName) {
  if (!parent) return parent
  if (newIdByName[parent]) return newIdByName[parent]
  if (index.byId.has(parent)) return parent
  const named = index.byName.get(parent)
  return named?.id || parent
}

function findExistingDraftNode(action, index, newIdByName) {
  if (!action?.name) return null
  if (newIdByName[action.name]) return { id: newIdByName[action.name], name: action.name }
  if (action.type === 'add_project') {
    return index.nodes.find(node => node.type === 'project' && node.name === action.name && !node.parent_id) ||
      index.byName.get(action.name) ||
      null
  }
  if (action.type === 'add_task' || action.type === 'add_category') {
    const type = action.type === 'add_task' ? 'task' : 'category'
    const parentId = resolveDraftParentId(action.parent, index, newIdByName)
    if (parentId) {
      return index.nodes.find(node => node.type === type && node.name === action.name && node.parent_id === parentId) || null
    }
    return index.nodes.find(node => node.type === type && node.name === action.name) || null
  }
  return null
}
