import { computeTreeNodeMetaMap, flattenTree, findNodeById, getDerivedWeightMeta } from './treeUtils.js'

const MODEL_JUDGMENT_WORDS = /(应该|建议|推荐|优先|先做什么|先做哪|取舍|规划|梳理|分析|判断|值不值得|要不要|是否|为什么|怎么|如何|帮我想|帮我拆|卡住)/
const ACTIVE_STATUS = { active: '进行中', done: '已完成', dormant: '已暂停' }
const TYPE_LABEL = { project: '项目', category: '分类', task: '任务' }

/**
 * 只处理可以从树数据和固定规则直接推出的查询。
 * 需要解释、取舍、生成和开放判断的请求返回 null，让模型处理。
 */
export function routeLocalQuery(text, treeData, options = {}) {
  const content = String(text || '').trim()
  if (!content || !treeData) return null
  if (MODEL_JUDGMENT_WORDS.test(content)) return null

  const selectedNode = options.selectedNodeId ? findNodeById(treeData, options.selectedNodeId) : null

  if (isStatsQuery(content)) {
    return localReply(buildStatsReply(treeData), 'stats')
  }

  if (selectedNode && isSelectedNodeInfoQuery(content)) {
    return localReply(buildSelectedNodeReply(treeData, selectedNode), 'selected_node')
  }

  if (isTimeTaskQuery(content)) {
    return localReply(buildTimeTaskReply(treeData, content, options.userGoal), 'time_tasks')
  }

  if (isActiveTaskListQuery(content)) {
    return localReply(buildActiveTaskReply(treeData, options.userGoal), 'active_tasks')
  }

  if (isSearchQuery(content)) {
    const reply = buildSearchReply(treeData, content)
    if (reply) return localReply(reply, 'search')
  }

  return null
}

function localReply(reply, route) {
  return {
    matched: true,
    kind: 'local_query',
    route,
    reply,
  }
}

function isStatsQuery(text) {
  return /(统计|数量|多少|完成率|进度|概况|总数)/.test(text) &&
    /(任务|节点|项目|分支|完成|暂停|进行中|进度|概况|总数)/.test(text)
}

function isSelectedNodeInfoQuery(text) {
  return /(这个|当前|选中|这里)/.test(text) &&
    /(详情|信息|状态|子节点|下面有什么|有哪些子|进度|概况)/.test(text)
}

function isTimeTaskQuery(text) {
  return /(今天|今日|明天|本周|这周|周内|deadline|截止|到期)/i.test(text) &&
    /(任务|待办|to-?do|事项|deadline|截止|到期|有哪些|列)/i.test(text)
}

function isActiveTaskListQuery(text) {
  return /(有哪些|列出|显示|查看|看看|待办|to-?do|任务清单|进行中任务|未完成任务|活跃任务)/i.test(text) &&
    /(任务|待办|to-?do|未完成|进行中|活跃)/i.test(text)
}

function isSearchQuery(text) {
  return /^(?:找|查找|搜索|搜|包含)\s+/.test(text) || /(?:有哪些|列出).*(?:包含|叫|名字里有)/.test(text)
}

function buildStatsReply(treeData) {
  const nodes = flattenTree(treeData).filter(node => node.type !== 'root')
  const tasks = nodes.filter(node => node.type === 'task')
  const projects = nodes.filter(node => node.type === 'project')
  const categories = nodes.filter(node => node.type === 'category')
  const doneTasks = tasks.filter(node => node.status === 'done')
  const activeTasks = tasks.filter(node => node.status === 'active')
  const dormantTasks = tasks.filter(node => node.status === 'dormant')
  const doneRate = tasks.length ? Math.round(doneTasks.length / tasks.length * 100) : 0

  return [
    `本地统计：共 ${nodes.length} 个节点，其中项目 ${projects.length} 个、分类 ${categories.length} 个、任务 ${tasks.length} 个。`,
    `任务状态：进行中 ${activeTasks.length} 个，已完成 ${doneTasks.length} 个，已暂停 ${dormantTasks.length} 个，完成率 ${doneRate}%。`,
  ].join('\n')
}

function buildSelectedNodeReply(treeData, node) {
  const parent = node.parent_id ? findNodeById(treeData, node.parent_id) : null
  const children = node.children || []
  const activeChildren = children.filter(child => child.status === 'active').length
  const doneChildren = children.filter(child => child.status === 'done').length
  const details = String(node.annotations?.ai_notes || '').trim()
  const lines = [
    `当前节点：${node.name}`,
    `类型：${TYPE_LABEL[node.type] || node.type}；状态：${ACTIVE_STATUS[node.status] || node.status || '进行中'}`,
  ]

  if (parent) lines.push(`父节点：${parent.name}`)
  lines.push(`直属子节点：${children.length} 个（进行中 ${activeChildren}，已完成 ${doneChildren}）`)
  if (details) lines.push(`详情：${details.slice(0, 280)}${details.length > 280 ? '...' : ''}`)
  if (children.length) {
    lines.push(`子节点：${children.slice(0, 8).map(child => child.name).join('、')}${children.length > 8 ? ` 等 ${children.length} 个` : ''}`)
  }
  return lines.join('\n')
}

function buildTimeTaskReply(treeData, text, userGoal) {
  const mode = /今天|今日/.test(text)
    ? 'today'
    : /明天/.test(text)
      ? 'tomorrow'
      : 'week'
  const candidates = rankOpenTasks(treeData, userGoal)
    .filter(item => matchesTimeIntent(item.node, mode, text))
    .slice(0, 12)

  const title = mode === 'today'
    ? '今天相关任务'
    : mode === 'tomorrow'
      ? '明天相关任务'
      : '本周 / deadline 相关任务'

  if (!candidates.length) {
    return `${title}：我没有在任务名或详情里找到明确时间线索。\n说明：当前还没有专门的截止日期栏位，本地算法只能按“今天/明天/本周/截止/deadline”等文字和时间标签筛选。`
  }

  return [
    `${title}（本地筛选，不做优先级判断）：`,
    ...formatTaskLines(candidates),
    '说明：这是按节点文字、详情和时间标签筛出的候选；如果要我判断先后顺序，再问“我应该先做什么”。',
  ].join('\n')
}

function buildActiveTaskReply(treeData, userGoal) {
  const candidates = rankOpenTasks(treeData, userGoal).slice(0, 15)
  if (!candidates.length) return '当前没有进行中的任务。'
  return [
    '进行中的任务（本地排序，仅供快速查看）：',
    ...formatTaskLines(candidates),
  ].join('\n')
}

function buildSearchReply(treeData, text) {
  const keyword = extractSearchKeyword(text)
  if (!keyword || keyword.length < 2) return null
  const matches = flattenTree(treeData)
    .filter(node => node.type !== 'root')
    .filter(node => nodeText(node).includes(keyword))
    .slice(0, 12)

  if (!matches.length) return `没有找到包含「${keyword}」的节点。`
  return [
    `找到 ${matches.length} 个包含「${keyword}」的节点：`,
    ...matches.map((node, index) => `${index + 1}. ${nodePath(treeData, node)}（${TYPE_LABEL[node.type] || node.type}，${ACTIVE_STATUS[node.status] || node.status || '进行中'}）`),
  ].join('\n')
}

function rankOpenTasks(treeData, userGoal) {
  const metaById = computeTreeNodeMetaMap(treeData, { userGoal })
  return flattenTree(treeData)
    .filter(node => node.type === 'task' && node.status !== 'done' && node.status !== 'dormant')
    .map(node => ({
      node,
      path: nodePath(treeData, node),
      meta: getDerivedWeightMeta(metaById, node),
    }))
    .sort((a, b) => {
      const bScore = b.meta?.recommendationRank ?? 0
      const aScore = a.meta?.recommendationRank ?? 0
      if (bScore !== aScore) return bScore - aScore
      return (b.node.position ?? 0) - (a.node.position ?? 0)
    })
}

function matchesTimeIntent(node, mode, rawText) {
  const text = nodeText(node)
  if (mode === 'today') {
    return /今天|今日|立刻|马上|现在|今晚/.test(text) || node.annotations?.time_horizon === '立即'
  }
  if (mode === 'tomorrow') {
    return /明天|明日/.test(text)
  }
  return /本周|这周|周内|本月底|月底|月内|deadline|截止|到期|交付|提交|答辩/i.test(text) ||
    ['立即', '短期'].includes(node.annotations?.time_horizon) ||
    /deadline|截止|到期/i.test(rawText)
}

function formatTaskLines(items) {
  return items.map((item, index) => {
    const meta = item.meta
    const score = meta ? `，匹配度 ${Math.round(meta.recommendationRank * 100)}%` : ''
    return `${index + 1}. ${item.path || item.node.name}（${ACTIVE_STATUS[item.node.status] || item.node.status || '进行中'}${score}）`
  })
}

function nodeText(node) {
  const annotations = node.annotations || {}
  return [
    node.name,
    annotations.ai_notes,
    annotations.time_horizon,
    annotations.energy_cost,
    annotations.risk,
    annotations.strategic_tag,
  ].filter(Boolean).join(' ')
}

function extractSearchKeyword(text) {
  const patterns = [
    /^(?:找|查找|搜索|搜|包含)\s+(.+)$/,
    /(?:包含|叫|名字里有)\s*[「"']?(.+?)[」"']?\s*(?:的)?(?:节点|任务|项目|分支)?$/,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1].replace(/[。！？?!\s]+$/g, '').trim()
  }
  return ''
}

function nodePath(treeData, target) {
  const path = []
  findPath(treeData, target.id, path)
  return path.filter(node => node.type !== 'root').map(node => node.name).join(' > ')
}

function findPath(node, targetId, path) {
  if (!node) return false
  path.push(node)
  if (node.id === targetId) return true
  for (const child of node.children || []) {
    if (findPath(child, targetId, path)) return true
  }
  path.pop()
  return false
}
