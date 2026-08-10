import { getDerivedWeightMeta, getDerivedWeightMetaMap, flattenTree } from './treeUtils.js'

export function collectProposalEntries(messages = [], treeData, userGoal) {
  const metaById = getDerivedWeightMetaMap(treeData, { userGoal })
  return messages.flatMap(message => {
    if (message?.role !== 'assistant' || !message.thinking) return []
    const entries = []
    const draftActions = decorateDraftActions([
      ...(Array.isArray(message.thinking.draft_actions) ? message.thinking.draft_actions : []),
      ...(Array.isArray(message.thinking.proposed_panel_changes) ? message.thinking.proposed_panel_changes : []),
    ], treeData)
    if (draftActions.length) {
      entries.push({ id: `${message.id}-draft`, type: 'draft', message, actions: draftActions, summary: `建议整理 ${draftActions.length} 个节点`, sourceLabel: '结构草案', applied: Boolean(message.applied_draft_actions) })
    }
    if (message.thinking.goal_analysis) {
      entries.push({ id: `${message.id}-goal`, type: 'goal', message, goal: message.thinking.goal_analysis, summary: '建议更新当前阶段目标', sourceLabel: '目标变更', applied: Boolean(message.applied_goal_analysis) })
    }
    if (Array.isArray(message.thinking.node_priority_proposals) && message.thinking.node_priority_proposals.length) {
      const proposals = message.thinking.node_priority_proposals.map(proposal => ({
        ...proposal,
        currentPriority: getDerivedWeightMeta(metaById, proposal.node_id)?.directPriority ?? 0,
      }))
      entries.push({ id: `${message.id}-priority`, type: 'priority', message, proposals, goal: message.thinking.goal_analysis, summary: `需要确认 ${proposals.length} 个节点的优先级信号`, sourceLabel: '优先级信号', applied: Boolean(message.applied_priority_analysis) })
    }
    return entries
  })
}

export function getPendingProposalCount(entries = [], processed = {}) {
  return entries.reduce((count, entry) => count + (entry.applied || processed[entry.id] ? 0 : 1), 0)
}

export function isGoalAnalysisPending(message) {
  if (!message?.thinking?.goal_analysis) return false
  if (message.applied_goal_analysis) return false
  return 'applied_goal_analysis' in message || !message.applied_priority_analysis
}

export function stripDraftUiState(action) {
  const clean = { ...action }
  delete clean.existing
  return clean
}

export function previewGoal(currentGoal, goalAnalysis, entryId) {
  if (!goalAnalysis) return currentGoal
  const text = goalAnalysis.text || goalAnalysis.outcome || currentGoal?.text || ''
  return { ...currentGoal, ...goalAnalysis, text, outcome: goalAnalysis.outcome || text, version: `preview-${entryId}` }
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

function draftNodeType(type) {
  if (type === 'add_project') return 'project'
  if (type === 'add_category') return 'category'
  if (type === 'add_task') return 'task'
  return null
}
