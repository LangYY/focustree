import { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { getNodeRadius, getNodeColor, getLinkStrokeWidth, findNodeById } from '../../lib/treeUtils'
import ContextMenu from './ContextMenu'
import NodeTooltip from './NodeTooltip'

const MARGIN = { top: 20, right: 120, bottom: 20, left: 60 }
const NODE_H_GAP = 220
const NODE_V_GAP = 48
const DRAG_THRESHOLD = 4
const DROP_LABEL_WIDTH = 180
const DROP_HIT_PADDING = 14
const NODE_HIT_PADDING = 6

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

export default function TreeView({ treeData, density, onNodeSelect, onNodeToggle, onContextAction, resetZoomRef, highlightedNodeId, onLeafAdd, onDropBranch }) {
  const svgRef  = useRef(null)
  const gRef    = useRef(null)
  const zoomRef = useRef(null)
  const rootRef = useRef(null)   // 缓存 d3 hierarchy root，供高亮 effect 使用

  const [contextMenu, setContextMenu] = useState(null)  // { x, y, node }
  const [tooltip, setTooltip]         = useState(null)  // { x, y, node }
  const dragRef      = useRef({})  // { node, startX, startY, dragging, sourceEl, pointerId }
  const suppressClickRef = useRef(false)
  const addDisabledRef = useRef(false)
  const onDropRef    = useRef(onDropBranch)
  const onLeafAddRef = useRef(onLeafAdd)
  useEffect(() => { onDropRef.current = onDropBranch }, [onDropBranch])
  useEffect(() => { onLeafAddRef.current = onLeafAdd }, [onLeafAdd])

  // 暴露 resetZoom 给父组件
  const resetZoom = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return
    const svg = d3.select(svgRef.current)
    svg.transition().duration(400).call(zoomRef.current.transform, d3.zoomIdentity)
  }, [])

  useEffect(() => {
    if (resetZoomRef) resetZoomRef.current = resetZoom
  }, [resetZoom, resetZoomRef])

  // 渲染树
  useEffect(() => {
    if (!treeData || !svgRef.current) return

    const height = svgRef.current.clientHeight

    const root = d3.hierarchy(treeData, d => d.expanded === false ? null : d.children)
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
      .attr('stroke', d =>
        d.source.depth === 0 ? '#374151' : getNodeColor(d.source.data)
      )
      .attr('stroke-width', d => getLinkStrokeWidth(d.target.data.weight))
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
        onNodeSelect?.(d.data)
      })

    // 双击：折叠/展开
    node.filter(d => d.data.type !== 'root')
      .on('dblclick', (event, d) => {
        event.stopPropagation()
        onNodeToggle?.(d.data)
      })

    // 右键：上下文菜单
    node.filter(d => d.data.type !== 'root')
      .on('contextmenu', (event, d) => {
        event.preventDefault()
        event.stopPropagation()
        setContextMenu({ x: event.clientX, y: event.clientY, node: d.data })
      })

    // Hover tooltip
    node.filter(d => d.data.type !== 'root')
      .on('mouseover', (event, d) => {
        setTooltip({ x: event.clientX, y: event.clientY, node: d.data })
      })
      .on('mousemove', (event) => {
        setTooltip(prev => prev ? { ...prev, x: event.clientX, y: event.clientY } : prev)
      })
      .on('mouseout', () => setTooltip(null))

    node.filter(d => d.data.type !== 'root')
      .append('rect')
      .attr('class', 'node-hit-area')
      .attr('x', d => -getNodeRadius(d.data.type) - NODE_HIT_PADDING)
      .attr('y', d => -getNodeRadius(d.data.type) - NODE_HIT_PADDING)
      .attr('width', d => getNodeRadius(d.data.type) * 2 + NODE_HIT_PADDING + DROP_LABEL_WIDTH)
      .attr('height', d => getNodeRadius(d.data.type) * 2 + NODE_HIT_PADDING * 2)
      .attr('fill', 'transparent')
      // 让 task 这种小节点也能被拖动：hit area 整个都是 drag handle
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
      .on('click', (event, d) => {
        event.stopPropagation()
        if (suppressClickRef.current || addDisabledRef.current) return
        const childType = d.data.type === 'project' ? 'category' : 'task'
        onLeafAddRef.current?.(d.data, childType)
      })

    node.filter(d => d.data.type !== 'root')
      .append('text')
      .attr('class', 'node-main-plus')
      .attr('dy', '0.35em')
      .attr('text-anchor', 'middle')
      .attr('fill', '#0f1117')
      .attr('font-size', d => Math.max(9, getNodeRadius(d.data.type) * 0.82))
      .attr('font-weight', 800)
      .attr('opacity', 0)
      .attr('pointer-events', 'none')
      .text('+')

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
    const showLabel = (d) => {
      if (d.data.type === 'root') return false
      if (density === 'dense')  return true
      if (density === 'medium') return d.data.type !== 'task'
      return d.data.type === 'project'
    }

    node.filter(d => showLabel(d))
      .append('text')
      .attr('x', d => getNodeRadius(d.data.type) + 6)
      .attr('dy', '0.35em')
      .attr('fill', '#d1d5db')
      .attr('font-size', d => d.data.type === 'project' ? 13 : 11)
      .attr('font-weight', d => d.data.type === 'project' ? 600 : 400)
      .attr('pointer-events', 'none')
      .text(d => d.data.name)

    // 居中定位
    const xs = nodes.map(d => d.y)
    const ys = nodes.map(d => d.x)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const treeH = maxY - minY
    const offsetX = MARGIN.left - Math.min(...xs)
    const offsetY = (height - treeH) / 2 - minY + 30
    g.attr('transform', `translate(${offsetX},${offsetY})`)

  }, [treeData, density])

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
      .attr('stroke-width', function () {
        // 从 D3 数据里取 weight；没有就 1
        const d = d3.select(this).datum()
        return getLinkStrokeWidth(d?.target?.data?.weight)
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
          .attr('stroke-width', function () {
            const d = d3.select(this).datum()
            return getLinkStrokeWidth(d?.target?.data?.weight) + 1.5
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
        // 仅 pinch 缩放：ctrlKey + wheel（触控板两指捏合 → 浏览器自动加 ctrlKey）
        if (event.type === 'wheel' && event.ctrlKey) return true
        // 触摸屏手势
        if (event.type.startsWith('touch')) return true
        // 鼠标拖拽背景 → 平移（节点上的 mousedown/pointerdown 不激活 zoom）
        if (event.type === 'mousedown' || event.type === 'pointerdown') {
          return event.target === svgRef.current || event.target.tagName === 'svg'
        }
        return !!event.sourceEvent
      })
      .on('zoom', (event) => {
        d3.select(gRef.current).attr('transform', event.transform)
      })

    zoomRef.current = zoom
    svg.call(zoom)

    // 双指滑动 / 鼠标滚轮（无 ctrlKey）→ 平移画布
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

    const findBranchDropTarget = (clientX, clientY, sourceId, sourceEl) => {
      const root = rootRef.current
      if (!root) return null

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
            return { node: targetNode, el: nodeEl }
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
          best = { node: candidate, el, distance }
        }
      }

      return best ? { node: best.node, el: best.el } : null
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

      // 拖拽可以从「圆点」或「整个 hit area」起手——后者对 task 这种小节点关键
      const handleEl =
        event.target.closest?.('.node-main-circle') ||
        event.target.closest?.('.node-hit-area')
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
      const fullNode = findNodeById(treeData, nodeId)
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

        // 更新预览徽章：跟着鼠标走，显示「正在移动 N+M」
        if (dragRef.current.dragging && dragRef.current.previewBadge) {
          const count = dragRef.current.descendantCount || 0
          const label = count > 0 ? `移动 1 + ${count} 子` : '移动 1'
          const badge = dragRef.current.previewBadge
          const text = badge.select('.drag-preview-badge-text').text(label)
          const padX = 8, padY = 4
          // 估算文本宽度（d3 text 没有同步 getBBox，所以用粗算：字符数 * 7px）
          const w = Math.max(60, label.length * 7 + padX * 2)
          const h = 20
          badge.select('rect')
            .attr('x', -w / 2).attr('y', -h / 2)
            .attr('width', w).attr('height', h)
          text.attr('x', 0).attr('y', 0)
          badge.attr('transform', `translate(${lineEndX + 28},${lineEndY - 12})`)
            .style('opacity', 1)
        }

        // 实时高亮当前 hover 的潜在 drop target
        const drop = findBranchDropTarget(e.clientX, e.clientY, dragRef.current.node.data.id, dragRef.current.sourceEl)
        if (drop?.el !== dragRef.current.hoverEl) {
          if (dragRef.current.hoverEl) {
            d3.select(dragRef.current.hoverEl).select('.node-main-circle')
              .attr('stroke', '#1f2937').attr('stroke-width', 1.5)
          }
          if (drop?.el) {
            d3.select(drop.el).select('.node-main-circle')
              .attr('stroke', '#34d399').attr('stroke-width', 3)
          }
          dragRef.current.hoverEl = drop?.el || null
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

        const drop = findBranchDropTarget(endX, endY, node.data.id, sourceEl)
        if (drop?.node) {
          onDropRef.current?.(node.data, drop.node.data)
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

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={contextMenu.node}
          onClose={() => setContextMenu(null)}
          onAction={onContextAction}
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
