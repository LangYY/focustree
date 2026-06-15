const PRIORITY_VERSION = 'priority-v2'

const RELATION_PROPAGATION = {
  required: 1,
  enables: 1,
  normal: 1,
  supporting: 0.75,
  optional: 0.55,
}

const MANUAL_PRIORITY_SCORE = {
  low: 20,
  normal: 50,
  high: 78,
  urgent: 95,
}

const GOAL_KEYWORD_GROUPS = [
  ['现金', '收入', '赚钱', '变现', '回款', '外包', '客户', '商业', '报价'],
  ['内容', 'b站', '哔哩', '视频', '频道', 'youtube', '小红书', '短剧', '脚本'],
  ['求职', '简历', '面试', '作品集', '投递', '工作', '岗位'],
  ['健康', '医院', '治疗', '体检', '运动', '睡眠'],
  ['学习', '课程', '读书', '训练', '练习', '技能'],
]

function clamp(value, min = 0, max = 100) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return min
  return Math.max(min, Math.min(max, numeric))
}

function roundScore(value) {
  return Math.round(clamp(value) * 10) / 10
}

function compactText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '')
}

function dateOnly(value) {
  if (!value) return null
  const text = String(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

export function getGoalVersion(goal) {
  if (!goal) return null
  return String(goal.version || goal.id || goal.set_at || goal.text || '') || null
}

export function nodePriorityFingerprint(node) {
  const analysisSource = {
    id: node?.id || null,
    parent_id: node?.parent_id || null,
    name: node?.name || '',
    type: node?.type || '',
    status: node?.status || 'active',
    current_priority: node?.current_priority || null,
    target_completion_date: dateOnly(node?.target_completion_date),
    details: node?.annotations?.ai_notes || '',
  }
  const text = JSON.stringify(analysisSource)
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`
}

function goalText(goal) {
  if (!goal) return ''
  if (typeof goal === 'string') return goal
  return [
    goal.text,
    goal.outcome,
    ...(Array.isArray(goal.constraints) ? goal.constraints : []),
  ].filter(Boolean).join(' ')
}

function nodeText(node) {
  const annotation = node?.annotations || {}
  return [
    node?.name,
    annotation.ai_notes,
    annotation.strategic_tag,
    ...(annotation.roi_type ? Object.keys(annotation.roi_type) : []),
  ].filter(Boolean).join(' ')
}

function localGoalAlignment(node, goal) {
  const goalValue = compactText(goalText(goal))
  const nodeValue = compactText(nodeText(node))
  if (!goalValue || !nodeValue) return { score: 45, confidence: 0.25, source: 'neutral' }

  let score = 24
  let matched = false
  for (const group of GOAL_KEYWORD_GROUPS) {
    const goalMatches = group.some(word => goalValue.includes(compactText(word)))
    const nodeMatches = group.some(word => nodeValue.includes(compactText(word)))
    if (goalMatches && nodeMatches) {
      score += 58
      matched = true
    }
  }

  const tokens = (goalValue.match(/[a-z0-9]{2,}|[\u4e00-\u9fff]{2,4}/g) || [])
  const uniqueTokens = [...new Set(tokens)]
  const hits = uniqueTokens.filter(token => nodeValue.includes(token)).length
  score += Math.min(18, hits * 6)

  const excludes = typeof goal === 'object' && Array.isArray(goal.exclude) ? goal.exclude : []
  if (excludes.some(item => nodeValue.includes(compactText(item)))) score -= 45

  return {
    score: clamp(score),
    confidence: matched || hits ? 0.55 : 0.32,
    source: 'local_goal_match',
  }
}

function deadlineSignal(node, now) {
  const target = dateOnly(node?.target_completion_date)
  if (!target || node?.status === 'done') return null
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const due = new Date(`${target}T00:00:00`)
  const days = Math.round((due.getTime() - today.getTime()) / 86400000)
  if (days < 0) return { score: 100, confidence: 1, days }
  if (days === 0) return { score: 96, confidence: 1, days }
  if (days <= 3) return { score: 88, confidence: 1, days }
  if (days <= 7) return { score: 76, confidence: 1, days }
  if (days <= 30) return { score: 58, confidence: 0.9, days }
  return { score: 38, confidence: 0.75, days }
}

function readConfirmedAnalysis(node, goal) {
  const analysis = node?.annotations?.priority_analysis
  if (!analysis || analysis.confirmed !== true) return null
  const staleReasons = []
  const currentGoalVersion = getGoalVersion(goal)
  const analysisGoalVersion = analysis.goal_version || null
  if ((currentGoalVersion || analysisGoalVersion) && analysisGoalVersion !== currentGoalVersion) staleReasons.push('goal_changed')
  if (analysis.node_fingerprint !== nodePriorityFingerprint(node)) staleReasons.push('node_changed')
  return { analysis, staleReasons, fresh: staleReasons.length === 0 }
}

function weightedAverage(signals) {
  const usable = signals.filter(signal => Number.isFinite(signal.score) && signal.weight > 0)
  const totalWeight = usable.reduce((sum, signal) => sum + signal.weight, 0)
  if (!totalWeight) return 0
  return usable.reduce((sum, signal) => sum + signal.score * signal.weight, 0) / totalWeight
}

function calculateDirectPriority(node, goal, now) {
  if (node?.type === 'root') {
    return {
      directPriority: 0,
      confidence: 1,
      signalBreakdown: [],
      staleReasons: [],
      relationType: 'normal',
    }
  }

  const stored = readConfirmedAnalysis(node, goal)
  const analysis = stored?.fresh ? stored.analysis : null
  const fallbackGoal = localGoalAlignment(node, goal)
  const due = deadlineSignal(node, now)
  const signals = [
    { key: 'baseline', score: 40, weight: 0.15, confidence: 0.35, source: 'baseline' },
  ]

  if (MANUAL_PRIORITY_SCORE[node?.current_priority] != null) {
    signals.push({
      key: 'manual_priority',
      score: MANUAL_PRIORITY_SCORE[node.current_priority],
      weight: 0.5,
      confidence: 1,
      source: 'user',
    })
  }

  signals.push({
    key: 'goal_alignment',
    score: analysis ? clamp(analysis.goal_alignment * 100) : fallbackGoal.score,
    weight: 0.32,
    confidence: analysis ? clamp(analysis.confidence ?? 0.5, 0, 1) : fallbackGoal.confidence,
    source: analysis ? 'confirmed_ai' : fallbackGoal.source,
  })

  if (analysis) {
    signals.push({
      key: 'necessity',
      score: clamp(analysis.necessity * 100),
      weight: 0.22,
      confidence: clamp(analysis.confidence ?? 0.5, 0, 1),
      source: 'confirmed_ai',
    })
    signals.push({
      key: 'delay_cost',
      score: clamp(analysis.delay_cost * 100),
      weight: 0.18,
      confidence: clamp(analysis.confidence ?? 0.5, 0, 1),
      source: 'confirmed_ai',
    })
  }

  if (due) {
    signals.push({
      key: 'deadline_pressure',
      score: due.score,
      weight: 0.2,
      confidence: due.confidence,
      source: 'deadline',
      days: due.days,
    })
  }

  const rawDirectPriority = weightedAverage(signals)
  let directPriority = rawDirectPriority
  if (node?.status === 'done') directPriority = 0
  if (node?.status === 'dormant') directPriority = Math.min(25, directPriority * 0.28)

  const confidenceWeight = signals.reduce((sum, signal) => sum + signal.weight, 0)
  const confidence = confidenceWeight
    ? signals.reduce((sum, signal) => sum + signal.confidence * signal.weight, 0) / confidenceWeight
    : 0

  return {
    directPriority: roundScore(directPriority),
    confidence: Math.round(clamp(confidence, 0, 1) * 100) / 100,
    signalBreakdown: signals.map(signal => ({
      ...signal,
      score: roundScore(signal.score),
      contribution: confidenceWeight
        ? roundScore((signal.score * signal.weight) / confidenceWeight)
        : 0,
    })).concat(directPriority !== rawDirectPriority ? [{
      key: 'status_gate',
      score: roundScore(directPriority),
      weight: 1,
      confidence: 1,
      source: 'status',
      contribution: roundScore(directPriority - rawDirectPriority),
    }] : []),
    staleReasons: stored?.staleReasons || (node?.annotations?.priority_analysis ? ['unconfirmed_analysis'] : ['missing_analysis']),
    relationType: analysis?.relation_type || 'normal',
    analysisReason: analysis?.reason || null,
    analysisConfidence: analysis ? clamp(analysis.confidence ?? 0.5, 0, 1) : null,
  }
}

function recencyScore(node, now) {
  const raw = node?.last_active_at || node?.updated_at || node?.created_at
  if (!raw) return 20
  const time = new Date(raw).getTime()
  if (!Number.isFinite(time)) return 20
  const days = Math.max(0, (now.getTime() - time) / 86400000)
  if (days <= 1) return 100
  if (days <= 7) return 78
  if (days <= 30) return 52
  if (days <= 90) return 30
  return 15
}

function ownCultivationEvidence(node) {
  if (!node || node.type === 'root') return 0
  let points = 18
  if (String(node.name || '').trim().length >= 6) points += 10
  if (String(node.annotations?.ai_notes || '').trim().length >= 20) points += 28
  if (node.current_priority) points += 12
  if (node.target_completion_date) points += 12
  if (node.annotations?.strategic_tag) points += 8
  if (node.annotations?.energy_cost) points += 6
  if (node.annotations?.roi_type && Object.keys(node.annotations.roi_type).length) points += 6
  return clamp(points)
}

function setMeta(map, id, meta) {
  if (id == null) return
  map.set(id, meta)
  map.set(String(id), meta)
}

export function computePriorityMetaMap(tree, options = {}) {
  const metaById = new Map()
  if (!tree) return metaById
  const goal = options.goal ?? options.userGoal ?? null
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now())
  const metaByNode = new WeakMap()

  function analyzeBottomUp(node, depth = 0) {
    const children = Array.isArray(node?.children) ? node.children : []
    const childMetas = children.map(child => analyzeBottomUp(child, depth + 1))
    const direct = calculateDirectPriority(node, goal, now)
    const childCritical = childMetas.reduce((max, childMeta) => {
      const factor = RELATION_PROPAGATION[childMeta.relationType] ?? RELATION_PROPAGATION.normal
      return Math.max(max, childMeta.upwardCritical * factor)
    }, 0)
    const upwardCritical = roundScore(Math.max(direct.directPriority, childCritical))
    const descendantCount = childMetas.reduce((sum, child) => sum + child.descendantCount + 1, 0)
    const completedCount = (node?.status === 'done' ? 1 : 0) + childMetas.reduce((sum, child) => sum + child.completedCount, 0)
    const maxDepth = childMetas.reduce((max, child) => Math.max(max, child.maxDepth + 1), 0)
    const ownEvidence = ownCultivationEvidence(node)
    const structure = clamp(Math.log2(descendantCount + 1) * 24 + Math.min(24, maxDepth * 8))
    const completion = clamp(Math.log2(completedCount + 1) * 24)
    const cultivationScore = roundScore(
      ownEvidence * 0.42 +
      structure * 0.32 +
      completion * 0.14 +
      recencyScore(node, now) * 0.12
    )
    const meta = {
      ...direct,
      depth,
      upwardCritical,
      branchPriority: upwardCritical,
      cultivationScore,
      descendantCount,
      completedCount,
      maxDepth,
      inheritedBase: 0,
      algorithmVersion: PRIORITY_VERSION,
    }
    metaByNode.set(node, meta)
    return meta
  }

  function assignBranches(node, inheritedBase = 0) {
    const meta = metaByNode.get(node)
    if (!meta) return
    meta.inheritedBase = roundScore(inheritedBase)
    meta.branchPriority = roundScore(Math.max(meta.upwardCritical, inheritedBase))
    setMeta(metaById, node?.id, { ...meta })

    const downwardFromNode = node?.type === 'root'
      ? inheritedBase
      : Math.max(inheritedBase, meta.directPriority * 0.82)
    for (const child of (node?.children || [])) assignBranches(child, downwardFromNode)
  }

  analyzeBottomUp(tree)
  assignBranches(tree)
  return metaById
}

export function getPriorityMeta(metaById, nodeOrId) {
  if (!metaById || nodeOrId == null) return null
  const id = typeof nodeOrId === 'object' ? nodeOrId.id : nodeOrId
  return metaById.get(id) ?? metaById.get(String(id)) ?? null
}

export function compareGoalScenarios(tree, goals, options = {}) {
  return (goals || []).map(goal => ({
    goal,
    metaById: computePriorityMetaMap(tree, { ...options, goal }),
  }))
}

export const PRIORITY_ENGINE_VERSION = PRIORITY_VERSION
export const PRIORITY_RELATION_TYPES = Object.freeze(Object.keys(RELATION_PROPAGATION))
