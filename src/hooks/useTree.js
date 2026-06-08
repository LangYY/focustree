import { useState, useCallback, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import {
  flatToTree,
  findNodeById,
  collectSubtree,
  sortByParentFirst,
  sortByDepthDesc,
  flattenTree,
  normalizeCurrentPriority,
  normalizeTargetCompletionDate,
  SAMPLE_DATA,
} from '../lib/treeUtils'

const MAX_HISTORY = 30

function stripRuntimeNodeFields(node) {
  const raw = { ...node }
  delete raw.children
  delete raw.annotations
  return raw
}

async function restoreAnnotations(nodes, userId) {
  const rows = (nodes || [])
    .map(node => node.annotations ? {
      ...node.annotations,
      node_id: node.id,
      user_id: userId,
    } : null)
    .filter(Boolean)
  if (!rows.length) return
  const { error } = await supabase.from('node_annotations').upsert(rows, { onConflict: 'node_id' })
  if (error) console.warn('[restoreAnnotations]', error.message)
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

  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => {
      if (!cancelled) loadNodes()
    })
    return () => { cancelled = true }
  }, [loadNodes])

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
  }, [history])

  const redo = useCallback(async () => {
    if (!future.length) return
    const next = future[future.length - 1]
    if (!next.redoFn) return
    setFuture(prev => prev.slice(0, -1))
    await next.redoFn()
    setHistory(prev => [...prev.slice(-(MAX_HISTORY - 1)), next])
  }, [future])

  // ── 展开/折叠：内存先变，DB 异步 fire-and-forget ─────
  // 关键：必须持久化，否则手动 reload/重新打开页面后会重置回 DB 状态

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
      setTreeData(prev => prev ? updateNodeFieldsInTree(prev, nodeId, {
        status: prevStatus,
        completed_at: prevCompleted,
      }) : prev)
    }, async () => {
      await supabase.from('nodes').update({
        status,
        completed_at: nextCompleted,
      }).eq('id', nodeId).eq('user_id', user.id)
      setTreeData(prev => prev ? updateNodeFieldsInTree(prev, nodeId, {
        status,
        completed_at: nextCompleted,
        last_active_at: nowIso,
      }) : prev)
    })

    setTreeData(prev => prev ? updateNodeFieldsInTree(prev, nodeId, {
      status,
      completed_at: nextCompleted,
      last_active_at: nowIso,
    }) : prev)
  }, [user, treeData, pushHistory])

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
      setTreeData(prev => prev ? updateNodeFieldsInTree(prev, nodeId, { name: prevName }) : prev)
    }, async () => {
      await supabase.from('nodes').update({ name: nextName }).eq('id', nodeId).eq('user_id', user.id)
      setTreeData(prev => prev ? updateNodeFieldsInTree(prev, nodeId, { name: nextName }) : prev)
    })

    setTreeData(prev => prev ? updateNodeFieldsInTree(prev, nodeId, { name: nextName }) : prev)
  }, [user, treeData, pushHistory])

  // ── 新增节点（可带 AI 自动生成的 annotations）────────

  const addNode = useCallback(async ({ name, type, parentId, color, annotations, weight, current_priority, target_completion_date }) => {
    if (!user) return
    const nodeWeight = typeof weight === 'number' ? Math.max(0, Math.min(2, weight)) : 1.0
    const nodePriority = normalizeCurrentPriority(current_priority)
    const nodeTargetDate = normalizeTargetCompletionDate(target_completion_date)
    const insertPayload = {
      user_id: user.id,
      parent_id: parentId || null,
      name: name.trim(),
      type, color: color || null,
      status: 'active', weight: nodeWeight,
      expanded: true, position: Date.now(),
      last_active_at: new Date().toISOString(),
    }
    if (nodePriority) insertPayload.current_priority = nodePriority
    if (nodeTargetDate) insertPayload.target_completion_date = nodeTargetDate
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
      const localNode = { ...insertedNode, annotations: insertedAnnotation, children: [] }

      pushHistory(`添加「${name}」`, async () => {
        await supabase.from('nodes').delete().eq('id', newId).eq('user_id', user.id)
        setTreeData(prev => removeNodeFromTree(prev, newId))
      }, async () => {
        await supabase.from('nodes').insert(stripRuntimeNodeFields(localNode))
        if (insertedAnnotation) {
          await supabase.from('node_annotations').upsert(insertedAnnotation, { onConflict: 'node_id' })
        }
        setTreeData(prev => insertNodeInTree(prev, localNode))
      })
      setTreeData(prev => insertNodeInTree(prev, localNode))
    }

    return newId
  }, [user, pushHistory])

  // ── 给已有节点打/改策略标签 ──────────────────────────

  const annotateNode = useCallback(async (nodeId, annotations) => {
    if (!user || !nodeId || !annotations) return
    const annotationPayload = {
      node_id: nodeId,
      user_id: user.id,
      roi_type:      annotations.roi_type      || null,
      time_horizon:  annotations.time_horizon  || null,
      energy_cost:   annotations.energy_cost   || null,
      feasibility:   annotations.feasibility   ?? null,
      risk:          annotations.risk          || null,
      strategic_tag: annotations.strategic_tag || null,
      ai_notes:      annotations.ai_notes      || null,
    }
    const { error } = await supabase.from('node_annotations').upsert(annotationPayload, { onConflict: 'node_id' })
    if (error) console.warn('[annotateNode]', error.message)
    setTreeData(prev => prev ? updateNodeAnnotationInTree(prev, nodeId, annotationPayload) : prev)
  }, [user])

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
        setTreeData(prev => prev ? updateNodeAnnotationInTree(prev, nodeId, { ai_notes: prevDetails || null }) : prev)
      } else {
        await supabase.from('node_annotations').delete()
          .eq('node_id', nodeId)
          .eq('user_id', user.id)
        setTreeData(prev => prev ? updateNodeAnnotationInTree(prev, nodeId, null) : prev)
      }
    }, async () => {
      await writeDetails(nextDetails)
      setTreeData(prev => prev ? updateNodeAnnotationInTree(prev, nodeId, { ai_notes: nextDetails.trim() ? nextDetails : null }) : prev)
    })

    setTreeData(prev => prev ? updateNodeAnnotationInTree(prev, nodeId, { ai_notes: nextDetails.trim() ? nextDetails : null }) : prev)
  }, [user, treeData, pushHistory])

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
      await restoreAnnotations(snapshot, user.id)
      setTreeData(prev => insertFlatNodesInTree(prev, snapshot))
    }, async () => {
      for (const n of sorted) {
        await supabase.from('nodes').delete()
          .eq('id', n.id).eq('user_id', user.id)
      }
      setTreeData(prev => removeNodeFromTree(prev, nodeId))
    })

    setTreeData(prev => removeNodeFromTree(prev, nodeId))
  }, [user, treeData, pushHistory])

  const deleteNodeOnly = useCallback(async (nodeId) => {
    if (!user) return
    const node = findNodeById(treeData, nodeId)
    if (!node || node.type === 'root' || !node.children?.length) return

    const parentId = node.parent_id || null
    const directChildren = [...(node.children || [])]
    const childIds = new Set(directChildren.map(child => child.id))
    const siblings = getSiblingNodes(treeData, parentId)
    const prevSiblingPositions = siblings.map(sibling => ({
      id: sibling.id,
      position: sibling.position ?? 0,
    }))
    const childSnapshots = directChildren.map(child => ({
      id: child.id,
      parent_id: child.parent_id || null,
      position: child.position ?? 0,
    }))
    const nextOrderIds = []
    siblings.forEach(sibling => {
      if (sibling.id === nodeId) {
        directChildren.forEach(child => nextOrderIds.push(child.id))
      } else {
        nextOrderIds.push(sibling.id)
      }
    })
    const nextPositions = nextOrderIds.map((id, index) => ({
      id,
      position: (index + 1) * 1000,
    }))
    const treeBefore = treeData
    const treeAfter = deleteNodeOnlyFromTree(treeData, nodeId, nextPositions)

    const applyDeleteOnly = async () => {
      const updates = nextPositions.map(item => {
        const payload = { position: item.position }
        if (childIds.has(item.id)) payload.parent_id = parentId
        return supabase
          .from('nodes')
          .update(payload)
          .eq('id', item.id)
          .eq('user_id', user.id)
      })
      const updateResults = await Promise.all(updates)
      const firstUpdateError = updateResults.find(result => result.error)?.error
      if (firstUpdateError) return firstUpdateError

      const { error: deleteError } = await supabase
        .from('nodes')
        .delete()
        .eq('id', nodeId)
        .eq('user_id', user.id)
      return deleteError || null
    }

    const restoreDeletedNode = async () => {
      await supabase.from('nodes').insert(stripRuntimeNodeFields(node))
      await restoreAnnotations([node], user.id)
      await Promise.all(childSnapshots.map(child =>
        supabase
          .from('nodes')
          .update({ parent_id: child.parent_id, position: child.position })
          .eq('id', child.id)
          .eq('user_id', user.id)
      ))
      await Promise.all(prevSiblingPositions.map(item =>
        supabase
          .from('nodes')
          .update({ position: item.position })
          .eq('id', item.id)
          .eq('user_id', user.id)
      ))
    }

    const error = await applyDeleteOnly()
    if (error) {
      console.error('[deleteNodeOnly]', error.message)
      alert(`删除当前节点失败：${error.message}`)
      return
    }

    pushHistory(`只删除「${node.name}」`, async () => {
      await restoreDeletedNode()
      setTreeData(treeBefore)
    }, async () => {
      await applyDeleteOnly()
      setTreeData(treeAfter)
    })

    setTreeData(treeAfter)
  }, [user, treeData, pushHistory])

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
      setTreeData(prev => prev ? reorderSiblingsInTree(prev, parentId, prevOrder) : prev)
    }, async () => {
      await Promise.all(nextPositions.map(item =>
        supabase
          .from('nodes')
          .update({ position: item.position })
          .eq('id', item.id)
          .eq('user_id', user.id)
      ))
      setTreeData(prev => prev ? reorderSiblingsInTree(prev, parentId, nextPositions) : prev)
    })
  }, [user, treeData, pushHistory])

  // ── 清空所有（clear_all）─────────────────────────────

  const clearAll = useCallback(async () => {
    if (!user) return
    const treeSnapshot = treeData
    const annotationSnapshot = treeSnapshot ? flattenTree(treeSnapshot).filter(n => n.type !== 'root' && n.annotations) : []
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
      await restoreAnnotations(annotationSnapshot, user.id)
      setTreeData(treeSnapshot)
    }, async () => {
      const redoSorted = sortByDepthDesc(allNodes)
      for (const n of redoSorted) {
        await supabase.from('nodes').delete()
          .eq('id', n.id).eq('user_id', user.id)
      }
      setTreeData(null)
    })

    setTreeData(null)
  }, [user, treeData, pushHistory])

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
  }, [user, treeData, pushHistory])

  const updateNodePlanning = useCallback(async (nodeId, fields) => {
    if (!user || !nodeId || !fields) return
    const node = findNodeById(treeData, nodeId)
    if (!node || node.type === 'root') return

    const nextFields = {}
    if (Object.prototype.hasOwnProperty.call(fields, 'current_priority')) {
      nextFields.current_priority = normalizeCurrentPriority(fields.current_priority)
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'target_completion_date')) {
      nextFields.target_completion_date = normalizeTargetCompletionDate(fields.target_completion_date)
    }
    const changedKeys = Object.keys(nextFields)
      .filter(key => (node[key] || null) !== (nextFields[key] || null))
    if (!changedKeys.length) return

    const prevFields = Object.fromEntries(changedKeys.map(key => [key, node[key] || null]))
    const changedFields = Object.fromEntries(changedKeys.map(key => [key, nextFields[key]]))
    const nowIso = new Date().toISOString()

    setTreeData(prev => prev ? updateNodeFieldsInTree(prev, nodeId, {
      ...changedFields,
      last_active_at: nowIso,
    }) : prev)

    const { error } = await supabase
      .from('nodes')
      .update({
        ...changedFields,
        last_active_at: nowIso,
      })
      .eq('id', nodeId)
      .eq('user_id', user.id)

    if (error) {
      console.error('[updateNodePlanning]', error.message)
      alert(`规划信息保存失败：${error.message}`)
      setTreeData(prev => prev ? updateNodeFieldsInTree(prev, nodeId, prevFields) : prev)
      throw error
    }

    const label = changedKeys.includes('target_completion_date') && changedKeys.includes('current_priority')
      ? '规划信息'
      : changedKeys.includes('target_completion_date') ? '目标日期' : '优先级'

    pushHistory(`更新「${node.name}」${label}`, async () => {
      await supabase.from('nodes').update(prevFields).eq('id', nodeId).eq('user_id', user.id)
      setTreeData(prev => prev ? updateNodeFieldsInTree(prev, nodeId, prevFields) : prev)
    }, async () => {
      await supabase.from('nodes').update(changedFields).eq('id', nodeId).eq('user_id', user.id)
      setTreeData(prev => prev ? updateNodeFieldsInTree(prev, nodeId, changedFields) : prev)
    })
  }, [user, treeData, pushHistory])

  return {
    treeData, loading, density, setDensity, leafView, setLeafView,
    expandAll, collapseAll, toggleNode,
    addNode, renameNode, updateStatus, deleteNode, deleteNodeOnly, clearAll, updateWeight, moveNode, reorderNode,
    annotateNode, updateNodeDetails, updateNodePlanning,
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

function updateNodeFieldsInTree(node, nodeId, fields) {
  if (!node) return node
  if (node.id === nodeId) return { ...node, ...fields }
  if (!node.children?.length) return node
  return { ...node, children: node.children.map(c => updateNodeFieldsInTree(c, nodeId, fields)) }
}

function updateNodeAnnotationInTree(node, nodeId, annotation) {
  if (!node) return node
  if (node.id === nodeId) {
    if (annotation === null) return { ...node, annotations: null }
    return {
      ...node,
      annotations: {
        ...(node.annotations || {}),
        ...annotation,
        node_id: nodeId,
        updated_at: new Date().toISOString(),
      },
    }
  }
  if (!node.children?.length) return node
  return { ...node, children: node.children.map(c => updateNodeAnnotationInTree(c, nodeId, annotation)) }
}

function insertNodeInTree(tree, nodeToInsert) {
  const normalized = {
    ...nodeToInsert,
    children: nodeToInsert.children || [],
  }
  const parentId = normalized.parent_id || null
  const root = tree || { id: 'root', type: 'root', children: [] }

  function walk(node) {
    const isTarget = (parentId == null && node.id === 'root') || node.id === parentId
    if (isTarget) {
      const withoutDuplicate = (node.children || []).filter(child => child.id !== normalized.id)
      const children = [...withoutDuplicate, normalized]
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      return { ...node, children, expanded: true }
    }
    if (!node.children?.length) return node
    return { ...node, children: node.children.map(walk) }
  }

  return walk(root)
}

function insertFlatNodesInTree(tree, nodes) {
  return sortByParentFirst(nodes || []).reduce((nextTree, node) => {
    const normalized = {
      ...node,
      children: [],
    }
    return insertNodeInTree(nextTree, normalized)
  }, tree || { id: 'root', type: 'root', children: [] })
}

function removeNodeFromTree(tree, nodeId) {
  if (!tree || !nodeId) return tree
  if (tree.id === nodeId) return null
  if (!tree.children?.length) return tree
  return {
    ...tree,
    children: tree.children
      .filter(child => child.id !== nodeId)
      .map(child => removeNodeFromTree(child, nodeId))
      .filter(Boolean),
  }
}

function deleteNodeOnlyFromTree(tree, nodeId, orderedPositions = []) {
  if (!tree || !nodeId) return tree
  const positionById = new Map(orderedPositions.map(item => [item.id, item.position]))

  function walk(node) {
    if (!node.children?.length) return node
    const nextChildren = []
    let changed = false

    for (const child of node.children) {
      if (child.id === nodeId) {
        changed = true
        const promotedChildren = (child.children || []).map(grandchild => ({
          ...grandchild,
          parent_id: node.id === 'root' ? null : node.id,
          position: positionById.get(grandchild.id) ?? grandchild.position,
        }))
        nextChildren.push(...promotedChildren)
      } else {
        const nextChild = walk(child)
        const positionedChild = positionById.has(nextChild.id)
          ? { ...nextChild, position: positionById.get(nextChild.id) }
          : nextChild
        if (positionedChild !== child) changed = true
        nextChildren.push(positionedChild)
      }
    }

    if (!changed) return node
    return {
      ...node,
      children: nextChildren.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    }
  }

  return walk(tree)
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
