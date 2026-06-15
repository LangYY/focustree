import { computePriorityMetaMap, getPriorityMeta } from './priorityEngine.js'

/**
 * 把 Supabase 返回的 flat nodes 数组转成 D3 需要的树结构
 */
export function flatToTree(nodes) {
  if (!nodes || nodes.length === 0) return null

  const map = {}
  nodes.forEach(n => { map[n.id] = { ...n, children: [] } })

  const roots = []
  const orphans = []
  nodes.forEach(n => {
    if (!n.parent_id) {
      roots.push(map[n.id])
    } else if (map[n.parent_id]) {
      map[n.parent_id].children.push(map[n.id])
    } else {
      // ⚠️ parent_id 指向不存在的节点（理论上 FK 约束应该禁止，但兜底防御）
      // 把孤儿挂到 root 而不是静默丢弃——以前的 bug：丢弃会让用户感觉节点消失
      orphans.push(map[n.id])
    }
  })

  if (orphans.length) {
    console.warn(`[flatToTree] 发现 ${orphans.length} 个孤儿节点，已挂到根级显示：`,
      orphans.map(o => `${o.name}(${o.id}) → parent_id=${o.parent_id}`))
    roots.push(...orphans)
  }

  // 按 position 排序
  function sortChildren(node) {
    node.children.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    node.children.forEach(sortChildren)
    return node
  }
  roots.forEach(sortChildren)

  return {
    id: 'root',
    type: 'root',
    children: roots,
  }
}

// 未登录时的演示数据（保持简洁，只做示意）
export const SAMPLE_DATA = {
  id: 'root',
  type: 'root',
  children: [
    {
      id: 'p1', type: 'project', name: '我的第一个项目',
      color: '#4A8C5C', weight: 1.0, status: 'active',
      expanded: true,
      children: [
        { id: 't1', type: 'task', name: '点击右键可以添加子任务', status: 'active', weight: 0.8 },
        { id: 't2', type: 'task', name: '告诉 AI「我完成了 XX」它会帮你更新', status: 'active', weight: 0.6 },
      ]
    },
  ]
}

/**
 * 收集某节点及其所有后代，返回扁平数组（去掉 children 字段）
 * 用于删除前备份，以便撤销时重新插入
 */
export function collectSubtree(tree, nodeId) {
  const node = findNodeById(tree, nodeId)
  if (!node) return []
  const result = []
  function walk(n) {
    const raw = { ...n }
    delete raw.children
    result.push(raw)
    n.children?.forEach(walk)
  }
  walk(node)
  return result
}

/**
 * 把节点列表按深度降序排序（最深的子节点先）
 * 用于删除时：先删叶子，再删父节点，避免 FK 约束报错
 */
export function sortByDepthDesc(nodes) {
  const parentOf = {}
  nodes.forEach(n => { parentOf[n.id] = n.parent_id })

  const cache = {}
  function depth(id) {
    if (cache[id] !== undefined) return cache[id]
    const pid = parentOf[id]
    cache[id] = pid && parentOf[pid] !== undefined ? 1 + depth(pid) : 0
    return cache[id]
  }

  return [...nodes].sort((a, b) => depth(b.id) - depth(a.id))
}

/**
 * 把节点列表按"父先于子"排序（插入时用）
 */
export function sortByParentFirst(nodes) {
  const sorted = []
  const remaining = [...nodes]
  const inserted = new Set()

  // root 节点（无 parent_id）先进
  let pass = 0
  while (remaining.length > 0 && pass < nodes.length + 1) {
    pass++
    for (let i = remaining.length - 1; i >= 0; i--) {
      const n = remaining[i]
      if (!n.parent_id || inserted.has(n.parent_id)) {
        sorted.push(n)
        inserted.add(n.id)
        remaining.splice(i, 1)
      }
    }
  }
  return [...sorted, ...remaining] // 保险：剩余的附在末尾
}

export function getNodeRadius(type) {
  if (type === 'project') return 18
  if (type === 'category') return 11
  return 6
}

export const PRIORITY_OPTIONS = [
  { value: null, label: '未设定' },
  { value: 'low', label: '低' },
  { value: 'normal', label: '普通' },
  { value: 'high', label: '高' },
  { value: 'urgent', label: '紧急' },
]

export const PRIORITY_LABELS = {
  low: '低',
  normal: '普通',
  high: '高',
  urgent: '紧急',
}

export function normalizeCurrentPriority(value) {
  if (value === null || value === undefined || value === '') return null
  const normalized = String(value).trim()
  return PRIORITY_LABELS[normalized] ? normalized : null
}

export function normalizeTargetCompletionDate(value) {
  if (value === null || value === undefined || value === '') return null
  const text = String(value).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  return Number.isNaN(new Date(`${text}T00:00:00`).getTime()) ? null : text
}

export function getNodeDueState(node, now = new Date()) {
  if (!node || node.status === 'done') return null
  const targetDate = normalizeTargetCompletionDate(node.target_completion_date)
  if (!targetDate) return null

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const due = new Date(`${targetDate}T00:00:00`)
  const days = Math.round((due.getTime() - today.getTime()) / 86400000)

  if (days < 0) return { state: 'overdue', days, label: `逾期 ${Math.abs(days)} 天` }
  if (days === 0) return { state: 'today', days, label: '今天到期' }
  if (days <= 3) return { state: 'three_days', days, label: `${days} 天内` }
  if (days <= 7) return { state: 'week', days, label: `${days} 天内` }
  return { state: 'later', days, label: targetDate }
}

export function isUrgentPriority(value) {
  return normalizeCurrentPriority(value) === 'urgent'
}

export function getNodeColor(node) {
  if (node.status === 'done') return '#22c55e'
  if (node.status === 'dormant') return '#eab308'
  if (node.type === 'project') return node.color || '#6b7280'
  if (node.type === 'category') return '#9ca3af'
  return '#d1d5db'
}

export function getLinkStrokeWidth(flow = 1) {
  const numeric = Number.isFinite(Number(flow)) ? Number(flow) : 1
  const clampedFlow = Math.max(0.01, Math.min(1, numeric))
  return 2 + Math.sqrt(clampedFlow) * 9
}

function normalizedWeight(value) {
  if (value === null || value === undefined || value === '') return 1
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 1
}

function statusPressureMultiplier(status) {
  if (status === 'done') return 0.25
  if (status === 'dormant') return 0.45
  return 1
}

function nodeBasePressure(node) {
  if (node?.type === 'task') return 1
  if (node?.type === 'category') return 0.7
  if (node?.type === 'project') return 0.9
  return 0
}

function normalizeShares(values, fallbackCount) {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total > 0) return values.map(value => value / total)
  return Array.from({ length: fallbackCount }, () => fallbackCount ? 1 / fallbackCount : 0)
}

function clamp(value, min = 0, max = 1) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return min
  return Math.max(min, Math.min(max, numeric))
}

function goalTextOf(userGoal) {
  if (!userGoal) return ''
  if (typeof userGoal === 'string') return userGoal
  return [
    userGoal.text,
    ...(Array.isArray(userGoal.constraints) ? userGoal.constraints : []),
  ].filter(Boolean).join(' ')
}

function goalExcludeTextOf(userGoal) {
  if (!userGoal || typeof userGoal === 'string') return ''
  return (Array.isArray(userGoal.exclude) ? userGoal.exclude : []).filter(Boolean).join(' ')
}

function nodeTextOf(node) {
  const a = node?.annotations || {}
  const roi = a.roi_type && typeof a.roi_type === 'object'
    ? Object.keys(a.roi_type).join(' ')
    : ''
  return [
    node?.name,
    node?.summary,
    node?.current_priority ? PRIORITY_LABELS[node.current_priority] || node.current_priority : null,
    node?.target_completion_date,
    a.strategic_tag,
    a.time_horizon,
    a.energy_cost,
    a.risk,
    a.ai_notes,
    roi,
  ].filter(Boolean).join(' ')
}

function compactText(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, '')
}

function textIncludesAny(text, words) {
  const normalized = compactText(text)
  return words.some(word => normalized.includes(compactText(word)))
}

const GOAL_KEYWORD_GROUPS = [
  ['现金', '收入', '赚钱', '变现', '外包', '客户', '商业', '自由职业', '报价'],
  ['内容', 'b站', '哔哩', '视频', '频道', 'youtube', '小红书', '账号', '短剧', '脚本'],
  ['求职', '简历', '面试', '作品集', '投递', '找工作', '岗位'],
  ['健康', '医院', '答辩', '课题', '结题', '论文', '汇报'],
  ['学习', '课程', '读书', '训练', '练习', '技能'],
]

function tokenOverlapScore(goalText, nodeText) {
  const goal = compactText(goalText)
  const node = compactText(nodeText)
  if (!goal || !node) return 0

  const latinTokens = goal.match(/[a-z0-9]{2,}/g) || []
  const chineseTokens = goal.match(/[\u4e00-\u9fff]{2,4}/g) || []
  const tokens = Array.from(new Set([
    ...latinTokens,
    ...chineseTokens,
  ])).filter(token => token.length >= 2)

  if (!tokens.length) return 0
  const hits = tokens.filter(token => node.includes(token)).length
  return Math.min(0.35, hits * 0.07)
}

function goalFitScore(node, userGoal) {
  const goalText = goalTextOf(userGoal)
  if (!goalText) return 0.5

  const nodeText = nodeTextOf(node)
  let score = 0.15 + tokenOverlapScore(goalText, nodeText)

  for (const group of GOAL_KEYWORD_GROUPS) {
    if (textIncludesAny(goalText, group) && textIncludesAny(nodeText, group)) {
      score += 0.22
    }
  }

  const excludeText = goalExcludeTextOf(userGoal)
  if (excludeText && textIncludesAny(nodeText, excludeText.split(/[,\s，、]+/).filter(Boolean))) {
    score -= 0.35
  }

  return clamp(score, 0, 1)
}

function urgencyScore(node) {
  const a = node?.annotations || {}
  let score = 0

  if (node?.current_priority === 'urgent') score += 0.9
  if (node?.current_priority === 'high') score += 0.55
  if (node?.current_priority === 'normal') score += 0.18

  const dueState = getNodeDueState(node)
  if (dueState?.state === 'overdue') score += 0.85
  if (dueState?.state === 'today') score += 0.75
  if (dueState?.state === 'three_days') score += 0.55
  if (dueState?.state === 'week') score += 0.28

  if (a.time_horizon === '立即') score += 0.8
  if (a.time_horizon === '短期') score += 0.45
  if (a.time_horizon === '中期') score += 0.18

  const text = nodeTextOf(node)
  if (/今天|明天|本周|这周|周内|月底|月内|截止|deadline|答辩|交付|提交|到期|清零|紧急/i.test(text)) {
    score += 0.45
  }
  if (a.risk === '确定性') score += 0.08
  if (a.strategic_tag === '现金流') score += 0.12

  return clamp(score, 0, 1)
}

function hasTaskDescendant(childMetas) {
  return childMetas.some(meta => meta.taskCount > 0)
}

function taskSpecificity(node) {
  const text = String(node?.name || '')
  let score = 0.35
  if (text.length >= 6) score += 0.15
  if (/写|剪|做|发|发布|联系|整理|提交|更新|修改|检查|录|拍|画|设计|部署|修复|预约|确认|完成|制作/.test(text)) score += 0.25
  if (/稿|脚本|视频|邮件|简历|作品集|清单|方案|页面|版本|初稿|报价|分镜|文案|报告/.test(text)) score += 0.18
  if (/项目|平台|账号|方向|计划|想法|构思|灵感$/.test(text)) score -= 0.18
  return clamp(score, 0.2, 1)
}

function completenessFor(node, childMetas) {
  if (!node || node.type === 'root') return { completeness: 1, missingSlots: [] }
  if (node.status === 'done') return { completeness: 1, missingSlots: [] }

  const children = Array.isArray(node.children) ? node.children : []
  const missingSlots = []
  let score

  if (node.type === 'task') {
    score = taskSpecificity(node)
    if (score < 0.7) missingSlots.push('具体动作/产出物')
    if (!node.annotations) missingSlots.push('策略标签')
    return { completeness: clamp(score, 0, 1), missingSlots }
  }

  if (node.type === 'project') {
    score = 0.25
    if (children.length) score += 0.2
    else missingSlots.push('方向/模块')

    if (children.some(child => child.type === 'category')) score += 0.2
    else missingSlots.push('项目模块')

    if (hasTaskDescendant(childMetas)) score += 0.25
    else missingSlots.push('关键下一步')

    if (childMetas.some(meta => meta.activeTaskCount > 0)) score += 0.1
    else missingSlots.push('进行中任务')

    return { completeness: clamp(score, 0, 1), missingSlots: [...new Set(missingSlots)] }
  }

  if (node.type === 'category') {
    score = 0.3
    if (children.length) score += 0.22
    else missingSlots.push('可执行任务')

    if (children.some(child => child.type === 'task') || hasTaskDescendant(childMetas)) score += 0.3
    else missingSlots.push('任务拆解')

    if (childMetas.some(meta => meta.activeTaskCount > 0)) score += 0.13
    if (node.annotations) score += 0.05

    return { completeness: clamp(score, 0, 1), missingSlots: [...new Set(missingSlots)] }
  }

  return { completeness: 0.5, missingSlots: [] }
}

function weightLooksLocked(children) {
  if (!children?.length || children.length === 1) return children?.map(() => false) || []

  const hasWeight = children.map(child => child?.weight !== null && child?.weight !== undefined)
  const weights = children.map(child => normalizedWeight(child?.weight))
  const candidates = weights.map((weight, index) => hasWeight[index] && weight >= 0 && weight < 0.95)
  if (!candidates.some(Boolean)) return children.map(() => false)

  const candidateWeights = weights.filter((_, index) => candidates[index])
  const min = Math.min(...candidateWeights)
  const max = Math.max(...candidateWeights)
  const sum = candidateWeights.reduce((total, weight) => total + weight, 0)
  const evenShare = 1 / children.length
  const looksAutoEven =
    candidateWeights.length === children.length &&
    max - min <= 0.015 &&
    Math.abs(sum - 1) <= 0.08 &&
    candidateWeights.every(weight => Math.abs(weight - evenShare) <= 0.04)

  if (looksAutoEven) return children.map(() => false)
  return candidates
}

function childLocalSharesFromMeta(children, metaByNode) {
  if (!children?.length) return []
  if (children.length === 1) return [1]

  const locked = weightLooksLocked(children)
  const hasLocked = locked.some(Boolean)
  const weights = children.map(child => normalizedWeight(child?.weight))
  const scores = children.map(child => metaByNode.get(child)?.allocationScore ?? 0.1)

  if (!hasLocked) return normalizeShares(scores, children.length)

  const lockedTotal = weights.reduce((sum, weight, index) => locked[index] ? sum + weight : sum, 0)
  const unlockedScoreTotal = scores.reduce((sum, score, index) => locked[index] ? sum : sum + score, 0)

  if (lockedTotal >= 1) {
    return normalizeShares(children.map((_, index) => locked[index] ? weights[index] : 0), children.length)
  }

  const remaining = 1 - lockedTotal
  return normalizeShares(children.map((_, index) => {
    if (locked[index]) return weights[index]
    if (unlockedScoreTotal <= 0) return remaining / children.length
    return remaining * (scores[index] / unlockedScoreTotal)
  }), children.length)
}

export function computeTreeNodeMetaMap(tree, options = {}) {
  if (options.algorithmVersion !== 'legacy') {
    return computePriorityMetaMap(tree, options)
  }
  const metaById = new Map()
  if (!tree) return metaById

  const metaByNode = new WeakMap()
  const userGoal = options.goal ?? options.userGoal ?? null

  function analyze(node, depth = 0) {
    const children = Array.isArray(node?.children) ? node.children : []
    const childMetas = children.map(child => analyze(child, depth + 1))
    const { completeness, missingSlots } = completenessFor(node, childMetas)
    const goalFit = goalFitScore(node, userGoal)
    const urgency = urgencyScore(node)
    const statusMultiplier = statusPressureMultiplier(node?.status)
    const childPressure = childMetas.reduce((sum, meta) => sum + meta.branchPressure, 0)
    const selfPressure = nodeBasePressure(node) + urgency * 0.8 + (1 - completeness) * 0.65
    const branchPressure = Math.max(0.05, (selfPressure + childPressure) * statusMultiplier)
    const taskCount = (node?.type === 'task' ? 1 : 0) + childMetas.reduce((sum, meta) => sum + meta.taskCount, 0)
    const activeTaskCount = (node?.type === 'task' && node.status !== 'done' && node.status !== 'dormant' ? 1 : 0) +
      childMetas.reduce((sum, meta) => sum + meta.activeTaskCount, 0)
    const descendantCount = childMetas.reduce((sum, meta) => sum + 1 + meta.descendantCount, 0)
    const pressureSignal = Math.sqrt(branchPressure)
    const allocationScore = Math.max(
      0.05,
      pressureSignal * 0.5 +
        goalFit * 0.65 +
        urgency * 0.45 +
        (1 - completeness) * 0.28 +
        Math.min(0.35, activeTaskCount * 0.06)
    )

    const meta = {
      depth,
      branchPressure,
      goalFit,
      completeness,
      missingSlots,
      urgency,
      taskCount,
      activeTaskCount,
      descendantCount,
      allocationScore,
      localShare: 1,
      flow: 1,
      recommendationRank: 0,
    }
    metaByNode.set(node, meta)
    return meta
  }

  function assignFlow(node, flow = 1, localShare = 1) {
    const meta = metaByNode.get(node)
    if (!meta) return

    meta.flow = flow
    meta.localShare = localShare
    const pressureRank = clamp(meta.branchPressure / (meta.branchPressure + 4))
    const statusPenalty = node?.status === 'done' ? 0.35 : node?.status === 'dormant' ? 0.18 : 0
    meta.recommendationRank = clamp(
      flow * 0.48 +
        pressureRank * 0.18 +
        meta.goalFit * 0.16 +
        meta.urgency * 0.12 +
        (1 - meta.completeness) * 0.06 -
        statusPenalty
    )
    setMeta(metaById, node?.id, { ...meta })

    const children = Array.isArray(node?.children) ? node.children : []
    if (!children.length) return
    const shares = childLocalSharesFromMeta(children, metaByNode)
    children.forEach((child, index) => {
      const childLocalShare = shares[index] ?? (1 / children.length)
      assignFlow(child, flow * childLocalShare, childLocalShare)
    })
  }

  analyze(tree)
  assignFlow(tree)
  return metaById
}

export function getBranchPressure(node, cache = new WeakMap()) {
  if (!node) return 0.1
  if (typeof node === 'object' && cache.has(node)) return cache.get(node)
  const meta = computeTreeNodeMetaMap(node).get(node.id)
  const pressure = meta?.branchPressure ?? 0.1
  if (typeof node === 'object') cache.set(node, pressure)
  return pressure
}

export function getChildLocalShares(children) {
  if (!children?.length) return []
  const tree = { id: '__tmp_root__', type: 'root', children }
  const metaById = computeTreeNodeMetaMap(tree)
  return children.map(child => getDerivedWeightMeta(metaById, child)?.localShare ?? (1 / children.length))
}

function setMeta(metaById, id, meta) {
  if (id === null || id === undefined) return
  metaById.set(id, meta)
  metaById.set(String(id), meta)
}

export function getDerivedWeightMetaMap(tree, options = {}) {
  return computeTreeNodeMetaMap(tree, options)
}

export function getDerivedWeightMeta(metaById, node) {
  return getPriorityMeta(metaById, node)
}

/** 通过 ID 找节点 */
export function findNodeById(tree, id) {
  if (!tree) return null
  if (tree.id === id) return tree
  for (const child of (tree.children || [])) {
    const found = findNodeById(child, id)
    if (found) return found
  }
  return null
}

/** 把树结构序列化成 AI 可读的文字 + ID 列表 */
export function treeToPromptText(tree, userGoal = null) {
  if (!tree) return '（暂无项目）'
  const lines = []
  const STATUS = { active: '▶', done: '✓', dormant: '⏸' }
  const metaById = computeTreeNodeMetaMap(tree, { userGoal })

  function annoTag(node) {
    const a = node.annotations
    const parts = []
    if (node.current_priority) parts.push(`优先级:${PRIORITY_LABELS[node.current_priority] || node.current_priority}`)
    if (node.target_completion_date) parts.push(`目标日期:${node.target_completion_date}`)
    if (a?.strategic_tag) parts.push(a.strategic_tag)
    if (a?.time_horizon)  parts.push(a.time_horizon)
    if (a?.energy_cost)   parts.push(a.energy_cost)
    if (a?.risk)          parts.push(a.risk)
    return parts.length ? ` 〔${parts.join('·')}〕` : ''
  }

  function walk(node, depth) {
    if (node.type === 'root') { node.children?.forEach(c => walk(c, 0)); return }
    const indent = '  '.repeat(depth)
    const icon   = STATUS[node.status] || '▶'
    const meta = getDerivedWeightMeta(metaById, node)
    const directPriority = Math.round(meta?.directPriority ?? 0)
    const branchPriority = Math.round(meta?.branchPriority ?? directPriority)
    const cultivation = Math.round(meta?.cultivationScore ?? 0)
    const metaText = meta
      ? ` direct:${directPriority} branch:${branchPriority} cultivation:${cultivation} confidence:${Math.round((meta.confidence ?? 0) * 100)}%`
      : ''
    const staleText = meta?.staleReasons?.length ? ` stale:${meta.staleReasons.join('/')}` : ''
    lines.push(`${indent}${icon} [${node.type}] ${node.name} (id:${node.id}${metaText}${staleText})${annoTag(node)}`)
    node.children?.forEach(c => walk(c, depth + 1))
  }
  walk(tree, 0)
  return lines.join('\n')
}

export function flattenTree(node, result = []) {
  result.push(node)
  if (node.children) {
    node.children.forEach(child => flattenTree(child, result))
  }
  return result
}
