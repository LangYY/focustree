import { useCallback, useEffect, useRef, useState } from 'react'
import { PRIORITY_OPTIONS, getNodeDueState } from '../../lib/treeUtils'

const AUTOSAVE_DELAY_MS = 1200

const STATUS_OPTIONS = [
  { value: 'active', label: '进行中' },
  { value: 'done', label: '完成' },
  { value: 'dormant', label: '暂停' },
]

function typeLabel(type) {
  if (type === 'project') return '项目'
  if (type === 'category') return '分类'
  return '任务'
}

export default function NodeDetailPanel({
  node,
  onClose,
  onRenameNode,
  onUpdateDetails,
  onUpdatePlanning,
  onStatusChange,
}) {
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
  const [savedSnapshot, setSavedSnapshot] = useState({
    id: node?.id || null,
    title: initialTitle,
    details: initialDetails,
    priority: initialPriority,
    targetDate: initialTargetDate,
  })
  const loadedRef = useRef({
    id: node?.id || null,
    title: initialTitle,
    details: initialDetails,
    priority: initialPriority,
    targetDate: initialTargetDate,
  })
  const activeSavesRef = useRef(0)

  const nodeId = node?.id || null
  const nodeType = node?.type || null
  const invalidTitle = Boolean(nodeId) && !title.trim()
  const titleDirty = Boolean(nodeId && title.trim() && title.trim() !== savedSnapshot.title)
  const detailsDirty = Boolean(nodeId) && details !== savedSnapshot.details
  const planningDirty = Boolean(nodeId) &&
    (priority !== savedSnapshot.priority || targetDate !== savedSnapshot.targetDate)

  const runSave = useCallback(async (task) => {
    activeSavesRef.current += 1
    setSaving(true)
    setSaveError('')
    try {
      await task()
    } catch (error) {
      console.warn('[NodeDetailPanel autosave]', error)
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
      setSavedSnapshot(prev => (
        prev.id === currentNodeId ? { ...prev, title: nextTitle } : prev
      ))
      loadedRef.current = { ...loadedRef.current, id: currentNodeId, title: nextTitle }
    })
  }, [nodeId, onRenameNode, runSave, savedSnapshot.title, title])

  const saveDetails = useCallback(async (value = details) => {
    if (!nodeId) return
    const nextDetails = String(value ?? '')
    if (nextDetails === savedSnapshot.details) return
    const currentNodeId = nodeId
    await runSave(async () => {
      await onUpdateDetails?.(currentNodeId, nextDetails)
      setSavedSnapshot(prev => (
        prev.id === currentNodeId ? { ...prev, details: nextDetails } : prev
      ))
      loadedRef.current = { ...loadedRef.current, id: currentNodeId, details: nextDetails }
    })
  }, [details, nodeId, onUpdateDetails, runSave, savedSnapshot.details])

  const savePlanning = useCallback(async (next = {}) => {
    if (!nodeId) return
    const nextPriority = Object.prototype.hasOwnProperty.call(next, 'priority')
      ? (next.priority || '')
      : priority
    const nextTargetDate = Object.prototype.hasOwnProperty.call(next, 'targetDate')
      ? (next.targetDate || '')
      : targetDate
    const payload = {}
    if (nextPriority !== savedSnapshot.priority) {
      payload.current_priority = nextPriority || null
    }
    if (nextTargetDate !== savedSnapshot.targetDate) {
      payload.target_completion_date = nextTargetDate || null
    }
    if (!Object.keys(payload).length) return

    const currentNodeId = nodeId
    await runSave(async () => {
      await onUpdatePlanning?.(currentNodeId, payload)
      setSavedSnapshot(prev => (
        prev.id === currentNodeId
          ? { ...prev, priority: nextPriority, targetDate: nextTargetDate }
          : prev
      ))
      loadedRef.current = {
        ...loadedRef.current,
        id: currentNodeId,
        priority: nextPriority,
        targetDate: nextTargetDate,
      }
    })
  }, [nodeId, onUpdatePlanning, priority, runSave, savedSnapshot.priority, savedSnapshot.targetDate, targetDate])

  const saveAll = useCallback(async () => {
    await saveTitle(title)
    await saveDetails(details)
    await savePlanning()
  }, [details, saveDetails, savePlanning, saveTitle, title])

  useEffect(() => {
    if (!nodeId || nodeType === 'root') return
    if (!titleDirty && !detailsDirty) return
    const timer = window.setTimeout(() => {
      if (titleDirty) saveTitle(title)
      if (detailsDirty) saveDetails(details)
    }, AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [details, detailsDirty, nodeId, nodeType, saveDetails, saveTitle, title, titleDirty])

  if (!node || node.type === 'root') return null

  const canSave = titleDirty || detailsDirty
  const dueState = getNodeDueState({ ...node, target_completion_date: targetDate })
  const saveStatus = saving
    ? '保存中'
    : saveError || (invalidTitle ? '标题不能为空' : (canSave || planningDirty ? '等待自动保存' : '已保存'))

  const scores = [
    ['现在', node.__directPriority, 'accent'],
    ['未来', node.__branchPriority, 'ai'],
    ['培育', node.__cultivationScore, 'warn'],
  ]

  return (
    <aside className="ft-detail-panel ft-detail-border-subtle ft-detail-surface">
      <div className="flex items-center justify-between border-b ft-detail-border-subtle px-4 py-3">
        <div>
          <div className="text-[11px] ft-detail-text-tertiary">{typeLabel(node.type)}详情</div>
          <div className={`text-xs ${saveError || invalidTitle ? 'ft-detail-error' : 'ft-detail-text-secondary'}`}>{saveStatus}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ft-detail-close h-8 w-8 rounded-md border"
          aria-label="关闭详情"
        >
          ×
        </button>
      </div>

      <div className="ft-detail-scroll flex-1 overflow-y-auto px-4 py-4">
        <div className="ft-detail-breadcrumb"><span>根</span>{node.parent_id ? <span>…</span> : null}<span><i className="ft-branch-dot" />{node.name}</span></div>
        <label className="mb-2 block text-xs ft-detail-text-secondary">标题</label>
        <input
          value={title}
          onChange={event => {
            setSaveError('')
            setTitle(event.target.value)
          }}
          onBlur={event => saveTitle(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              saveTitle(event.currentTarget.value)
              event.currentTarget.blur()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setTitle(savedSnapshot.title)
              event.currentTarget.blur()
            }
          }}
          className="mb-4 w-full rounded-md border ft-detail-field px-3 py-2 text-sm outline-none"
        />

        <div className="ft-detail-scores" aria-label="三个优先级信号">
          {scores.map(([label, value, tone]) => <div className="ft-detail-score" key={label}><span>{label}</span><span className="ft-progress" data-tone={tone}><span style={{ width: `${Math.max(0, Math.min(100, Number(value) || 0))}%` }} /></span><b>{Math.round(value || 0)}</b></div>)}
        </div>

        <div className="mb-4">
          <div className="mb-2 text-xs ft-detail-text-secondary">状态</div>
          <div className="grid grid-cols-3 gap-2">
            {STATUS_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => onStatusChange?.(node.id, option.value)}
                className={`rounded-md border px-2 py-1.5 text-xs transition-colors ${
                  node.status === option.value
                    ? 'ft-detail-status is-active'
                    : 'ft-detail-status'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <div className="mb-2 text-xs ft-detail-text-secondary">当下优先级</div>
          <div className="grid grid-cols-5 gap-1.5">
            {PRIORITY_OPTIONS.map(option => {
              const value = option.value || ''
              const active = priority === value
              return (
                <button
                  key={value || 'none'}
                  type="button"
                  onClick={() => {
                    setSaveError('')
                    setPriority(value)
                    savePlanning({ priority: value })
                  }}
                  className={`rounded-md border px-1.5 py-1.5 text-xs transition-colors ${
                    active
                      ? value === 'urgent'
                        ? 'ft-urgent-priority ft-detail-priority is-urgent'
                        : 'ft-detail-priority is-active'
                      : 'ft-detail-priority'
                  }`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <label htmlFor="node-target-date" className="text-xs ft-detail-text-secondary">目标完成日期</label>
            {dueState?.state && dueState.state !== 'later' && (
              <span className={`text-[11px] ${
                dueState.state === 'overdue' ? 'ft-detail-due is-overdue' : 'ft-detail-due'
              }`}>
                {dueState.label}
              </span>
            )}
          </div>
          <input
            id="node-target-date"
            type="date"
            value={targetDate}
            onChange={event => {
              const value = event.target.value
              setSaveError('')
              setTargetDate(value)
              savePlanning({ targetDate: value })
            }}
            className="w-full rounded-md border ft-detail-field px-3 py-2 text-sm outline-none"
          />
        </div>

        <label className="mb-2 block text-xs ft-detail-text-secondary">详细想法</label>
        <textarea
          value={details}
          onChange={event => {
            setSaveError('')
            setDetails(event.target.value)
          }}
          onBlur={event => saveDetails(event.target.value)}
          onKeyDown={event => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
              event.preventDefault()
              saveAll()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setDetails(savedSnapshot.details)
              event.currentTarget.blur()
            }
          }}
          placeholder="补充背景、判断、卡点、下一步，或者这个步骤为什么重要。"
          className="min-h-[220px] w-full resize-y rounded-md border ft-detail-field px-3 py-2 text-sm leading-6 outline-none"
        />
      </div>
    </aside>
  )
}
