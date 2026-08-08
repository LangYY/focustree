import { Check, ChevronDown, ChevronRight, GitBranch, Gauge, Target, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { computePriorityMetaMap } from '../../lib/priorityEngine'
import { getDerivedWeightMeta, getDerivedWeightMetaMap } from '../../lib/treeUtils'
import ProgressBar from '../ui/ProgressBar'

const SIGNALS = [
  ['goal_alignment', '目标契合', '无关', '必需'],
  ['necessity', '必要性', '可选', '不可绕过'],
  ['delay_cost', '延误损失', '很小', '很大'],
]
const RELATIONS = [['required', '必需'], ['enables', '支撑'], ['normal', '普通'], ['supporting', '辅助'], ['optional', '探索']]

export default function InboxTab({ messages = [], treeData, userGoal, onApplyDraftPlan, onApplyPriorityAnalysis, onSelectNode }) {
  const entries = useMemo(() => collectEntries(messages, treeData, userGoal), [messages, treeData, userGoal])
  const [expanded, setExpanded] = useState(() => new Set())
  const [processed, setProcessed] = useState(() => new Set())
  const [overrides, setOverrides] = useState({})
  const [preview, setPreview] = useState({})
  const [showProcessed, setShowProcessed] = useState(false)
  const activeEntries = useMemo(() => entries.filter(entry => !processed.has(entry.id)), [entries, processed])
  const doneEntries = useMemo(() => entries.filter(entry => processed.has(entry.id)), [entries, processed])
  const toggle = id => setExpanded(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = {}
      for (const entry of activeEntries) {
        if (entry.type !== 'priority') continue
        const proposals = overrides[entry.id] || entry.proposals
        const cloned = applyProposalTree(treeData, proposals)
        const map = computePriorityMetaMap(cloned, { userGoal })
        next[entry.id] = proposals.map(proposal => ({
          id: proposal.node_id,
          value: getDerivedWeightMeta(map, proposal.node_id)?.directPriority ?? getDerivedWeightMeta(getDerivedWeightMetaMap(treeData, { userGoal }), proposal.node_id)?.directPriority ?? 0,
        }))
      }
      setPreview(next)
    }, 120)
    return () => window.clearTimeout(timer)
  }, [activeEntries, overrides, treeData, userGoal])

  const markProcessed = id => setProcessed(current => new Set([...current, id]))
  const applyEntry = async entry => {
    if (entry.type === 'draft') await onApplyDraftPlan?.(entry.message.id)
    if (entry.type === 'priority') await onApplyPriorityAnalysis?.(entry.message.id, { goal_analysis: entry.goal, node_priority_proposals: overrides[entry.id] || entry.proposals })
    markProcessed(entry.id)
  }

  return (
    <div className="ft-inbox-tab">
      <div className="ft-drawer-intro"><div><span className="ft-eyebrow">INBOX / CONFIRMATION</span><h1>待确认</h1><p>重要的改变在这里等你点头，不会被聊天滚走。</p></div><span className="ft-inbox-count ft-mono">{activeEntries.length}</span></div>
      {activeEntries.length ? <div className="ft-inbox-list">{activeEntries.map(entry => <ProposalEntry key={entry.id} entry={entry} open={expanded.has(entry.id)} onToggle={() => toggle(entry.id)} onApply={() => applyEntry(entry)} onSelectNode={onSelectNode} overrides={overrides[entry.id] || entry.proposals} onOverride={value => setOverrides(current => ({ ...current, [entry.id]: value }))} preview={preview[entry.id] || []} />)}</div> : <div className="ft-inbox-empty"><Target size={30} /><h2>没有待确认的提案</h2><p>和 AI 聊聊你在忙什么，它会把建议放到这里。</p></div>}
      {doneEntries.length ? <div className="ft-processed"><button type="button" onClick={() => setShowProcessed(value => !value)}><span>已处理 · {doneEntries.length}</span>{showProcessed ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>{showProcessed ? doneEntries.map(entry => <div className="ft-processed-row" key={entry.id}><Check size={13} />{entry.summary}<span>已处理</span></div>) : null}</div> : null}
      {activeEntries.length ? <div className="ft-inbox-batch"><span className="ft-mono">{activeEntries.length} 条待处理</span><button type="button" onClick={() => activeEntries.forEach(entry => applyEntry(entry))}>全部采纳</button><button type="button" className="is-quiet" onClick={() => activeEntries.forEach(entry => markProcessed(entry.id))}>全部否决</button></div> : null}
    </div>
  )
}

function ProposalEntry({ entry, open, onToggle, onApply, onSelectNode, overrides, onOverride, preview }) {
  const Icon = entry.type === 'draft' ? GitBranch : entry.type === 'goal' ? Target : Gauge
  return (
    <article className={`ft-proposal ${open ? 'is-open' : ''}`}>
      <button type="button" className="ft-proposal-summary" onClick={onToggle}><span className="ft-proposal-marker"><Icon size={15} /></span><span className="ft-proposal-copy"><strong>{entry.summary}</strong><small>{entry.sourceLabel}</small></span>{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
      {open ? <div className="ft-proposal-body">{entry.type === 'draft' ? <DraftBody entry={entry} /> : entry.type === 'goal' ? <GoalBody goal={entry.goal} /> : <PriorityBody entry={entry} proposals={overrides} onOverride={onOverride} preview={preview} onSelectNode={onSelectNode} />}<div className="ft-proposal-actions"><button type="button" className="ft-quiet-button" onClick={onToggle}><X size={13} />稍后</button><button type="button" className="ft-primary-button ft-small-button" onClick={onApply}><Check size={13} />采纳</button></div></div> : null}
    </article>
  )
}

function DraftBody({ entry }) {
  return <div className="ft-draft-preview">{entry.actions.map((action, index) => <div key={`${action.name}-${index}`}><span className="ft-draft-indent" /> <strong>{action.name || '未命名节点'}</strong><small>{draftType(action.type)} · {action.parent || '根节点'}</small></div>)}</div>
}

function GoalBody({ goal }) {
  return <div className="ft-goal-diff"><div><span>提议结果</span><strong>{goal?.outcome || goal?.text || '未命名目标'}</strong></div><div className="ft-diff-grid"><span>类型</span><strong>{goal?.kind === 'stage' ? '阶段目标' : '长期目标'}</strong><span>截止</span><strong>{goal?.deadline || '长期'}</strong><span>约束</span><strong>{goal?.constraints?.join(' · ') || '无'}</strong></div></div>
}

function PriorityBody({ proposals, onOverride, preview, onSelectNode }) {
  return <div className="ft-priority-proposals">{proposals.map((proposal, index) => <SignalCard key={`${proposal.node_id}-${index}`} proposal={proposal} preview={preview.find(item => item.id === proposal.node_id)?.value} onChange={value => onOverride(proposals.map((current, itemIndex) => itemIndex === index ? { ...current, ...value } : current))} onSelect={() => onSelectNode?.(proposal.node_id)} />)}</div>
}

function SignalCard({ proposal, preview, onChange, onSelect }) {
  const update = (key, value) => onChange({ [key]: value })
  return (
    <div className="ft-signal-card"><div className="ft-signal-head"><button type="button" onClick={onSelect}><span className="ft-branch-dot" />{proposal.name || '未命名节点'}</button><span className="ft-confidence">置信度 <ProgressBar value={Number(proposal.confidence || 0) * 100} tone={proposal.confidence < .5 ? 'warn' : 'accent'} /> <b className="ft-mono">{Math.round(Number(proposal.confidence || 0) * 100)}%</b></span></div>{proposal.confidence < .5 ? <div className="ft-signal-warning">模型对这条不太确定</div> : null}{SIGNALS.map(([key, label, low, high]) => <label className="ft-signal-slider" key={key}><span>{label}</span><input type="range" min="0" max="1" step=".05" value={Number(proposal[key] || 0)} onChange={event => update(key, Number(event.target.value))} /><small>{low} <i>{Number(proposal[key] || 0).toFixed(2)}</i> {high}</small></label>)}<div className="ft-relation-row"><span>关系类型</span><div className="ft-relation-options">{RELATIONS.map(([value, label]) => <button type="button" key={value} className={proposal.relation_type === value ? 'is-active' : ''} onClick={() => update('relation_type', value)}>{label}</button>)}</div></div>{proposal.reason ? <p className="ft-signal-reason">“{proposal.reason}”</p> : null}<div className="ft-preview-score"><span>当前优先级 <b className="ft-mono">{Math.round(proposal.currentPriority || 0)}</b></span><span>→</span><strong className="ft-mono">{Math.round(preview ?? proposal.currentPriority ?? 0)}</strong></div></div>
  )
}

function collectEntries(messages, treeData, userGoal) {
  const metaById = getDerivedWeightMetaMap(treeData, { userGoal })
  return messages.flatMap(message => {
    if (message?.role !== 'assistant' || !message.thinking) return []
    const entries = []
    if (!message.applied_draft_actions && Array.isArray(message.thinking.draft_actions) && message.thinking.draft_actions.length) entries.push({ id: `${message.id}-draft`, type: 'draft', message, actions: message.thinking.draft_actions, summary: `建议整理 ${message.thinking.draft_actions.length} 个节点`, sourceLabel: '来自结构草案' })
    if (!message.applied_priority_analysis && message.thinking.goal_analysis) entries.push({ id: `${message.id}-goal`, type: 'goal', message, goal: message.thinking.goal_analysis, summary: '建议更新当前阶段目标', sourceLabel: '来自目标拆解' })
    if (!message.applied_priority_analysis && Array.isArray(message.thinking.node_priority_proposals) && message.thinking.node_priority_proposals.length) entries.push({ id: `${message.id}-priority`, type: 'priority', message, proposals: message.thinking.node_priority_proposals.map(proposal => ({ ...proposal, currentPriority: getDerivedWeightMeta(metaById, proposal.node_id)?.directPriority ?? 0 })), goal: message.thinking.goal_analysis, summary: `需要确认 ${message.thinking.node_priority_proposals.length} 个节点的优先级信号`, sourceLabel: '来自 AI 语义分析' })
    return entries
  })
}

function applyProposalTree(treeData, proposals) {
  if (!treeData) return treeData
  const byId = new Map(proposals.map(proposal => [proposal.node_id, proposal]))
  const walk = node => {
    const proposal = byId.get(node.id)
    const next = { ...node, children: (node.children || []).map(walk) }
    if (!proposal) return next
    return {
      ...next,
      annotations: {
        ...(next.annotations || {}),
        priority_analysis: {
          confirmed: true,
          goal_alignment: proposal.goal_alignment,
          necessity: proposal.necessity,
          delay_cost: proposal.delay_cost,
          relation_type: proposal.relation_type,
          confidence: proposal.confidence,
          reason: proposal.reason,
        },
      },
    }
  }
  return walk(treeData)
}

function draftType(type) {
  if (type === 'add_project') return '项目'
  if (type === 'add_category') return '分类'
  if (type === 'annotate') return '标注'
  return '任务'
}
