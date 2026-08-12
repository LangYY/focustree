import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import AuthPage from './components/Auth/AuthPage'
import AppShell from './components/Shell/AppShell'
import CanvasStage from './components/Tree/CanvasStage'
import NodeInspector from './components/Tree/NodeInspector'
import ChatPanel from './components/Chat/ChatPanel'
import PriorityAuditModal from './components/Modals/PriorityAuditModal'
import UtilityModal from './components/Modals/UtilityModal'
import FocusView from './components/Views/FocusView'
import ListView from './components/Views/ListView'
import ReviewView from './components/Views/ReviewView'
import { useTree } from './hooks/useTree'
import { useChat } from './hooks/useChat'
import { useUserProfile } from './hooks/useUserProfile'
import { useDailyFocus } from './hooks/useDailyFocus'
import { useWeeklyReview } from './hooks/useWeeklyReview'
import { useBackup } from './hooks/useBackup'
import { useOnboarding } from './hooks/useOnboarding.js'
import { DEFAULT_PROJECT_COLOR } from './lib/branchPalette'
import { EXAMPLE_GOAL } from './lib/exampleData.js'
import { flattenTree, getDerivedWeightMeta, getDerivedWeightMetaMap } from './lib/treeUtils'
import { restoreAuthSession } from './lib/authSession'

const DELETE_CONFIRM_SHARE = 0.7
const DELETE_CONFIRM_DIRECT_CHILDREN = 3
const DELETE_CONFIRM_DESCENDANTS = 6

function defaultNodeName(type) {
  if (type === 'project') return '新项目'
  if (type === 'category') return '新分类'
  return '新任务'
}

export default function App() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [mode, setMode] = useState(() => localStorage.getItem('ft_mode') || 'tree')
  const [drawerOpen, setDrawerOpen] = useState(true)
  const [utilityModal, setUtilityModal] = useState(null)
  const [priorityCalculationVersion, setPriorityCalculationVersion] = useState(() => Date.now())
  const [highlightedNodeId, setHighlightedNodeId] = useState(null)
  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const [inspectorFocusId, setInspectorFocusId] = useState(null)
  const [layers, setLayers] = useState(() => readLayers())
  // 只有深色和浅色两种；旧的 'system' 存量值在这里一并归到深色。
  const [themeMode, setThemeMode] = useState(() => localStorage.getItem('ft_theme') === 'light' ? 'light' : 'dark')
  const [resolvedTheme, setResolvedTheme] = useState(() => localStorage.getItem('ft_theme') === 'light' ? 'light' : 'dark')
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [authError, setAuthError] = useState('')
  const resetZoomRef = useRef(null)
  const backupRef = useRef(null)
  const lastUserIdRef = useRef(null)

  useEffect(() => {
    localStorage.setItem('ft_mode', mode)
  }, [mode])

  useEffect(() => {
    localStorage.setItem('ft_layers', JSON.stringify(layers))
  }, [layers])

  useEffect(() => {
    localStorage.setItem('ft_theme', themeMode)
    document.documentElement.dataset.theme = themeMode
    setResolvedTheme(themeMode)
  }, [themeMode])

  useEffect(() => {
    let mounted = true
    const syncSession = (session, markReady = false) => {
      if (!mounted) return
      const nextUser = session?.user || null
      if (lastUserIdRef.current !== nextUser?.id) {
        lastUserIdRef.current = nextUser?.id || null
        setUser(nextUser)
      }
      if (nextUser) setAuthError('')
      if (markReady) setAuthLoading(false)
    }

    const stopSessionRestore = restoreAuthSession(supabase.auth, {
      onSession: session => syncSession(session),
      onReady: () => { if (mounted) setAuthLoading(false) },
      onError: error => {
        console.error('[auth] session restore failed:', error)
        if (mounted) setAuthError(formatAuthError(error))
      },
    })

    let subscription = { unsubscribe: () => {} }
    try {
      const authState = supabase.auth.onAuthStateChange((event, session) => {
        if (event !== 'TOKEN_REFRESHED') syncSession(session, event === 'INITIAL_SESSION')
      })
      subscription = authState?.data?.subscription || subscription
    } catch (error) {
      console.error('[auth] state listener failed:', error)
      if (mounted) {
        setAuthError(formatAuthError(error))
        setAuthLoading(false)
      }
    }

    return () => {
      mounted = false
      stopSessionRestore()
      subscription.unsubscribe?.()
    }
  }, [])

  const {
    treeData, loading: treeLoading,
    density, setDensity,
    expandAll, collapseAll, toggleNode,
    addNode, renameNode, updateStatus, deleteNode, deleteNodeOnly, clearAll, loadExampleData, annotateNode, updateNodeDetails, updateNodePlanning, moveNode, reorderNode, applyPriorityAnalyses,
    canUndo, canRedo, lastAction, nextAction, undo, redo,
  } = useTree(user)

  const { goal, goalText, goalExpired, setGoal, clearGoal } = useUserProfile(user)
  const handleNodeSelect = useCallback(nodeOrId => {
    const nodeId = typeof nodeOrId === 'string' ? nodeOrId : nodeOrId?.id
    if (!nodeId) {
      setHighlightedNodeId(null)
      setSelectedNodeId(null)
      return
    }
    setHighlightedNodeId(nodeId)
    setSelectedNodeId(nodeId)
  }, [])
  const addNodeAndOpen = useCallback(async payload => {
    const newId = await addNode(payload)
    if (newId) {
      setInspectorFocusId(newId)
      handleNodeSelect(newId)
    }
    return newId
  }, [addNode, handleNodeSelect])
  const guardedDeleteNode = useGuardedDelete(deleteNode, treeData, goal, backupRef)
  const guardedClearAll = useCallback(async () => {
    await backupRef.current?.preDestructiveBackup?.('清空全部前')
    return clearAll()
  }, [clearAll])
  const treeActions = useMemo(() => ({
    addNode: addNodeAndOpen,
    renameNode,
    updateStatus,
    deleteNode: guardedDeleteNode,
    clearAll: guardedClearAll,
    annotateNode,
    updateNodeDetails,
    expandAll,
    collapseAll,
    applyPriorityAnalyses,
    setGoal,
  }), [addNodeAndOpen, annotateNode, applyPriorityAnalyses, collapseAll, expandAll, guardedClearAll, guardedDeleteNode, renameNode, setGoal, updateNodeDetails, updateStatus])

  const {
    messages, isLoading: chatLoading, sendMessage, resetConversation,
    retryLastMessage, cancelRequest, pendingQueue,
    sessions,
    learnedPatterns,
    recommendations, hitRate, reloadRecommendations,
    recentSummaries, injectReviewMessage,
    applyPriorityAnalysis, requestPriorityAnalysis, applyDraftPlan,
  } = useChat(user, treeActions, goal)
  // 载入示例数据会先删光当前用户的全部节点，且不进撤销栈。树非空时必须显式确认，
  // 并先留一份可恢复的快照——否则「重新看一遍引导」这种无害操作会直接抹掉真实数据。
  const loadExample = useCallback(async () => {
    const existing = countUserNodes(treeData)
    if (existing > 0) {
      const confirmed = window.confirm(
        `载入示例数据会先删除你现在的 ${existing} 个节点，并且无法撤销。\n\n`
        + '继续前会自动存一份备份，可在「数据备份」里恢复。\n\n确定要继续吗？',
      )
      if (!confirmed) return false
      await backupRef.current?.preDestructiveBackup?.('载入示例数据前')
    }
    const loaded = await loadExampleData()
    if (!loaded) return false
    const savedGoal = await setGoal(EXAMPLE_GOAL.text, EXAMPLE_GOAL)
    return Boolean(savedGoal)
  }, [loadExampleData, setGoal, treeData])
  const onboarding = useOnboarding({
    user,
    treeData,
    treeLoading,
    messages,
    onLoadExample: loadExample,
    onOpenChat: () => setDrawerOpen(true),
    fitToView: () => resetZoomRef.current?.(),
  })
  const dailyFocus = useDailyFocus(user, treeData, goal, recentSummaries, learnedPatterns, hitRate)
  const weeklyReview = useWeeklyReview(user, goal, injectReviewMessage)
  const backup = useBackup(user, () => window.location.reload())
  const [backupNow, setBackupNow] = useState(0)
  const backupWarning = !backup.lastManual || !backupNow || backupNow - backup.lastManual > 7 * 24 * 3600 * 1000
  const priorityMetaById = useMemo(() => getDerivedWeightMetaMap(treeData, { userGoal: goal }), [goal, treeData])
  const selectedNodeBase = useMemo(() => selectedNodeId ? findNodeInTree(treeData, selectedNodeId) : null, [selectedNodeId, treeData])
  const selectedMeta = useMemo(() => selectedNodeBase ? getDerivedWeightMeta(priorityMetaById, selectedNodeBase) : null, [priorityMetaById, selectedNodeBase])
  const selectedNode = useMemo(() => selectedNodeBase ? { ...selectedNodeBase, ...(selectedMeta ? { __directPriority: selectedMeta.directPriority, __branchPriority: selectedMeta.branchPriority, __cultivationScore: selectedMeta.cultivationScore, __priorityStaleReasons: selectedMeta.staleReasons, __prioritySignals: selectedMeta.signalBreakdown } : {}) } : null, [selectedMeta, selectedNodeBase])
  useEffect(() => { backupRef.current = backup }, [backup])
  useEffect(() => {
    const refresh = () => setBackupNow(Date.now())
    refresh()
    const timer = window.setInterval(refresh, 60 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])

  const toggleDrawer = useCallback(() => setDrawerOpen(open => !open), [])
  const openModal = useCallback(kind => {
    if (kind === 'recommendations') reloadRecommendations()
    setUtilityModal(kind)
  }, [reloadRecommendations])
  const closeModal = useCallback(() => setUtilityModal(null), [])

  const handleGoalEdit = useCallback(() => {
    const next = window.prompt('设置当前阶段目标：', goalText || '')
    if (next == null) return
    if (!next.trim()) clearGoal()
    else setGoal(next.trim(), { deadline: goal?.deadline, constraints: goal?.constraints, exclude: goal?.exclude })
  }, [clearGoal, goal, goalText, setGoal])

  const createDefaultNode = useCallback(async (parentNode, type) => {
    const nodeType = type || 'task'
    return addNodeAndOpen({ name: defaultNodeName(nodeType), type: nodeType, parentId: parentNode?.id || null, color: nodeType === 'project' ? DEFAULT_PROJECT_COLOR : undefined })
  }, [addNodeAndOpen])

  const handleContextAction = useCallback(async (action, payload) => {
    const { node, childType, status } = payload
    if (action === 'add-child') await createDefaultNode(node, childType)
    if (action === 'add-sibling') {
      const parentNode = node.parent_id ? findNodeInTree(treeData, node.parent_id) : null
      await createDefaultNode(parentNode, node.type === 'project' ? 'project' : (childType || node.type || 'task'))
    }
    if (action === 'status') await updateStatus(node.id, status)
    if (action === 'delete') {
      if (!confirmRiskyDelete(node, treeData, goal)) return
      await guardedDeleteNode(node.id)
    }
    if (action === 'delete-only') {
      await deleteNodeOnly(node.id)
      handleNodeSelect(node.parent_id || null)
    }
  }, [createDefaultNode, deleteNodeOnly, goal, guardedDeleteNode, handleNodeSelect, treeData, updateStatus])

  const deleteSelectedNode = useCallback(async () => {
    if (!selectedNode || selectedNode.type === 'root') return
    if (!confirmRiskyDelete(selectedNode, treeData, goal)) return
    const nextSelection = selectedNode.parent_id || null
    await guardedDeleteNode(selectedNode.id)
    setSelectedNodeId(nextSelection)
    setHighlightedNodeId(nextSelection)
  }, [goal, guardedDeleteNode, selectedNode, treeData])

  useEffect(() => {
    const handleKeyDown = event => {
      if (isTypingTarget(event.target) || event.defaultPrevented || authLoading || !user) return
      const key = event.key.toLowerCase()
      const mod = event.ctrlKey || event.metaKey
      if (event.key === 'Escape') {
        event.preventDefault()
        setShortcutsOpen(false)
        if (utilityModal) setUtilityModal(null)
        else if (selectedNodeId) handleNodeSelect(null)
        else if (drawerOpen) setDrawerOpen(false)
        return
      }
      if (event.key === '?') {
        event.preventDefault()
        setShortcutsOpen(value => !value)
        return
      }
      if (mod && key === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return }
      if (mod && key === 'y') { event.preventDefault(); redo(); return }
      if (event.key === 'delete' || event.key === 'backspace') { if (selectedNode) { event.preventDefault(); deleteSelectedNode() } return }
      if (['1', '2', '3', '4'].includes(event.key)) { setMode(['tree', 'focus', 'list', 'review'][Number(event.key) - 1]); return }
      if (key === 'c') { toggleDrawer(); return }
      if (key === '/') { setDrawerOpen(true); window.setTimeout(() => window.dispatchEvent(new CustomEvent('ft-focus-chat')), 0) }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [authLoading, deleteSelectedNode, drawerOpen, handleNodeSelect, redo, selectedNode, selectedNodeId, toggleDrawer, undo, user, utilityModal])

  const handleDropBranch = useCallback(async (source, target, drop) => {
    if (drop?.mode === 'reorder') await reorderNode(source.id, target.id, drop.placement)
    else await moveNode(source.id, target.id)
  }, [moveNode, reorderNode])

  const handlePrefill = useCallback(text => {
    setDrawerOpen(true)
    window.dispatchEvent(new CustomEvent('ft-prefill-chat', { detail: text }))
  }, [])

  const handleSignOut = useCallback(() => supabase.auth.signOut(), [])
  const handleClearAll = useCallback(async () => {
    if (!window.confirm('确定要清空全部项目吗？此操作可撤销。')) return
    await guardedClearAll()
  }, [guardedClearAll])
  const handleApplyPriority = useCallback(async (...args) => {
    const result = await applyPriorityAnalysis(...args)
    setPriorityCalculationVersion(Date.now())
    return result
  }, [applyPriorityAnalysis])

  if (authLoading) return <div className="ft-auth-loading"><span className="ft-loading-line" />载入中…</div>
  if (!user) return <AuthPage initialError={authError} />

  const drawerContent = (
    <ChatPanel
      isOpen
      messages={messages}
      isLoading={chatLoading}
      onSend={text => {
        onboarding.submitUserInput(text)
        return sendMessage(text, treeData, { selectedNodeId })
      }}
      goalText={goalText}
      goalExpired={goalExpired}
      onSetGoal={setGoal}
      onClearGoal={clearGoal}
      userGoal={goal}
      onResetConversation={resetConversation}
      onOpenHistory={() => openModal('history')}
      onOpenLearned={() => openModal('memory')}
      onApplyDraftPlan={(messageId, actions) => applyDraftPlan(messageId, treeData, actions)}
      onApplyPriorityAnalysis={(messageId, overrides) => handleApplyPriority(messageId, overrides, treeData)}
      treeData={treeData}
      onHoverNode={setHighlightedNodeId}
      onSelectNode={handleNodeSelect}
      onRetry={() => retryLastMessage(treeData, { selectedNodeId })}
      onCancel={cancelRequest}
      pendingQueueCount={pendingQueue.length}
      onboarding={onboarding}
      onOnboardingToday={onboarding.sendTodayQuestion}
      onOnboardingApplyAll={onboarding.applyAll}
    />
  )

  return (
    <>
      <AppShell
        mode={mode}
        onModeChange={setMode}
        drawerOpen={drawerOpen}
        onToggleDrawer={toggleDrawer}
        onDrawerClose={() => setDrawerOpen(false)}
        drawerContent={drawerContent}
        goal={goal}
        goalText={goalText}
        goalExpired={goalExpired}
        onEditGoal={handleGoalEdit}
        user={user}
        canUndo={canUndo}
        canRedo={canRedo}
        lastAction={lastAction}
        nextAction={nextAction}
        onUndo={undo}
        onRedo={redo}
        onOpenModal={openModal}
        backupWarning={backupWarning}
        themeMode={themeMode}
        onThemeChange={setThemeMode}
        onSignOut={handleSignOut}
        onAccount={() => openModal('memory')}
        onLoadExample={onboarding.chooseExample}
        onClearAll={handleClearAll}
        onRestartOnboarding={onboarding.restart}
      >
        {mode === 'tree' ? <CanvasStage theme={resolvedTheme} treeData={treeData} treeLoading={treeLoading} dailyFocus={dailyFocus} onNodeSelect={handleNodeSelect} onNodeToggle={node => toggleNode(node.id)} onContextAction={handleContextAction} resetZoomRef={resetZoomRef} highlightedNodeId={highlightedNodeId} onLeafAdd={createDefaultNode} onDropBranch={handleDropBranch} onRenameNode={renameNode} priorityCalculationVersion={priorityCalculationVersion} density={density} onDensityChange={setDensity} onExpandAll={expandAll} onCollapseAll={collapseAll} onExample={handlePrefill} userGoal={goal} layers={layers} onLayerChange={(key, value) => setLayers(current => ({ ...current, [key]: value }))} onboarding={onboarding} /> : null}
        {mode === 'tree' && selectedNode ? <NodeInspector key={selectedNode.id} node={selectedNode} treeData={treeData} meta={selectedMeta} goal={goal} autoFocusTitle={inspectorFocusId === selectedNode.id} onAutoFocusHandled={() => setInspectorFocusId(null)} onClose={() => handleNodeSelect(null)} onSelectNode={handleNodeSelect} onRenameNode={renameNode} onUpdateDetails={updateNodeDetails} onUpdatePlanning={updateNodePlanning} onStatusChange={updateStatus} onRequestAnalysis={options => requestPriorityAnalysis(treeData, options)} analysisLoading={chatLoading} onRecalculate={() => setPriorityCalculationVersion(Date.now())} /> : null}
        {mode === 'focus' ? <FocusView focus={dailyFocus.focus} generating={dailyFocus.generating} onGenerate={dailyFocus.generate} onToggle={dailyFocus.toggleTask} onGoTree={() => setMode('tree')} /> : null}
        {mode === 'list' ? <ListView treeData={treeData} userGoal={goal} onStatusChange={updateStatus} onSelect={handleNodeSelect} /> : null}
        {mode === 'review' ? <ReviewView review={weeklyReview.latestReview} history={weeklyReview.history} generating={weeklyReview.generating} onGenerate={() => weeklyReview.generate({ silent: false })} /> : null}
      </AppShell>
      {utilityModal && utilityModal !== 'priorityAudit' ? <UtilityModal kind={utilityModal} learnedPatterns={learnedPatterns} recommendations={recommendations} sessions={sessions} backup={backup} onClose={closeModal} /> : null}
      {utilityModal === 'priorityAudit' ? <PriorityAuditModal treeData={treeData} goal={goal} onSelectNode={handleNodeSelect} onClose={closeModal} /> : null}
      {shortcutsOpen ? <ShortcutHelp onClose={() => setShortcutsOpen(false)} /> : null}
    </>
  )
}

function ShortcutHelp({ onClose }) {
  return (
    <div className="ft-shortcut-scrim" onMouseDown={event => { if (event.currentTarget === event.target) onClose() }}>
      <section className="ft-shortcut-dialog" role="dialog" aria-modal="true" aria-labelledby="ft-shortcut-title">
        <div className="ft-shortcut-head">
          <h2 id="ft-shortcut-title">快捷键</h2>
          <button type="button" autoFocus onClick={onClose} aria-label="关闭快捷键说明">关闭</button>
        </div>
        <dl className="ft-shortcut-list">
          <div><dt><kbd>1</kbd>–<kbd>4</kbd></dt><dd>切换主视图</dd></div>
          <div><dt><kbd>C</kbd></dt><dd>开合对话面板</dd></div>
          <div><dt><kbd>/</kbd></dt><dd>聚焦对话输入框</dd></div>
          <div><dt><kbd>Tab</kbd> + 方向键</dt><dd>进入树并移动选择</dd></div>
          <div><dt><kbd>Enter</kbd></dt><dd>展开或折叠节点</dd></div>
          <div><dt><kbd>Space</kbd></dt><dd>打开节点检视卡</dd></div>
          <div><dt><kbd>Delete</kbd></dt><dd>删除当前节点（走确认）</dd></div>
          <div><dt><kbd>Esc</kbd></dt><dd>关闭浮层或收起抽屉</dd></div>
        </dl>
      </section>
    </div>
  )
}

function useGuardedDelete(deleteNode, treeData, goal, backupRef) {
  return useCallback(async nodeId => {
    const node = findNodeInTree(treeData, nodeId)
    if (getDeleteRisk(node, treeData, goal).shouldConfirm) await backupRef.current?.preDestructiveBackup?.('删除子树前')
    return deleteNode(nodeId)
  }, [backupRef, deleteNode, goal, treeData])
}

// 根节点是容器不是用户内容，统计时排除。
function countUserNodes(tree) {
  if (!tree) return 0
  return flattenTree(tree).filter(node => node?.type !== 'root').length
}

function readLayers() {
  try { return { dueArc: true, rings: true, labels: true, ...JSON.parse(localStorage.getItem('ft_layers') || '{}') } } catch { return { dueArc: true, rings: true, labels: true } }
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
  return window.confirm(`这是一个较大的分支：${risk.reasons.join('、')}。\n删除后可以撤销，确定删除「${node.name}」吗？`)
}

function getDeleteRisk(node, treeData, goal) {
  if (!node || node.type === 'root') return { shouldConfirm: false, reasons: [] }
  const directChildren = node.children?.length || 0
  const descendants = countDescendants(node)
  const metaById = treeData ? getDerivedWeightMetaMap(treeData, { userGoal: goal }) : null
  const meta = metaById ? getDerivedWeightMeta(metaById, node) : null
  const effectiveShare = Number.isFinite(Number(node.__branchPriority)) ? Number(node.__branchPriority) / 100 : Number.isFinite(Number(meta?.branchPriority)) ? Number(meta.branchPriority) / 100 : null
  const reasons = []
  if ((node.type !== 'task' || descendants > 0) && Number.isFinite(effectiveShare) && effectiveShare >= DELETE_CONFIRM_SHARE) reasons.push(`有效权重约 ${Math.round(effectiveShare * 100)}%`)
  if (directChildren >= DELETE_CONFIRM_DIRECT_CHILDREN) reasons.push(`${directChildren} 个直属子节点`)
  else if (descendants >= DELETE_CONFIRM_DESCENDANTS) reasons.push(`${descendants} 个子孙节点`)
  return { shouldConfirm: reasons.length > 0, reasons }
}

function countDescendants(node) {
  if (!node?.children?.length) return 0
  return node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0)
}

function isTypingTarget(element) {
  const tag = element?.tagName?.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || element?.isContentEditable
}

function formatAuthError(error) {
  if (error?.code === 'AUTH_SESSION_TIMEOUT') return '登录服务响应超时，请检查网络后重试。'
  return error?.message || '登录服务初始化失败，请重试。'
}
