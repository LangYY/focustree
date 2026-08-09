import { Check, ChevronDown, ChevronRight, GitBranch, Gauge, Target, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { previewPriorityMetaMap } from '../../lib/priorityProposals'
import { flattenTree, getDerivedWeightMeta, getDerivedWeightMetaMap } from '../../lib/treeUtils'
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

export default function InboxTab({
  messages = [],
  treeData,
  userGoal,
  onApplyDraftPlan,
  onApplyPriorityAnalysis,
  onSelectNode,
  focusId,
  onFocusHandled,
}) {
  const entries = useMemo(() => collectEntries(messages, treeData, userGoal), [messages, treeData, userGoal])
  const [expanded, setExpanded] = useState(() => new Set())
  const [processed, setProcessed] = useState(readProcessed)
  const [overrides, setOverrides] = useState({})
  const [preview, setPreview] = useState({})
  const [showProcessed, setShowProcessed] = useState(false)
  const [busy, setBusy] = useState(() => new Set())
  const [highlighted, setHighlighted] = useState(null)
  const entryRefs = useRef(new Map())

  const activeEntries = useMemo(
    () => entries.filter(entry => !processed[entry.id]),
    [entries, processed],
  )
  const processedRecords = useMemo(
    () => Object.entries(processed).sort(([, a], [, b]) => b.processedAt - a.processedAt),
    [processed],
  )

  useEffect(() => {
    try { localStorage.setItem(PROCESSED_STORAGE_KEY, JSON.stringify(processed)) } catch { /* storage is optional */ }
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

  useEffect(() => {
    if (!focusId) return undefined
    const target = entries.find(entry => entry.message.id === focusId && !processed[entry.id])
    if (!target) {
      onFocusHandled?.()
      return undefined
    }
    setExpanded(current => new Set([...current, target.id]))
    setHighlighted(target.id)
    const timer = window.setTimeout(() => {
      entryRefs.current.get(target.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      onFocusHandled?.()
    }, 40)
    const clear = window.setTimeout(() => setHighlighted(null), 2200)
    return () => { window.clearTimeout(timer); window.clearTimeout(clear) }
  }, [entries, focusId, onFocusHandled, processed])

  const toggle = id => setExpanded(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const markProcessed = (entry, result) => setProcessed(current => ({
    ...current,
    [entry.id]: { processedAt: Date.now(), result, summary: entry.summary },
  }))

  const applyEntry = async entry => {
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
      console.warn('[InboxTab apply]', error)
      markProcessed(entry, 'failed')
    } finally {
      setBusy(current => {
        const next = new Set(current)
        next.delete(entry.id)
        return next
      })
    }
  }

  const rejectEntry = entry => markProcessed(entry, 'rejected')

  return (
    <div className="ft-inbox-tab">
      <div className="ft-drawer-intro">
        <div><span className="ft-eyebrow">INBOX / CONFIRMATION</span><h1>待确认</h1><p>重要的改变在这里等你点头，不会被聊天滚走。</p></div>
        <Badge tone={activeEntries.length ? 'accent' : 'neutral'} className="ft-inbox-count ft-mono">{activeEntries.length}</Badge>
      </div>

      {activeEntries.length ? (
        <div className="ft-inbox-list">
          {activeEntries.map(entry => (
            <ProposalEntry
              key={entry.id}
              entry={entry}
              open={expanded.has(entry.id)}
              highlighted={highlighted === entry.id}
              busy={busy.has(entry.id)}
              onRef={node => node && entryRefs.current.set(entry.id, node)}
              onToggle={() => toggle(entry.id)}
              onApply={() => applyEntry(entry)}
              onReject={() => rejectEntry(entry)}
              onSelectNode={onSelectNode}
              proposals={overrides[entry.id] || entry.proposals}
              onOverride={value => setOverrides(current => ({ ...current, [entry.id]: value }))}
              preview={preview[entry.id] || []}
            />
          ))}
        </div>
      ) : (
        <div className="ft-inbox-empty"><Target size={30} /><h2>没有待确认的提案</h2><p>和 AI 聊聊你在忙什么，它会把建议放到这里。</p></div>
      )}

      {processedRecords.length ? (
        <div className="ft-processed">
          <button type="button" onClick={() => setShowProcessed(value => !value)}>
            <span>已处理 · {processedRecords.length}</span>{showProcessed ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {showProcessed ? processedRecords.map(([id, record]) => (
            <div className="ft-processed-row" key={id}>
              {record.result === 'applied' ? <Check size={13} /> : <X size={13} />}
              <span className="ft-processed-summary">{record.summary}</span>
              <Badge tone={record.result === 'applied' ? 'accent' : record.result === 'rejected' ? 'neutral' : 'danger'}>{resultLabel(record.result)}</Badge>
              <time>{formatProcessedAt(record.processedAt)}</time>
            </div>
          )) : null}
        </div>
      ) : null}

      {activeEntries.length ? (
        <div className="ft-inbox-batch">
          <span className="ft-mono">{activeEntries.length} 条待处理</span>
          <Button size="sm" onClick={async () => { for (const entry of activeEntries) await applyEntry(entry) }}>全部采纳</Button>
          <Button size="sm" variant="quiet" onClick={() => activeEntries.forEach(entry => rejectEntry(entry))}>全部否决</Button>
        </div>
      ) : null}
    </div>
  )
}

function ProposalEntry({ entry, open, highlighted, busy, onRef, onToggle, onApply, onReject, onSelectNode, proposals, onOverride, preview }) {
  const Icon = entry.type === 'draft' ? GitBranch : entry.type === 'goal' ? Target : Gauge
  return (
    <article ref={onRef} className={`ft-proposal ${open ? 'is-open' : ''} ${highlighted ? 'is-highlighted' : ''}`}>
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
  return <div className="ft-goal-diff"><div><span>提议结果</span><strong>{goal?.outcome || goal?.text || '未命名目标'}</strong></div><div className="ft-diff-grid"><span>类型</span><strong>{goal?.kind === 'stage' ? '阶段目标' : '长期目标'}</strong><span>截止</span><strong>{goal?.deadline || '长期'}</strong><span>约束</span><strong>{goal?.constraints?.join(' · ') || '无'}</strong></div></div>
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
            <Slider
              label={label}
              value={value}
              min={0}
              max={1}
              step={.05}
              valueText={value.toFixed(2)}
              showValue
              changed={changed}
              aria-label={label}
              onChange={nextValue => update(key, nextValue)}
            />
            <div className="ft-slider-range"><span>{low}</span><span className="ft-slider-ticks">{ticks.map(tick => <i key={tick}>{tick}</i>)}</span><span>{high}</span></div>
            {changed ? <span className="ft-model-value">模型 {modelValue.toFixed(2)}</span> : null}
          </div>
        )
      })}
      <div className="ft-relation-row"><span>关系类型</span><div className="ft-relation-options">{RELATIONS.map(([value, label]) => <Chip key={value} active={proposal.relation_type === value} onClick={() => update('relation_type', value)}>{label}</Chip>)}</div></div>
      {proposal.reason ? <p className="ft-signal-reason">“{proposal.reason}”</p> : null}
      <div className="ft-preview-score">
        <span>当前 <b className="ft-mono">{Math.round(current)}</b></span><span>→</span><strong className="ft-mono">应用后 {Math.round(next)}</strong><span className={`ft-preview-delta ${delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : ''}`}>{delta > 0 ? '↗' : delta < 0 ? '↘' : '→'} {delta > 0 ? '+' : ''}{delta}</span>
      </div>
    </div>
  )
}

function collectEntries(messages, treeData, userGoal) {
  const metaById = getDerivedWeightMetaMap(treeData, { userGoal })
  return messages.flatMap(message => {
    if (message?.role !== 'assistant' || !message.thinking) return []
    const entries = []
    const draftActions = decorateDraftActions([
      ...(Array.isArray(message.thinking.draft_actions) ? message.thinking.draft_actions : []),
      ...(Array.isArray(message.thinking.proposed_panel_changes) ? message.thinking.proposed_panel_changes : []),
    ], treeData)
    if (!message.applied_draft_actions && draftActions.length) entries.push({ id: `${message.id}-draft`, type: 'draft', message, actions: draftActions, summary: `建议整理 ${draftActions.length} 个节点`, sourceLabel: '来自结构草案' })
    if (isGoalAnalysisPending(message) && message.thinking.goal_analysis) entries.push({ id: `${message.id}-goal`, type: 'goal', message, goal: message.thinking.goal_analysis, summary: '建议更新当前阶段目标', sourceLabel: '来自目标拆解' })
    if (!message.applied_priority_analysis && Array.isArray(message.thinking.node_priority_proposals) && message.thinking.node_priority_proposals.length) {
      const proposals = message.thinking.node_priority_proposals.map(proposal => ({ ...proposal, currentPriority: getDerivedWeightMeta(metaById, proposal.node_id)?.directPriority ?? 0 }))
      entries.push({ id: `${message.id}-priority`, type: 'priority', message, proposals, goal: message.thinking.goal_analysis, summary: `需要确认 ${proposals.length} 个节点的优先级信号`, sourceLabel: '来自 AI 语义分析' })
    }
    return entries
  })
}

function isGoalAnalysisPending(message) {
  if (!message?.thinking?.goal_analysis) return false
  if (message.applied_goal_analysis) return false
  return 'applied_goal_analysis' in message || !message.applied_priority_analysis
}

function decorateDraftActions(actions, treeData) {
  const nodes = treeData ? flattenTree(treeData).filter(node => node.type !== 'root') : []
  const byId = new Map(nodes.map(node => [String(node.id), node]))
  const byName = new Map(nodes.filter(node => node.name).map(node => [node.name, node]))
  const seen = new Set()
  return normalizeDraftActions(actions).filter(action => action.name).map(action => {
    const parentId = action.parent && (byId.has(String(action.parent)) ? String(action.parent) : byName.get(action.parent)?.id || null)
    const existing = action.type === 'annotate'
      ? byId.get(String(action.id || action.node_id))
      : nodes.find(node => node.name === action.name && node.type === draftNodeType(action.type) && (action.type === 'add_project' ? !node.parent_id : String(node.parent_id || '') === String(parentId || '')))
    const key = `${action.type}|${action.name}|${parentId || action.parent || ''}`
    if (seen.has(key)) return null
    seen.add(key)
    return { ...action, parent: parentId || action.parent || null, existing: Boolean(existing) }
  }).filter(Boolean)
}

function normalizeDraftActions(actions) {
  return actions.flatMap(action => {
    if (typeof action !== 'string') return [normalizeDraftAction(action)]
    const segments = action.split(/\s*(?:>|›|→)\s*/).map(segment => cleanPanelSegment(segment)).filter(Boolean)
    if (segments.length < 2) return [normalizeDraftAction(segments[0] || action)]
    return segments.map((name, index) => ({
      type: index === 0 ? 'add_project' : index === segments.length - 1 ? 'add_task' : 'add_category',
      name,
      parent: index ? segments[index - 1] : null,
    }))
  })
}

function normalizeDraftAction(action) {
  if (typeof action === 'string') return { type: 'add_task', name: action, parent: null }
  const type = ['add_project', 'add_category', 'add_task', 'annotate'].includes(action?.type) ? action.type : 'add_task'
  return { ...action, type, name: action?.name || action?.title || action?.label || action?.node_name || '', parent: action?.parent || action?.parent_id || action?.parentId || null }
}

function cleanPanelSegment(segment) {
  const text = String(segment || '').replace(/^已落地\s*[:：]\s*/, '').trim()
  const quoted = text.match(/[「“"](.+?)[」”"]/)
  return (quoted?.[1] || text.replace(/^(?:项目|分类|任务|子任务)\s*[:：]?\s*/, '')).trim()
}

function stripDraftUiState(action) {
  const clean = { ...action }
  delete clean.existing
  return clean
}

function draftNodeType(type) {
  if (type === 'add_project') return 'project'
  if (type === 'add_category') return 'category'
  if (type === 'add_task') return 'task'
  return null
}

function draftType(type) {
  if (type === 'add_project') return '项目'
  if (type === 'add_category') return '分类'
  if (type === 'annotate') return '标注'
  return '任务'
}

function previewGoal(currentGoal, goalAnalysis, entryId) {
  if (!goalAnalysis) return currentGoal
  const text = goalAnalysis.text || goalAnalysis.outcome || currentGoal?.text || ''
  return { ...currentGoal, ...goalAnalysis, text, outcome: goalAnalysis.outcome || text, version: `preview-${entryId}` }
}

function readProcessed() {
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
