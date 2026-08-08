import { ChevronRight, RefreshCw, Route, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { getDerivedWeightMeta, getDerivedWeightMetaMap, flattenTree } from '../../lib/treeUtils'
import ProgressBar from '../ui/ProgressBar'

export default function AuditTab({ treeData, goal, selectedNode, onSelectNode, onRequestAnalysis, analysisLoading, onRecalculate }) {
  const [mode, setMode] = useState('node')
  const [sort, setSort] = useState('direct')
  const metaById = useMemo(() => getDerivedWeightMetaMap(treeData, { userGoal: goal }), [goal, treeData])
  const rows = useMemo(() => flattenTree(treeData).filter(node => node.type !== 'root').map(node => ({ node, meta: getDerivedWeightMeta(metaById, node) || {} })).sort((a, b) => (b.meta[sort === 'direct' ? 'directPriority' : sort === 'branch' ? 'branchPriority' : 'cultivationScore'] || 0) - (a.meta[sort === 'direct' ? 'directPriority' : sort === 'branch' ? 'branchPriority' : 'cultivationScore'] || 0)), [metaById, sort, treeData])
  const target = selectedNode || rows[0]?.node
  const meta = target ? getDerivedWeightMeta(metaById, target) || {} : {}
  const signalTotal = meta.signalBreakdown?.reduce((sum, item) => sum + (Number(item.contribution) || 0), 0) || 1
  return (
    <div className="ft-audit-tab">
      <div className="ft-drawer-intro"><div><span className="ft-eyebrow">AUDIT / EXPLAINER</span><h1>为什么是这个分数</h1><p>本地算法、目标信号和结构传播都在这里可查。</p></div><button type="button" className="ft-quiet-button" onClick={onRecalculate}><RefreshCw size={14} />重新计算</button></div>
      <div className="ft-audit-mode"><button type="button" className={mode === 'node' ? 'is-active' : ''} onClick={() => setMode('node')}>当前节点</button><button type="button" className={mode === 'tree' ? 'is-active' : ''} onClick={() => setMode('tree')}>整棵树</button></div>
      {mode === 'tree' ? <TreeTable rows={rows} sort={sort} setSort={setSort} onSelect={onSelectNode} /> : <NodeAudit target={target} meta={meta} signalTotal={signalTotal} onRequestAnalysis={onRequestAnalysis} analysisLoading={analysisLoading} onSelectNode={onSelectNode} />}
    </div>
  )
}

function NodeAudit({ target, meta, signalTotal, onRequestAnalysis, analysisLoading, onSelectNode }) {
  if (!target) return <div className="ft-audit-empty"><Sparkles size={28} /><span>选中一个节点后，这里会解释它为什么得到这个分数。</span></div>
  return <div className="ft-node-audit"><div className="ft-audit-object"><span className="ft-branch-dot" /><strong>{target.name}</strong><span>{target.type === 'project' ? '项目' : target.type === 'category' ? '分类' : '任务'}</span></div><div className="ft-score-trio"><Score value={meta.directPriority} label="现在" note="直接优先级" /><Score value={meta.branchPriority} label="未来" note="枝干意义" /><Score value={meta.cultivationScore} label="过去" note="培育程度" /></div><section className="ft-audit-section"><h2>directPriority 瀑布</h2><div className="ft-waterfall">{(meta.signalBreakdown || []).map(signal => <div className="ft-waterfall-row" key={signal.key}><div className="ft-waterfall-label"><span>{signal.key}</span><b className="ft-mono">{signal.contribution > 0 ? '+' : ''}{Math.round(signal.contribution || 0)}</b></div><ProgressBar value={Math.abs(Number(signal.contribution || 0)) / signalTotal * 100} tone={signal.contribution < 0 ? 'danger' : 'accent'} /></div>)}</div></section><section className="ft-audit-section"><h2><Route size={14} /> branchPriority 关键路径</h2><div className="ft-path-chips"><button type="button" onClick={() => onSelectNode?.(target)}>{target.name}</button><ChevronRight size={13} />{(target.children || []).slice(0, 3).map(child => <span key={child.id}><button type="button" onClick={() => onSelectNode?.(child)}>{child.name}</button><ChevronRight size={13} /></span>)}</div></section><section className="ft-audit-section"><h2>cultivationScore 构成</h2><div className="ft-cultivation-stack"><CultivationPart label="自身证据" value={42} /><CultivationPart label="结构" value={32} /><CultivationPart label="完成" value={14} /><CultivationPart label="近期活跃" value={12} /></div></section><div className="ft-audit-freshness"><span className={meta.staleReasons?.length ? 'is-stale' : 'is-fresh'}>{meta.staleReasons?.length ? '分析已过期，当前使用本地信号' : '分析新鲜'}</span><button type="button" onClick={() => onRequestAnalysis?.({ mode: 'missing', nodeIds: [target.id] })} disabled={analysisLoading}>{analysisLoading ? '请求中…' : '重新分析此节点'}</button></div></div>
}

function Score({ value, label, note }) { return <div className="ft-score-item"><strong className="ft-mono">{Math.round(value || 0)}</strong><span>{label}</span><small>{note}</small></div> }
function CultivationPart({ label, value }) { return <div><span>{label}</span><ProgressBar value={value} tone="warn" /><b className="ft-mono">{value}%</b></div> }
function TreeTable({ rows, sort, setSort, onSelect }) { return <div className="ft-audit-table"><div className="ft-audit-table-head"><span>节点</span><button type="button" className={sort === 'direct' ? 'is-active' : ''} onClick={() => setSort('direct')}>现在</button><button type="button" className={sort === 'branch' ? 'is-active' : ''} onClick={() => setSort('branch')}>未来</button><button type="button" className={sort === 'cultivation' ? 'is-active' : ''} onClick={() => setSort('cultivation')}>过去</button></div>{rows.map(row => <button type="button" className="ft-audit-table-row" key={row.node.id} onClick={() => onSelect?.(row.node)}><span>{row.node.name}</span><b className="ft-mono">{Math.round(row.meta.directPriority || 0)}</b><b className="ft-mono">{Math.round(row.meta.branchPriority || 0)}</b><b className="ft-mono">{Math.round(row.meta.cultivationScore || 0)}</b></button>)}</div> }
