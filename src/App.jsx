import { Archive, Database, History, Lightbulb } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import AuthPage from './components/Auth/AuthPage'
import AppShell from './components/Shell/AppShell'
import CanvasStage from './components/Tree/CanvasStage'
import ChatPanel from './components/Chat/ChatPanel'
import NodeDetailPanel from './components/Tree/NodeDetailPanel'
import InboxTab from './components/Drawer/InboxTab'
import AuditTab from './components/Drawer/AuditTab'
import UtilityTab from './components/Drawer/UtilityTab'
import FocusView from './components/Views/FocusView'
import ListView from './components/Views/ListView'
import ReviewView from './components/Views/ReviewView'
import { useTree } from './hooks/useTree'
import { useChat } from './hooks/useChat'
import { useUserProfile } from './hooks/useUserProfile'
import { useDailyFocus } from './hooks/useDailyFocus'
import { useWeeklyReview } from './hooks/useWeeklyReview'
import { useBackup } from './hooks/useBackup'
import { DEFAULT_PROJECT_COLOR } from './lib/branchPalette'
import { getDerivedWeightMeta, getDerivedWeightMetaMap } from './lib/treeUtils'

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
  const [drawerTab, setDrawerTab] = useState('chat')
  const [temporaryTabs, setTemporaryTabs] = useState([])
  const [model, setModel] = useState(() => localStorage.getItem('ft_model') || 'auto')
  const [priorityCalculationVersion, setPriorityCalculationVersion] = useState(() => Date.now())
  const [highlightedNodeId, setHighlightedNodeId] = useState(null)
  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const [layers, setLayers] = useState(() => readLayers())
  const [themeMode, setThemeMode] = useState(() => localStorage.getItem('ft_theme') || 'dark')
  const [resolvedTheme, setResolvedTheme] = useState(() => localStorage.getItem('ft_theme') === 'light' ? 'light' : 'dark')
  const resetZoomRef = useRef(null)
  const backupRef = useRef(null)
  const userPinnedTabRef = useRef(false)
  const lastUserIdRef = useRef(null)

  useEffect(() => {
    localStorage.setItem('ft_mode', mode)
  }, [mode])

  useEffect(() => {
    localStorage.setItem('ft_layers', JSON.stringify(layers))
  }, [layers])

  useEffect(() => {
    localStorage.setItem('ft_theme', themeMode)
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const apply = () => {
      const nextTheme = themeMode === 'system' ? (media.matches ? 'light' : 'dark') : themeMode
      document.documentElement.dataset.theme = nextTheme
      setResolvedTheme(nextTheme)
    }
    apply()
    if (themeMode !== 'system') return undefined
    media.addEventListener?.('change', apply)
    return () => media.removeEventListener?.('change', apply)
  }, [themeMode])

  const handleModelChange = useCallback(next => {
    setModel(next)
    localStorage.setItem('ft_model', next)
  }, [])

  useEffect(() => {
    let mounted = true
    const syncSession = (session, markReady = false) => {
      if (!mounted) return
      const nextUser = session?.user || null
      if (lastUserIdRef.current !== nextUser?.id) {
        lastUserIdRef.current = nextUser?.id || null
        setUser(nextUser)
      }
      if (markReady) setAuthLoading(false)
    }
    supabase.auth.getSession().then(({ data: { session } }) => syncSession(session, true)).catch(error => {
      console.error('[auth] getSession failed:', error)
      if (mounted) setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== 'TOKEN_REFRESHED') syncSession(session, event === 'INITIAL_SESSION')
    })
    return () => { mounted = false; subscription.unsubscribe() }
  }, [])

  const {
    treeData, loading: treeLoading,
    density, setDensity,
    expandAll, collapseAll, toggleNode,
    addNode, renameNode, updateStatus, deleteNode, deleteNodeOnly, clearAll, annotateNode, updateNodeDetails, updateNodePlanning, moveNode, reorderNode, applyPriorityAnalyses,
    canUndo, canRedo, lastAction, nextAction, undo, redo,
  } = useTree(user)

  const { goal, goalText, goalExpired, setGoal, clearGoal } = useUserProfile(user)
  const guardedDeleteNode = useGuardedDelete(deleteNode, treeData, goal, backupRef)
  const guardedClearAll = useCallback(async () => {
    await backupRef.current?.preDestructiveBackup?.('清空全部前')
    return clearAll()
  }, [clearAll])
  const treeActions = useMemo(() => ({
    addNode,
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
  }), [addNode, annotateNode, applyPriorityAnalyses, collapseAll, expandAll, guardedClearAll, guardedDeleteNode, renameNode, setGoal, updateNodeDetails, updateStatus])

  const {
    messages, isLoading: chatLoading, sendMessage, resetConversation,
    retryLastMessage, cancelRequest, pendingQueue,
    sessions,
    learnedPatterns,
    recommendations, hitRate, reloadRecommendations,
    recentSummaries, injectReviewMessage,
    applyPriorityAnalysis, requestPriorityAnalysis, applyDraftPlan,
  } = useChat(user, treeActions, goal, model)
  const dailyFocus = useDailyFocus(user, treeData, goal, recentSummaries, learnedPatterns, hitRate)
  const weeklyReview = useWeeklyReview(user, goal, injectReviewMessage)
  const backup = useBackup(user, () => window.location.reload())
  const [backupNow, setBackupNow] = useState(0)
  const backupWarning = !backup.lastManual || !backupNow || backupNow - backup.lastManual > 7 * 24 * 3600 * 1000
  const priorityMetaById = useMemo(() => getDerivedWeightMetaMap(treeData, { userGoal: goal }), [goal, treeData])
  const selectedNodeBase = useMemo(() => selectedNodeId ? findNodeInTree(treeData, selectedNodeId) : null, [selectedNodeId, treeData])
  const selectedMeta = useMemo(() => selectedNodeBase ? getDerivedWeightMeta(priorityMetaById, selectedNodeBase) : null, [priorityMetaById, selectedNodeBase])
  const selectedNode = useMemo(() => selectedNodeBase ? { ...selectedNodeBase, ...(selectedMeta ? { __directPriority: selectedMeta.directPriority, __branchPriority: selectedMeta.branchPriority, __cultivationScore: selectedMeta.cultivationScore, __priorityStaleReasons: selectedMeta.staleReasons, __prioritySignals: selectedMeta.signalBreakdown } : {}) } : null, [selectedMeta, selectedNodeBase])
  const pendingCount = useMemo(() => countPendingProposals(messages), [messages])

  useEffect(() => { backupRef.current = backup }, [backup])
  useEffect(() => {
    const refresh = () => setBackupNow(Date.now())
    refresh()
    const timer = window.setInterval(refresh, 60 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])

  const handleNodeSelect = useCallback(nodeOrId => {
    const node = typeof nodeOrId === 'string' ? findNodeInTree(treeData, nodeOrId) : nodeOrId
    if (!node?.id) {
      setHighlightedNodeId(null)
      setSelectedNodeId(null)
      return
    }
    setHighlightedNodeId(node.id)
    setSelectedNodeId(node.id)
    if (!userPinnedTabRef.current) setDrawerTab('detail')
  }, [treeData])

  const selectDrawerTab = useCallback(tab => {
    userPinnedTabRef.current = true
    setDrawerTab(tab)
  }, [])

  const closeUtilityTab = useCallback(kind => {
    setTemporaryTabs(current => current.filter(tab => tab.value !== kind))
    setDrawerTab(current => current === kind ? 'chat' : current)
  }, [])

  const openUtilityTab = useCallback(kind => {
    const config = {
      memory: { label: '记忆', icon: Lightbulb },
      recommendations: { label: '推荐', icon: Archive },
      history: { label: '历史', icon: History },
      backup: { label: '数据', icon: Database },
    }[kind]
    if (!config) return
    setTemporaryTabs(current => {
      const next = current.filter(tab => tab.value !== kind)
      return [...next, { value: kind, ...config, temporary: true, onClose: () => closeUtilityTab(kind) }].slice(-2)
    })
    userPinnedTabRef.current = true
    setDrawerTab(kind)
  }, [closeUtilityTab])

  const handleGoalEdit = useCallback(() => {
    const next = window.prompt('设置当前阶段目标：', goalText || '')
    if (next == null) return
    if (!next.trim()) clearGoal()
    else setGoal(next.trim(), { deadline: goal?.deadline, constraints: goal?.constraints, exclude: goal?.exclude })
  }, [clearGoal, goal, goalText, setGoal])

  const createDefaultNode = useCallback(async (parentNode, type) => {
    const nodeType = type || 'task'
    const newId = await addNode({ name: defaultNodeName(nodeType), type: nodeType, parentId: parentNode?.id || null, color: nodeType === 'project' ? DEFAULT_PROJECT_COLOR : undefined })
    if (newId) handleNodeSelect(newId)
    return newId
  }, [addNode, handleNodeSelect])

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
      if (mod && key === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return }
      if (mod && key === 'y') { event.preventDefault(); redo(); return }
      if (event.key === 'delete' || event.key === 'backspace') { if (selectedNode) { event.preventDefault(); deleteSelectedNode() } return }
      if (['1', '2', '3', '4'].includes(event.key)) { setMode(['tree', 'focus', 'list', 'review'][Number(event.key) - 1]); return }
      if (key === 'c') { selectDrawerTab('chat'); return }
      if (key === 'i') { selectDrawerTab('inbox'); return }
      if (key === 'a') { selectDrawerTab('audit'); return }
      if (key === '/') { selectDrawerTab('chat'); window.setTimeout(() => window.dispatchEvent(new CustomEvent('ft-focus-chat')), 0) }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [authLoading, deleteSelectedNode, redo, selectDrawerTab, selectedNode, undo, user])

  const handleDropBranch = useCallback(async (source, target, drop) => {
    if (drop?.mode === 'reorder') await reorderNode(source.id, target.id, drop.placement)
    else await moveNode(source.id, target.id)
  }, [moveNode, reorderNode])

  const handlePrefill = useCallback(text => {
    selectDrawerTab('chat')
    window.dispatchEvent(new CustomEvent('ft-prefill-chat', { detail: text }))
  }, [selectDrawerTab])

  const handleSignOut = useCallback(() => supabase.auth.signOut(), [])
  const handleApplyPriority = useCallback(async (...args) => {
    await applyPriorityAnalysis(...args)
    setPriorityCalculationVersion(Date.now())
  }, [applyPriorityAnalysis])

  if (authLoading) return <div className="ft-auth-loading"><span className="ft-loading-line" />载入中…</div>
  if (!user) return <AuthPage />

  const renderDrawerTab = tab => {
    if (tab === 'chat') return <ChatPanel isOpen messages={messages} isLoading={chatLoading} onSend={text => sendMessage(text, treeData, { selectedNodeId })} goalText={goalText} goalExpired={goalExpired} onSetGoal={setGoal} onClearGoal={clearGoal} model={model} onModelChange={handleModelChange} onResetConversation={resetConversation} onOpenHistory={() => openUtilityTab('history')} onOpenLearned={() => openUtilityTab('memory')} onOpenRecommendations={() => { reloadRecommendations(); openUtilityTab('recommendations') }} hitRate={hitRate} treeData={treeData} onHoverNode={setHighlightedNodeId} onSelectNode={handleNodeSelect} onTriggerReview={() => weeklyReview.generate({ silent: false })} reviewGenerating={weeklyReview.generating} onRetry={() => retryLastMessage(treeData, { selectedNodeId })} onCancel={cancelRequest} onApplyDraftPlan={messageId => applyDraftPlan(messageId, treeData)} onApplyPriorityAnalysis={(messageId, overrides) => handleApplyPriority(messageId, overrides, treeData)} pendingCount={pendingQueue.length} />
    if (tab === 'inbox') return <InboxTab messages={messages} treeData={treeData} userGoal={goal} onApplyDraftPlan={messageId => applyDraftPlan(messageId, treeData)} onApplyPriorityAnalysis={(messageId, overrides) => handleApplyPriority(messageId, overrides, treeData)} onSelectNode={handleNodeSelect} />
    if (tab === 'detail') return <NodeDetailPanel key={selectedNode?.id || 'empty'} node={selectedNode} onClose={() => selectDrawerTab('chat')} onRenameNode={renameNode} onUpdateDetails={updateNodeDetails} onUpdatePlanning={updateNodePlanning} onStatusChange={updateStatus} />
    if (tab === 'audit') return <AuditTab treeData={treeData} goal={goal} selectedNode={selectedNode} onSelectNode={handleNodeSelect} onRequestAnalysis={options => requestPriorityAnalysis(treeData, options)} analysisLoading={chatLoading} onRecalculate={() => setPriorityCalculationVersion(Date.now())} />
    if (['memory', 'recommendations', 'history', 'backup'].includes(tab)) return <UtilityTab kind={tab} learnedPatterns={learnedPatterns} recommendations={recommendations} sessions={sessions} backup={backup} onClose={() => closeUtilityTab(tab)} />
    return null
  }

  return (
    <AppShell
      mode={mode}
      onModeChange={next => { setMode(next); if (next !== 'tree') userPinnedTabRef.current = true }}
      drawerTab={drawerTab}
      onDrawerTab={tab => tab ? selectDrawerTab(tab) : setDrawerTab(null)}
      onDrawerClose={() => setDrawerTab(null)}
      renderDrawerTab={renderDrawerTab}
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
      onOpenTab={kind => kind === 'account' ? openUtilityTab('memory') : openUtilityTab(kind)}
      backupWarning={backupWarning}
      themeMode={themeMode}
      onThemeChange={setThemeMode}
      onSignOut={handleSignOut}
      hasSelection={Boolean(selectedNode)}
      pendingCount={pendingCount}
      temporaryTabs={temporaryTabs}
    >
      {mode === 'tree' ? <CanvasStage theme={resolvedTheme} treeData={treeData} treeLoading={treeLoading} dailyFocus={dailyFocus} onNodeSelect={handleNodeSelect} onNodeToggle={node => toggleNode(node.id)} onContextAction={handleContextAction} resetZoomRef={resetZoomRef} highlightedNodeId={highlightedNodeId} onLeafAdd={createDefaultNode} onDropBranch={handleDropBranch} onRenameNode={renameNode} priorityCalculationVersion={priorityCalculationVersion} density={density} onDensityChange={setDensity} onExpandAll={expandAll} onCollapseAll={collapseAll} onExample={handlePrefill} userGoal={goal} layers={layers} onLayerChange={(key, value) => setLayers(current => ({ ...current, [key]: value }))} /> : null}
      {mode === 'focus' ? <FocusView focus={dailyFocus.focus} generating={dailyFocus.generating} onGenerate={dailyFocus.generate} onToggle={dailyFocus.toggleTask} onGoTree={() => setMode('tree')} /> : null}
      {mode === 'list' ? <ListView treeData={treeData} userGoal={goal} onStatusChange={updateStatus} onSelect={handleNodeSelect} /> : null}
      {mode === 'review' ? <ReviewView review={weeklyReview.latestReview} history={weeklyReview.history} generating={weeklyReview.generating} onGenerate={() => weeklyReview.generate({ silent: false })} /> : null}
    </AppShell>
  )
}

function useGuardedDelete(deleteNode, treeData, goal, backupRef) {
  return useCallback(async nodeId => {
    const node = findNodeInTree(treeData, nodeId)
    if (getDeleteRisk(node, treeData, goal).shouldConfirm) await backupRef.current?.preDestructiveBackup?.('删除子树前')
    return deleteNode(nodeId)
  }, [backupRef, deleteNode, goal, treeData])
}

function countPendingProposals(messages = []) {
  return messages.reduce((count, message) => {
    if (message?.role !== 'assistant' || !message.thinking) return count
    const draft = !message.applied_draft_actions && Array.isArray(message.thinking.draft_actions) ? message.thinking.draft_actions.length : 0
    const goal = !message.applied_priority_analysis && message.thinking.goal_analysis ? 1 : 0
    const priority = !message.applied_priority_analysis && Array.isArray(message.thinking.node_priority_proposals) ? message.thinking.node_priority_proposals.length : 0
    return count + draft + goal + priority
  }, 0)
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
