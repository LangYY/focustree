import { useCallback, useEffect, useRef, useState } from 'react'

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
  onStatusChange,
}) {
  const initialTitle = node?.name || ''
  const initialDetails = node?.annotations?.ai_notes || ''
  const [title, setTitle] = useState(initialTitle)
  const [details, setDetails] = useState(initialDetails)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [savedSnapshot, setSavedSnapshot] = useState({
    id: node?.id || null,
    title: initialTitle,
    details: initialDetails,
  })
  const loadedRef = useRef({ id: node?.id || null, title: initialTitle, details: initialDetails })
  const activeSavesRef = useRef(0)

  const nodeId = node?.id || null
  const nodeType = node?.type || null
  const invalidTitle = Boolean(nodeId) && !title.trim()
  const titleDirty = Boolean(nodeId && title.trim() && title.trim() !== savedSnapshot.title)
  const detailsDirty = Boolean(nodeId) && details !== savedSnapshot.details

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

  const saveAll = useCallback(async () => {
    await saveTitle(title)
    await saveDetails(details)
  }, [details, saveDetails, saveTitle, title])

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
  const saveStatus = saving
    ? '保存中'
    : saveError || (invalidTitle ? '标题不能为空' : (canSave ? '等待自动保存' : '已保存'))

  return (
    <aside className="w-[320px] min-w-[300px] max-w-[360px] border-l border-gray-800 bg-gray-950/98 text-gray-100 flex flex-col">
      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <div>
          <div className="text-[11px] text-gray-500">{typeLabel(node.type)}详情</div>
          <div className={`text-xs ${saveError || invalidTitle ? 'text-amber-400' : 'text-gray-400'}`}>{saveStatus}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-8 w-8 rounded-md border border-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-100"
          aria-label="关闭详情"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <label className="mb-2 block text-xs text-gray-400">标题</label>
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
          className="mb-4 w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500"
        />

        <div className="mb-4">
          <div className="mb-2 text-xs text-gray-400">状态</div>
          <div className="grid grid-cols-3 gap-2">
            {STATUS_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => onStatusChange?.(node.id, option.value)}
                className={`rounded-md border px-2 py-1.5 text-xs transition-colors ${
                  node.status === option.value
                    ? 'border-blue-500 bg-blue-600/25 text-blue-100'
                    : 'border-gray-800 bg-gray-900 text-gray-400 hover:border-gray-600 hover:text-gray-100'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <label className="mb-2 block text-xs text-gray-400">详细想法</label>
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
          className="min-h-[220px] w-full resize-y rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm leading-6 text-gray-100 outline-none focus:border-blue-500"
        />
      </div>
    </aside>
  )
}
