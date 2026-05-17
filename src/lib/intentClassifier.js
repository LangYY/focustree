/**
 * 意图分类器 —— 确定性算法层
 *
 * ── 设计目标 ──────────────────────────────────────────
 *  1. 把"明确指令"（加/删/改/标记/打开/折叠）从 LLM 路径剥离，本地直接执行
 *  2. 节省 token：90% 的日常操作不需要走 LLM
 *  3. 降低模型差异：同样的"删除 X"无论换什么模型，结果完全一致
 *  4. 把"推理类问题"（建议/规划/咨询）留给 LLM，因为只有那部分需要它
 *
 * ── 调用契约 ──────────────────────────────────────────
 *  classifyIntent(text, treeData, ctx) →
 *    { kind: 'action' | 'fallback', actions?: [...], reply?: '...' }
 *
 *  - kind='action': 已成功解析为本地可执行 action，调用方应直接 execute
 *  - kind='fallback': 无法本地处理，调用方应转发到 LLM
 *
 *  ctx 提供查询树的辅助函数；不直接依赖 React state
 */

import { collectSubtree, flattenTree } from './treeUtils.js'

const SUBTREE_WORDS = '(?:及(?:其)?\\s*)?(?:所有)?(?:(?:子任务|后续|下面|下方|下属|整条分支|整个分支|全部)(?:的)?(?:所有)?(?:任务|节点|项目|内容)?|下(?:的)?(?:所有)?(?:任务|节点|项目|内容)?)'

// ── 工具：在 treeData 里按名字模糊匹配节点 ───────────

/**
 * 按名字找节点。支持：完全匹配 > 前后缀 > 包含。
 * 返回最佳匹配；找不到返回 null；歧义（多个等强度匹配）返回 { ambiguous: [...] }
 */
export function findNodeByName(treeData, name) {
  if (!treeData || !name) return null
  const target = name.trim()
  if (!target) return null
  const all = flattenTree(treeData).filter(n => n.type !== 'root' && n.name)

  const exact = all.filter(n => n.name === target)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return { ambiguous: exact }

  const startsWith = all.filter(n => n.name.startsWith(target))
  if (startsWith.length === 1) return startsWith[0]
  if (startsWith.length > 1) return { ambiguous: startsWith }

  const contains = all.filter(n => n.name.includes(target))
  if (contains.length === 1) return contains[0]
  if (contains.length > 1) return { ambiguous: contains }

  // 包含子串
  const lower = target.toLowerCase()
  const fuzzy = all.filter(n => n.name.toLowerCase().includes(lower))
  if (fuzzy.length === 1) return fuzzy[0]
  if (fuzzy.length > 1) return { ambiguous: fuzzy }

  return null
}

// ── 工具：把"找不到/歧义"统一回包成给用户看的提示 ────

function ambiguousReply(name, candidates) {
  const names = candidates.slice(0, 5).map(c => `「${c.name}」`).join('、')
  return `「${name}」匹配到多个节点：${names}。请说具体一点（例如完整名）。`
}

function notFoundReply(name) {
  return `没找到名字含「${name}」的节点。可能拼错了，或它还没建。`
}

function subtreeReply(rootName, count, actionText) {
  const childCount = Math.max(0, count - 1)
  return childCount
    ? `已将「${rootName}」及 ${childCount} 个子节点${actionText}。`
    : `已将「${rootName}」${actionText}。`
}

// ── 解析器集合：每个返回 { matched: bool, actions, reply } ────

/**
 * 1. 加任务/加分类/加子项目
 *
 * 触发模式：
 *   - 「在 X 下加任务 Y」/「在 X 下添加分类 Y」
 *   - 「在 X 下加 Y」（默认 task）
 *   - 「给 X 加任务 Y」
 *   - 「新建项目 Y」/「创建项目 Y」
 *   - 「加任务 Y 到 X」
 */
function parseAdd(text, treeData) {
  // 新建顶层 project（不能含「在 X 下」「给 X」这种父子结构）
  if (/项目/.test(text) && !/[在给]\s*(?:「|『)?[^「』」]*?(?:」|』)?\s*(?:下|里|中)/.test(text)) {
    let name = null
    // 「新建项目 X」/「创建项目: X」—— 用户显式带「项目」前缀，X 是完整名
    let m = text.match(/^(?:新建|创建|加|添加)(?:一个)?(?:顶层)?项目[:：\s]+(.+)$/)
    if (m) name = m[1].trim()
    // 「新建一个 X 项目」/「创建 X 项目」—— X 紧跟动词，「项目」是类型词，去掉
    if (!name) {
      m = text.match(/^(?:新建|创建)(?:一个)?\s*(.+?)\s*项目\s*$/)
      if (m) name = m[1].trim()
    }
    if (name && name.length > 0 && name.length <= 40) {
      return {
        matched: true,
        actions: [{ type: 'add_project', name }],
      }
    }
  }

  // 「在 X 下加（任务|分类）Y」/「给 X 加（任务|分类）Y」
  const inParent =
    text.match(/^(?:在|给)\s*(?:「|『)?(.+?)(?:」|』)?(?:下|里|中)?\s*(?:加|添加|新建|创建)(?:个|一个)?\s*(任务|分类|子任务|子分类)?[:：\s]*(.+)$/) ||
    text.match(/^(?:加|添加|新建)(?:个|一个)?\s*(任务|分类)?[:：\s]*(.+?)\s*到\s*(.+)$/)
  if (inParent) {
    let parentName, childType, name
    if (inParent.length === 4 && inParent[3] && inParent[1] && /^(?:加|添加|新建)/.test(text) === false) {
      // 第一种正则
      parentName = inParent[1].trim()
      childType = inParent[2] || 'task'
      name = inParent[3].replace(/^[:：「『]/, '').replace(/[」』]$/, '').trim()
    } else {
      // 第二种正则
      childType = inParent[1] || 'task'
      name = inParent[2].replace(/^[:：「『]/, '').replace(/[」』]$/, '').trim()
      parentName = inParent[3].replace(/^[「『]/, '').replace(/[」』]$/, '').trim()
    }
    if (!parentName || !name) return { matched: false }
    if (name.length > 60) return { matched: false }

    const parent = findNodeByName(treeData, parentName)
    if (!parent) return { matched: true, reply: notFoundReply(parentName) }
    if (parent.ambiguous) return { matched: true, reply: ambiguousReply(parentName, parent.ambiguous) }

    const type = /分类/.test(childType) ? 'category' : 'task'
    return {
      matched: true,
      actions: [{ type: `add_${type}`, name, parent: parent.id }],
    }
  }

  return { matched: false }
}

/**
 * 2. 标记完成/进行中/暂停
 *
 *   「X 做完了 / 完成了」
 *   「把 X 标记完成 / 标完成」
 *   「暂停 X / 把 X 搁置」
 *   「恢复 X / X 继续做」
 */
function parseStatus(text, treeData) {
  // 完成
  let m = text.match(/^(?:把\s*)?(?:「|『)?(.+?)(?:」|』)?\s*(?:做完|做好|完成|搞定|搞完)了?$/)
  if (!m) m = text.match(/^(?:把|将)?\s*(?:「|『)?(.+?)(?:」|』)?\s*标(?:记)?(?:为)?\s*(?:完成|搞定)$/)
  if (m) return statusAction(treeData, m[1], 'done')

  // 暂停 / 搁置
  m = text.match(/^(?:暂停|搁置|先放|放放|hold)\s*(?:「|『)?(.+?)(?:」|』)?\s*$/i)
  if (!m) m = text.match(/^(?:把|将)?\s*(?:「|『)?(.+?)(?:」|』)?\s*(?:暂停|搁置|先放一放|hold)$/i)
  if (m) return statusAction(treeData, m[1], 'dormant')

  // 恢复
  m = text.match(/^(?:恢复|继续做|重启)\s*(?:「|『)?(.+?)(?:」|』)?\s*$/)
  if (!m) m = text.match(/^(?:把|将)?\s*(?:「|『)?(.+?)(?:」|』)?\s*(?:恢复|重启|继续)(?:进行)?$/)
  if (m) return statusAction(treeData, m[1], 'active')

  return { matched: false }
}

function statusAction(treeData, name, status) {
  name = name.trim()
  if (!name || name.length > 40) return { matched: false }
  const found = findNodeByName(treeData, name)
  if (!found) return { matched: true, reply: notFoundReply(name) }
  if (found.ambiguous) return { matched: true, reply: ambiguousReply(name, found.ambiguous) }
  return {
    matched: true,
    actions: [{ type: `mark_${status}`, id: found.id, name: found.name }],
  }
}

/**
 * 2a. 调整权重
 *
 *   「把 X 权重调到 80%」/「X 权重设为 0.8」
 */
function parseWeight(text, treeData) {
  let m = text.match(/^(?:把|将)?\s*(?:「|『)?(.+?)(?:」|』)?\s*权重\s*(?:调(?:整)?到|设(?:置)?为|改(?:成|为)?|=|到)\s*([0-9]+(?:\.[0-9]+)?)\s*(%)?\s*$/)
  if (!m) {
    m = text.match(/^权重\s*(?:调(?:整)?到|设(?:置)?为|改(?:成|为)?|=|到)\s*([0-9]+(?:\.[0-9]+)?)\s*(%)?\s*(?:给|到|为)\s*(?:「|『)?(.+?)(?:」|』)?\s*$/)
    if (m) m = [m[0], m[3], m[1], m[2]]
  }
  if (!m) {
    m = text.match(/^(?:把|将)?\s*(?:「|『)?(.+?)(?:」|』)?\s*(?:调(?:整)?到|调(?:整)?为|设(?:置)?为|改(?:成|为)?|=|到)\s*([0-9]+(?:\.[0-9]+)?)\s*%\s*$/)
    if (m) m = [m[0], m[1], m[2], '%']
  }
  if (!m) return { matched: false }

  const name = m[1].trim()
  const rawValue = Number(m[2])
  if (!name || name.length > 60 || !Number.isFinite(rawValue)) return { matched: false }

  let weight = (m[3] || rawValue > 2) ? rawValue / 100 : rawValue
  weight = Math.max(0, Math.min(2, weight))

  const found = findNodeByName(treeData, name)
  if (!found) return { matched: true, reply: notFoundReply(name) }
  if (found.ambiguous) return { matched: true, reply: ambiguousReply(name, found.ambiguous) }

  return {
    matched: true,
    reply: `已将「${found.name}」权重调整为 ${Math.round(weight * 100)}%。`,
    actions: [{ type: 'set_weight', id: found.id, name: found.name, weight }],
  }
}

/**
 * 2b. 批量状态：明确要求把某节点及其后续/子任务一起切状态。
 *
 *   「暂停 X 及子任务」/「把 X 下所有任务标完成」/「恢复 X 整条分支」
 */
function parseStatusSubtree(text, treeData) {
  let m = text.match(new RegExp(`^(?:把|将)?\\s*(?:「|『)?(.+?)(?:」|』)?\\s*${SUBTREE_WORDS}\\s*(?:都)?\\s*(?:标(?:记)?(?:为)?\\s*)?(完成|做完|搞定|暂停|搁置|恢复|重启|继续)(?:进行)?\\s*$`))
  if (!m) {
    m = text.match(new RegExp(`^(完成|做完|搞定|暂停|搁置|恢复|重启|继续)\\s*(?:「|『)?(.+?)(?:」|』)?\\s*${SUBTREE_WORDS}\\s*$`))
    if (m) m = [m[0], m[2], m[1]]
  }
  if (!m) return { matched: false }

  const name = m[1].trim()
  if (!name || name.length > 60) return { matched: false }

  const found = findNodeByName(treeData, name)
  if (!found) return { matched: true, reply: notFoundReply(name) }
  if (found.ambiguous) return { matched: true, reply: ambiguousReply(name, found.ambiguous) }

  const statusWord = m[2]
  const status = /完成|做完|搞定/.test(statusWord)
    ? 'done'
    : /恢复|重启|继续/.test(statusWord)
      ? 'active'
      : 'dormant'
  const label = status === 'done'
    ? '标记为完成'
    : status === 'active'
      ? '恢复为进行中'
      : '标记为暂停'

  const nodes = collectSubtree(treeData, found.id).filter(n => n.type !== 'root')
  if (!nodes.length) return { matched: false }

  return {
    matched: true,
    reply: subtreeReply(found.name, nodes.length, label),
    actions: nodes.map(n => ({ type: `mark_${status}`, id: n.id, name: n.name })),
  }
}

/**
 * 3. 删除整条分支
 *
 *   「删除 X 及子任务」/「把 X 整条分支删掉」
 */
function parseDeleteSubtree(text, treeData) {
  let m = text.match(new RegExp(`^(?:删除|删掉|删|清除)\\s*(?:「|『)?(.+?)(?:」|』)?\\s*${SUBTREE_WORDS}\\s*$`))
  if (!m) {
    m = text.match(new RegExp(`^(?:把|将)\\s*(?:「|『)?(.+?)(?:」|』)?\\s*${SUBTREE_WORDS}\\s*(?:删(?:除|掉|了)?|清除)\\s*$`))
  }
  if (!m) return { matched: false }

  const name = m[1].trim()
  if (!name || name.length > 60) return { matched: false }

  const found = findNodeByName(treeData, name)
  if (!found) return { matched: true, reply: notFoundReply(name) }
  if (found.ambiguous) return { matched: true, reply: ambiguousReply(name, found.ambiguous) }

  const nodes = collectSubtree(treeData, found.id).filter(n => n.type !== 'root')
  return {
    matched: true,
    reply: subtreeReply(found.name, nodes.length || 1, '删除'),
    actions: [{ type: 'delete', id: found.id, name: found.name }],
  }
}

/**
 * 4. 删除
 *
 *   「删除 X / 删掉 X / 把 X 删了」
 */
function parseDelete(text, treeData) {
  let m = text.match(/^(?:删除|删掉|删)\s*(?:「|『)?(.+?)(?:」|』)?\s*$/)
  if (!m) m = text.match(/^(?:把|将)\s*(?:「|『)?(.+?)(?:」|』)?\s*删(?:除|掉|了)?$/)
  if (!m) return { matched: false }
  const name = m[1].trim()
  if (!name || name.length > 40) return { matched: false }
  const found = findNodeByName(treeData, name)
  if (!found) return { matched: true, reply: notFoundReply(name) }
  if (found.ambiguous) return { matched: true, reply: ambiguousReply(name, found.ambiguous) }
  return {
    matched: true,
    actions: [{ type: 'delete', id: found.id, name: found.name }],
  }
}

/**
 * 5. 重命名
 *
 *   「把 X 改名为 Y」/「X 改名 Y」/「重命名 X 为 Y」
 */
function parseRename(text, treeData) {
  let m = text.match(/^(?:把|将)\s*(?:「|『)?(.+?)(?:」|』)?\s*(?:改名|重命名|改)\s*(?:为|成|叫)\s*(?:「|『)?(.+?)(?:」|』)?\s*$/)
  if (!m) m = text.match(/^重命名\s*(?:「|『)?(.+?)(?:」|』)?\s*(?:为|成|叫)\s*(?:「|『)?(.+?)(?:」|』)?\s*$/)
  if (!m) return { matched: false }
  const oldName = m[1].trim()
  const newName = m[2].trim()
  if (!oldName || !newName || newName.length > 60) return { matched: false }
  const found = findNodeByName(treeData, oldName)
  if (!found) return { matched: true, reply: notFoundReply(oldName) }
  if (found.ambiguous) return { matched: true, reply: ambiguousReply(oldName, found.ambiguous) }
  return {
    matched: true,
    actions: [{ type: 'rename', id: found.id, name: newName }],
  }
}

/**
 * 6. 清空全部
 */
function parseClearAll(text) {
  if (
    /^(?:清空|清除)\s*(?:全部|所有|整棵|这棵|当前|这个)?\s*(?:面板|画板|项目|树|节点|内容)?\s*$/.test(text) ||
    /^(?:删除|删掉|删)\s*(?:全部|所有|整棵|这棵)\s*(?:项目|树|节点|内容)?\s*$/.test(text)
  ) {
    return {
      matched: true,
      reply: '已清空。（可撤销）',
      actions: [{ type: 'clear_all' }],
    }
  }
  return { matched: false }
}

function parseBareDelete(text) {
  if (/^(?:删除|删掉|删)\s*$/.test(text)) {
    return { matched: true, reply: '要删除哪个节点？请说完整名称，或说「删除全部」。' }
  }
  return { matched: false }
}

/**
 * 7. 展开 / 折叠（本地操作，不写 action，直接返回 special kind）
 */
function parseExpandCollapse(text) {
  if (/^(?:展开|打开)\s*(?:全部|所有)\s*$/.test(text)) {
    return { matched: true, special: 'expandAll' }
  }
  if (/^(?:折叠|收起|关闭)\s*(?:全部|所有)\s*$/.test(text)) {
    return { matched: true, special: 'collapseAll' }
  }
  return { matched: false }
}

// ── 入口 ─────────────────────────────────────────────

/**
 * 主分类入口。返回结构：
 *   { matched: true, actions: [...] }           → 调用方执行 actions
 *   { matched: true, reply: '...' }             → 调用方直接显示这条 reply
 *   { matched: true, special: 'expandAll' }     → 调用方调用对应 helper
 *   { matched: false }                          → fallback 到 LLM
 */
export function classifyIntent(text, treeData) {
  const t = (text || '').trim()
  if (!t) return { matched: false }

  // 试图通过算法解析，按优先级
  const tryParsers = [
    parseClearAll,
    parseExpandCollapse,
    parseBareDelete,
    parseDeleteSubtree,
    parseDelete,
    parseWeight,
    parseStatusSubtree,
    parseStatus,
    parseRename,
    parseAdd,
  ]

  for (const fn of tryParsers) {
    const res = fn.length === 1 ? fn(t) : fn(t, treeData)
    if (res?.matched) return res
  }
  return { matched: false }
}
