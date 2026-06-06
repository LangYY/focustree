import { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import {
  getNodeRadius,
  getNodeColor,
  getLinkStrokeWidth,
  findNodeById,
  getDerivedWeightMetaMap,
  getDerivedWeightMeta,
} from '../../lib/treeUtils'
import ContextMenu from './ContextMenu'
import NodeTooltip from './NodeTooltip'

const MARGIN = { top: 20, right: 120, bottom: 20, left: 60 }
const NODE_H_GAP = 220
const NODE_V_GAP = 48
const DRAG_THRESHOLD = 4
const DROP_LABEL_WIDTH = 180
const DROP_HIT_PADDING = 14
const NODE_HIT_PADDING = 6
const ADD_CHILD_DRAG_MIN_X = 28

function shouldShowLabel(node, density) {
  const data = node?.data || node
  if (data?.type === 'root') return false
  if (density === 'dense') return true
  if (density === 'medium') return data?.type !== 'task'
  return data?.type === 'project'
}

function childTypeFor(node) {
  const data = node?.data || node
  return data?.type === 'project' ? 'category' : 'task'
}

function isRightAddGesture(startX, startY, endX, endY) {
  const dx = endX - startX
  const dy = Math.abs(endY - startY)
  return dx >= ADD_CHILD_DRAG_MIN_X && dx >= dy * 0.7
}

function dragPreviewPath(startX, startY, endX, endY) {
  const midX = startX + (endX - startX) * 0.5
  return `M${startX},${startY} C${midX},${startY} ${midX},${endY} ${endX},${endY}`
}

/** 算节点下面有多少子孙（不含自己） */
function countDescendants(node) {
  if (!node?.children?.length) return 0
  let n = 0
  for (const c of node.children) n += 1 + countDescendants(c)
  return n
}

function assignCumulativeFlow(root, userGoal) {
  const metaById = getDerivedWeightMetaMap(root.data, { userGoal })
  root.eachBefore(node => {
    const meta = getDerivedWeightMeta(metaById, node.data)
    node.__flow = meta?.flow ?? 1
    node.__localShare = meta?.localShare ?? 1
    node.__branchPressure = meta?.branchPressure ?? 0.1
    node.__goalFit = meta?.goalFit ?? 0.5
    node.__completeness = meta?.completeness ?? 1
    node.__missingSlots = meta?.missingSlots ?? []
    node.__recommendationRank = meta?.recommendationRank ?? 0
    node.__urgency = meta?.urgency ?? 0
  })
}

function linkStrokeWidth(d) {
  return getLinkStrokeWidth(d?.target?.__flow)
}

function applyLinkStrokeWidth(selection, extra = 0) {
  selection
    .attr('stroke-width', d => linkStrokeWidth(d) + extra)
    .style('stroke-width', d => `${linkStrokeWidth(d) + extra}px`)
}

function withDerivedWeightMeta(hNode) {
  if (!hNode?.data) return null
  return {
    ...hNode.data,
    __flow: hNode.__flow,
    __localShare: hNode.__localShare,
    __branchPressure: hNode.__branchPressure,
    __goalFit: hNode.__goalFit,
    __completeness: hNode.__completeness,
    __missingSlots: hNode.__missingSlots,
    __recommendationRank: hNode.__recommendationRank,
    __urgency: hNode.__urgency,
  }
}

function isTypingTarget(element) {
  const tag = element?.tagName?.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || element?.isContentEditable
}

export default function TreeView({ treeData, userGoal, density, onNodeSelect, onNodeToggle, onContextAction, resetZoomRef, highlightedNodeId, onLeafAdd, onDropBranch, onRenameNode }) {
  const svgRef  = useRef(null)
  const gRef    = useRef(null)
  const zoomRef = useRef(null)
  const rootRef = useRef(null)   // 缓存 d3 hierarchy root，供高亮 effect 使用
  const treeDataRef = useRef(treeData)
  const autoCenteredRef = useRef(false)

  const [contextMenu, setContextMenu] = useState(null)  // { x, y, node }
  const [tooltip, setTooltip]         = useState(null)  // { x, y, node }
  const [editingNode, setEditingNode] = useState(null)  // { id, name, left, top, width }
  const dragRef      = useRef({})  // { node, startX, startY, dragging, sourceEl, pointerId }
  const suppressClickRef = useRef(false)
  const addDisabledRef = useRef(false)
  const addClickTimerRef = useRef(null)
  const onDropRef    = useRef(onDropBranch)
  const onLeafAddRef = useRef(onLeafAdd)
  const onRenameRef  = useRef(onRenameNode)
  const onNodeSelectRef = useRef(onNodeSelect)
  const onNodeToggleRef = useRef(onNodeToggle)
  const renameCancelledRef = useRef(false)
  const densityRef = useRef(density)
  useEffect(() => { treeDataRef.current = treeData }, [treeData])
  useEffect(() => { densityRef.current = density }, [density])
  useEffect(() => { onDropRef.current = onDropBranch }, [onDropBranch])
  useEffect(() => { onLeafAddRef.current = onLeafAdd }, [onLeafAdd])
  useEffect(() => { onRenameRef.current = onRenameNode }, [onRenameNode])
  useEffect(() => { onNodeSelectRef.current = onNodeSelect }, [onNodeSelect])
  useEffect(() => { onNodeToggleRef.current = onNodeToggle }, [onNodeToggle])
  useEffect(() => () => {
    if (addClickTimerRef.current) window.clearTimeout(addClickTimerRef.current)
  }, [])

  const startInlineRename = useCallback((hNode, event) => {
    const nodeData = hNode?.data || hNode
    if (!nodeData?.id || nodeData.type === 'root') return

    event?.preventDefault?.()
    event?.stopPropagation?.()
    setContextMenu(null)
    setTooltip(null)
    renameCancelledRef.current = false

    const nodeEl = gRef.current?.querySelector(`.node[data-node-id="${nodeData.id}"]`)
    const labelEl = nodeEl?.querySelector?.('.node-label')
    const rect = labelEl?.getBoundingClientRect?.() || nodeEl?.getBoundingClientRect?.()
    const radius = getNodeRadius(nodeData.type)
    const left = rect
      ? (labelEl ? rect.left - 4 : rect.left + radius + 8)
      : (event?.clientX || 80)
    const top = rect
      ? rect.top + rect.height / 2 - 16
      : (event?.clientY || 80) - 16
    const width = Math.max(160, Math.min(380, String(nodeData.name || '').length * 15 + 48))

    setEditingNode({
      id: nodeData.id,
      name: nodeData.name || '',
      left: Math.max(8, Math.min(left, window.innerWidth - width - 12)),
      top: Math.max(8, Math.min(top, window.innerHeight - 44)),
      width,
    })
  }, [])

  const commitInlineRename = useCallback(async () => {
    const current = editingNode
    if (!current) return
    if (renameCancelledRef.current) {
      renameCancelledRef.current = false
      setEditingNode(null)
      return
    }
    const nextName = current.name.trim()
    setEditingNode(null)
    if (!nextName) return
    const node = rootRef.current?.descendants().find(n => n.data.id === current.id)?.data
    if (node && nextName === node.name) return
    await onRenameRef.current?.(current.id, nextName)
  }, [editingNode])

  const cancelInlineRename = useCallback(() => {
    renameCancelledRef.current = true
    setEditingNode(null)
  }, [])

  // 暴露 resetZoom 给父组件
  const resetZoom = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return
    const svg = d3.select(svgRef.current)
    svg.transition().duration(400).call(zoomRef.current.transform, d3.zoomIdentity)
  }, [])

  useEffect(() => {
    if (resetZoomRef) resetZoomRef.current = resetZoom
  }, [resetZoom, resetZoomRef])

  const handleContextMenuAction = useCallback((action, payload) => {
    if (action === 'rename') {
      const hNode = rootRef.current?.descendants().find(n => n.data.id === payload?.node?.id)
      startInlineRename(hNode || payload?.node)
      return
    }
    onContextAction?.(action, payload)
  }, [onContextAction, startInlineRename])

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (isTypingTarget(event.target) || event.defaultPrevented) return
      if (event.key !== 'F2' && event.key !== 'Enter') return
      const selected = rootRef.current?.descendants().find(n => n.data.id === highlightedNodeId)
      if (!selected || selected.data.type === 'root') return
      event.preventDefault()
      startInlineRename(selected, event)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [highlightedNodeId, startInlineRename])

  // 渲染树
  useEffect(() => {
    if (!treeData || !svgRef.current) {
      autoCenteredRef.current = false
      return
    }

    const height = svgRef.current.clientHeight

    const root = d3.hierarchy(treeData, d => d.expanded === false ? null : d.children)
    assignCumulativeFlow(root, userGoal)
    const treeLayout = d3.tree()
      .nodeSize([NODE_V_GAP, NODE_H_GAP])
      .separation((a, b) => {
        const aR = getNodeRadius(a.data.type)
        const bR = getNodeRadius(b.data.type)
        return (aR + bR) / NODE_V_GAP + 0.5
      })
    treeLayout(root)
    rootRef.current = root

    const nodes = root.descendants()
    const links = root.links()

    const g = d3.select(gRef.current)
    g.selectAll('*').remove()

    // 链接线
    g.selectAll('.link')
      .data(links)
      .join('path')
      .attr('class', 'link')
      .attr('data-target-id', d => d.target.data.id || '')
      .attr('data-flow', d => Number.isFinite(d.target.__flow) ? d.target.__flow.toFixed(4) : '')
      .attr('data-local-share', d => Number.isFinite(d.target.__localShare) ? d.target.__localShare.toFixed(4) : '')
      .attr('data-branch-pressure', d => Number.isFinite(d.target.__branchPressure) ? d.target.__branchPressure.toFixed(2) : '')
      .attr('data-completeness', d => Number.isFinite(d.target.__completeness) ? d.target.__completeness.toFixed(2) : '')
      .attr('data-goal-fit', d => Number.isFinite(d.target.__goalFit) ? d.target.__goalFit.toFixed(2) : '')
      .attr('data-recommendation-rank', d => Number.isFinite(d.target.__recommendationRank) ? d.target.__recommendationRank.toFixed(2) : '')
      .attr('stroke', d =>
        d.source.depth === 0 ? '#374151' : getNodeColor(d.source.data)
      )
      .call(selection => applyLinkStrokeWidth(selection))
      .attr('opacity', 0.45)
      .attr('d', d3.linkHorizontal().x(d => d.y).y(d => d.x))

    // 节点组
    const node = g.selectAll('.node')
      .data(nodes)
      .join('g')
      .attr('class', 'node')
      .attr('data-node-id', d => d.data.id || '')
      .attr('transform', d => `translate(${d.y},${d.x})`)
      .style('cursor', 'pointer')

    // 单击：选中节点
    node.filter(d => d.data.type !== 'root')
      .on('click', (event, d) => {
        event.stopPropagation()
        setContextMenu(null)
        onNodeSelectRef.current?.(withDerivedWeightMeta(d))
      })

    // 双击：折叠/展开
    node.filter(d => d.data.type !== 'root')
      .on('dblclick', (event, d) => {
        event.stopPropagation()
        if (addClickTimerRef.current) {
          window.clearTimeout(addClickTimerRef.current)
          addClickTimerRef.current = null
        }
        onNodeToggleRef.current?.(d.data)
      })

    // 右键：上下文菜单
    node.filter(d => d.data.type !== 'root')
      .on('contextmenu', (event, d) => {
        event.preventDefault()
        event.stopPropagation()
        setContextMenu({ x: event.clientX, y: event.clientY, node: withDerivedWeightMeta(d) })
      })

    // Hover tooltip
    node.filter(d => d.data.type !== 'root')
      .on('mouseover', (event, d) => {
        setTooltip({ x: event.clientX, y: event.clientY, node: withDerivedWeightMeta(d) })
      })
      .on('mousemove', (event) => {
        setTooltip(prev => prev ? { ...prev, x: event.clientX, y: event.clientY } : prev)
      })
      .on('mouseout', () => setTooltip(null))

    // 大 hit area：用于 drop 命中（向右延伸 DROP_LABEL_WIDTH 让 label 区也算）
    // 注意：不参与 drag start，否则会"误抓父节点向右延伸的 label 区"
    node.filter(d => d.data.type !== 'root')
      .append('rect')
      .attr('class', 'node-hit-area')
      .attr('x', d => -getNodeRadius(d.data.type) - NODE_HIT_PADDING)
      .attr('y', d => -getNodeRadius(d.data.type) - NODE_HIT_PADDING)
      .attr('width', d => getNodeRadius(d.data.type) * 2 + NODE_HIT_PADDING + DROP_LABEL_WIDTH)
      .attr('height', d => getNodeRadius(d.data.type) * 2 + NODE_HIT_PADDING * 2)
      .attr('fill', 'transparent')

    // 小 drag handle：紧贴圆点一圈，仅这里能起手拖拽
    // 即使是 task 节点（radius=6），handle 也比纯圆点大一圈，方便抓取
    const DRAG_HANDLE_PADDING = 8
    node.filter(d => d.data.type !== 'root')
      .append('rect')
      .attr('class', 'node-drag-handle')
      .attr('x', d => -getNodeRadius(d.data.type) - DRAG_HANDLE_PADDING)
      .attr('y', d => -getNodeRadius(d.data.type) - DRAG_HANDLE_PADDING)
      .attr('width', d => (getNodeRadius(d.data.type) + DRAG_HANDLE_PADDING) * 2)
      .attr('height', d => (getNodeRadius(d.data.type) + DRAG_HANDLE_PADDING) * 2)
      .attr('fill', 'transparent')
      .style('cursor', 'grab')

    // 圆圈
    node.filter(d => d.data.type !== 'root')
      .append('circle')
      .attr('class', 'node-main-circle')
      .attr('r', d => getNodeRadius(d.data.type))
      .attr('fill', d => getNodeColor(d.data))
      .attr('stroke', '#1f2937')
      .attr('stroke-width', 1.5)
      .style('cursor', 'grab')
      .on('mouseenter', function (event, d) {
        d3.select(this).attr('r', getNodeRadius(d.data.type) * 1.14)
        d3.select(this.parentNode).select('.node-main-plus').attr('opacity', addDisabledRef.current ? 0 : 1)
        d3.select(this.parentNode).select('.node-status-mark').attr('opacity', 0)
      })
      .on('mouseleave', function (event, d) {
        d3.select(this).attr('r', getNodeRadius(d.data.type))
        d3.select(this.parentNode).select('.node-main-plus').attr('opacity', 0)
        d3.select(this.parentNode).select('.node-status-mark').attr('opacity', 1)
      })

    // 完成勾
    node.filter(d => d.data.status === 'done')
      .append('text')
      .attr('class', 'node-status-mark')
      .attr('dy', '0.35em')
      .attr('text-anchor', 'middle')
      .attr('fill', '#0f1117')
      .attr('font-size', d => getNodeRadius(d.data.type) * 0.9)
      .attr('pointer-events', 'none')
      .text('✓')

    // 标签
    node.filter(d => shouldShowLabel(d, density))
      .append('text')
      .attr('class', 'node-label')
      .attr('x', d => getNodeRadius(d.data.type) + 6)
      .attr('dy', '0.35em')
      .attr('fill', '#d1d5db')
      .attr('font-size', d => d.data.type === 'project' ? 13 : 11)
      .attr('font-weight', d => d.data.type === 'project' ? 600 : 400)
      .attr('pointer-events', 'auto')
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        event.stopPropagation()
        setContextMenu(null)
        onNodeSelectRef.current?.(withDerivedWeightMeta(d))
      })
      .on('dblclick', (event, d) => {
        event.stopPropagation()
        onNodeToggleRef.current?.(d.data)
      })
      .text(d => d.data.name)

    // 居中定位
    const xs = nodes.map(d => d.y)
    const ys = nodes.map(d => d.x)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const treeH = maxY - minY
    const offsetX = MARGIN.left - Math.min(...xs)
    const offsetY = (height - treeH) / 2 - minY + 30
    if (!autoCenteredRef.current) {
      g.attr('transform', `translate(${offsetX},${offsetY})`)
      autoCenteredRef.current = true
    }

  }, [treeData, userGoal, density, startInlineRename])

  // ── 高亮：监听 highlightedNodeId 变化，更新节点圆圈 + 祖先路径 ──
  useEffect(() => {
    if (!gRef.current) return
    const g = d3.select(gRef.current)

    // 全部复位
    g.selectAll('.node-main-circle')
      .attr('stroke', '#1f2937')
      .attr('stroke-width', 1.5)
      .attr('filter', null)
    g.selectAll('.link')
      .attr('opacity', 0.45)
      .each(function () {
        applyLinkStrokeWidth(d3.select(this))
      })

    if (!highlightedNodeId || !rootRef.current) return

    // 找到目标节点
    const target = rootRef.current.descendants().find(d => d.data.id === highlightedNodeId)
    if (!target) return

    // 高亮目标节点的 circle
    g.selectAll(`.node[data-node-id="${highlightedNodeId}"] .node-main-circle`)
      .attr('stroke', '#60a5fa')
      .attr('stroke-width', 3)
      .attr('filter', 'drop-shadow(0 0 6px rgba(96,165,250,0.7))')

    // 祖先链 → 高亮路径上的 link
    const ancestorIds = new Set(target.ancestors().map(a => a.data.id).filter(Boolean))
    g.selectAll('.link').each(function () {
      const tid = this.getAttribute('data-target-id')
      if (ancestorIds.has(tid)) {
        d3.select(this)
          .attr('opacity', 0.95)
          .each(function () {
            applyLinkStrokeWidth(d3.select(this), 1.5)
          })
      }
    })
  }, [highlightedNodeId, treeData])

  // zoom + pan（分开处理，避免重置位置）
  useEffect(() => {
    if (!svgRef.current || !gRef.current) return
    const svg = d3.select(svgRef.current)

    const zoom = d3.zoom()
      .scaleExtent([0.15, 3])
      .filter((event) => {
        // ✅ 仅允许：pinch 缩放（ctrlKey + wheel）+ 触摸屏 pinch
        // ❌ 禁止：mousedown / pointerdown 触发的拖拽平移
        //         因为 macOS 三指拖拽会变成 mousedown，会被误解为「拖动画布」
        //         平移完全交给 wheel.pan（二指滑动）处理
        if (event.type === 'wheel' && event.ctrlKey) return true
        if (event.type === 'touchstart' || event.type === 'touchmove') {
          // 仅多指触摸（pinch）才允许 zoom；单指 touch 留给节点拖拽
          return event.touches && event.touches.length >= 2
        }
        return false
      })
      .on('zoom', (event) => {
        d3.select(gRef.current).attr('transform', event.transform)
      })

    zoomRef.current = zoom
    svg.call(zoom)

    // 二指滑动 / 鼠标滚轮（无 ctrlKey）→ 平移画布。这是唯一的平移途径。
    svg.on('wheel.pan', (event) => {
      if (event.ctrlKey) return  // pinch 由 d3.zoom 处理
      event.preventDefault()
      svg.call(zoom.translateBy, -event.deltaX, -event.deltaY)
    })

    svg.on('click.bg', () => setContextMenu(null))

    return () => svg.on('.zoom', null).on('click.bg', null).on('wheel.pan', null)
  }, [])

  // 拖拽：SVG 层事件代理，完全独立于 D3 事件系统
  useEffect(() => {
    const svgEl = svgRef.current
    if (!svgEl) return

    const getDropOperation = (clientX, clientY, sourceNode, targetNode) => {
      const sourceParentId = sourceNode?.data?.parent_id || null
      const targetParentId = targetNode?.data?.parent_id || null
      if (sourceParentId === targetParentId) {
        const [, pointerY] = d3.pointer({ clientX, clientY }, gRef.current)
        return {
          mode: 'reorder',
          placement: pointerY <= targetNode.x ? 'before' : 'after',
        }
      }
      return { mode: 'move', placement: null }
    }

    const buildDropTarget = (clientX, clientY, sourceNode, targetNode, el, distance) => ({
      node: targetNode,
      el,
      distance,
      ...getDropOperation(clientX, clientY, sourceNode, targetNode),
    })

    const findBranchDropTarget = (clientX, clientY, sourceNode, sourceEl) => {
      const root = rootRef.current
      if (!root) return null
      const sourceId = sourceNode?.data?.id
      if (!sourceId) return null

      // DOM 命中优先；临时忽略源节点，避免拖回原位或三指拖曳残留命中自己。
      const previousPointerEvents = sourceEl?.style.pointerEvents
      if (sourceEl) sourceEl.style.pointerEvents = 'none'
      try {
        for (const el of document.elementsFromPoint(clientX, clientY)) {
          const nodeEl = el.closest?.('.node')
          const targetId = nodeEl?.getAttribute('data-node-id')
          if (!targetId || targetId === sourceId) continue

          const targetNode = root.descendants().find(n => n.data.id === targetId)
          if (targetNode && targetNode.data.type !== 'root') {
            return buildDropTarget(clientX, clientY, sourceNode, targetNode, nodeEl)
          }
        }
      } finally {
        if (sourceEl) sourceEl.style.pointerEvents = previousPointerEvents
      }

      // 兜底：把屏幕坐标转换到树坐标，只接受落在节点圆点/标签行附近的目标。
      // 三指拖曳有时会让 DOM 栈包含浏览器选区或浮层，这里避免误选上方分支。
      if (!gRef.current) return null
      const [x, y] = d3.pointer({ clientX, clientY }, gRef.current)
      let best = null

      for (const candidate of root.descendants()) {
        if (candidate.data.id === sourceId || candidate.data.type === 'root') continue

        const radius = getNodeRadius(candidate.data.type)
        const dx = x - candidate.y
        const dy = y - candidate.x
        const distance = Math.hypot(dx, dy)
        const onCircle = distance <= radius + DROP_HIT_PADDING
        const onLabelRow =
          x >= candidate.y - radius - DROP_HIT_PADDING &&
          x <= candidate.y + radius + DROP_LABEL_WIDTH &&
          Math.abs(dy) <= radius + DROP_HIT_PADDING

        if ((onCircle || onLabelRow) && (!best || distance < best.distance)) {
          const el = gRef.current.querySelector(`.node[data-node-id="${candidate.data.id}"]`)
          best = buildDropTarget(clientX, clientY, sourceNode, candidate, el, distance)
        }
      }

      return best || null
    }

    const restoreDragStyles = ({ sourceEl, previousBodyUserSelect }) => {
      if (sourceEl) d3.select(sourceEl).attr('opacity', 1).style('cursor', '')
      if (previousBodyUserSelect !== undefined) {
        document.body.style.userSelect = previousBodyUserSelect
      }
      if (dragRef.current.previousBodyWebkitUserSelect !== undefined) {
        document.body.style.webkitUserSelect = dragRef.current.previousBodyWebkitUserSelect
      }
      dragRef.current.previewLine?.remove()
      dragRef.current.previewBadge?.remove()
      dragRef.current.hoverEl && d3.select(dragRef.current.hoverEl).select('.node-main-circle')
        .attr('stroke', '#1f2937').attr('stroke-width', 1.5)
    }

    const disableAddDuringDrag = () => {
      if (addDisabledRef.current) return
      addDisabledRef.current = true
      d3.select(gRef.current).selectAll('.node-main-plus').attr('opacity', 0)
    }

    const scheduleEnableAdd = () => {
      window.setTimeout(() => {
        addDisabledRef.current = false
      }, 180)
    }

    const suppressPostDragClick = () => {
      suppressClickRef.current = true
      window.setTimeout(() => { suppressClickRef.current = false }, 180)
    }

    const startBranchDrag = (event, options) => {
      if (dragRef.current.node) return
      if ('button' in event && event.button !== 0) return

      // 拖拽起手：圆点 或 紧贴圆点的小 drag-handle（task 这种小节点用）
      // 注意：不用 .node-hit-area —— 那个向右延伸到 label 区，
      //       会让"父节点 label 末尾"被误判成抓父节点
      const handleEl =
        event.target.closest?.('.node-main-circle') ||
        event.target.closest?.('.node-drag-handle')
      if (!handleEl) return

      // 找到最近的 .node 容器
      const nodeEl = handleEl.closest?.('.node')
      if (!nodeEl) return
      const nodeId = nodeEl.getAttribute('data-node-id')
      if (!nodeId) return

      // 从缓存 hierarchy 里查
      const hNode = rootRef.current?.descendants().find(n => n.data.id === nodeId)
      if (!hNode || hNode.data.type === 'root') return

      // 阻止浏览器默认行为（文本选中、三指拖拽等）
      event.preventDefault()
      event.stopPropagation()
      window.getSelection?.()?.removeAllRanges?.()

      const startX = hNode.y
      const startY = hNode.x
      const previewLine = d3.select(gRef.current)
        .append('path')
        .attr('class', 'drag-preview-link')
        .attr('d', dragPreviewPath(startX, startY, startX, startY))
        .attr('fill', 'none')
        .attr('stroke', '#60a5fa')
        .attr('stroke-width', 2.5)
        .attr('stroke-linecap', 'round')
        .attr('stroke-dasharray', '5,4')
        .attr('opacity', 0.95)
        .attr('pointer-events', 'none')

      // 统计这个分支带几个子孙——计数用 treeData（含折叠的），不是 D3 hierarchy（不含折叠）
      const fullNode = findNodeById(treeDataRef.current, nodeId)
      const descendantCount = countDescendants(fullNode)
      const previewBadge = d3.select(gRef.current)
        .append('g')
        .attr('class', 'drag-preview-badge')
        .attr('pointer-events', 'none')
        .style('opacity', 0)
      previewBadge.append('rect')
        .attr('rx', 4).attr('ry', 4)
        .attr('fill', 'rgba(15, 17, 23, 0.92)')
        .attr('stroke', '#60a5fa')
        .attr('stroke-width', 1)
      previewBadge.append('text')
        .attr('class', 'drag-preview-badge-text')
        .attr('fill', '#e5e7eb')
        .attr('font-size', 11)
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')

      dragRef.current = {
        node: hNode,
        startX: event.clientX,
        startY: event.clientY,
        lineStartX: startX,
        lineStartY: startY,
        lastX: event.clientX,
        lastY: event.clientY,
        dragging: false,
        sourceEl: nodeEl,
        handleEl,
        descendantCount,
        previewBadge,
        previewLine,
        pointerId: options.pointerId,
        previousBodyUserSelect: document.body.style.userSelect,
        previousBodyWebkitUserSelect: document.body.style.webkitUserSelect,
      }
      document.body.style.userSelect = 'none'
      document.body.style.webkitUserSelect = 'none'
      handleEl.style.cursor = 'grabbing'
      nodeEl.style.cursor = 'grabbing'
      setContextMenu(null)
      setTooltip(null)

      if (options.usePointerCapture) {
        try {
          svgEl.setPointerCapture(options.pointerId)
        } catch {
          // Pointer capture can fail for synthetic events; document listeners still cover the drag.
        }
      }

      const cleanup = () => {
        document.removeEventListener(options.moveEvent, onMove, listenerOptions)
        document.removeEventListener(options.upEvent, onUp, listenerOptions)
        if (options.cancelEvent) document.removeEventListener(options.cancelEvent, onCancel, listenerOptions)
        if (options.usePointerCapture) {
          try {
            if (svgEl.hasPointerCapture(options.pointerId)) svgEl.releasePointerCapture(options.pointerId)
          } catch {
            // Ignore release races after pointercancel.
          }
        }
      }

      const isSamePointer = (e) => options.pointerId == null || e.pointerId === options.pointerId

      const onMove = (e) => {
        if (!isSamePointer(e) || !dragRef.current.node) return
        e.preventDefault()
        e.stopPropagation()
        dragRef.current.lastX = e.clientX
        dragRef.current.lastY = e.clientY

        const dx = e.clientX - dragRef.current.startX
        const dy = e.clientY - dragRef.current.startY
        const [lineEndX, lineEndY] = d3.pointer(e, gRef.current)
        dragRef.current.previewLine
          ?.attr('d', dragPreviewPath(
            dragRef.current.lineStartX,
            dragRef.current.lineStartY,
            lineEndX,
            lineEndY
          ))

        if (!dragRef.current.dragging && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
          dragRef.current.dragging = true
          disableAddDuringDrag()
          d3.select(dragRef.current.sourceEl).attr('opacity', 0.65)
        }

        const drop = dragRef.current.dragging
          ? findBranchDropTarget(e.clientX, e.clientY, dragRef.current.node, dragRef.current.sourceEl)
          : null

        // 更新预览徽章：跟着鼠标走，显示「正在拖动 <节点名>（+N 子）」
        if (dragRef.current.dragging && dragRef.current.previewBadge) {
          const count = dragRef.current.descendantCount || 0
          const sourceName = dragRef.current.node?.data?.name || '节点'
          const truncated = sourceName.length > 12 ? sourceName.slice(0, 12) + '…' : sourceName
          let label = count > 0 ? `${truncated} +${count}子` : truncated
          const addGesture = isRightAddGesture(
            dragRef.current.startX,
            dragRef.current.startY,
            e.clientX,
            e.clientY
          )
          if (drop?.node?.data?.name) {
            const targetName = drop.node.data.name.length > 10 ? drop.node.data.name.slice(0, 10) + '…' : drop.node.data.name
            label = drop.mode === 'reorder'
              ? `${drop.placement === 'before' ? '排到前面' : '排到后面'}：${targetName}`
              : `移入：${targetName}`
          } else if (addGesture) {
            label = childTypeFor(dragRef.current.node) === 'category' ? '松手创建新分类' : '松手创建新任务'
          }
          dragRef.current.previewLine
            ?.attr('stroke', !drop?.node && addGesture ? '#34d399' : '#60a5fa')
          const badge = dragRef.current.previewBadge
          const text = badge.select('.drag-preview-badge-text').text(label)
          const padX = 8
          // 中文宽度大概 14px，英文 7px，简单粗估
          const w = Math.max(70, label.length * 12 + padX * 2)
          const h = 20
          badge.select('rect')
            .attr('x', -w / 2).attr('y', -h / 2)
            .attr('width', w).attr('height', h)
          text.attr('x', 0).attr('y', 0)
          badge.attr('transform', `translate(${lineEndX + 28},${lineEndY - 12})`)
            .style('opacity', 1)
        }

        // 实时高亮当前 hover 的潜在 drop target
        if (drop?.el !== dragRef.current.hoverEl || drop?.mode !== dragRef.current.hoverMode || drop?.placement !== dragRef.current.hoverPlacement) {
          if (dragRef.current.hoverEl) {
            d3.select(dragRef.current.hoverEl).select('.node-main-circle')
              .attr('stroke', '#1f2937').attr('stroke-width', 1.5)
          }
          if (drop?.el) {
            d3.select(drop.el).select('.node-main-circle')
              .attr('stroke', drop.mode === 'reorder' ? '#f59e0b' : '#34d399')
              .attr('stroke-width', 3)
          }
          dragRef.current.hoverEl = drop?.el || null
          dragRef.current.hoverMode = drop?.mode || null
          dragRef.current.hoverPlacement = drop?.placement || null
        }
      }

      const onUp = (e) => {
        if (!isSamePointer(e)) return
        cleanup()

        const {
          dragging, sourceEl, node, startX, startY,
          lastX = e.clientX, lastY = e.clientY,
          previousBodyUserSelect, handleEl,
        } = dragRef.current
        restoreDragStyles({ sourceEl, previousBodyUserSelect })
        if (handleEl) handleEl.style.cursor = 'grab'
        dragRef.current = {}

        if (!node) return

        const endX = e.clientX || lastX
        const endY = e.clientY || lastY
        const movedFarEnough =
          Math.abs(endX - startX) > DRAG_THRESHOLD ||
          Math.abs(endY - startY) > DRAG_THRESHOLD
        const effectiveDragging = dragging || movedFarEnough

        if (!effectiveDragging) {
          return
        }

        e.preventDefault()
        e.stopPropagation()
        disableAddDuringDrag()
        suppressPostDragClick()
        scheduleEnableAdd()

        const drop = findBranchDropTarget(endX, endY, node, sourceEl)
        if (drop?.node) {
          onDropRef.current?.(node.data, drop.node.data, {
            mode: drop.mode,
            placement: drop.placement,
          })
        } else if (isRightAddGesture(startX, startY, endX, endY)) {
          onLeafAddRef.current?.(node.data, childTypeFor(node), { source: 'node-right-drag' })
        }
      }

      const onCancel = (e) => {
        if (!isSamePointer(e)) return
        cleanup()
        const { handleEl } = dragRef.current
        restoreDragStyles(dragRef.current)
        if (handleEl) handleEl.style.cursor = 'grab'
        dragRef.current = {}
        scheduleEnableAdd()
      }

      const listenerOptions = { capture: true, passive: false }
      document.addEventListener(options.moveEvent, onMove, listenerOptions)
      document.addEventListener(options.upEvent, onUp, listenerOptions)
      if (options.cancelEvent) document.addEventListener(options.cancelEvent, onCancel, listenerOptions)
    }

    const onPointerDown = (event) => {
      if (event.pointerType === 'mouse') return
      startBranchDrag(event, {
        moveEvent: 'pointermove',
        upEvent: 'pointerup',
        cancelEvent: 'pointercancel',
        pointerId: event.pointerId,
        usePointerCapture: true,
      })
    }

    const onMouseDown = (event) => {
      startBranchDrag(event, {
        moveEvent: 'mousemove',
        upEvent: 'mouseup',
        pointerId: null,
        usePointerCapture: false,
      })
    }

    const onClickCapture = (event) => {
      if (!suppressClickRef.current) return
      event.preventDefault()
      event.stopPropagation()
    }

    const listenerOptions = { capture: true, passive: false }
    svgEl.addEventListener('pointerdown', onPointerDown, listenerOptions)
    svgEl.addEventListener('mousedown', onMouseDown, listenerOptions)
    svgEl.addEventListener('click', onClickCapture, true)
    return () => {
      svgEl.removeEventListener('pointerdown', onPointerDown, listenerOptions)
      svgEl.removeEventListener('mousedown', onMouseDown, listenerOptions)
      svgEl.removeEventListener('click', onClickCapture, true)
    }
  }, [])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overscrollBehavior: 'none' }}>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{
          background: '#0f1117',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          touchAction: 'none',
          overscrollBehavior: 'none',
        }}
      >
        <g ref={gRef} />
      </svg>

      {editingNode && (
        <input
          autoFocus
          value={editingNode.name}
          onFocus={event => event.target.select()}
          onChange={event => setEditingNode(prev => prev ? { ...prev, name: event.target.value } : prev)}
          onBlur={commitInlineRename}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitInlineRename()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              cancelInlineRename()
            }
          }}
          className="fixed z-[1100] rounded-md border border-blue-500 bg-gray-950 px-2 py-1 text-sm text-gray-100 shadow-xl outline-none"
          style={{
            left: editingNode.left,
            top: editingNode.top,
            width: editingNode.width,
          }}
        />
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={contextMenu.node}
          onClose={() => setContextMenu(null)}
          onAction={handleContextMenuAction}
        />
      )}

      {/* Tooltip */}
      {tooltip && (
        <NodeTooltip
          x={tooltip.x}
          y={tooltip.y}
          node={tooltip.node}
        />
      )}
    </div>
  )
}
