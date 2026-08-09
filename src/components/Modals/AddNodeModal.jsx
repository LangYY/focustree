import { useState, useEffect, useRef } from 'react'
import { BRANCH_PALETTE } from '../../lib/branchPalette'

const PROJECT_COLORS = BRANCH_PALETTE.dark

export default function AddNodeModal({ parentNode, defaultType, onConfirm, onClose }) {
  const [name, setName]   = useState('')
  const [type, setType]   = useState(defaultType || 'project')
  const [color, setColor] = useState(PROJECT_COLORS[0])
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 按 Esc 关闭
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    onConfirm({ name, type, color: type === 'project' ? color : undefined, parentId: parentNode?.id })
    onClose()
  }

  const isProject = type === 'project'
  const title = parentNode
    ? `在「${parentNode.name}」下添加${type === 'category' ? '分类' : '任务'}`
    : '新建项目'

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'var(--ft-overlay-scrim)' }}
      onClick={onClose}
    >
      <div
        className="ft-modal-panel border rounded-2xl p-6 w-96 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-base font-semibold ft-modal-text-primary mb-4">{title}</div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 名称 */}
          <div>
            <label className="block text-xs ft-modal-text-secondary mb-1.5">名称</label>
            <input
              ref={inputRef}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={isProject ? '项目名称…' : type === 'category' ? '分类名称…' : '任务名称…'}
              className="w-full ft-modal-surface-hover border ft-modal-border rounded-lg px-3 py-2 text-sm ft-modal-text-primary outline-none ft-modal-field transition-colors"
            />
          </div>

          {/* 类型选择（只在没有 parentNode 时显示，顶层可选 project） */}
          {!parentNode && (
            <div>
              <label className="block text-xs ft-modal-text-secondary mb-1.5">类型</label>
              <div className="flex gap-2">
                {['project'].map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      type === t
                        ? 'ft-modal-bg-accent ft-modal-border-accent ft-modal-text-inverse'
                        : 'ft-modal-surface-hover ft-modal-border ft-modal-text-secondary'
                    }`}
                  >
                    项目
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 颜色（仅 project） */}
          {isProject && (
            <div>
              <label className="block text-xs ft-modal-text-secondary mb-1.5">颜色</label>
              <div className="flex gap-2 flex-wrap">
                {PROJECT_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    style={{ background: c }}
                    className={`w-7 h-7 rounded-full transition-transform ${
                      color === c ? 'ft-modal-color-swatch is-selected' : 'ft-modal-color-swatch'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 按钮 */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-lg text-sm ft-modal-text-secondary border ft-modal-border ft-modal-hover-border-strong transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="flex-1 py-2 rounded-lg text-sm font-semibold ft-modal-primary-action transition-colors"
            >
              创建
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
