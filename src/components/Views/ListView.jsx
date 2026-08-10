import { Check, Filter, MoreHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { resolveBranchBaseColor } from '../../lib/branchPalette'
import { getDerivedWeightMetaMap } from '../../lib/treeUtils'
import { buildBoardColumns } from './boardModel'

const FILTERS = [
  ['all', '全部'],
  ['active', '只看进行中'],
  ['due', '只看有期限的'],
]

export default function ListView({ treeData, userGoal, onStatusChange, onSelect }) {
  const [filter, setFilter] = useState('all')
  const metaById = useMemo(() => getDerivedWeightMetaMap(treeData, { userGoal }), [treeData, userGoal])
  const columns = useMemo(
    () => buildBoardColumns(treeData, metaById, filter),
    [filter, metaById, treeData],
  )
  const taskCount = columns.reduce((total, column) => total + column.tasks.length, 0)

  return (
    <section className="ft-list-view">
      <div className="ft-view-heading">
        <div>
          <span className="ft-eyebrow">PROJECT BOARD / TASKS</span>
          <h1>看板</h1>
          <p>按项目查看所有末端任务，状态在卡片上直接切换。</p>
        </div>
        <div className="ft-list-stats ft-mono">{taskCount} 个任务</div>
      </div>
      <div className="ft-board-filters" role="group" aria-label="看板过滤">
        <span><Filter size={13} />过滤</span>
        {FILTERS.map(([value, label]) => (
          <button key={value} type="button" className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </div>
      {columns.length ? (
        <div className="ft-board-scroll">
          <div className="ft-board-columns">
            {columns.map((column, index) => (
              <BoardColumn key={column.key} column={column} index={index} onStatusChange={onStatusChange} onSelect={onSelect} />
            ))}
          </div>
        </div>
      ) : (
        <div className="ft-board-empty"><MoreHorizontal size={22} />还没有顶层项目，先在树里创建一个项目。</div>
      )}
    </section>
  )
}

function BoardColumn({ column, index, onStatusChange, onSelect }) {
  const branchColor = resolveBranchBaseColor({ data: column.project }, index, 'dark')
  return (
    <article className="ft-board-column">
      <header className="ft-board-column-head">
        <div className="ft-board-column-title"><span className="ft-board-branch" style={{ backgroundColor: branchColor }} /><h2 title={column.project.name}>{column.project.name}</h2></div>
        <span className="ft-board-count ft-mono">{column.tasks.length}</span>
      </header>
      <div className="ft-board-cards" role="list" aria-label={`${column.project.name} 的任务`}>
        {column.tasks.map(task => <BoardCard key={task.id} task={task} onStatusChange={onStatusChange} onSelect={onSelect} />)}
        {!column.tasks.length ? <div className="ft-board-column-empty">没有符合条件的任务</div> : null}
      </div>
    </article>
  )
}

function BoardCard({ task, onStatusChange, onSelect }) {
  const isDone = task.status === 'done'
  return (
    <article className={`ft-board-card ${isDone ? 'is-done' : ''}`} role="listitem" onClick={() => onSelect?.(task)}>
      <div className="ft-board-card-top">
        <button type="button" className={`ft-board-status ${isDone ? 'is-done' : ''}`} onClick={event => { event.stopPropagation(); onStatusChange?.(task.id, isDone ? 'active' : 'done') }} aria-label={isDone ? '标记未完成' : '标记完成'}>
          {isDone ? <Check size={12} /> : null}
        </button>
        <strong title={task.name}>{task.name}</strong>
      </div>
      <div className="ft-board-card-meta">
        <span className="ft-board-category" title={task.categoryName}>{task.categoryName}</span>
        <span className={`ft-board-due ${task.due ? `is-${task.due.state}` : 'is-later'}`}>{task.due?.label || '无期限'}</span>
      </div>
    </article>
  )
}
