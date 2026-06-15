export function collectPriorityAnalysisNodes(treeData, nodeIds = null) {
  const selected = nodeIds ? new Set(nodeIds.map(String)) : null
  const output = []

  function walk(node, path = [], parent = null) {
    const currentPath = node.type === 'root' ? path : [...path, node.name]
    if (node.type !== 'root' && node.status !== 'done' && (!selected || selected.has(String(node.id)))) {
      output.push({
        id: node.id,
        name: node.name,
        type: node.type,
        status: node.status || 'active',
        parent_id: node.parent_id || parent?.id || null,
        parent_name: parent?.type === 'root' ? null : parent?.name || null,
        path: currentPath.join(' > '),
        details: node.annotations?.ai_notes || '',
        current_priority: node.current_priority || null,
        target_completion_date: node.target_completion_date || null,
      })
    }
    for (const child of node.children || []) walk(child, currentPath, node)
  }

  if (treeData) walk(treeData)
  return output
}

export function estimatePriorityAnalysisTokens(nodes, goal) {
  const inputChars = JSON.stringify({ goal, nodes }).length + 1200
  const inputTokens = Math.ceil(inputChars / 1.8)
  const outputTokens = (nodes?.length || 0) * 105
  return Math.max(900, inputTokens + outputTokens)
}

export function formatTokenEstimate(tokens) {
  const numeric = Number(tokens) || 0
  if (numeric < 1000) return `约 ${Math.round(numeric)} tokens`
  return `约 ${(numeric / 1000).toFixed(numeric >= 10000 ? 0 : 1)}k tokens`
}
