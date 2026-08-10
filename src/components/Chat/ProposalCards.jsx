import { Check, ChevronDown, ChevronRight, GitBranch, Gauge, Target, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { previewPriorityMetaMap } from '../../lib/priorityProposals'
import { collectProposalEntries, getPendingProposalCount, previewGoal, stripDraftUiState } from '../../lib/chatProposals'
import { getDerivedWeightMeta } from '../../lib/treeUtils'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Chip from '../ui/Chip'
import ProgressBar from '../ui/ProgressBar'
import Slider from '../ui/Slider'
import Tooltip from '../ui/Tooltip'

const PROCESSED_STORAGE_KEY = 'ft_inbox_processed'
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const SIGNALS = [
  ['goal_alignment', '目标契合', '无关', '必需', ['无关', '较弱', '一般', '较强', '必需']],
  ['necessity', '必要性', '可选', '不可绕过', ['可选', '较低', '一般', '较高', '不可绕过']],
  ['delay_cost', '延误损失', '很小', '很大', ['很小', '较小', '一般', '较大', '很大']],
]
const RELATIONS = [['required', '必需'], ['enables', '支撑'], ['normal', '普通'], ['supporting', '辅助'], ['optional', '探索']]

export default function ProposalCards({
  messages = [],
  treeData,
  userGoal,
  onApplyDraftPlan,
  onApplyPriorityAnalysis,
  onSelectNode,
  onboardingAttention = false,
  onApplyAll,
  children,
}) {
  const entries = useMemo(() => collectProposalEntries(messages, treeData, userGoal), [messages, treeData, userGoal])
  const [expanded, setExpanded] = useState(() => new Set())
  const [processed, setProcessed] = useState(readProcessed)
  const [overrides, setOverrides] = useState({})
  const [preview, setPreview] = useState({})
  const [busy, setBusy] = useState(() => new Set())

  const activeEntries = useMemo(
    () => entries.filter(entry => !entry.applied && !processed[entry.id]),
    [entries, processed],
  )
  const pendingCount = useMemo(() => getPendingProposalCount(entries, processed), [entries, processed])

  useEffect(() => {
    try { localStorage.setItem(PROCESSED_STORAGE_KEY, JSON.stringify(processed)) } catch { /* optional browser storage */ }
  }, [processed])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = {}
      for (const entry of activeEntries) {
        if (entry.type !== 'priority') continue
        const proposals = overrides[entry.id] || entry.proposals
        const goal = previewGoal(userGoal, entry.goal, entry.id)
        const map = previewPriorityMetaMap(treeData, proposals, goal)
        next[entry.id] = proposals.map(proposal => ({
          id: proposal.node_id,
          value: getDerivedWeightMeta(map, proposal.node_id)?.directPriority ?? 0,
        }))
      }
      setPreview(next)
    }, 120)
    return () => window.clearTimeout(timer)
  }, [activeEntries, overrides, treeData, userGoal])

  function toggle(id) {
    setExpanded(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function markProcessed(entry, result) {
    setProcessed(current => ({
      ...current,
      [entry.id]: { processedAt: Date.now(), result, summary: entry.summary },
    }))
  }

  async function applyEntry(entry) {
    setBusy(current => new Set([...current, entry.id]))
    try {
      if (entry.type === 'draft') {
        await onApplyDraftPlan?.(entry.message.id, entry.actions.map(stripDraftUiState))
      } else {
        const result = await onApplyPriorityAnalysis?.(entry.message.id, {
          scope: entry.type === 'goal' ? 'goal' : 'priority',
          goal_analysis: entry.goal,
          node_priority_proposals: entry.type === 'priority' ? (overrides[entry.id] || entry.proposals) : [],
        })
        if (result?.status === 'missing') throw new Error('some proposals no longer match existing nodes')
      }
      markProcessed(entry, 'applied')
    } catch (error) {
      console.warn('[ProposalCards apply]', error)
      markProcessed(entry, 'failed')
    } finally {
      setBusy(current => {
        const next = new Set(current)
        next.delete(entry.id)
        return next
      })
    }
  }

  function rejectEntry(entry) {
    markProcessed(entry, 'rejected')
  }

  function renderForMessage(messageId) {
    return entries
      .filter(entry => entry.message.id === messageId)
      .map(entry => {
        const record = processed[entry.id]
        if (entry.applied || record) {
          return <ProcessedProposal key={entry.id} entry={entry} record={record} />
        }
        return (
          <ProposalEntry
            key={entry.id}
            entry={entry}
            open={expanded.has(entry.id)}
            busy={busy.has(entry.id)}
            onToggle={() => toggle(entry.id)}
            onApply={() => applyEntry(entry)}
            onReject={() => rejectEntry(entry)}
            onSelectNode={onSelectNode}
            proposals={overrides[entry.id] || entry.proposals}
            onOverride={value => setOverrides(current => ({ ...current, [entry.id]: value }))}
            preview={preview[entry.id] || []}
            attention={onboardingAttention}
          />
        )
      })
  }

  function scrollToPending() {
    const target = activeEntries[0]
    if (!target) return
    setExpanded(current => new Set([...current, target.id]))
    window.setTimeout(() => {
      const targetElement = Array.from(document.querySelectorAll('.ft-proposal')).find(element => element.dataset.proposalId === target.id)
      targetElement?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 0)
  }

  async function applyAll() {
    if (!activeEntries.length) return
    for (const entry of activeEntries) await applyEntry(entry)
    onApplyAll?.()
  }

  function rejectAll() {
    activeEntries.forEach(entry => rejectEntry(entry))
  }

  return children?.({ pendingCount, activeEntries, scrollToPending, applyAll, rejectAll, renderForMessage }) || null
}

function ProposalEntry({ entry, open, busy, onToggle, onApply, onReject, onSelectNode, proposals, onOverride, preview, attention }) {
  const Icon = entry.type === 'draft' ? GitBranch : entry.type === 'goal' ? Target : Gauge
  return (
    <article data-proposal-id={entry.id} className={`ft-proposal ${open ? 'is-open' : ''} ${attention ? 'is-onboarding-attention' : ''}`}>
      <button type="button" className="ft-proposal-summary" onClick={onToggle}>
        <span className="ft-proposal-marker"><Icon size={15} /></span>
        <span className="ft-proposal-copy"><strong>{entry.summary}</strong><small>{entry.sourceLabel}</small></span>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      {open ? (
        <div className="ft-proposal-body">
          {entry.type === 'draft' ? <DraftBody entry={entry} /> : entry.type === 'goal' ? <GoalBody goal={entry.goal} /> : <PriorityBody entry={entry} proposals={proposals} onOverride={onOverride} preview={preview} onSelectNode={onSelectNode} />}
          <div className="ft-proposal-actions">
            <Button size="sm" variant="quiet" icon={X} onClick={onReject} disabled={busy}>否决</Button>
            <Button size="sm" icon={Check} onClick={onApply} loading={busy}>采纳</Button>
          </div>
        </div>
      ) : null}
    </article>
  )
}

function ProcessedProposal({ entry, record }) {
  const result = record?.result || (entry.applied ? 'applied' : 'rejected')
  return (
    <div className="ft-processed-inline" title={record?.processedAt ? formatProcessedAt(record.processedAt) : '已处理'}>
      {result === 'applied' ? <Check size={13} /> : <X size={13} />}
      <span>{entry.summary}</span>
      <Badge tone={result === 'applied' ? 'accent' : result === 'rejected' ? 'neutral' : 'danger'}>{resultLabel(result)}</Badge>
    </div>
  )
}

function DraftBody({ entry }) {
  return (
    <div className="ft-draft-preview">
      {entry.actions.map((action, index) => (
        <div className={action.existing ? 'is-existing' : ''} key={`${action.name}-${index}`}>
          <span className="ft-draft-indent" />
          <strong>{action.name || '未命名节点'}</strong>
          <small>{draftType(action.type)} · {action.parent || '根节点'}</small>
          {action.existing ? <Badge>面板中已有</Badge> : null}
        </div>
      ))}
    </div>
  )
}

function GoalBody({ goal }) {
  return (
    <div className="ft-goal-diff">
      <div><span>提议结果</span><strong>{goal?.outcome || goal?.text || '未命名目标'}</strong></div>
      <div className="ft-diff-grid"><span>类型</span><strong>{goal?.kind === 'stage' ? '阶段目标' : '长期目标'}</strong><span>截止</span><strong>{goal?.deadline || '长期'}</strong><span>约束</span><strong>{goal?.constraints?.join(' · ') || '无'}</strong></div>
    </div>
  )
}

function PriorityBody({ entry, proposals, onOverride, preview, onSelectNode }) {
  return (
    <div className="ft-priority-proposals">
      {proposals.map((proposal, index) => (
        <SignalCard
          key={`${proposal.node_id}-${index}`}
          proposal={proposal}
          original={entry.proposals[index]}
          preview={preview.find(item => item.id === proposal.node_id)?.value}
          onChange={value => onOverride(proposals.map((current, itemIndex) => itemIndex === index ? { ...current, ...value } : current))}
          onSelect={() => onSelectNode?.(proposal.node_id)}
        />
      ))}
    </div>
  )
}

function SignalCard({ proposal, original, preview, onChange, onSelect }) {
  const update = (key, value) => onChange({ [key]: value })
  const current = Number(proposal.currentPriority || 0)
  const next = Number(preview ?? current)
  const delta = Math.round(next) - Math.round(current)
  return (
    <div className="ft-signal-card">
      <div className="ft-signal-head">
        <button type="button" onClick={onSelect}><span className="ft-branch-dot" />{proposal.name || '未命名节点'}</button>
        <Tooltip content={proposal.confidence < .5 ? '模型对这条不太确定' : '模型对这条提案的置信度'}>
          <span className="ft-confidence"><span>置信度</span><ProgressBar value={Number(proposal.confidence || 0) * 100} tone={proposal.confidence < .5 ? 'warn' : 'accent'} /><b className="ft-mono">{Math.round(Number(proposal.confidence || 0) * 100)}%</b></span>
        </Tooltip>
      </div>
      {proposal.confidence < .5 ? <div className="ft-signal-warning">模型对这条不太确定</div> : null}
      {SIGNALS.map(([key, label, low, high, ticks]) => {
        const value = Number(proposal[key] || 0)
        const modelValue = Number(original?.[key] || 0)
        const changed = Math.abs(value - modelValue) > 0.001
        return (
          <div className={`ft-signal-slider ${changed ? 'is-changed' : ''}`} key={key}>
            <Slider label={label} value={value} min={0} max={1} step={.05} valueText={value.toFixed(2)} showValue changed={changed} aria-label={label} onChange={nextValue => update(key, nextValue)} />
            <div className="ft-slider-range"><span>{low}</span><span className="ft-slider-ticks">{ticks.map(tick => <i key={tick}>{tick}</i>)}</span><span>{high}</span></div>
            {changed ? <span className="ft-model-value">模型 {modelValue.toFixed(2)}</span> : null}
          </div>
        )
      })}
      <div className="ft-relation-row"><span>关系类型</span><div className="ft-relation-options">{RELATIONS.map(([value, label]) => <Chip key={value} active={proposal.relation_type === value} onClick={() => update('relation_type', value)}>{label}</Chip>)}</div></div>
      {proposal.reason ? <p className="ft-signal-reason">“{proposal.reason}”</p> : null}
      <div className="ft-preview-score"><span>当前 <b className="ft-mono">{Math.round(current)}</b></span><span>→</span><strong className="ft-mono">应用后 {Math.round(next)}</strong><span className={`ft-preview-delta ${delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : ''}`}>{delta > 0 ? '↗' : delta < 0 ? '↘' : '→'} {delta > 0 ? '+' : ''}{delta}</span></div>
    </div>
  )
}

function readProcessed() {
  if (typeof window === 'undefined') return {}
  try {
    const raw = JSON.parse(localStorage.getItem(PROCESSED_STORAGE_KEY) || '{}')
    const cutoff = Date.now() - RETENTION_MS
    return Object.fromEntries(Object.entries(raw).filter(([, record]) => record?.processedAt > cutoff))
  } catch {
    return {}
  }
}

function resultLabel(result) {
  if (result === 'applied') return '已采纳'
  if (result === 'rejected') return '已否决'
  return '应用失败'
}

function formatProcessedAt(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function draftType(type) {
  if (type === 'add_project') return '项目'
  if (type === 'add_category') return '分类'
  if (type === 'annotate') return '标注'
  return '任务'
}
