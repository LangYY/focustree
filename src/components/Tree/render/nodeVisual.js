export const NODE_BASE_RADIUS = Object.freeze({ project: 16, category: 10, task: 6.5, root: 5 })

export function nodeRadius(nodeOrType, directPriority = 0) {
  const type = typeof nodeOrType === 'string' ? nodeOrType : nodeOrType?.type
  const base = NODE_BASE_RADIUS[type] || NODE_BASE_RADIUS.task
  const direct = clamp(Number(directPriority) / 100)
  return base * (0.82 + 0.50 * direct ** 0.85)
}

export function branchWidth(branchPriority = 0) {
  const branch = clamp(Number(branchPriority) / 100)
  return 1.2 + branch ** 1.30 * 13
}

export function glowMetrics(radius, directPriority = 0) {
  const direct = clamp(Number(directPriority) / 100)
  if (direct < 0.55) return null
  const strength = (direct - 0.55) / 0.45
  return {
    radius: radius * (1.9 + strength * 1.3),
    opacity: 0.10 + strength * 0.34,
  }
}

export function nodeAriaLabel(node, meta = {}) {
  const type = node?.type === 'project' ? '项目' : node?.type === 'category' ? '分类' : '任务'
  const status = node?.status === 'done' ? '已完成' : node?.status === 'dormant' ? '已暂停' : '进行中'
  return `${node?.name || '未命名'}，${type}，${status}，现在 ${Math.round(meta.directPriority || 0)}，未来 ${Math.round(meta.branchPriority || 0)}，培育度 ${Math.round(meta.cultivationScore || 0)}`
}

function clamp(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}
