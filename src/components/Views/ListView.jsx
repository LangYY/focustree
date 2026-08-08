import { ArrowDownUp, Check, Filter, FolderTree, MoreHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { flattenTree, getDerivedWeightMetaMap, getDerivedWeightMeta, getNodeDueState } from '../../lib/treeUtils'
import ProgressBar from '../ui/ProgressBar'

export default function ListView({ treeData, userGoal, onStatusChange, onSelect }) {
  const [group, setGroup] = useState('status')
  const [sort, setSort] = useState('direct')
  const [filter, setFilter] = useState('all')
  const metaById = useMemo(() => getDerivedWeightMetaMap(treeData, { userGoal }), [treeData, userGoal])
  const tasks = useMemo(() => {
    const all = flattenTree(treeData).filter(node => node.type === 'task')
    const filtered = filter === 'due' ? all.filter(node => getNodeDueState(node)?.state && getNodeDueState(node).state !== 'later') : all
    return filtered.sort((a, b) => {
      const aMeta = getDerivedWeightMeta(metaById, a) || {}
      const bMeta = getDerivedWeightMeta(metaById, b) || {}
      if (sort === 'branch') return (bMeta.branchPriority || 0) - (aMeta.branchPriority || 0)
      if (sort === 'cultivation') return (bMeta.cultivationScore || 0) - (aMeta.cultivationScore || 0)
      if (sort === 'due') return String(a.target_completion_date || '9999').localeCompare(String(b.target_completion_date || '9999'))
      return (bMeta.directPriority || 0) - (aMeta.directPriority || 0)
    })
  }, [filter, metaById, sort, treeData])
  const groups = useMemo(() => {
    if (group === 'all') return [{ key: 'all', label: '全部任务', items: tasks }]
    const grouped = new Map()
    tasks.forEach(task => {
      const key = group === 'status' ? task.status || 'active' : task.parent_name || '未分组'
      const label = group === 'status' ? ({ active: '进行中', dormant: '已暂停', done: '已完成' }[key] || key) : key
      if (!grouped.has(key)) grouped.set(key, { key, label, items: [] })
      grouped.get(key).items.push(task)
    })
    return [...grouped.values()]
  }, [group, tasks])
  return (
    <section className="ft-list-view">
      <div className="ft-view-heading"><div><span className="ft-eyebrow">THREE SIGNALS / TASKS</span><h1>清单</h1><p>所有末端任务，按你现在真正需要的信息排序。</p></div><div className="ft-list-stats ft-mono">{tasks.length} 个任务</div></div>
      <div className="ft-list-controls"><Segment icon={FolderTree} label="分组" value={group} onChange={setGroup} options={[['status', '按状态'], ['project', '按项目']]} /><Segment icon={ArrowDownUp} label="排序" value={sort} onChange={setSort} options={[['direct', '直接优先级'], ['branch', '枝干意义'], ['cultivation', '培育度'], ['due', '期限']]} /><Segment icon={Filter} label="过滤" value={filter} onChange={setFilter} options={[['all', '全部'], ['due', '有期限']]} /></div>
      <div className="ft-list-table" role="list">
        {groups.map(section => <section className="ft-list-group" key={section.key}>
          {group !== 'all' ? <div className="ft-list-group-heading"><span>{section.label}</span><b className="ft-mono">{section.items.length}</b></div> : null}
          {section.items.map(task => <ListRow key={task.id} task={task} meta={getDerivedWeightMeta(metaById, task) || {}} onStatusChange={onStatusChange} onSelect={onSelect} />)}
        </section>)}
        {!tasks.length ? <div className="ft-list-empty"><MoreHorizontal size={22} />暂时没有符合条件的任务。</div> : null}
      </div>
    </section>
  )
}

function Segment({ icon: Icon, label, value, onChange, options }) {
  return <label className="ft-list-segment"><span><Icon size={13} />{label}</span><select value={value} onChange={event => onChange(event.target.value)} aria-label={label}>{options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}</select></label>
}

function ListRow({ task, meta, onStatusChange, onSelect }) {
  const due = getNodeDueState(task)
  return (
    <div className={`ft-list-row ${task.status === 'done' ? 'is-done' : ''}`} role="listitem" onClick={() => onSelect?.(task)}>
      <span className="ft-list-branch" />
      <button type="button" className="ft-list-check" onClick={event => { event.stopPropagation(); onStatusChange?.(task.id, task.status === 'done' ? 'active' : 'done') }} aria-label={task.status === 'done' ? '标记未完成' : '标记完成'}>{task.status === 'done' ? <Check size={12} /> : null}</button>
      <div className="ft-list-copy"><strong>{task.name}</strong><span>{task.parent_name || '未分组'} {due?.state && due.state !== 'later' ? ` · ${due.label}` : ''}</span></div>
      <div className="ft-list-scores" title={`现在 ${Math.round(meta.directPriority || 0)} · 未来 ${Math.round(meta.branchPriority || 0)} · 培育 ${Math.round(meta.cultivationScore || 0)}`}><ProgressBar value={meta.directPriority} /><ProgressBar value={meta.branchPriority} tone="ai" /><ProgressBar value={meta.cultivationScore} tone="warn" /></div>
      <span className="ft-list-number ft-mono">{Math.round(meta.directPriority || 0)}</span>
    </div>
  )
}
