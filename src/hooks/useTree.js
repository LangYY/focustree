import { useState, useCallback, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { flatToTree, findNodeById, collectSubtree, sortByParentFirst, sortByDepthDesc, SAMPLE_DATA } from '../lib/treeUtils'

const MAX_HISTORY = 30

function stripRuntimeNodeFields(node) {
  const raw = { ...node }
  delete raw.children
  delete raw.annotations
  return raw
}

export function useTree(user) {
  const [treeData, setTreeData]     = useState(null)
  const [loading, setLoading]       = useState(true)
  const [density, setDensity]       = useState('medium')
  const [leafView, setLeafView]     = useState(false)
  const [history, setHistory]       = useState([])   // [{ label, undoFn, redoFn }]
  const [future, setFuture]         = useState([])   // redo stack

  // ── 加载 ────────────────────────────────────────────

  const loadNodes = useCallback(async () => {
    if (!user) { setTreeData(SAMPLE_DATA); setLoading(false); return }
    setLoading(true)

    // 并发拉取 nodes + annotations
    const [nodesResult, annResult] = await Promise.all([
      supabase.from('nodes').select('*').eq('user_id', user.id).order('position'),
      supabase.from('node_annotations').select('*').eq('user_id', user.id),
    ])

    const { data, error } = nodesResult
    const annotations = annResult.data || []
    const annMap = {}
    annotations.forEach(a => { annMap[a.node_id] = a })

    // 把 annotations 合并到 node 上
    const enrichNodes = arr => arr.map(n => ({ ...n, annotations: annMap[n.id] || null }))

    if (error) {
      console.error(error); setTreeData(SAMPLE_DATA)
    } else if (!data?.length) {
      const initKey = `ft_init_${user.id}`
      const alreadyInitialized = localStorage.getItem(initKey)

      if (!alreadyInitialized) {
        await seedSampleData(user.id)
        localStorage.setItem(initKey, '1')
        const { data: seeded } = await supabase
          .from('nodes').select('*').eq('user_id', user.id).order('position')
        setTreeData(flatToTree(enrichNodes(seeded || [])))
      } else {
        setTreeData(null)
      }
    } else {
      localStorage.setItem(`ft_init_${user.id}`, '1')
      setTreeData(flatToTree(enrichNodes(data)))
    }
    setLoading(false)
  }, [user])

  useEffect(() => { loadNodes() }, [loadNodes])

  // ── 历史工具 ─────────────────────────────────────────

  const pushHistory = useCallback((label, undoFn, redoFn) => {
    setHistory(prev => [...prev.slice(-(MAX_HISTORY - 1)), { label, undoFn, redoFn }])
    setFuture([])
  }, [])

  const undo = useCallback(async () => {
    if (!history.length) return
    const last = history[history.length - 1]
    setHistory(prev => prev.slice(0, -1))
    await last.undoFn()
    if (last.redoFn) {
      setFuture(prev => [...prev.slice(-(MAX_HISTORY - 1)), last])
    }
    await loadNodes()
  }, [history, loadNodes])

  const redo = useCallback(async () => {
    if (!future.length) return
    const next = future[future.length - 1]
    if (!next.redoFn) return
    setFuture(prev => prev.slice(0, -1))
    await next.redoFn()
    setHistory(prev => [...prev.slice(-(MAX_HISTORY - 1)), next])
    await loadNodes()
  }, [future, loadNodes])

  // ── 展开/折叠：内存先变，DB 异步 fire-and-forget ─────
  // 关键：必须持久化，否则任何后续 loadNodes()（CRUD 后都会触发）会重置回 DB 状态

  const toggleNode = useCallback((id) => {
    let nextExpanded = null
    setTreeData(prev => {
      if (!prev) return prev
      const node = findNodeById(prev, id)
      if (node) nextExpanded = !node.expanded
      return toggleExpanded(prev, id)
    })
    if (user && id && id !== 'root' && nextExpanded !== null) {
      supabase.from('nodes').update({ expanded: nextExpanded })
        .eq('id', id).eq('user_id', user.id)
        .then(({ error }) => { if (error) console.warn('[toggleNode] persist:', error.message) })
    }
  }, [user])

  const expandAll = useCallback(() => {
    setTreeData(prev => prev ? setAllExpanded(prev, true) : prev)
    if (user) {
      supabase.from('nodes').update({ expanded: true })
        .eq('user_id', user.id)
        .then(({ error }) => { if (error) console.warn('[expandAll]:', error.message) })
    }
  }, [user])

  const collapseAll = useCallback(() => {
    setTreeData(prev => prev ? setAllExpanded(prev, false) : prev)
    if (user) {
      supabase.from('nodes').update({ expanded: false })
        .eq('user_id', user.id)
        .then(({ error }) => { if (error) console.warn('[collapseAll]:', error.message) })
    }
  }, [user])

  // ── 状态变更（mark_done / mark_active / mark_dormant）──

  const updateStatus = useCallback(async (nodeId, status) => {
    if (!user) return
    const node = findNodeById(treeData, nodeId)
    const prevStatus = node?.status || 'active'
    const prevCompleted = node?.completed_at || null
    const nowIso = new Date().toISOString()
    const nextCompleted = status === 'done' ? nowIso : null

    await supabase.from('nodes').update({
      status,
      completed_at: nextCompleted,
      last_active_at: nowIso,
    }).eq('id', nodeId).eq('user_id', user.id)

    // 🔁 Outcome 闭环：标完成时，把对应的近期推荐回填为 completed
    if (status === 'done') {
      const SEVEN_DAYS_AGO = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
      const { error: outcomeErr } = await supabase
        .from('recommendation_log')
        .update({
          outcome: 'completed',
          outcome_at: new Date().toISOString(),
          feedback: 'accepted',
        })
        .eq('user_id', user.id)
        .eq('primary_node_id', nodeId)
        .is('outcome', null)
        .gte('created_at', SEVEN_DAYS_AGO)
      if (outcomeErr) console.warn('[updateStatus] outcome backfill:', outcomeErr.message)
    }

    const statusLabel = { done: '完成', active: '进行中', dormant: '暂停' }
    pushHistory(`标记「${node?.name}」为${statusLabel[status]}`, async () => {
      await supabase.from('nodes').update({
        status: prevStatus,
        completed_at: prevCompleted,
      }).eq('id', nodeId).eq('user_id', user.id)
    }, async () => {
      await supabase.from('nodes').update({
        status,
        completed_at: nextCompleted,
      }).eq('id', nodeId).eq('user_id', user.id)
    })

    await loadNodes()
  }, [user, treeData, loadNodes, pushHistory])

  // ── 重命名 ────────────────────────────────────────────

  const renameNode = useCallback(async (nodeId, newName) => {
    if (!user || !newName?.trim()) return
    const node = findNodeById(treeData, nodeId)
    const prevName = node?.name || ''
    const nextName = newName.trim()
    if (!prevName || prevName === nextName) return

    await supabase.from('nodes').update({ name: nextName }).eq('id', nodeId).eq('user_id', user.id)

    pushHistory(`重命名「${prevName}」→「${nextName}」`, async () => {
      await supabase.from('nodes').update({ name: prevName }).eq('id', nodeId).eq('user_id', user.id)
    }, async () => {
      await supabase.from('nodes').update({ name: nextName }).eq('id', nodeId).eq('user_id', user.id)
    })

    await loadNodes()
  }, [user, treeData, loadNodes, pushHistory])

  // ── 新增节点（可带 AI 自动生成的 annotations）────────

  const addNode = useCallback(async ({ name, type, parentId, color, annotations, weight }) => {
    if (!user) return
    const nodeWeight = typeof weight === 'number' ? Math.max(0, Math.min(2, weight)) : 1.0
    const insertPayload = {
      user_id: user.id,
      parent_id: parentId || null,
      name: name.trim(),
      type, color: color || null,
      status: 'active', weight: nodeWeight,
      expanded: true, position: Date.now(),
      last_active_at: new Date().toISOString(),
    }
    const { data, error: insertErr } = await supabase.from('nodes').insert(insertPayload).select('id').single()

    if (insertErr) {
      console.error('[addNode] insert failed:', insertErr)
      alert(`创建失败：${insertErr.message}`)
      return null
    }

    let newId = null
    if (data?.id) {
      newId = data.id
      const insertedNode = { ...insertPayload, id: newId }
      let insertedAnnotation = null

      // 若 AI 提供了 annotations，写入 node_annotations
      if (annotations && Object.keys(annotations).length) {
        insertedAnnotation = {
          node_id: newId,
          user_id: user.id,
          roi_type:      annotations.roi_type      || null,
          time_horizon:  annotations.time_horizon  || null,
          energy_cost:   annotations.energy_cost   || null,
          feasibility:   annotations.feasibility   ?? null,
          risk:          annotations.risk          || null,
          strategic_tag: annotations.strategic_tag || null,
          ai_notes:      annotations.ai_notes      || null,
        }
        const { error: annErr } = await supabase.from('node_annotations').insert(insertedAnnotation)
        if (annErr) console.warn('[addNode] annotations write:', annErr.message)
      }

      pushHistory(`添加「${name}」`, async () => {
        await supabase.from('nodes').delete().eq('id', newId).eq('user_id', user.id)
      }, async () => {
        await supabase.from('nodes').insert(insertedNode)
        if (insertedAnnotation) {
          await supabase.from('node_annotations').upsert(insertedAnnotation, { onConflict: 'node_id' })
        }
      })
    }

    await loadNodes()
    return newId
  }, [user, loadNodes, pushHistory])

  // ── 给已有节点打/改策略标签 ──────────────────────────

  const annotateNode = useCallback(async (nodeId, annotations) => {
    if (!user || !nodeId || !annotations) return
    const { error } = await supabase.from('node_annotations').upsert({
      node_id: nodeId,
      user_id: user.id,
      roi_type:      annotations.roi_type      || null,
      time_horizon:  annotations.time_horizon  || null,
      energy_cost:   annotations.energy_cost   || null,
      feasibility:   annotations.feasibility   ?? null,
      risk:          annotations.risk          || null,
      strategic_tag: annotations.strategic_tag || null,
      ai_notes:      annotations.ai_notes      || null,
    }, { onConflict: 'node_id' })
    if (error) console.warn('[annotateNode]', error.message)
    await loadNodes()
  }, [user, loadNodes])

  // ── 删除节点（级联删除子节点）────────────────────────

  const updateNodeDetails = useCallback(async (nodeId, details) => {
    if (!user || !nodeId) return
    const node = findNodeById(treeData, nodeId)
    if (!node || node.type === 'root') return

    const prevDetails = node.annotations?.ai_notes || ''
    const nextDetails = String(details ?? '')
    if (prevDetails === nextDetails) return

    const hadAnnotation = Boolean(node.annotations)
    const writeDetails = async (value) => {
      await supabase.from('node_annotations').upsert({
        node_id: nodeId,
        user_id: user.id,
        ai_notes: value.trim() ? value : null,
      }, { onConflict: 'node_id' })
    }

    const { error } = await supabase.from('node_annotations').upsert({
      node_id: nodeId,
      user_id: user.id,
      ai_notes: nextDetails.trim() ? nextDetails : null,
    }, { onConflict: 'node_id' })

    if (error) {
      console.warn('[updateNodeDetails]', error.message)
      return
    }

    pushHistory(`更新「${node.name}」详情`, async () => {
      if (hadAnnotation) {
        await writeDetails(prevDetails)
      } else {
        await supabase.from('node_annotations').delete()
          .eq('node_id', nodeId)
          .eq('user_id', user.id)
      }
    }, async () => {
      await writeDetails(nextDetails)
    })

    await loadNodes()
  }, [user, treeData, loadNodes, pushHistory])

  const deleteNode = useCallback(async (nodeId) => {
    if (!user) return
    const snapshot = collectSubtree(treeData, nodeId)
    const nodeName = snapshot[0]?.name || nodeId

    // 从最深子节点开始删，避免 FK 约束报错
    const sorted = sortByDepthDesc(snapshot)
    for (const n of sorted) {
      const { error } = await supabase.from('nodes').delete()
        .eq('id', n.id).eq('user_id', user.id)
      if (error) console.error('[deleteNode]', n.name, error.message)
    }

    pushHistory(`删除「${nodeName}」`, async () => {
      const toInsert = sortByParentFirst(snapshot).map(stripRuntimeNodeFields)
      await supabase.from('nodes').insert(toInsert)
    }, async () => {
      for (const n of sorted) {
        await supabase.from('nodes').delete()
          .eq('id', n.id).eq('user_id', user.id)
      }
    })

    await loadNodes()
  }, [user, treeData, loadNodes, pushHistory])

  // ── 移动节点到另一父节点 ──────────────────────────────

  const moveNode = useCallback(async (nodeId, targetParentId) => {
    if (!user || !nodeId || !targetParentId || nodeId === targetParentId) return

    const node = findNodeById(treeData, nodeId)
    if (!node) return

    // 环形引用检测：目标不能是源的子孙
    const isDescendant = (parent, childId) => {
      if (!parent.children) return false
      for (const c of parent.children) {
        if (c.id === childId || isDescendant(c, childId)) return true
      }
      return false
    }
    if (isDescendant(node, targetParentId)) {
      alert('不能将节点移动到其子节点下')
      return
    }

    const prevParentId = node.parent_id || null
    if (prevParentId === targetParentId) return

    // 1. 乐观更新本地树：先把这一支从旧位置剪下来，再挂到新父下
    //    这样 UI 立刻反映新结构，不会闪烁、不会丢 expand 状态
    setTreeData(prev => prev ? moveSubtreeInTree(prev, nodeId, targetParentId) : prev)

    // 2. 后台异步写库；失败再回滚 UI
    const { error } = await supabase
      .from('nodes')
      .update({ parent_id: targetParentId })
      .eq('id', nodeId)
      .eq('user_id', user.id)

    if (error) {
      console.error('[moveNode]', error.message)
      alert(`移动失败：${error.message}`)
      // 回滚
      setTreeData(prev => prev ? moveSubtreeInTree(prev, nodeId, prevParentId) : prev)
      return
    }

    pushHistory(`移动「${node.name}」`, async () => {
      await supabase.from('nodes').update({ parent_id: prevParentId }).eq('id', nodeId).eq('user_id', user.id)
      setTreeData(prev => prev ? moveSubtreeInTree(prev, nodeId, prevParentId) : prev)
    }, async () => {
      await supabase.from('nodes').update({ parent_id: targetParentId }).eq('id', nodeId).eq('user_id', user.id)
      setTreeData(prev => prev ? moveSubtreeInTree(prev, nodeId, targetParentId) : prev)
    })
  }, [user, treeData, pushHistory])

  // ── 调整同级节点顺序 ─────────────────────────────────

  const reorderNode = useCallback(async (nodeId, targetSiblingId, placement = 'after') => {
    if (!user || !nodeId || !targetSiblingId || nodeId === targetSiblingId) return

    const node = findNodeById(treeData, nodeId)
    const target = findNodeById(treeData, targetSiblingId)
    if (!node || !target) return

    const parentId = node.parent_id || null
    if ((target.parent_id || null) !== parentId) return

    const siblings = getSiblingNodes(treeData, parentId)
    if (!siblings.some(s => s.id === nodeId) || !siblings.some(s => s.id === targetSiblingId)) return

    const prevOrder = siblings.map(s => ({ id: s.id, position: s.position ?? 0 }))
    const nextIds = reorderSiblingIds(siblings.map(s => s.id), nodeId, targetSiblingId, placement)
    const prevIds = prevOrder.map(s => s.id)
    if (nextIds.join('|') === prevIds.join('|')) return

    const nextPositions = nextIds.map((id, index) => ({
      id,
      position: (index + 1) * 1000,
    }))

    setTreeData(prev => prev ? reorderSiblingsInTree(prev, parentId, nextPositions) : prev)

    const updates = nextPositions.map(item =>
      supabase
        .from('nodes')
        .update({ position: item.position })
        .eq('id', item.id)
        .eq('user_id', user.id)
    )
    const results = await Promise.all(updates)
    const firstError = results.find(result => result.error)?.error

    if (firstError) {
      console.error('[reorderNode]', firstError.message)
      alert(`调整顺序失败：${firstError.message}`)
      setTreeData(prev => prev ? reorderSiblingsInTree(prev, parentId, prevOrder) : prev)
      await Promise.all(prevOrder.map(item =>
        supabase
          .from('nodes')
          .update({ position: item.position })
          .eq('id', item.id)
          .eq('user_id', user.id)
      ))
      return
    }

    pushHistory(`调整「${node.name}」顺序`, async () => {
      await Promise.all(prevOrder.map(item =>
        supabase
          .from('nodes')
          .update({ position: item.position })
          .eq('id', item.id)
          .eq('user_id', user.id)
      ))
    }, async () => {
      await Promise.all(nextPositions.map(item =>
        supabase
          .from('nodes')
          .update({ position: item.position })
          .eq('id', item.id)
          .eq('user_id', user.id)
      ))
    })
  }, [user, treeData, pushHistory])

  // ── 清空所有（clear_all）─────────────────────────────

  const clearAll = useCallback(async () => {
    if (!user) return
    const { data: allNodes, error: fetchErr } = await supabase
      .from('nodes').select('*').eq('user_id', user.id)

    if (fetchErr) { console.error('[clearAll] fetch:', fetchErr.message); return }
    if (!allNodes?.length) return

    // 从最深子节点开始删，避免父节点被先删时 FK 报错
    const sorted = sortByDepthDesc(allNodes)
    for (const n of sorted) {
      const { error } = await supabase.from('nodes').delete()
        .eq('id', n.id).eq('user_id', user.id)
      if (error) console.error('[clearAll] delete', n.name, ':', error.message)
    }

    pushHistory('清空所有项目', async () => {
      const toInsert = sortByParentFirst(allNodes).map(stripRuntimeNodeFields)
      const { error } = await supabase.from('nodes').insert(toInsert)
      if (error) console.error('[clearAll] undo:', error.message)
    }, async () => {
      const redoSorted = sortByDepthDesc(allNodes)
      for (const n of redoSorted) {
        await supabase.from('nodes').delete()
          .eq('id', n.id).eq('user_id', user.id)
      }
    })

    await loadNodes()
  }, [user, loadNodes, pushHistory])

  // ── 权重更新 ──────────────────────────────────────────

  const updateWeight = useCallback(async (nodeId, weight) => {
    if (!user) return
    const node = findNodeById(treeData, nodeId)
    const prevWeight = node?.weight ?? 1.0
    const nextWeight = Number.isFinite(Number(weight)) ? Math.max(0, Math.min(2, Number(weight))) : prevWeight

    setTreeData(prev => prev ? updateNodeWeightInTree(prev, nodeId, nextWeight) : prev)

    const { error } = await supabase
      .from('nodes')
      .update({ weight: nextWeight })
      .eq('id', nodeId)
      .eq('user_id', user.id)

    if (error) {
      console.error('[updateWeight]', error.message)
      alert(`调整权重失败：${error.message}`)
      setTreeData(prev => prev ? updateNodeWeightInTree(prev, nodeId, prevWeight) : prev)
      return
    }

    pushHistory(`调整「${node?.name}」权重`, async () => {
      await supabase.from('nodes').update({ weight: prevWeight }).eq('id', nodeId).eq('user_id', user.id)
      setTreeData(prev => prev ? updateNodeWeightInTree(prev, nodeId, prevWeight) : prev)
    }, async () => {
      await supabase.from('nodes').update({ weight: nextWeight }).eq('id', nodeId).eq('user_id', user.id)
      setTreeData(prev => prev ? updateNodeWeightInTree(prev, nodeId, nextWeight) : prev)
    })

    await loadNodes()
  }, [user, treeData, loadNodes, pushHistory])

  return {
    treeData, loading, density, setDensity, leafView, setLeafView,
    expandAll, collapseAll, toggleNode,
    addNode, renameNode, updateStatus, deleteNode, clearAll, updateWeight, moveNode, reorderNode,
    annotateNode, updateNodeDetails,
    reload: loadNodes,
    // 历史
    history,
    future,
    canUndo: history.length > 0,
    canRedo: future.length > 0,
    lastAction: history[history.length - 1]?.label || null,
    nextAction: future[future.length - 1]?.label || null,
    undo,
    redo,
  }
}

// ── 本地树操作 ────────────────────────────────────────

function setAllExpanded(node, value) {
  return { ...node, expanded: value, children: node.children?.map(c => setAllExpanded(c, value)) }
}
function toggleExpanded(node, id) {
  if (node.id === id) return { ...node, expanded: !node.expanded }
  return { ...node, children: node.children?.map(c => toggleExpanded(c, id)) }
}

function updateNodeWeightInTree(node, nodeId, weight) {
  if (node.id === nodeId) return { ...node, weight }
  if (!node.children?.length) return node
  return { ...node, children: node.children.map(c => updateNodeWeightInTree(c, nodeId, weight)) }
}

/**
 * 把整个 subtree 从原父下剪掉，挂到新父下（targetParentId）。
 * 不修改子树本身的结构、不重置 expand 状态。targetParentId 为 null 时挂到根。
 * 返回新的 tree（不可变）。
 */
function moveSubtreeInTree(tree, nodeId, targetParentId) {
  let extracted = null

  function cut(node) {
    if (!node.children?.length) return node
    const nextChildren = []
    for (const c of node.children) {
      if (c.id === nodeId) {
        extracted = c
        continue
      }
      nextChildren.push(cut(c))
    }
    return { ...node, children: nextChildren }
  }

  function paste(node) {
    if (!extracted) return node
    const isTarget = (targetParentId == null && node.id === 'root') || node.id === targetParentId
    if (isTarget) {
      const updatedChild = { ...extracted, parent_id: targetParentId ?? null }
      const newChildren = [...(node.children || []), updatedChild]
      return { ...node, children: newChildren, expanded: true }
    }
    if (!node.children?.length) return node
    return { ...node, children: node.children.map(paste) }
  }

  if (!tree) return tree
  const cutTree = cut(tree)
  if (!extracted) return tree
  return paste(cutTree)
}

function getSiblingNodes(tree, parentId) {
  if (!tree) return []
  const targetParentId = parentId ?? 'root'

  function walk(node) {
    const isTarget = (parentId == null && node.id === 'root') || node.id === targetParentId
    if (isTarget) return node.children || []
    for (const child of node.children || []) {
      const found = walk(child)
      if (found) return found
    }
    return null
  }

  return walk(tree) || []
}

function reorderSiblingIds(ids, nodeId, targetSiblingId, placement) {
  const withoutSource = ids.filter(id => id !== nodeId)
  const targetIndex = withoutSource.indexOf(targetSiblingId)
  if (targetIndex < 0) return ids
  const insertIndex = placement === 'before' ? targetIndex : targetIndex + 1
  const next = [...withoutSource]
  next.splice(insertIndex, 0, nodeId)
  return next
}

function reorderSiblingsInTree(tree, parentId, orderedPositions) {
  const positionById = new Map(orderedPositions.map(item => [item.id, item.position]))
  const orderById = new Map(orderedPositions.map((item, index) => [item.id, index]))
  const targetParentId = parentId ?? 'root'

  function walk(node) {
    const isTarget = (parentId == null && node.id === 'root') || node.id === targetParentId
    if (isTarget) {
      const children = [...(node.children || [])]
        .map(child => positionById.has(child.id)
          ? { ...child, position: positionById.get(child.id) }
          : child
        )
        .sort((a, b) => {
          const aOrder = orderById.has(a.id) ? orderById.get(a.id) : Number.MAX_SAFE_INTEGER
          const bOrder = orderById.has(b.id) ? orderById.get(b.id) : Number.MAX_SAFE_INTEGER
          if (aOrder !== bOrder) return aOrder - bOrder
          return (a.position ?? 0) - (b.position ?? 0)
        })
      return { ...node, children }
    }
    if (!node.children?.length) return node
    return { ...node, children: node.children.map(walk) }
  }

  return walk(tree)
}

// ── 新用户示例数据 ────────────────────────────────────

async function seedSampleData(userId) {
  const now = new Date().toISOString()

  // 新用户只创建一个示例项目作为引导，保持界面干净
  const { data: projects } = await supabase.from('nodes').insert([
    { user_id: userId, name: '我的第一个项目', type: 'project', color: '#4A8C5C', weight: 1.0, status: 'active', position: 1, expanded: true, last_active_at: now },
  ]).select('id')

  if (!projects?.[0]) return
  const p1 = projects[0].id

  await supabase.from('nodes').insert([
    { user_id: userId, parent_id: p1, name: '点击右键可以添加子任务', type: 'task', status: 'active', weight: 0.8, position: 1, expanded: true, last_active_at: now },
    { user_id: userId, parent_id: p1, name: '告诉 AI「我完成了 XX」它会帮你更新', type: 'task', status: 'active', weight: 0.6, position: 2, expanded: true, last_active_at: now },
  ])
}
