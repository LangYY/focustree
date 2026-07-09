import { useState, useEffect, useRef } from 'react'

const PROJECT_COLORS = [
  '#4A8C5C', '#A84E3F', '#C07840', '#3E6E97',
  '#A85578', '#74589E', '#A8862E', '#3E8A80',
]

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
      style={{ background: 'rgba(44,56,47,0.28)' }}
      onClick={onClose}
    >
      <div
        className="bg-panel border border-line rounded-2xl p-6 w-96 shadow-lift"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-base font-semibold text-ink mb-4">{title}</div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 名称 */}
          <div>
            <label className="block text-xs text-ink-faint mb-1.5">名称</label>
            <input
              ref={inputRef}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={isProject ? '项目名称…' : type === 'category' ? '分类名称…' : '任务名称…'}
              className="w-full bg-panel-soft border border-line rounded-lg px-3 py-2 text-sm text-ink outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* 类型选择（只在没有 parentNode 时显示，顶层可选 project） */}
          {!parentNode && (
            <div>
              <label className="block text-xs text-ink-faint mb-1.5">类型</label>
              <div className="flex gap-2">
                {['project'].map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      type === t
                        ? 'bg-accent border-accent text-white'
                        : 'bg-panel-soft border-line text-ink-faint'
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
              <label className="block text-xs text-ink-faint mb-1.5">颜色</label>
              <div className="flex gap-2 flex-wrap">
                {PROJECT_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    style={{ background: c }}
                    className={`w-7 h-7 rounded-full transition-transform ${
                      color === c ? 'ring-2 ring-ink ring-offset-2 ring-offset-panel scale-110' : ''
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
              className="flex-1 py-2 rounded-lg text-sm text-ink-faint border border-line hover:border-line-strong transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="flex-1 py-2 rounded-lg text-sm font-semibold bg-accent hover:bg-accent-strong disabled:bg-panel-soft disabled:text-ink-ghost text-white transition-colors"
            >
              创建
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
