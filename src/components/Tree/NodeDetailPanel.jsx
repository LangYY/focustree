import { useCallback, useRef, useState } from 'react'

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
  const loadedRef = useRef({ id: node?.id || null, title: initialTitle, details: initialDetails })

  const savedDetails = node?.annotations?.ai_notes || ''
  const titleDirty = Boolean(node?.id) && title.trim() && title.trim() !== (node?.name || '')
  const detailsDirty = Boolean(node?.id) && details !== savedDetails

  const saveTitle = useCallback(async () => {
    if (!node?.id) return
    const nextTitle = title.trim()
    if (!nextTitle || nextTitle === node.name) return
    setSaving(true)
    try {
      await onRenameNode?.(node.id, nextTitle)
    } finally {
      setSaving(false)
    }
  }, [node, onRenameNode, title])

  const saveDetails = useCallback(async () => {
    if (!node?.id) return
    const nextDetails = details
    if (nextDetails === savedDetails) return
    setSaving(true)
    try {
      await onUpdateDetails?.(node.id, nextDetails)
    } finally {
      setSaving(false)
    }
  }, [details, node, onUpdateDetails, savedDetails])

  const saveAll = useCallback(async () => {
    await saveTitle()
    await saveDetails()
  }, [saveDetails, saveTitle])

  if (!node || node.type === 'root') return null

  const canSave = titleDirty || detailsDirty

  return (
    <aside className="w-[320px] min-w-[300px] max-w-[360px] border-l border-gray-800 bg-gray-950/98 text-gray-100 flex flex-col">
      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <div>
          <div className="text-[11px] text-gray-500">{typeLabel(node.type)}详情</div>
          <div className="text-xs text-gray-400">{saving ? '保存中' : canSave ? '有未保存修改' : '已保存'}</div>
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
          onChange={event => setTitle(event.target.value)}
          onBlur={saveTitle}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              saveTitle()
              event.currentTarget.blur()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setTitle(node.name || '')
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
          onChange={event => setDetails(event.target.value)}
          onBlur={saveDetails}
          onKeyDown={event => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
              event.preventDefault()
              saveAll()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setDetails(loadedRef.current.id === node.id ? loadedRef.current.details : savedDetails)
              event.currentTarget.blur()
            }
          }}
          placeholder="补充背景、判断、卡点、下一步，或者这个步骤为什么重要。"
          className="min-h-[220px] w-full resize-y rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm leading-6 text-gray-100 outline-none focus:border-blue-500"
        />
      </div>

      <div className="border-t border-gray-800 px-4 py-3">
        <button
          type="button"
          onClick={saveAll}
          disabled={!canSave || saving}
          className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500"
        >
          保存
        </button>
      </div>
    </aside>
  )
}
