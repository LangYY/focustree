import {
  computePriorityMetaMap,
  getGoalVersion,
  nodePriorityFingerprint,
  PRIORITY_RELATION_TYPES,
} from './priorityEngine.js'

function clampUnit(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(1, numeric))
}

export function normalizePriorityProposal(proposal = {}) {
  return {
    ...proposal,
    node_id: proposal.node_id || proposal.id || null,
    goal_alignment: clampUnit(proposal.goal_alignment),
    necessity: clampUnit(proposal.necessity),
    delay_cost: clampUnit(proposal.delay_cost),
    relation_type: PRIORITY_RELATION_TYPES.includes(proposal.relation_type) ? proposal.relation_type : 'normal',
    confidence: clampUnit(proposal.confidence ?? 0.5),
    reason: String(proposal.reason || '').trim() || null,
  }
}

export function buildPriorityAnalysis(node, proposal, goal, now = new Date()) {
  const normalized = normalizePriorityProposal(proposal)
  return {
    goal_alignment: normalized.goal_alignment,
    necessity: normalized.necessity,
    delay_cost: normalized.delay_cost,
    relation_type: normalized.relation_type,
    confidence: normalized.confidence,
    reason: normalized.reason,
    goal_version: getGoalVersion(goal),
    node_fingerprint: nodePriorityFingerprint(node),
    confirmed: true,
    confirmed_at: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
    algorithm_version: 'priority-v2',
  }
}

export function applyPriorityProposalsToTree(tree, proposals, goal, options = {}) {
  if (!tree) return tree
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now())
  const byId = new Map((proposals || []).map(proposal => {
    const normalized = normalizePriorityProposal(proposal)
    return [String(normalized.node_id), normalized]
  }))

  const walk = node => {
    const proposal = byId.get(String(node.id))
    const next = { ...node, children: (node.children || []).map(walk) }
    if (!proposal || node.type === 'root') return next
    return {
      ...next,
      annotations: {
        ...(next.annotations || {}),
        priority_analysis: buildPriorityAnalysis(node, proposal, goal, now),
      },
    }
  }

  return walk(tree)
}

export function previewPriorityMetaMap(tree, proposals, goal, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now())
  return computePriorityMetaMap(applyPriorityProposalsToTree(tree, proposals, goal, { now }), { goal, now })
}
