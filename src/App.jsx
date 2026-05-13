import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './lib/supabase'
import AuthPage from './components/Auth/AuthPage'
import Toolbar from './components/Toolbar/Toolbar'
import TreeView from './components/Tree/TreeView'
import LeafView from './components/Tree/LeafView'
import ChatPanel from './components/Chat/ChatPanel'
import AddNodeModal from './components/Modals/AddNodeModal'
import ChatHistoryPanel from './components/Chat/ChatHistoryPanel'
import LearnedPatternsPanel from './components/Chat/LearnedPatternsPanel'
import RecommendationLogPanel from './components/Chat/RecommendationLogPanel'
import TodayCard from './components/Tree/TodayCard'
import { useTree } from './hooks/useTree'
import { useChat } from './hooks/useChat'
import { useUserProfile } from './hooks/useUserProfile'
import { useDailyFocus } from './hooks/useDailyFocus'
import { useWeeklyReview } from './hooks/useWeeklyReview'

export default function App() {
  const [user, setUser]           = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [chatOpen, setChatOpen]   = useState(true)
  const [modal, setModal]         = useState(null)  // { parentNode, defaultType }
  const [model, setModel]         = useState(() => localStorage.getItem('ft_model') || 'auto')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [learnedOpen, setLearnedOpen] = useState(false)
  const [recsOpen,    setRecsOpen]    = useState(false)
  const [highlightedNodeId, setHighlightedNodeId] = useState(null)
  const resetZoomRef              = useRef(null)

  // 模型选择持久化
  const handleModelChange = useCallback((next) => {
    setModel(next)
    localStorage.setItem('ft_model', next)
  }, [])

  const lastUserIdRef = useRef(null)

  // ── Auth ────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const nextUser = session?.user ?? null
      const nextId = nextUser?.id ?? null
      if (lastUserIdRef.current === nextId) return
      lastUserIdRef.current = nextId
      setUser(nextUser)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // TOKEN_REFRESHED / INITIAL_SESSION 不改变用户身份，跳过
      if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') return
      const nextUser = session?.user ?? null
      const nextId = nextUser?.id ?? null
      if (lastUserIdRef.current === nextId) return
      lastUserIdRef.current = nextId
      setUser(nextUser)
    })
    return () => subscription.unsubscribe()
  }, [])

  const {
    treeData, loading: treeLoading,
    density, setDensity,
    leafView, setLeafView,
    expandAll, collapseAll, toggleNode,
    addNode, renameNode, updateStatus, deleteNode, clearAll, annotateNode, updateWeight, moveNode,
    history, canUndo, lastAction, undo,
  } = useTree(user)

  // 用户画像（当前阶段目标等）
  const { goal, goalText, goalExpired, setGoal, clearGoal } = useUserProfile(user)

  // 把树操作打包传给 useChat，AI 可以直接调用
  const treeActions = { addNode, renameNode, updateStatus, deleteNode, clearAll, annotateNode }
  const {
    messages, isLoading: chatLoading, sendMessage, resetConversation,
    retryLastMessage, cancelRequest, pendingQueue,
    sessionId, sessions, deleteSession, fetchSessionMessages,
    learnedPatterns, removeLearnedPattern,
    recommendations, hitRate, reloadRecommendations,
    recentSummaries,
    injectReviewMessage,
  } = useChat(user, treeActions, goal, model)

  // 今日聚焦
  const dailyFocus = useDailyFocus(user, treeData, goal, recentSummaries, learnedPatterns, hitRate)

  // 周末回顾
  const weeklyReview = useWeeklyReview(user, goal, injectReviewMessage)

  // ── 右键菜单动作处理 ────────────────────────────────
  const handleContextAction = useCallback(async (action, payload) => {
    const { node, childType, status } = payload

    if (action === 'add-child') {
      setModal({ parentNode: node, defaultType: childType })
    }
    if (action === 'rename') {
      const newName = prompt(`重命名「${node.name}」：`, node.name)
      if (newName && newName.trim() !== node.name) {
        await renameNode(node.id, newName)
      }
    }
    if (action === 'status') {
      await updateStatus(node.id, status)
    }
    if (action === 'weight') {
      const current = Math.round((node.weight ?? 1) * 100)
      const input = window.prompt(`调整「${node.name}」的权重 (0-100)：`, current)
      if (input !== null) {
        const w = Math.max(0, Math.min(100, parseInt(input) || 0))
        await updateWeight(node.id, w / 100)
      }
    }
    if (action === 'delete') {
      const hasChildren = node.children?.length > 0
      const msg = hasChildren
        ? `删除「${node.name}」及其所有子节点？此操作不可撤销。`
        : `删除「${node.name}」？此操作不可撤销。`
      if (window.confirm(msg)) {
        await deleteNode(node.id)
      }
    }
  }, [renameNode, updateStatus, deleteNode, updateWeight])

  // ── 新建节点 ────────────────────────────────────────
  const handleAddNode = useCallback(async ({ name, type, color, parentId }) => {
    await addNode({ name, type, color, parentId })
  }, [addNode])

  // ── 拖拽分支 ────────────────────────────────────────
  const handleDropBranch = useCallback(async (source, target) => {
    await moveNode(source.id, target.id)
  }, [moveNode])

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  // ── 渲染 ────────────────────────────────────────────
  if (authLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f1117', color: '#6b7280' }}>
        载入中…
      </div>
    )
  }

  if (!user) return <AuthPage />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f1117' }}>
      <Toolbar
        density={density}
        onDensityChange={setDensity}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
        onAddProject={() => setModal({ parentNode: null, defaultType: 'project' })}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen(v => !v)}
        leafView={leafView}
        onToggleLeafView={() => setLeafView(v => !v)}
        onResetZoom={() => resetZoomRef.current?.()}
        user={user}
        onSignOut={handleSignOut}
        canUndo={canUndo}
        lastAction={lastAction}
        onUndo={undo}
        history={history}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* 主区域：树 or 末端视图 */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {treeLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280' }}>
              加载中…
            </div>
          ) : !treeData ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              height: '100%', gap: '16px', color: '#6b7280', userSelect: 'none',
            }}>
              <div style={{ fontSize: '48px', opacity: 0.3 }}>🌱</div>
              <div style={{ fontSize: '16px', color: '#9ca3af' }}>树是空的</div>
              <div style={{ fontSize: '13px', color: '#6b7280', textAlign: 'center', lineHeight: 1.6 }}>
                点击顶部「＋ 新项目」创建第一个项目<br />
                或者在右侧告诉 AI 你想做什么
              </div>
            </div>
          ) : leafView ? (
            <LeafView
              treeData={treeData}
              onStatusChange={(id, status) => updateStatus(id, status)}
            />
          ) : (
            <>
              <TodayCard
                focus={dailyFocus.focus}
                loading={dailyFocus.loading}
                generating={dailyFocus.generating}
                onGenerate={dailyFocus.generate}
                onToggle={dailyFocus.toggleTask}
                onRemove={dailyFocus.removeTask}
                onDismiss={dailyFocus.dismiss}
                onHoverNode={setHighlightedNodeId}
              />
              <TreeView
                treeData={treeData}
                density={density}
                onNodeSelect={node => setHighlightedNodeId(node.id)}
                onNodeToggle={node => toggleNode(node.id)}
                onContextAction={handleContextAction}
                resetZoomRef={resetZoomRef}
                highlightedNodeId={highlightedNodeId}
                onLeafAdd={(node, childType) => setModal({ parentNode: node, defaultType: childType })}
                onDropBranch={handleDropBranch}
              />
            </>
          )}
        </div>

        {/* 对话面板 */}
        <ChatPanel
          messages={messages}
          isLoading={chatLoading}
          onSend={(text) => sendMessage(text, treeData)}
          isOpen={chatOpen}
          goalText={goalText}
          goalExpired={goalExpired}
          onSetGoal={setGoal}
          onClearGoal={clearGoal}
          model={model}
          onModelChange={handleModelChange}
          onResetConversation={resetConversation}
          onOpenHistory={() => setHistoryOpen(true)}
          onOpenLearned={() => setLearnedOpen(true)}
          onOpenRecommendations={() => { reloadRecommendations(); setRecsOpen(true) }}
          hitRate={hitRate}
          treeData={treeData}
          onHoverNode={setHighlightedNodeId}
          onTriggerReview={() => weeklyReview.generate({ silent: false })}
          reviewGenerating={weeklyReview.generating}
          onRetry={() => retryLastMessage(treeData)}
          onCancel={cancelRequest}
          pendingCount={pendingQueue.length}
        />
      </div>

      {/* 新建节点 Modal */}
      {modal && (
        <AddNodeModal
          parentNode={modal.parentNode}
          defaultType={modal.defaultType}
          onConfirm={handleAddNode}
          onClose={() => setModal(null)}
        />
      )}

      {/* 对话历史面板 */}
      {historyOpen && (
        <ChatHistoryPanel
          sessions={sessions}
          fetchSessionMessages={fetchSessionMessages}
          deleteSession={deleteSession}
          currentSessionId={sessionId}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {/* AI 记忆面板 */}
      {learnedOpen && (
        <LearnedPatternsPanel
          patterns={learnedPatterns}
          onRemove={removeLearnedPattern}
          onClose={() => setLearnedOpen(false)}
        />
      )}

      {/* 推荐记录面板 */}
      {recsOpen && (
        <RecommendationLogPanel
          recommendations={recommendations}
          hitRate={hitRate}
          treeData={treeData}
          onClose={() => setRecsOpen(false)}
        />
      )}
    </div>
  )
}
