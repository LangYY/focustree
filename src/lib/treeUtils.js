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
    const { children, ...raw } = n   // 去掉运行时的 children 数组
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

function isNegotiatedWeight(value) {
  if (value === null || value === undefined || value === '') return false
  const weight = normalizedWeight(value)
  return weight >= 0 && weight < 0.95
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

export function getBranchPressure(node, cache = new WeakMap()) {
  if (!node) return 0.1
  if (typeof node === 'object' && cache.has(node)) return cache.get(node)

  const children = Array.isArray(node.children) ? node.children : []
  const childPressure = children.reduce((sum, child) => sum + getBranchPressure(child, cache), 0)
  const base = nodeBasePressure(node)
  const pressure = Math.max(0.1, base + childPressure) * statusPressureMultiplier(node.status)

  if (typeof node === 'object') cache.set(node, pressure)
  return pressure
}

function normalizeShares(values, fallbackCount) {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total > 0) return values.map(value => value / total)
  return Array.from({ length: fallbackCount }, () => fallbackCount ? 1 / fallbackCount : 0)
}

export function getChildLocalShares(children, pressureCache = new WeakMap()) {
  if (!children?.length) return []
  if (children.length === 1) return [1]

  const pressures = children.map(child => getBranchPressure(child, pressureCache))
  const explicit = children.map(child => isNegotiatedWeight(child?.weight))

  if (!explicit.some(Boolean)) {
    return normalizeShares(pressures, children.length)
  }

  const weights = children.map(child => normalizedWeight(child?.weight))
  const explicitTotal = weights.reduce((sum, weight, index) => (
    explicit[index] ? sum + weight : sum
  ), 0)
  const hasUnweighted = explicit.some(flag => !flag)

  if (hasUnweighted && explicitTotal < 1) {
    const remaining = 1 - explicitTotal
    const unweightedPressureTotal = pressures.reduce((sum, pressure, index) => (
      explicit[index] ? sum : sum + pressure
    ), 0)

    return normalizeShares(children.map((_, index) => {
      if (explicit[index]) return weights[index]
      if (unweightedPressureTotal <= 0) return remaining / children.length
      return remaining * (pressures[index] / unweightedPressureTotal)
    }), children.length)
  }

  return normalizeShares(children.map((_, index) => (
    explicit[index] ? weights[index] : 0
  )), children.length)
}

function setMeta(metaById, id, meta) {
  if (id === null || id === undefined) return
  metaById.set(id, meta)
  metaById.set(String(id), meta)
}

export function getDerivedWeightMetaMap(tree) {
  const metaById = new Map()
  if (!tree) return metaById

  const pressureCache = new WeakMap()

  function walk(node, flow = 1, localShare = 1) {
    const branchPressure = getBranchPressure(node, pressureCache)
    setMeta(metaById, node?.id, { flow, localShare, branchPressure })

    const children = Array.isArray(node?.children) ? node.children : []
    if (!children.length) return

    const shares = getChildLocalShares(children, pressureCache)
    children.forEach((child, index) => {
      const childLocalShare = shares[index] ?? (1 / children.length)
      walk(child, flow * childLocalShare, childLocalShare)
    })
  }

  walk(tree)
  return metaById
}

export function getDerivedWeightMeta(metaById, node) {
  if (!metaById || !node) return null
  return metaById.get(node.id) ?? metaById.get(String(node.id)) ?? null
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
export function treeToPromptText(tree) {
  if (!tree) return '（暂无项目）'
  const lines = []
  const STATUS = { active: '▶', done: '✓', dormant: '⏸' }
  const metaById = getDerivedWeightMetaMap(tree)

  function annoTag(node) {
    const a = node.annotations
    if (!a) return ''
    const parts = []
    if (a.strategic_tag) parts.push(a.strategic_tag)
    if (a.time_horizon)  parts.push(a.time_horizon)
    if (a.energy_cost)   parts.push(a.energy_cost)
    if (a.risk)          parts.push(a.risk)
    return parts.length ? ` 〔${parts.join('·')}〕` : ''
  }

  function walk(node, depth) {
    if (node.type === 'root') { node.children?.forEach(c => walk(c, 0)); return }
    const indent = '  '.repeat(depth)
    const icon   = STATUS[node.status] || '▶'
    const meta = getDerivedWeightMeta(metaById, node)
    const wPct = Math.round((meta?.localShare ?? node.weight ?? 1) * 100)
    const flowPct = Math.round((meta?.flow ?? meta?.localShare ?? node.weight ?? 1) * 100)
    const weightText = flowPct === wPct ? `w:${wPct}%` : `w:${wPct}% flow:${flowPct}%`
    lines.push(`${indent}${icon} [${node.type}] ${node.name} (id:${node.id} ${weightText})${annoTag(node)}`)
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
