import { Fragment, useMemo, useState } from 'react'
import { ChevronRight, RefreshCw, Route, Sparkles } from 'lucide-react'
import { getDerivedWeightMeta, getDerivedWeightMetaMap, flattenTree } from '../../lib/treeUtils'
import { collectPriorityAnalysisNodes, estimatePriorityAnalysisTokens, formatTokenEstimate } from '../../lib/priorityAnalysis'
import ProgressBar from '../ui/ProgressBar'

const STATUS_LABELS = { active: '进行中', done: '完成', dormant: '暂停' }
const RELATION_LABELS = { required: '必需', enables: '支撑', normal: '普通', supporting: '辅助', optional: '探索' }
const CULTIVATION_LABELS = {
  own_evidence: '自身证据',
  structure: '结构',
  completion: '完成',
  recency: '近期活跃',
}

export default function AuditTab({ treeData, goal, selectedNode, onSelectNode, onRequestAnalysis, analysisLoading, onRecalculate }) {
  const [mode, setMode] = useState('node')
  const [sort, setSort] = useState('direct')
  const [confirmFull, setConfirmFull] = useState(false)
  const metaById = useMemo(() => getDerivedWeightMetaMap(treeData, { userGoal: goal }), [goal, treeData])
  const nodes = useMemo(() => treeData ? flattenTree(treeData).filter(node => node.type !== 'root') : [], [treeData])
  const rows = useMemo(() => nodes
    .map(node => ({ node, meta: getDerivedWeightMeta(metaById, node) || {} }))
    .sort((a, b) => compareRows(a, b, sort)), [metaById, nodes, sort])
  const target = selectedNode || rows[0]?.node
  const meta = target ? getDerivedWeightMeta(metaById, target) || {} : {}
  const staleNodeIds = useMemo(() => rows.filter(row => row.node.status !== 'done' && row.meta.staleReasons?.length).map(row => row.node.id), [rows])
  const allNodeIds = useMemo(() => collectPriorityAnalysisNodes(treeData).map(node => node.id), [treeData])
  const staleEstimate = estimatePriorityAnalysisTokens(collectPriorityAnalysisNodes(treeData, staleNodeIds), goal)
  const allEstimate = estimatePriorityAnalysisTokens(collectPriorityAnalysisNodes(treeData), goal)
  const requestMissing = () => onRequestAnalysis?.({ mode: 'missing', nodeIds: staleNodeIds })
  const requestAll = () => {
    if (!confirmFull) {
      setConfirmFull(true)
      return
    }
    setConfirmFull(false)
    onRequestAnalysis?.({ mode: 'all' })
  }

  return (
    <div className="ft-audit-tab">
      <div className="ft-drawer-intro">
        <div><span className="ft-eyebrow">AUDIT / EXPLAINER</span><h1>为什么是这个分数</h1><p>本地算法、目标信号和结构传播都在这里可查。</p></div>
        <button type="button" className="ft-quiet-button" onClick={onRecalculate}><RefreshCw size={14} />重新计算</button>
      </div>
      <div className="ft-audit-mode" role="tablist" aria-label="审计范围">
        <button type="button" role="tab" aria-selected={mode === 'node'} className={mode === 'node' ? 'is-active' : ''} onClick={() => setMode('node')}>当前节点</button>
        <button type="button" role="tab" aria-selected={mode === 'tree'} className={mode === 'tree' ? 'is-active' : ''} onClick={() => setMode('tree')}>整棵树</button>
      </div>
      <div className="ft-audit-analysis-actions">
        <button type="button" onClick={requestMissing} disabled={analysisLoading || !goal?.text || staleNodeIds.length === 0}>
          {analysisLoading ? '分析中…' : `补充分析缺失节点 · ${staleNodeIds.length ? formatTokenEstimate(staleEstimate) : '无需补充'}`}
        </button>
        <button type="button" className={confirmFull ? 'is-confirming' : ''} onClick={requestAll} disabled={analysisLoading || !goal?.text || allNodeIds.length === 0}>
          {confirmFull ? `确认全树重新分析 · ${formatTokenEstimate(allEstimate)}` : `全树重新分析 · ${formatTokenEstimate(allEstimate)}`}
        </button>
      </div>
      {mode === 'tree'
        ? <TreeTable rows={rows} sort={sort} setSort={setSort} onSelect={onSelectNode} />
        : <NodeAudit treeData={treeData} target={target} meta={meta} onRequestAnalysis={onRequestAnalysis} analysisLoading={analysisLoading} onSelectNode={onSelectNode} />}
    </div>
  )
}

function NodeAudit({ treeData, target, meta, onRequestAnalysis, analysisLoading, onSelectNode }) {
  if (!target) return <div className="ft-audit-empty"><Sparkles size={28} /><span>选中一个节点后，这里会解释它为什么得到这个分数。</span></div>
  const cultivation = meta.cultivationBreakdown || []
  const cultivationTotal = Number(meta.cultivationScore) || 0
  const signalTotal = meta.signalBreakdown?.reduce((sum, item) => sum + (Number(item.contribution) || 0), 0) || 1
  const pathNodes = (meta.criticalPath || []).map(id => findNode(treeData, id)).filter(Boolean)
  const pathEdges = meta.criticalPathEdges || []

  return (
    <div className="ft-node-audit">
      <div className="ft-audit-object"><span className="ft-branch-dot" /><strong>{target.name}</strong><span>{target.type === 'project' ? '项目' : target.type === 'category' ? '分类' : '任务'}</span></div>
      <div className="ft-score-trio"><Score value={meta.directPriority} label="现在" note="直接优先级" /><Score value={meta.branchPriority} label="未来" note="枝干意义" /><Score value={meta.cultivationScore} label="过去" note="培育程度" /></div>
      <section className="ft-audit-section">
        <h2>directPriority 瀑布</h2>
        <div className="ft-waterfall">{(meta.signalBreakdown || []).map(signal => <div className="ft-waterfall-row" key={signal.key}><div className="ft-waterfall-label"><span>{signal.key}</span><b className="ft-mono">{signal.contribution > 0 ? '+' : ''}{Number(signal.contribution || 0).toFixed(1)}</b></div><ProgressBar value={Math.abs(Number(signal.contribution || 0)) / signalTotal * 100} tone={signal.contribution < 0 ? 'danger' : 'accent'} /></div>)}</div>
      </section>
      <section className="ft-audit-section">
        <h2><Route size={14} /> branchPriority 关键路径</h2>
        <div className="ft-path-chips">
          {pathNodes.length ? pathNodes.map((pathNode, index) => {
            const edge = pathEdges[index - 1]
            return (
              <Fragment key={pathNode.id}>
                {index > 0 ? <span className="ft-path-hop"><ChevronRight size={13} /><small>{RELATION_LABELS[edge?.relationType] || edge?.relationType || '普通'} · ×{Number(edge?.propagationFactor ?? 1).toFixed(2)}</small></span> : null}
                <button type="button" onClick={() => onSelectNode?.(pathNode)}>{pathNode.name}</button>
              </Fragment>
            )
          }) : <span>暂无关键路径数据</span>}
        </div>
        <p className="ft-path-source">{meta.criticalPathSource === 'self' ? '意义来自节点自身' : '意义来自传播贡献最高的后代'}</p>
      </section>
      <section className="ft-audit-section">
        <h2>cultivationScore 构成</h2>
        <div className="ft-cultivation-stack">
          {cultivation.map(item => <CultivationPart key={item.key} item={item} total={cultivationTotal} />)}
        </div>
        <div className="ft-cultivation-total"><span>合计</span><b className="ft-mono">{cultivationTotal.toFixed(1)}</b></div>
      </section>
      <div className="ft-audit-freshness"><span className={meta.staleReasons?.length ? 'is-stale' : 'is-fresh'}>{meta.staleReasons?.length ? '分析已过期，当前使用本地信号' : '分析新鲜'}</span><button type="button" onClick={() => onRequestAnalysis?.({ mode: 'missing', nodeIds: [target.id] })} disabled={analysisLoading}>{analysisLoading ? '请求中…' : '重新分析此节点'}</button></div>
    </div>
  )
}

function CultivationPart({ item, total }) {
  const contribution = Number(item.contribution) || 0
  return <div title={`${Number(item.rawValue || 0).toFixed(1)} × ${Number(item.weight || 0).toFixed(2)}`}><span>{CULTIVATION_LABELS[item.key] || item.key}</span><ProgressBar value={total ? contribution / total * 100 : 0} tone="warn" /><b className="ft-mono">{contribution.toFixed(1)}</b></div>
}

function Score({ value, label, note }) { return <div className="ft-score-item"><strong className="ft-mono">{Math.round(value || 0)}</strong><span>{label}</span><small>{note}</small></div> }

function TreeTable({ rows, sort, setSort, onSelect }) {
  const columns = [
    ['name', '节点'],
    ['direct', 'direct'],
    ['branch', 'branch'],
    ['cultivation', 'cultivation'],
    ['status', '状态'],
    ['deadline', '期限'],
  ]
  return (
    <div className="ft-audit-table" role="table" aria-label="整棵树审计">
      <div className="ft-audit-table-head" role="row">{columns.map(([key, label]) => <button type="button" role="columnheader" key={key} className={sort === key ? 'is-active' : ''} onClick={() => setSort(key)}>{label}</button>)}</div>
      {rows.map(row => <button type="button" role="row" className="ft-audit-table-row" key={row.node.id} onClick={() => onSelect?.(row.node)}><span role="cell">{row.node.name}</span><b role="cell" className="ft-mono">{Math.round(row.meta.directPriority || 0)}</b><b role="cell" className="ft-mono">{Math.round(row.meta.branchPriority || 0)}</b><b role="cell" className="ft-mono">{Math.round(row.meta.cultivationScore || 0)}</b><span role="cell">{STATUS_LABELS[row.node.status] || row.node.status || '—'}</span><span role="cell">{row.node.target_completion_date || '—'}</span></button>)}
    </div>
  )
}

function compareRows(a, b, sort) {
  if (sort === 'name') return String(a.node.name || '').localeCompare(String(b.node.name || ''), 'zh-CN')
  if (sort === 'status') return String(STATUS_LABELS[a.node.status] || a.node.status || '').localeCompare(String(STATUS_LABELS[b.node.status] || b.node.status || ''), 'zh-CN')
  if (sort === 'deadline') {
    const aDate = a.node.target_completion_date || '9999-12-31'
    const bDate = b.node.target_completion_date || '9999-12-31'
    return aDate.localeCompare(bDate)
  }
  const key = sort === 'branch' ? 'branchPriority' : sort === 'cultivation' ? 'cultivationScore' : 'directPriority'
  return (Number(b.meta[key]) || 0) - (Number(a.meta[key]) || 0)
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
