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
import NodeDetailPanel from './components/Tree/NodeDetailPanel'
import BackupPanel from './components/Modals/BackupPanel'
import { useTree } from './hooks/useTree'
import { useChat } from './hooks/useChat'
import { useUserProfile } from './hooks/useUserProfile'
import { useDailyFocus } from './hooks/useDailyFocus'
import { useWeeklyReview } from './hooks/useWeeklyReview'
import { useBackup } from './hooks/useBackup'
import { getDerivedWeightMeta, getDerivedWeightMetaMap } from './lib/treeUtils'

const DEFAULT_PROJECT_COLOR = '#4A8C5C'
const DELETE_CONFIRM_SHARE = 0.7
const DELETE_CONFIRM_DIRECT_CHILDREN = 3
const DELETE_CONFIRM_DESCENDANTS = 6

function defaultNodeName(type) {
  if (type === 'project') return '新项目'
  if (type === 'category') return '新分类'
  return '新任务'
}

export default function App() {
  const [user, setUser]           = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authSlow, setAuthSlow] = useState(false)   // 连接过慢提示
  const [chatOpen, setChatOpen]   = useState(true)
  const [modal, setModal]         = useState(null)  // { parentNode, defaultType }
  const [model, setModel]         = useState(() => localStorage.getItem('ft_model') || 'auto')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [learnedOpen, setLearnedOpen] = useState(false)
  const [recsOpen,    setRecsOpen]    = useState(false)
  const [backupOpen,  setBackupOpen]  = useState(false)
  const [highlightedNodeId, setHighlightedNodeId] = useState(null)
  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const resetZoomRef              = useRef(null)

  // 模型选择持久化
  const handleModelChange = useCallback((next) => {
    setModel(next)
    localStorage.setItem('ft_model', next)
  }, [])

  const lastUserIdRef = useRef(null)

  // ── Auth ────────────────────────────────────────────
  useEffect(() => {
    let isMounted = true

    const syncSession = (session, { markReady = false } = {}) => {
      if (!isMounted) return
      const nextUser = session?.user ?? null
      const nextId = nextUser?.id ?? null
      if (lastUserIdRef.current !== nextId) {
        lastUserIdRef.current = nextId
        setUser(nextUser)
      }
      if (markReady) setAuthLoading(false)
    }

    // 防呆：Supabase 连不上（项目暂停/网络阻断）时不要永久 loading
    const slowTimer = window.setTimeout(() => { if (isMounted) setAuthSlow(true) }, 5000)
    const hardTimer = window.setTimeout(() => {
      if (isMounted) {
        console.warn('[auth] getSession 超时（12s），可能 Supabase 项目暂停或网络不通')
        setAuthLoading(false)
      }
    }, 12000)

    supabase.auth.getSession().then(({ data: { session } }) => {
      window.clearTimeout(slowTimer)
      window.clearTimeout(hardTimer)
      syncSession(session, { markReady: true })
    }).catch((error) => {
      console.error('[auth] getSession failed:', error)
      window.clearTimeout(slowTimer)
      window.clearTimeout(hardTimer)
      if (isMounted) setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // TOKEN_REFRESHED 不改变用户身份，跳过即可；INITIAL_SESSION 可作为首次就绪信号。
      if (event === 'TOKEN_REFRESHED') return
      syncSession(session, { markReady: event === 'INITIAL_SESSION' })
    })
    return () => {
      isMounted = false
      window.clearTimeout(slowTimer)
      window.clearTimeout(hardTimer)
      subscription.unsubscribe()
    }
  }, [])

  const {
    treeData, loading: treeLoading,
    density, setDensity,
    leafView, setLeafView,
    expandAll, collapseAll, toggleNode,
    addNode, renameNode, updateStatus, deleteNode, deleteNodeOnly, clearAll, annotateNode, updateNodeDetails, updateNodePlanning, updateWeight, moveNode, reorderNode,
    history, future, canUndo, canRedo, lastAction, nextAction, undo, redo,
  } = useTree(user)

  // 用户画像（当前阶段目标等）
  const { goal, goalText, goalExpired, setGoal, clearGoal } = useUserProfile(user)

  // 把树操作打包传给 useChat，AI / 算法层都能直接调用
  // clearAll 用 ref 包裹，下面在 useBackup 就绪后插入 pre-destructive 备份
  const backupRef = useRef(null)
  const guardedClearAll = useCallback(async () => {
    try {
      await backupRef.current?.preDestructiveBackup?.('清空全部前')
    } catch (e) { console.warn('[guardedClearAll] backup failed:', e) }
    return clearAll()
  }, [clearAll])
  const guardedDeleteNode = useCallback(async (nodeId) => {
    // 删粗壮/大子树前自动备份，普通小节点依赖撤销即可。
    let shouldBackup = false
    try {
      const node = findNodeInTree(treeData, nodeId)
      shouldBackup = getDeleteRisk(node, treeData, goal).shouldConfirm
    } catch { /* ignore */ }
    if (shouldBackup) {
      try {
        await backupRef.current?.preDestructiveBackup?.('删除子树前')
      } catch (e) { console.warn('[guardedDeleteNode] backup failed:', e) }
    }
    return deleteNode(nodeId)
  }, [deleteNode, goal, treeData])
  const treeActions = {
    addNode, renameNode, updateStatus,
    deleteNode: guardedDeleteNode,
    clearAll: guardedClearAll,
    annotateNode, updateNodeDetails, updateWeight, expandAll, collapseAll,
  }
  const {
    messages, isLoading: chatLoading, sendMessage, resetConversation,
    retryLastMessage, cancelRequest, pendingQueue,
    sessionId, sessions, deleteSession, fetchSessionMessages,
    learnedPatterns, removeLearnedPattern,
    recommendations, hitRate, reloadRecommendations,
    recentSummaries,
    injectReviewMessage,
    applyWeightPlan,
    applyDraftPlan,
  } = useChat(user, treeActions, goal, model)

  // 今日聚焦
  const dailyFocus = useDailyFocus(user, treeData, goal, recentSummaries, learnedPatterns, hitRate)

  // 周末回顾
  const weeklyReview = useWeeklyReview(user, goal, injectReviewMessage)

  const selectedNode = selectedNodeId ? findNodeInTree(treeData, selectedNodeId) : null

  const handleNodeSelect = useCallback((node) => {
    if (!node?.id) return
    setHighlightedNodeId(node.id)
    setSelectedNodeId(node.id)
  }, [])

  const createDefaultNode = useCallback(async (parentNode, type) => {
    const nodeType = type || 'task'
    const newId = await addNode({
      name: defaultNodeName(nodeType),
      type: nodeType,
      parentId: parentNode?.id || null,
      color: nodeType === 'project' ? DEFAULT_PROJECT_COLOR : undefined,
    })
    if (newId) {
      setHighlightedNodeId(newId)
      setSelectedNodeId(newId)
    }
    return newId
  }, [addNode])

  // 备份系统
  const backup = useBackup(user, /* onAfterRestore */ () => {
    // 恢复完成后强制刷新整棵树
    window.location.reload()
  })
  const [backupNow, setBackupNow] = useState(0)
  useEffect(() => {
    const refresh = () => setBackupNow(Date.now())
    refresh()
    const timer = window.setInterval(refresh, 60 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])
  const backupWarning = !backup.lastManual || !backupNow || (backupNow - backup.lastManual) > 7 * 24 * 3600 * 1000
  // 把 backup 暴露给上面 guardedClearAll/guardedDeleteNode 用的 ref
  useEffect(() => { backupRef.current = backup }, [backup])

  // ── 右键菜单动作处理 ────────────────────────────────
  const handleContextAction = useCallback(async (action, payload) => {
    const { node, childType, status } = payload

    if (action === 'add-child') {
      await createDefaultNode(node, childType)
    }
    if (action === 'add-sibling') {
      const parentNode = node.parent_id ? findNodeInTree(treeData, node.parent_id) : null
      await createDefaultNode(parentNode, node.type === 'project' ? 'project' : (childType || node.type || 'task'))
    }
    if (action === 'rename') return
    if (action === 'status') {
      await updateStatus(node.id, status)
    }
    if (action === 'weight') {
      const localShare = Number.isFinite(Number(node.__localShare ?? node.weight))
        ? Math.max(0, Math.min(1, Number(node.__localShare ?? node.weight)))
        : 1
      const effectiveShare = Number.isFinite(Number(node.__flow))
        ? Math.max(0, Math.min(1, Number(node.__flow)))
        : localShare
      const current = Math.round(localShare * 100)
      const effective = Math.round(effectiveShare * 100)
      const input = window.prompt(
        `调整「${node.name}」的本级配比 (0-100)：\n当前有效权重约 ${effective}%。`,
        current
      )
      if (input !== null) {
        const w = Math.max(0, Math.min(100, parseInt(input) || 0))
        await updateWeight(node.id, w / 100)
      }
    }
    if (action === 'delete') {
      if (!confirmRiskyDelete(node, treeData, goal)) return
      await guardedDeleteNode(node.id)
    }
    if (action === 'delete-only') {
      await deleteNodeOnly(node.id)
      const nextSelection = node.parent_id || null
      setSelectedNodeId(nextSelection)
      setHighlightedNodeId(nextSelection)
    }
  }, [updateStatus, guardedDeleteNode, deleteNodeOnly, updateWeight, treeData, goal, createDefaultNode])

  const deleteSelectedNode = useCallback(async () => {
    if (!selectedNode || selectedNode.type === 'root') return
    if (!confirmRiskyDelete(selectedNode, treeData, goal)) return
    const nextSelection = selectedNode.parent_id || null
    await guardedDeleteNode(selectedNode.id)
    setSelectedNodeId(nextSelection)
    setHighlightedNodeId(nextSelection)
  }, [goal, guardedDeleteNode, selectedNode, treeData])

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (isTypingTarget(event.target) || event.defaultPrevented || authLoading || !user) return

      const key = event.key
      const mod = event.ctrlKey || event.metaKey

      if (mod && key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) {
          if (canRedo) redo()
        } else if (canUndo) {
          undo()
        }
        return
      }

      if (mod && key.toLowerCase() === 'y') {
        event.preventDefault()
        if (canRedo) redo()
        return
      }

      if ((key === 'Delete' || key === 'Backspace') && selectedNode) {
        event.preventDefault()
        deleteSelectedNode()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [authLoading, canRedo, canUndo, deleteSelectedNode, redo, selectedNode, undo, user])

  // ── 新建节点 ────────────────────────────────────────
  const handleAddNode = useCallback(async ({ name, type, color, parentId }) => {
    await addNode({ name, type, color, parentId })
  }, [addNode])

  // ── 拖拽分支 ────────────────────────────────────────
  const handleDropBranch = useCallback(async (source, target, drop) => {
    if (drop?.mode === 'reorder') {
      await reorderNode(source.id, target.id, drop.placement)
      return
    }
    await moveNode(source.id, target.id)
  }, [moveNode, reorderNode])

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  // ── 渲染 ────────────────────────────────────────────
  if (authLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f1117', color: '#6b7280' }}>
        <div>载入中…</div>
        {authSlow && (
          <div style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', lineHeight: 1.7, maxWidth: 360 }}>
            连接数据库较慢。可能原因：<br />
            · Supabase 免费项目闲置后被暂停（去 Dashboard 点 Restore）<br />
            · 网络代理拦截了 supabase.co<br />
            <button
              onClick={() => window.location.reload()}
              style={{ marginTop: 8, padding: '4px 14px', borderRadius: 8, border: '1px solid #374151', background: 'transparent', color: '#93c5fd', cursor: 'pointer' }}
            >
              重试
            </button>
          </div>
        )}
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
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen(v => !v)}
        leafView={leafView}
        onToggleLeafView={() => setLeafView(v => !v)}
        onResetZoom={() => resetZoomRef.current?.()}
        user={user}
        onSignOut={handleSignOut}
        canUndo={canUndo}
        canRedo={canRedo}
        lastAction={lastAction}
        nextAction={nextAction}
        onUndo={undo}
        onRedo={redo}
        history={history}
        future={future}
        onOpenBackup={() => setBackupOpen(true)}
        backupWarning={backupWarning}
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
                在右侧告诉 AI 你想做什么<br />
                树里有节点后，也可以从末端枝干拉出虚线继续增加
              </div>
            </div>
          ) : leafView ? (
            <LeafView
              treeData={treeData}
              userGoal={goal}
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
                userGoal={goal}
                density={density}
                onNodeSelect={handleNodeSelect}
                onNodeToggle={node => toggleNode(node.id)}
                onContextAction={handleContextAction}
                resetZoomRef={resetZoomRef}
                highlightedNodeId={highlightedNodeId}
                onLeafAdd={createDefaultNode}
                onDropBranch={handleDropBranch}
                onRenameNode={renameNode}
              />
            </>
          )}
        </div>

        {/* 对话面板 */}
        <NodeDetailPanel
          key={selectedNode?.id || 'empty'}
          node={selectedNode}
          onClose={() => setSelectedNodeId(null)}
          onRenameNode={renameNode}
          onUpdateDetails={updateNodeDetails}
          onUpdatePlanning={updateNodePlanning}
          onStatusChange={updateStatus}
        />

        <ChatPanel
          messages={messages}
          isLoading={chatLoading}
          onSend={(text) => sendMessage(text, treeData, { selectedNodeId })}
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
          onRetry={() => retryLastMessage(treeData, { selectedNodeId })}
          onCancel={cancelRequest}
          onApplyDraftPlan={(messageId) => applyDraftPlan(messageId, treeData)}
          onApplyWeightPlan={(messageId) => applyWeightPlan(messageId, treeData)}
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

      {/* 数据备份面板 */}
      {backupOpen && (
        <BackupPanel
          list={backup.list}
          lastAuto={backup.lastAuto}
          lastManual={backup.lastManual}
          working={backup.working}
          progress={backup.progress}
          onExport={backup.exportToFile}
          onRestoreFile={backup.restoreFromFile}
          onRestoreLocal={backup.restoreFromLocal}
          onClose={() => setBackupOpen(false)}
        />
      )}
    </div>
  )
}

function findNodeInTree(tree, id) {
  if (!tree || !id) return null
  if (tree.id === id) return tree
  for (const child of tree.children || []) {
    const found = findNodeInTree(child, id)
    if (found) return found
  }
  return null
}

function confirmRiskyDelete(node, treeData, goal) {
  const risk = getDeleteRisk(node, treeData, goal)
  if (!risk.shouldConfirm) return true
  return window.confirm(
    `这是一个较大的分支：${risk.reasons.join('、')}。\n删除后可以撤销，确定删除「${node.name}」吗？`
  )
}

function getDeleteRisk(node, treeData, goal) {
  if (!node || node.type === 'root') return { shouldConfirm: false, reasons: [] }
  const directChildren = node.children?.length || 0
  const descendants = countDescendants(node)
  const effectiveShare = readDeleteShare(node, treeData, goal)
  const reasons = []
  const canBeRiskyByShare = node.type !== 'task' || descendants > 0

  if (canBeRiskyByShare && Number.isFinite(effectiveShare) && effectiveShare >= DELETE_CONFIRM_SHARE) {
    reasons.push(`有效权重约 ${Math.round(effectiveShare * 100)}%`)
  }
  if (directChildren >= DELETE_CONFIRM_DIRECT_CHILDREN) {
    reasons.push(`${directChildren} 个直属子节点`)
  } else if (descendants >= DELETE_CONFIRM_DESCENDANTS) {
    reasons.push(`${descendants} 个子孙节点`)
  }

  return { shouldConfirm: reasons.length > 0, reasons }
}

function readDeleteShare(node, treeData, goal) {
  if (Number.isFinite(Number(node?.__flow))) return Number(node.__flow)
  if (Number.isFinite(Number(node?.__localShare))) return Number(node.__localShare)
  if (!treeData || !node?.id) return null
  const metaById = getDerivedWeightMetaMap(treeData, { userGoal: goal })
  const meta = getDerivedWeightMeta(metaById, node)
  return Number.isFinite(Number(meta?.flow)) ? Number(meta.flow) : null
}

function countDescendants(node) {
  if (!node?.children?.length) return 0
  return node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0)
}

function isTypingTarget(element) {
  const tag = element?.tagName?.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || element?.isContentEditable
}
