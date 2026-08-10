import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronRight, RefreshCw, Route, Sparkles } from 'lucide-react'
import { PRIORITY_OPTIONS, getDerivedWeightMeta, getDerivedWeightMetaMap, getNodeDueState } from '../../lib/treeUtils'
import { collectPriorityAnalysisNodes, estimatePriorityAnalysisTokens, formatTokenEstimate } from '../../lib/priorityAnalysis'
import ProgressBar from '../ui/ProgressBar'

const AUTOSAVE_DELAY_MS = 1200
const STATUS_OPTIONS = [
  { value: 'active', label: '进行中' },
  { value: 'done', label: '完成' },
  { value: 'dormant', label: '暂停' },
]
const RELATION_LABELS = { required: '必需', enables: '支撑', normal: '普通', supporting: '辅助', optional: '探索' }
const CULTIVATION_LABELS = { own_evidence: '自身证据', structure: '结构', completion: '完成', recency: '近期活跃' }

export default function NodeInspector({
  node,
  treeData,
  meta,
  goal,
  autoFocusTitle,
  onAutoFocusHandled,
  onClose,
  onSelectNode,
  onRenameNode,
  onUpdateDetails,
  onUpdatePlanning,
  onStatusChange,
  onRequestAnalysis,
  analysisLoading,
  onRecalculate,
}) {
  const inspectorRef = useRef(null)
  const titleRef = useRef(null)
  const [position, setPosition] = useState({ visibility: 'hidden' })
  const initialTitle = node?.name || ''
  const initialDetails = node?.annotations?.ai_notes || ''
  const initialPriority = node?.current_priority || ''
  const initialTargetDate = node?.target_completion_date || ''
  const [title, setTitle] = useState(initialTitle)
  const [details, setDetails] = useState(initialDetails)
  const [priority, setPriority] = useState(initialPriority)
  const [targetDate, setTargetDate] = useState(initialTargetDate)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [savedSnapshot, setSavedSnapshot] = useState(() => ({
    id: node?.id || null,
    title: initialTitle,
    details: initialDetails,
    priority: initialPriority,
    targetDate: initialTargetDate,
  }))
  const activeSavesRef = useRef(0)
  const nodeId = node?.id || null
  const nodeType = node?.type || null
  const invalidTitle = Boolean(nodeId) && !title.trim()
  const titleDirty = Boolean(nodeId && title.trim() && title.trim() !== savedSnapshot.title)
  const detailsDirty = Boolean(nodeId) && details !== savedSnapshot.details
  const planningDirty = Boolean(nodeId) && (priority !== savedSnapshot.priority || targetDate !== savedSnapshot.targetDate)

  const updatePosition = useCallback(() => {
    const panel = inspectorRef.current
    const stage = panel?.closest('.ft-stage')
    if (!panel || !stage || !nodeId) return
    const nodeElement = Array.from(stage.querySelectorAll('.node')).find(element => element.getAttribute('data-node-id') === String(nodeId))
    if (!nodeElement) {
      setPosition(current => current.visibility === 'hidden' ? current : { ...current, visibility: 'hidden' })
      return
    }
    const anchor = nodeElement.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    const stageRect = stage.getBoundingClientRect()
    const margin = 12
    const minLeft = Math.max(stageRect.left + margin, margin)
    const maxRight = Math.min(stageRect.right - margin, window.innerWidth - margin)
    const minTop = Math.max(stageRect.top + margin, margin)
    const maxBottom = Math.min(stageRect.bottom - margin, window.innerHeight - margin)
    const width = panelRect.width || 368
    const height = panelRect.height || 520
    const rightCandidate = anchor.right + 16
    const leftCandidate = anchor.left - width - 16
    let left = rightCandidate + width <= maxRight ? rightCandidate : leftCandidate
    let top = anchor.top
    if (top + height > maxBottom) top = anchor.bottom - height
    left = Math.max(minLeft, Math.min(left, Math.max(minLeft, maxRight - width)))
    top = Math.max(minTop, Math.min(top, Math.max(minTop, maxBottom - height)))
    setPosition({ position: 'fixed', left, top, width: Math.min(width, Math.max(320, maxRight - minLeft)), visibility: 'visible' })
  }, [nodeId])

  useLayoutEffect(() => {
    updatePosition()
    const panel = inspectorRef.current
    const stage = panel?.closest('.ft-stage')
    if (!panel || !stage) return undefined
    const schedule = () => window.requestAnimationFrame(updatePosition)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    resizeObserver?.observe(panel)
    resizeObserver?.observe(stage)
    const mutationObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule)
    mutationObserver?.observe(stage, { subtree: true, childList: true, attributes: true, attributeFilter: ['transform', 'style'] })
    const retry = window.setTimeout(updatePosition, 80)
    return () => {
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
      window.clearTimeout(retry)
    }
  }, [updatePosition])

  useEffect(() => {
    if (!autoFocusTitle || !titleRef.current) return
    titleRef.current.focus()
    titleRef.current.select()
    onAutoFocusHandled?.()
  }, [autoFocusTitle, onAutoFocusHandled])

  useEffect(() => {
    const handleKeyDown = event => {
      if (event.key === 'Escape' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) {
        event.preventDefault()
        onClose?.()
      }
    }
    const handlePointerDown = event => {
      if (inspectorRef.current?.contains(event.target)) return
      const stage = inspectorRef.current?.closest('.ft-stage')
      if (!stage?.contains(event.target)) return
      if (event.target.closest?.('.node')) return
      onClose?.()
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [onClose])

  const runSave = useCallback(async task => {
    activeSavesRef.current += 1
    setSaving(true)
    setSaveError('')
    try {
      await task()
    } catch (error) {
      console.warn('[NodeInspector autosave]', error)
      setSaveError('保存失败')
    } finally {
      activeSavesRef.current = Math.max(0, activeSavesRef.current - 1)
      if (activeSavesRef.current === 0) setSaving(false)
    }
  }, [])

  const saveTitle = useCallback(async (value = title) => {
    if (!nodeId) return
    const nextTitle = String(value ?? '').trim()
    if (!nextTitle || nextTitle === savedSnapshot.title) return
    const currentNodeId = nodeId
    await runSave(async () => {
      await onRenameNode?.(currentNodeId, nextTitle)
      setSavedSnapshot(prev => prev.id === currentNodeId ? { ...prev, title: nextTitle } : prev)
    })
  }, [nodeId, onRenameNode, runSave, savedSnapshot.title, title])

  const saveDetails = useCallback(async (value = details) => {
    if (!nodeId) return
    const nextDetails = String(value ?? '')
    if (nextDetails === savedSnapshot.details) return
    const currentNodeId = nodeId
    await runSave(async () => {
      await onUpdateDetails?.(currentNodeId, nextDetails)
      setSavedSnapshot(prev => prev.id === currentNodeId ? { ...prev, details: nextDetails } : prev)
    })
  }, [details, nodeId, onUpdateDetails, runSave, savedSnapshot.details])

  const savePlanning = useCallback(async (next = {}) => {
    if (!nodeId) return
    const nextPriority = Object.prototype.hasOwnProperty.call(next, 'priority') ? (next.priority || '') : priority
    const nextTargetDate = Object.prototype.hasOwnProperty.call(next, 'targetDate') ? (next.targetDate || '') : targetDate
    const payload = {}
    if (nextPriority !== savedSnapshot.priority) payload.current_priority = nextPriority || null
    if (nextTargetDate !== savedSnapshot.targetDate) payload.target_completion_date = nextTargetDate || null
    if (!Object.keys(payload).length) return
    const currentNodeId = nodeId
    await runSave(async () => {
      await onUpdatePlanning?.(currentNodeId, payload)
      setSavedSnapshot(prev => prev.id === currentNodeId ? { ...prev, priority: nextPriority, targetDate: nextTargetDate } : prev)
    })
  }, [nodeId, onUpdatePlanning, priority, runSave, savedSnapshot.priority, savedSnapshot.targetDate, targetDate])

  const saveAll = useCallback(async () => {
    await saveTitle(title)
    await saveDetails(details)
    await savePlanning()
  }, [details, saveDetails, savePlanning, saveTitle, title])

  useEffect(() => {
    if (!nodeId || nodeType === 'root' || (!titleDirty && !detailsDirty)) return undefined
    const timer = window.setTimeout(() => {
      if (titleDirty) saveTitle(title)
      if (detailsDirty) saveDetails(details)
    }, AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [details, detailsDirty, nodeId, nodeType, saveDetails, saveTitle, title, titleDirty])

  if (!node || node.type === 'root') return null

  const dueState = getNodeDueState({ ...node, target_completion_date: targetDate })
  const saveStatus = saving ? '保存中' : saveError || (invalidTitle ? '标题不能为空' : (titleDirty || detailsDirty || planningDirty ? '等待自动保存' : '已保存'))
  const path = findPath(treeData, node.id)

  return (
    <aside ref={inspectorRef} tabIndex={-1} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveAll() } }} className="ft-node-inspector" style={position} role="dialog" aria-label={`${typeLabel(node.type)}检视卡`}>
      <div className="ft-inspector-head">
        <div><div className="ft-inspector-kicker">{typeLabel(node.type)}</div><div className={`ft-inspector-save ${saveError || invalidTitle ? 'is-error' : ''}`}>{saveStatus}</div></div>
        <button type="button" className="ft-detail-close" onClick={onClose} aria-label="关闭节点检视卡">×</button>
      </div>
      <div className="ft-inspector-scroll">
        <Breadcrumb path={path} onSelectNode={onSelectNode} onClose={onClose} />
        <label className="ft-inspector-label" htmlFor="node-inspector-title">标题</label>
        <input
          ref={titleRef}
          id="node-inspector-title"
          value={title}
          onChange={event => { setSaveError(''); setTitle(event.target.value) }}
          onBlur={event => saveTitle(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); saveTitle(event.currentTarget.value); event.currentTarget.blur() }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setTitle(savedSnapshot.title); event.currentTarget.blur() }
          }}
          className="ft-inspector-field"
        />
        <div className="ft-detail-scores" aria-label="三个优先级信号">
          <InspectorScore label="现在" value={meta?.directPriority ?? node.__directPriority} tone="accent" />
          <InspectorScore label="未来" value={meta?.branchPriority ?? node.__branchPriority} tone="ai" />
          <InspectorScore label="过去" value={meta?.cultivationScore ?? node.__cultivationScore} tone="warn" />
        </div>
        <section className="ft-inspector-section"><div className="ft-inspector-label">状态</div><div className="ft-inspector-grid ft-inspector-grid-3">{STATUS_OPTIONS.map(option => <button type="button" key={option.value} onClick={() => onStatusChange?.(node.id, option.value)} className={`ft-detail-status ${node.status === option.value ? 'is-active' : ''}`}>{option.label}</button>)}</div></section>
        <section className="ft-inspector-section"><div className="ft-inspector-label">当下优先级</div><div className="ft-inspector-grid ft-inspector-grid-5">{PRIORITY_OPTIONS.map(option => { const value = option.value || ''; const active = priority === value; return <button type="button" key={value || 'none'} onClick={() => { setSaveError(''); setPriority(value); savePlanning({ priority: value }) }} className={`ft-detail-priority ${active ? value === 'urgent' ? 'is-active is-urgent' : 'is-active' : ''}`}>{option.label}</button> })}</div></section>
        <section className="ft-inspector-section"><div className="ft-inspector-date-head"><label className="ft-inspector-label" htmlFor="node-target-date">目标完成日期</label>{dueState?.state && dueState.state !== 'later' ? <span className={`ft-detail-due ${dueState.state === 'overdue' ? 'is-overdue' : ''}`}>{dueState.label}</span> : null}</div><input id="node-target-date" type="date" value={targetDate} onChange={event => { const value = event.target.value; setSaveError(''); setTargetDate(value); savePlanning({ targetDate: value }) }} className="ft-inspector-field" /></section>
        <label className="ft-inspector-label" htmlFor="node-inspector-details">详细想法</label>
        <textarea
          id="node-inspector-details"
          value={details}
          onChange={event => { setSaveError(''); setDetails(event.target.value) }}
          onBlur={event => saveDetails(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDetails(savedSnapshot.details); event.currentTarget.blur() }
          }}
          placeholder="补充背景、判断、卡点或下一步。"
          className="ft-inspector-field ft-inspector-textarea"
        />
        <details className="ft-inspector-audit">
          <summary>为什么是这个分数</summary>
          <InspectorAudit treeData={treeData} target={node} meta={meta || {}} goal={goal} onRequestAnalysis={onRequestAnalysis} analysisLoading={analysisLoading} onRecalculate={onRecalculate} onSelectNode={onSelectNode} />
        </details>
      </div>
    </aside>
  )
}

function Breadcrumb({ path, onSelectNode, onClose }) {
  return <div className="ft-detail-breadcrumb">{path.map((item, index) => <Fragment key={item.id}><button type="button" onClick={() => index === 0 ? onClose?.() : onSelectNode?.(item.id)}>{index === 0 ? '根' : item.name}</button></Fragment>)}</div>
}

function InspectorScore({ label, value, tone }) {
  const numeric = Math.max(0, Math.min(100, Number(value) || 0))
  return <div className="ft-detail-score"><span>{label}</span><span className="ft-progress" data-tone={tone}><span style={{ width: `${numeric}%` }} /></span><b>{Math.round(numeric)}</b></div>
}

function InspectorAudit({ treeData, target, meta, goal, onRequestAnalysis, analysisLoading, onRecalculate, onSelectNode }) {
  const cultivation = meta.cultivationBreakdown || []
  const cultivationTotal = Number(meta.cultivationScore) || 0
  const signalTotal = (meta.signalBreakdown || []).reduce((sum, item) => sum + Math.abs(Number(item.contribution) || 0), 0) || 1
  const pathNodes = (meta.criticalPath || []).map(id => findNode(treeData, id)).filter(Boolean)
  const pathEdges = meta.criticalPathEdges || []
  const allNodeIds = collectPriorityAnalysisNodes(treeData).map(node => node.id)
  const metaById = getDerivedWeightMetaMap(treeData, { userGoal: goal })
  const staleNodeIds = collectPriorityAnalysisNodes(treeData).filter(node => node.status !== 'done' && getDerivedWeightMeta(metaById, node)?.staleReasons?.length).map(node => node.id)
  const [confirmFull, setConfirmFull] = useState(false)
  const staleEstimate = estimatePriorityAnalysisTokens(collectPriorityAnalysisNodes(treeData, staleNodeIds), goal)
  const allEstimate = estimatePriorityAnalysisTokens(collectPriorityAnalysisNodes(treeData), goal)
  const requestAll = () => {
    if (!confirmFull) { setConfirmFull(true); return }
    setConfirmFull(false)
    onRequestAnalysis?.({ mode: 'all' })
  }
  if (!target) return <div className="ft-audit-empty"><Sparkles size={28} /><span>选中一个节点后，这里会解释它为什么得到这个分数。</span></div>
  return (
    <div className="ft-node-audit">
      <div className="ft-audit-object"><span className="ft-branch-dot" /><strong>{target.name}</strong><span>{typeLabel(target.type)}</span></div>
      <div className="ft-score-trio"><Score value={meta.directPriority} label="现在" note="直接优先级" /><Score value={meta.branchPriority} label="未来" note="枝干意义" /><Score value={meta.cultivationScore} label="过去" note="培育程度" /></div>
      <section className="ft-audit-section"><h2>signalBreakdown</h2><div className="ft-waterfall">{(meta.signalBreakdown || []).map(signal => <div className="ft-waterfall-row" key={signal.key}><div className="ft-waterfall-label"><span>{signal.key}</span><b className="ft-mono">{signal.contribution > 0 ? '+' : ''}{Number(signal.contribution || 0).toFixed(1)}</b></div><ProgressBar value={Math.abs(Number(signal.contribution || 0)) / signalTotal * 100} tone={signal.contribution < 0 ? 'danger' : 'accent'} /></div>)}</div></section>
      <section className="ft-audit-section"><h2><Route size={14} /> criticalPath</h2><div className="ft-path-chips">{pathNodes.length ? pathNodes.map((pathNode, index) => { const edge = pathEdges[index - 1]; return <Fragment key={pathNode.id}>{index > 0 ? <span className="ft-path-hop"><ChevronRight size={13} /><small>{RELATION_LABELS[edge?.relationType] || edge?.relationType || '普通'} · ×{Number(edge?.propagationFactor ?? 1).toFixed(2)}</small></span> : null}<button type="button" onClick={() => onSelectNode?.(pathNode)}>{pathNode.name}</button></Fragment> }) : <span>暂无关键路径数据</span>}</div><p className="ft-path-source">{meta.criticalPathSource === 'self' ? '意义来自节点自身' : '意义来自传播贡献最高的后代'}</p></section>
      <section className="ft-audit-section"><h2>cultivationBreakdown</h2><div className="ft-cultivation-stack">{cultivation.map(item => <CultivationPart key={item.key} item={item} total={cultivationTotal} />)}</div><div className="ft-cultivation-total"><span>合计</span><b className="ft-mono">{cultivationTotal.toFixed(1)}</b></div></section>
      <div className="ft-audit-freshness"><span className={meta.staleReasons?.length ? 'is-stale' : 'is-fresh'}>{meta.staleReasons?.length ? '分析已过期，当前使用本地信号' : '分析新鲜'}</span><button type="button" onClick={() => onRequestAnalysis?.({ mode: 'missing', nodeIds: [target.id] })} disabled={analysisLoading}>{analysisLoading ? '请求中…' : '重新分析此节点'}</button></div>
      <div className="ft-audit-analysis-actions"><button type="button" onClick={() => onRequestAnalysis?.({ mode: 'missing', nodeIds: staleNodeIds })} disabled={analysisLoading || !goal?.text || staleNodeIds.length === 0}>{analysisLoading ? '分析中…' : `补充分析缺失节点 · ${staleNodeIds.length ? formatTokenEstimate(staleEstimate) : '无需补充'}`}</button><button type="button" className={confirmFull ? 'is-confirming' : ''} onClick={requestAll} disabled={analysisLoading || !goal?.text || allNodeIds.length === 0}>{confirmFull ? `确认全树重新分析 · ${formatTokenEstimate(allEstimate)}` : `全树重新分析 · ${formatTokenEstimate(allEstimate)}`}</button></div>
      <button type="button" className="ft-inspector-recalculate" onClick={onRecalculate}><RefreshCw size={13} />重新计算本地分数</button>
    </div>
  )
}

function CultivationPart({ item, total }) {
  const contribution = Number(item.contribution) || 0
  return <div title={`${Number(item.rawValue || 0).toFixed(1)} × ${Number(item.weight || 0).toFixed(2)}`}><span>{CULTIVATION_LABELS[item.key] || item.key}</span><ProgressBar value={total ? contribution / total * 100 : 0} tone="warn" /><b className="ft-mono">{contribution.toFixed(1)}</b></div>
}

function Score({ value, label, note }) { return <div className="ft-score-item"><strong className="ft-mono">{Math.round(value || 0)}</strong><span>{label}</span><small>{note}</small></div> }

function findPath(tree, id, trail = []) {
  if (!tree) return []
  const next = tree.type === 'root' ? [...trail, { id: tree.id, name: '根' }] : [...trail, { id: tree.id, name: tree.name }]
  if (String(tree.id) === String(id)) return next
  for (const child of tree.children || []) {
    const match = findPath(child, id, next)
    if (match.length) return match
  }
  return []
}

function findNode(tree, id) {
  if (!tree || id == null) return null
  if (String(tree.id) === String(id)) return tree
  for (const child of tree.children || []) {
    const match = findNode(child, id)
    if (match) return match
  }
  return null
}

function typeLabel(type) {
  if (type === 'project') return '项目'
  if (type === 'category') return '分类'
  return '任务'
}
