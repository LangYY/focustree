import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getDerivedWeightMeta, getDerivedWeightMetaMap, flattenTree } from '../../lib/treeUtils'

const STATUS_LABELS = { active: '进行中', done: '完成', dormant: '暂停' }

export default function PriorityAuditModal({ treeData, goal, onSelectNode, onClose }) {
  const [sort, setSort] = useState({ key: 'direct', direction: 'desc' })
  const metaById = useMemo(() => getDerivedWeightMetaMap(treeData, { userGoal: goal }), [goal, treeData])
  const rows = useMemo(() => {
    const next = (treeData ? flattenTree(treeData).filter(node => node.type !== 'root') : [])
      .map(node => ({ node, meta: getDerivedWeightMeta(metaById, node) || {} }))
    return next.sort((a, b) => compareRows(a, b, sort))
  }, [metaById, sort, treeData])

  useEffect(() => {
    const onKeyDown = event => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const changeSort = key => setSort(current => ({
    key,
    direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
  }))

  return (
    <div className="ft-priority-audit-modal" onMouseDown={event => { if (event.currentTarget === event.target) onClose?.() }}>
      <section className="ft-priority-audit-panel" role="dialog" aria-modal="true" aria-labelledby="ft-priority-audit-title">
        <header className="ft-priority-audit-head">
          <h2 id="ft-priority-audit-title">整棵树审计</h2>
          <button type="button" onClick={onClose} aria-label="关闭整棵树审计"><X size={16} /></button>
        </header>
        <div className="ft-priority-audit-table" role="table" aria-label="整棵树优先级审计">
          <div className="ft-priority-audit-row is-head" role="row">
            <SortButton label="节点" sortKey="name" sort={sort} onClick={changeSort} />
            <SortButton label="direct" sortKey="direct" sort={sort} onClick={changeSort} />
            <SortButton label="branch" sortKey="branch" sort={sort} onClick={changeSort} />
            <SortButton label="cultivation" sortKey="cultivation" sort={sort} onClick={changeSort} />
            <SortButton label="状态" sortKey="status" sort={sort} onClick={changeSort} />
            <SortButton label="期限" sortKey="deadline" sort={sort} onClick={changeSort} />
          </div>
          <div className="ft-priority-audit-scroll">
            {rows.map(row => (
              <button type="button" role="row" className="ft-priority-audit-row" key={row.node.id} onClick={() => onSelectNode?.(row.node)}>
                <span role="cell">{row.node.name}</span>
                <b role="cell" className="ft-mono">{Math.round(row.meta.directPriority || 0)}</b>
                <b role="cell" className="ft-mono">{Math.round(row.meta.branchPriority || 0)}</b>
                <b role="cell" className="ft-mono">{Math.round(row.meta.cultivationScore || 0)}</b>
                <span role="cell">{STATUS_LABELS[row.node.status] || row.node.status || '—'}</span>
                <span role="cell">{row.node.target_completion_date || '—'}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function SortButton({ label, sortKey, sort, onClick }) {
  const active = sort.key === sortKey
  const Icon = sort.direction === 'asc' ? ChevronUp : ChevronDown
  return (
    <button type="button" className={active ? 'is-active' : ''} onClick={() => onClick(sortKey)}>
      <span>{label}</span>{active ? <Icon size={11} /> : null}
    </button>
  )
}

function compareRows(a, b, sort) {
  let result
  if (sort.key === 'name') result = String(a.node.name || '').localeCompare(String(b.node.name || ''), 'zh-CN')
  else if (sort.key === 'status') result = String(STATUS_LABELS[a.node.status] || a.node.status || '').localeCompare(String(STATUS_LABELS[b.node.status] || b.node.status || ''), 'zh-CN')
  else if (sort.key === 'deadline') result = String(a.node.target_completion_date || '9999-12-31').localeCompare(String(b.node.target_completion_date || '9999-12-31'))
  else {
    const key = sort.key === 'branch' ? 'branchPriority' : sort.key === 'cultivation' ? 'cultivationScore' : 'directPriority'
    result = (Number(a.meta[key]) || 0) - (Number(b.meta[key]) || 0)
  }
  return sort.direction === 'asc' ? result : -result
}
