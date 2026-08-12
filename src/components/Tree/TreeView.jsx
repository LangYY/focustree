import { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import {
  findNodeById,
  getDerivedWeightMetaMap,
  getDerivedWeightMeta,
  getNodeDueState,
  isUrgentPriority,
} from '../../lib/treeUtils'
import { resolveBranchBaseColor, shadeBranchColor } from '../../lib/branchPalette'
import { branchPath, branchTangent, centerLinePath } from './render/branchPath'
import { branchWidth, glowMetrics, nodeAriaLabel, nodeRadius } from './render/nodeVisual'
import { ringValues } from './render/growthRings'
import { dueArcPath, dueColor } from './render/dueArc'
import { layoutLabelPositions } from './render/labels'
import ContextMenu from './ContextMenu'
import NodeTooltip from './NodeTooltip'
import CanvasControls from './CanvasControls'

const MARGIN = { top: 20, right: 120, bottom: 20, left: 60 }
const NODE_H_GAP = 220
const NODE_V_GAP = 48
const LABEL_MAX_WIDTH_RATIO = 0.5
const LABEL_TANGENT_T = 0.88
const LABEL_TANGENT_DISTANCE = 8
const LABEL_BACKDROP_PADDING = 3
const LABEL_BACKDROP_OPACITY = { light: .42, dark: .34 }
const DRAG_THRESHOLD = 4
const DROP_LABEL_WIDTH = 180
const DROP_HIT_PADDING = 14
const NODE_HIT_PADDING = 8
const TERMINAL_BRANCH_HIT_WIDTH = 18
const ADD_CHILD_DRAG_MIN_X = 28
const DROP_MOVE_BAND_MIN = 10
const MIDDLE_MOUSE_BUTTON = 1
const ZOOM_MIN = 0.15
const ZOOM_MAX = 3
const ZOOM_BUTTON_FACTOR = 1.15
function shouldShowLabel(node, density, zoomScale = 1) {
  const data = node?.data || node
  if (data?.type === 'root') return false
  if (zoomScale < 0.5) return data?.type === 'project'
  if (zoomScale > 1.4) return true
  if (density === 'dense') return true
  if (density === 'medium') return data?.type !== 'task'
  return data?.type === 'project'
}

function childTypeFor(node) {
  const data = node?.data || node
  return data?.type === 'project' ? 'category' : 'task'
}

function childTypeForParent(node) {
  const data = node?.data || node
  if (!data || data.type === 'root') return 'project'
  return childTypeFor(data)
}

function addPreviewLabel(type, sameLevel = false) {
  const label = type === 'project' ? '项目' : type === 'category' ? '分类' : '任务'
  return sameLevel ? `松手创建同级${label}` : `松手创建新${label}`
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

function clampNumber(value, min, max) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return min
  return Math.max(min, Math.min(max, numeric))
}

function motionDuration(milliseconds) {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 1
  return milliseconds
}

function nodeTransform(node) {
  return `translate(${node?.y || 0},${node?.x || 0})`
}

function treeItemDomId(nodeId) {
  return `ft-tree-node-${String(nodeId || '').replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

function nodeVisualOpacity(node) {
  if (node?.data?.status === 'dormant') return .38
  if (node?.data?.status === 'done') return .45
  return node?.__visualOpacity ?? 1
}

function nodeFill(node) {
  return node?.data?.status === 'dormant'
    ? 'var(--ft-canvas)'
    : node?.__displayColor || 'var(--ft-text-tertiary)'
}

function pointForNode(node) {
  return { x: node?.x || 0, y: node?.y || 0 }
}

function layoutStart(node, previousById) {
  const previous = previousById.get(node?.data?.id)
  if (previous) return previous
  return previousById.get(node?.parent?.data?.id) || node?.parent || node
}

function linkStart(link, previousById) {
  const source = previousById.get(link?.source?.data?.id) || link?.source
  const target = previousById.get(link?.target?.data?.id) || source || link?.target
  return { source: pointForNode(source), target: pointForNode(target) }
}

function isVisibleDueState(dueState) {
  return dueState && ['overdue', 'today', 'three_days', 'week'].includes(dueState.state)
}

function assignBranchVisuals(root, theme) {
  const rootBranches = root.children || []

  function walk(node, baseColor, branchDepth) {
    const dueState = getNodeDueState(node.data)
    node.__branchBaseColor = baseColor
    node.__branchDepth = branchDepth
    node.__displayColor = shadeBranchColor(baseColor, branchDepth, node.data.status, theme)
    node.__glowColor = node.__displayColor
    node.__glowOpacityScale = theme === 'light' ? .58 : 1
    node.__ringStroke = theme === 'light' ? 'var(--ft-text-secondary)' : node.__displayColor
    node.__ringOpacityScale = theme === 'light' ? 1.65 : 1
    node.__visualOpacity = node.data.status === 'done' ? 0.58 : node.data.status === 'dormant' ? 0.46 : 1
    node.__dueState = dueState
    node.__dueVisible = isVisibleDueState(dueState)
    node.__isUrgent = isUrgentPriority(node.data.current_priority)
    ;(node.children || []).forEach(child => walk(child, baseColor, branchDepth + 1))
  }

  rootBranches.forEach((branch, index) => {
    walk(branch, resolveBranchBaseColor(branch, index, theme), 0)
  })
}

function assignCumulativeFlow(root, userGoal) {
  const metaById = getDerivedWeightMetaMap(root.data, { userGoal })
  root.eachBefore(node => {
    const meta = getDerivedWeightMeta(metaById, node.data)
    node.__branchPriority = meta?.branchPriority ?? 0
    node.__directPriority = meta?.directPriority ?? 0
    node.__cultivationScore = meta?.cultivationScore ?? 0
    node.__priorityConfidence = meta?.confidence ?? 0
    node.__priorityAnalysisConfidence = meta?.analysisConfidence ?? null
    node.__priorityStaleReasons = meta?.staleReasons ?? []
    node.__prioritySignals = meta?.signalBreakdown ?? []
  })
}
function getNodeRadius(value, directPriority) {
  const data = value?.data || value
  const type = typeof data === 'string' ? data : data?.type
  const priority = directPriority ?? value?.__directPriority ?? data?.__directPriority ?? 50
  return nodeRadius(type, priority)
}

function linkStrokeWidth(d) {
  const target = d?.target
  let extra = 0
  if (target?.__isUrgent) extra += 1.5
  else if (target?.data?.current_priority === 'high') extra += 0.7
  if (target?.__dueState?.state === 'overdue' || target?.__dueState?.state === 'today') extra += 0.8
  else if (target?.__dueState?.state === 'three_days') extra += 0.45
  return branchWidth(target?.__branchPriority) + extra
}

function applyLinkStrokeWidth(selection, extra = 0) {
  selection
    .attr('stroke-width', d => linkStrokeWidth(d) + extra)
    .style('stroke-width', d => `${linkStrokeWidth(d) + extra}px`)
}

function linkOpacity(d) {
  const opacity = d?.target?.__visualOpacity ?? 1
  const boosted = d?.target?.__isUrgent || d?.target?.__dueVisible ? 0.72 : 0.48
  return clampNumber(opacity * boosted, 0.22, 0.86)
}

function nodeStrokeColor(d) {
  if (d?.__isUrgent) return 'var(--ft-text-primary)'
  if (d?.data?.current_priority === 'high') return 'var(--ft-text-secondary)'
  return 'var(--ft-border-strong)'
}

function nodeStrokeWidth(d) {
  if (d?.__isUrgent) return 2.4
  if (d?.data?.current_priority === 'high') return 1.9
  return 1.5
}

function nodeFilter(d) {
  if (d?.__isUrgent) return 'url(#ft-glow)'
  return null
}

function withDerivedWeightMeta(hNode) {
  if (!hNode?.data) return null
  return {
    ...hNode.data,
    __flow: hNode.__flow,
    __branchPriority: hNode.__branchPriority,
    __directPriority: hNode.__directPriority,
    __cultivationScore: hNode.__cultivationScore,
    __priorityConfidence: hNode.__priorityConfidence,
    __priorityStaleReasons: hNode.__priorityStaleReasons,
    __prioritySignals: hNode.__prioritySignals,
  }
}

function isTypingTarget(element) {
  const tag = element?.tagName?.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || element?.isContentEditable
}

export default function TreeView({ treeData, theme = 'dark', userGoal, density, onDensityChange, onExpandAll, onCollapseAll, onNodeSelect, onNodeToggle, onContextAction, resetZoomRef, highlightedNodeId, onLeafAdd, onDropBranch, onRenameNode, priorityCalculationVersion, layers, onLayerChange }) {
  const svgRef  = useRef(null)
  const gRef    = useRef(null)
  const zoomRef = useRef(null)
  const rootRef = useRef(null)   // 缓存 d3 hierarchy root，供高亮 effect 使用
  const treeDataRef = useRef(treeData)
  const autoCenteredRef = useRef(false)
  const defaultTransformRef = useRef(d3.zoomIdentity)
  const currentTransformRef = useRef(d3.zoomIdentity)

  const [contextMenu, setContextMenu] = useState(null)  // { x, y, node }
  const [tooltip, setTooltip]         = useState(null)  // { x, y, node }
  const [editingNode, setEditingNode] = useState(null)  // { id, name, left, top, width }
  const [zoomScale, setZoomScale] = useState(1)
  const [controlsOpen, setControlsOpen] = useState(false)
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
  const canvasPanRef = useRef({})
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
    const radius = getNodeRadius(nodeData)
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
    svg.transition().duration(400).call(zoomRef.current.transform, defaultTransformRef.current || d3.zoomIdentity)
  }, [])

  const zoomBy = useCallback((factor) => {
    if (!svgRef.current || !zoomRef.current) return
    const svgEl = svgRef.current
    const svg = d3.select(svgEl)
    const center = [svgEl.clientWidth / 2, svgEl.clientHeight / 2]
    svg.transition().duration(180).call(zoomRef.current.scaleBy, factor, center)
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

  const handleTreeKeyDown = useCallback((event) => {
    if (isTypingTarget(event.target) || event.defaultPrevented) return
    const root = rootRef.current
    if (!root) return

    if (event.key === 'Escape') {
      setContextMenu(null)
      setTooltip(null)
      return
    }

    const visibleNodes = root.descendants().filter(node => node.data.type !== 'root')
    const current = visibleNodes.find(node => node.data.id === highlightedNodeId) || visibleNodes[0]
    if (!current) return

    const siblings = current.parent?.children?.filter(node => node.data.type !== 'root') || []
    let next = null
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const index = siblings.indexOf(current)
      if (index >= 0 && siblings.length > 1) {
        next = siblings[(index + (event.key === 'ArrowUp' ? -1 : 1) + siblings.length) % siblings.length]
      }
    } else if (event.key === 'ArrowLeft') {
      next = current.parent?.data?.type === 'root' ? null : current.parent
    } else if (event.key === 'ArrowRight') {
      next = current.children?.find(node => node.data.type !== 'root') || null
    }

    if (next?.data?.type !== 'root') {
      event.preventDefault()
      onNodeSelectRef.current?.(withDerivedWeightMeta(next))
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      onNodeToggleRef.current?.(current.data)
      return
    }
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault()
      onNodeSelectRef.current?.(withDerivedWeightMeta(current))
      return
    }
    if (event.key === 'Delete') {
      event.preventDefault()
      onContextAction?.('delete', { node: withDerivedWeightMeta(current) })
    }
  }, [highlightedNodeId, onContextAction])

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
    const previousRoot = rootRef.current
    const previousById = new Map(previousRoot?.descendants().map(node => [node.data.id, node]) || [])

    const root = d3.hierarchy(treeData, d => d.expanded === false ? null : d.children)
    assignCumulativeFlow(root, userGoal)
    assignBranchVisuals(root, theme)
    const treeLayout = d3.tree()
      .nodeSize([NODE_V_GAP, NODE_H_GAP])
      .separation((a, b) => {
        const aR = getNodeRadius(a.data, a.__directPriority)
        const bR = getNodeRadius(b.data, b.__directPriority)
        return (aR + bR) / NODE_V_GAP + 0.5
      })
    treeLayout(root)
    rootRef.current = root

    const nodes = root.descendants()
    const links = root.links()
    const labelPositions = layoutLabelPositions(nodes, {
      getRadius: nodeItem => getNodeRadius(nodeItem.data, nodeItem.__directPriority),
      shouldShow: nodeItem => shouldShowLabel(nodeItem, density, zoomScale),
      getMaxWidth: nodeItem => {
        const nextLayerNode = nodeItem.children?.[0]
        const measuredGap = nextLayerNode ? nextLayerNode.y - nodeItem.y : NODE_H_GAP
        const layerGap = Number.isFinite(measuredGap) && measuredGap > 0 ? measuredGap : NODE_H_GAP
        return layerGap * LABEL_MAX_WIDTH_RATIO
      },
      getAnchorOffset: nodeItem => {
        if (!nodeItem.parent) return { x: 0, y: 0 }
        const tangent = branchTangent({ source: nodeItem.parent, target: nodeItem }, LABEL_TANGENT_T)
        return {
          x: tangent.x * LABEL_TANGENT_DISTANCE,
          y: tangent.y * LABEL_TANGENT_DISTANCE,
        }
      },
    })
    const terminalLinks = links.filter(d =>
      d.target.data.type !== 'root' &&
      !(Array.isArray(d.target.data.children) && d.target.data.children.length > 0)
    )

    const g = d3.select(gRef.current)
    g.selectAll('*').remove()

    const currentIds = new Set(nodes.map(node => node.data.id))
    const removedNodes = previousRoot?.descendants().filter(node => node.data.type !== 'root' && !currentIds.has(node.data.id)) || []
    const removedIds = new Set(removedNodes.map(node => node.data.id))
    if (removedNodes.length) {
      const exitLayer = g.append('g')
        .attr('class', 'ft-tree-exit-layer')
        .attr('pointer-events', 'none')

      const exitLinks = previousRoot.links().filter(link => removedIds.has(link.target.data.id))
      exitLayer.selectAll('.ft-tree-exit-link')
        .data(exitLinks)
        .join('path')
        .attr('class', 'ft-tree-exit-link')
        .attr('d', link => centerLinePath(link))
        .attr('fill', 'none')
        .attr('stroke', link => link.target.__displayColor || 'var(--ft-text-tertiary)')
        .attr('stroke-width', link => branchWidth(link.target.__branchPriority))
        .attr('stroke-linecap', 'round')
        .attr('opacity', .5)
        .each(function () {
          const length = this.getTotalLength?.() || 1
          d3.select(this).attr('stroke-dasharray', `${length} ${length}`).attr('stroke-dashoffset', 0)
        })
        .transition()
        .delay(motionDuration(420))
        .duration(motionDuration(700))
        .ease(d3.easeCubicOut)
        .attr('stroke-dashoffset', function () { return -(this.getTotalLength?.() || 1) })
        .attr('opacity', 0)

      exitLayer.selectAll('.ft-tree-exit-node')
        .data(removedNodes)
        .join('g')
        .attr('class', 'ft-tree-exit-node')
        .attr('transform', node => nodeTransform(node))
        .append('circle')
        .attr('r', node => getNodeRadius(node.data, node.__directPriority))
        .attr('fill', node => nodeFill(node))
        .attr('opacity', node => nodeVisualOpacity(node))
        .transition()
        .duration(motionDuration(420))
        .ease(d3.easeCubicOut)
        .attr('r', 0)
        .attr('opacity', 0)

      exitLayer.transition()
        .delay(motionDuration(420) + motionDuration(700))
        .duration(1)
        .style('opacity', 0)
        .remove()
    }

    const svg = d3.select(svgRef.current)
    svg.selectAll('defs.ft-tree-defs').remove()
    const defs = svg.insert('defs', ':first-child').attr('class', 'ft-tree-defs')
    const glow = defs.append('filter').attr('id', 'ft-glow').attr('x', '-80%').attr('y', '-80%').attr('width', '260%').attr('height', '260%')
    glow.append('feGaussianBlur').attr('stdDeviation', 3.5)

    // 锥形枝干：branchPriority 只通过枝干物理宽度表达。
    const link = g.selectAll('.link')
      .data(links)
      .join('path')
      .attr('class', 'link')
      .attr('data-target-id', d => d.target.data.id || '')
      .attr('data-direct-priority', d => Number.isFinite(d.target.__directPriority) ? d.target.__directPriority.toFixed(1) : '')
      .attr('data-branch-priority', d => Number.isFinite(d.target.__branchPriority) ? d.target.__branchPriority.toFixed(1) : '')
      .attr('data-cultivation', d => Number.isFinite(d.target.__cultivationScore) ? d.target.__cultivationScore.toFixed(1) : '')
      .attr('fill', d => d.target.__displayColor || 'var(--ft-text-tertiary)')
      .attr('fill-opacity', d => clampNumber((d.target.__branchPriority || 0) / 100 * 0.48 + 0.34, 0.16, 0.82) * (d.target.data.status === 'done' ? 0.5 : d.target.data.status === 'dormant' ? 0.42 : 1))
      .attr('stroke', 'none')
      .attr('d', d => branchPath(d, branchWidth(d.source.__branchPriority), branchWidth(d.target.__branchPriority)))

    // 轮廓只在生长期间出现，用 stroke-dashoffset 把填充枝干“画”出来，结束后恢复无描边。
    link
      .attr('stroke', d => d.target.__displayColor || 'var(--ft-text-tertiary)')
      .attr('stroke-opacity', .22)
      .attr('stroke-width', .6)
      .each(function () {
        const length = this.getTotalLength?.() || 1
        d3.select(this).attr('stroke-dasharray', `${length} ${length}`).attr('stroke-dashoffset', length)
      })
      .attr('d', d => branchPath(linkStart(d, previousById), branchWidth(d.source.__branchPriority), branchWidth(d.target.__branchPriority)))
      .transition()
      .duration(motionDuration(700))
      .ease(d3.easeCubicOut)
      .attr('d', d => branchPath(d, branchWidth(d.source.__branchPriority), branchWidth(d.target.__branchPriority)))
      .attr('stroke-dashoffset', 0)
      .attr('stroke-opacity', 0)
      .on('end', function () {
        d3.select(this)
          .attr('stroke', 'none')
          .attr('stroke-dasharray', null)
          .attr('stroke-dashoffset', null)
      })

    const criticalPathLine = g.selectAll('.critical-path-line')
      .data(links.filter(d => (d.target.__branchPriority || 0) >= (d.source.__branchPriority || 0)))
      .join('path')
      .attr('class', 'critical-path-line')
      .attr('d', d => centerLinePath(d))
      .attr('fill', 'none')
      .attr('stroke', 'var(--ft-text-primary)')
      .attr('stroke-width', 1)
      .attr('opacity', .12)
      .attr('pointer-events', 'none')

    criticalPathLine
      .attr('d', d => centerLinePath(linkStart(d, previousById)))
      .transition()
      .duration(motionDuration(700))
      .ease(d3.easeCubicOut)
      .attr('d', d => centerLinePath(d))

    // 最末端枝干的透明命中区：可从枝干拉出虚线新增同级底层节点，不改变可见样式。
    g.selectAll('.terminal-branch-add-hit')
      .data(terminalLinks)
      .join('path')
      .attr('class', 'terminal-branch-add-hit')
      .attr('data-target-id', d => d.target.data.id || '')
      .attr('d', d => centerLinePath(d))
      .attr('fill', 'none')
      .attr('stroke', 'transparent')
      .attr('stroke-width', d => Math.max(TERMINAL_BRANCH_HIT_WIDTH, linkStrokeWidth(d) + 10))
      .attr('stroke-linecap', 'round')
      .attr('pointer-events', 'stroke')
      .style('cursor', 'crosshair')

    // 节点组
    const node = g.selectAll('.node')
      .data(nodes)
      .join('g')
      .attr('class', 'node')
      .attr('data-node-id', d => d.data.id || '')
      .attr('id', d => d.data.type === 'root' ? undefined : treeItemDomId(d.data.id))
      .attr('transform', d => nodeTransform(layoutStart(d, previousById)))
      .attr('role', d => d.data.type === 'root' ? undefined : 'treeitem')
      .attr('aria-expanded', d => d.data.type === 'root' ? undefined : Boolean(d.data.expanded !== false))
      .attr('aria-selected', d => d.data.id === highlightedNodeId ? 'true' : 'false')
      .attr('aria-level', d => d.data.type === 'root' ? undefined : d.depth)
      .attr('aria-posinset', d => d.data.type === 'root' ? undefined : (d.parent?.children?.indexOf(d) ?? 0) + 1)
      .attr('aria-setsize', d => d.data.type === 'root' ? undefined : d.parent?.children?.length)
      .attr('aria-label', d => d.data.type === 'root' ? '专注树根节点' : nodeAriaLabel(d.data, d))
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
      .attr('x', d => -getNodeRadius(d.data, d.__directPriority) - NODE_HIT_PADDING)
      .attr('y', d => -getNodeRadius(d.data, d.__directPriority) - NODE_HIT_PADDING)
      .attr('width', d => getNodeRadius(d.data, d.__directPriority) * 2 + NODE_HIT_PADDING + DROP_LABEL_WIDTH)
      .attr('height', d => getNodeRadius(d.data, d.__directPriority) * 2 + NODE_HIT_PADDING * 2)
      .attr('fill', 'transparent')

    // 小 drag handle：紧贴圆点一圈，仅这里能起手拖拽
    // 即使是 task 节点（radius=6），handle 也比纯圆点大一圈，方便抓取
    const DRAG_HANDLE_PADDING = 8
    node.filter(d => d.data.type !== 'root')
      .append('rect')
      .attr('class', 'node-drag-handle')
      .attr('x', d => -getNodeRadius(d.data, d.__directPriority) - DRAG_HANDLE_PADDING)
      .attr('y', d => -getNodeRadius(d.data, d.__directPriority) - DRAG_HANDLE_PADDING)
      .attr('width', d => (getNodeRadius(d.data, d.__directPriority) + DRAG_HANDLE_PADDING) * 2)
      .attr('height', d => (getNodeRadius(d.data, d.__directPriority) + DRAG_HANDLE_PADDING) * 2)
      .attr('fill', 'transparent')
      .style('cursor', 'grab')

    // 节点大小、辉光、年轮分别承载 direct / cultivation。
    node.filter(d => d.data.type !== 'root' && glowMetrics(getNodeRadius(d.data, d.__directPriority), d.__directPriority))
      .append('circle')
      .attr('class', 'node-direct-glow')
      .attr('r', d => {
        const previous = previousById.get(d.data.id)
        const metrics = previous && glowMetrics(getNodeRadius(previous.data, previous.__directPriority), previous.__directPriority)
        return metrics?.radius || 0
      })
      .attr('fill', d => d.__glowColor || d.__displayColor || 'var(--ft-accent)')
      .attr('opacity', d => {
        const previous = previousById.get(d.data.id)
        const metrics = previous && glowMetrics(getNodeRadius(previous.data, previous.__directPriority), previous.__directPriority)
        return (metrics?.opacity || 0) * (previous?.__glowOpacityScale || 1)
      })
      .attr('filter', nodes.length > 400 ? null : 'url(#ft-glow)')
      .attr('pointer-events', 'none')

    node.selectAll('.node-direct-glow')
      .transition()
      .duration(motionDuration(700))
      .ease(d3.easeCubicOut)
      .attr('r', d => glowMetrics(getNodeRadius(d.data, d.__directPriority), d.__directPriority)?.radius || 0)
      .attr('opacity', d => (glowMetrics(getNodeRadius(d.data, d.__directPriority), d.__directPriority)?.opacity || 0) * (d.__glowOpacityScale || 1))

    node.filter(d => d.data.type !== 'root' && layers?.rings !== false)
      .append('g')
      .attr('class', 'node-growth-rings')
      .each(function (d) {
        const rings = ringValues(getNodeRadius(d.data, d.__directPriority), d.__cultivationScore, nodes.length > 300)
        d3.select(this).selectAll('circle').data(rings).join('circle')
          .attr('r', ring => ring.radius)
          .attr('fill', 'none')
          .attr('stroke', d.__ringStroke || d.__displayColor || 'var(--ft-text-tertiary)')
          .attr('stroke-width', .75)
          .attr('opacity', ring => Math.min(.85, ring.opacity * (d.__ringOpacityScale || 1)))
          .attr('pointer-events', 'none')
      })

    // 圆圈：active 实心、dormant 虚线空心、done 去饱和并带对勾。
    node.filter(d => d.data.type !== 'root')
      .append('circle')
      .attr('class', 'node-main-circle')
      .attr('r', d => {
        const previous = previousById.get(d.data.id)
        return previous ? getNodeRadius(previous.data, previous.__directPriority) : 0
      })
      .attr('fill', d => previousById.has(d.data.id) ? nodeFill(previousById.get(d.data.id)) : nodeFill(d))
      .attr('stroke', d => {
        const previous = previousById.get(d.data.id)
        return previous
          ? (previous.data.status === 'dormant' ? (previous.__displayColor || 'var(--ft-text-tertiary)') : nodeStrokeColor(previous))
          : (d.data.status === 'dormant' ? (d.__displayColor || 'var(--ft-text-tertiary)') : nodeStrokeColor(d))
      })
      .attr('stroke-width', d => d.data.status === 'dormant' ? 1.5 : nodeStrokeWidth(d))
      .attr('stroke-dasharray', d => d.data.status === 'dormant' ? '2 2' : null)
      .attr('opacity', d => previousById.has(d.data.id) ? nodeVisualOpacity(previousById.get(d.data.id)) : 0)
      .attr('filter', d => d.data.status === 'done' ? null : nodeFilter(d))
      .style('cursor', 'grab')
      .on('mouseenter', function (event, d) {
        d3.select(this).attr('r', getNodeRadius(d.data, d.__directPriority) * 1.14)
        d3.select(this.parentNode).select('.node-main-plus').attr('opacity', addDisabledRef.current ? 0 : 1)
        d3.select(this.parentNode).select('.node-growth-rings circle').attr('opacity', ring => Math.min(1, ring.opacity * 2.2))
      })

    const mainCircle = node.selectAll('.node-main-circle')
    mainCircle
      .on('mouseleave', function (event, d) {
        d3.select(this).attr('r', getNodeRadius(d.data, d.__directPriority))
        d3.select(this.parentNode).select('.node-main-plus').attr('opacity', 0)
        d3.select(this.parentNode).select('.node-growth-rings circle').attr('opacity', ring => ring.opacity)
      })

    mainCircle
      .transition()
      .duration(motionDuration(420))
      .ease(d3.easeCubicOut)
      .attr('r', d => getNodeRadius(d.data, d.__directPriority))
      .attr('fill', d => nodeFill(d))
      .attr('stroke', d => d.data.status === 'dormant' ? (d.__displayColor || 'var(--ft-text-tertiary)') : nodeStrokeColor(d))
      .attr('opacity', d => nodeVisualOpacity(d))

    const doneMark = node.filter(d => d.data.status === 'done' && getNodeRadius(d.data, d.__directPriority) >= 8)
      .append('path')
      .attr('class', 'node-done-mark')
      .attr('d', 'M-4,0 L-1,3 L5,-4')
      .attr('fill', 'none')
      .attr('stroke', 'var(--ft-canvas)')
      .attr('stroke-width', 1.7)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round')
      .attr('pointer-events', 'none')

    doneMark.each(function (d) {
      const length = this.getTotalLength?.() || 15
      const previous = previousById.get(d.data.id)
      d3.select(this)
        .attr('stroke-dasharray', `${length} ${length}`)
        .attr('stroke-dashoffset', previous?.data?.status === 'done' ? 0 : length)
    })
    doneMark
      .filter(d => previousById.get(d.data.id)?.data?.status !== 'done')
      .transition()
      .duration(motionDuration(220))
      .ease(d3.easeCubicOut)
      .attr('stroke-dashoffset', 0)

    node.filter(d => d.data.status === 'done')
      .append('text')
      .attr('class', 'node-status-mark node-status-label')
      .attr('x', d => getNodeRadius(d.data, d.__directPriority) + 7)
      .attr('dy', '0.35em')
      .attr('fill', 'var(--ft-text-tertiary)')
      .attr('font-size', 9)
      .attr('pointer-events', 'none')
      .text('完成')

    node.filter(d => d.data.status === 'dormant')
      .append('text')
      .attr('class', 'node-status-mark')
      .attr('dy', '0.35em')
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--ft-text-tertiary)')
      .attr('font-size', 9)
      .attr('pointer-events', 'none')
      .text('暂停')

    node.filter(d => d.__isUrgent)
      .append('path')
      .attr('class', 'node-urgent-mark')
      .attr('d', d => {
        const r = getNodeRadius(d.data, d.__directPriority)
        return `M0,${-r - 7} C-4,${-r - 1} -3,${-r + 1} 0,${-r + 3} C3,${-r + 1} 4,${-r - 1} 0,${-r - 7}Z`
      })
      .attr('fill', 'var(--ft-text-primary)')
      .attr('pointer-events', 'none')

    const dueMarker = node.filter(d => d.__dueVisible && layers?.dueArc !== false)
      .append('g')
      .attr('class', 'node-due-marker')
      .attr('pointer-events', 'none')
    dueMarker.append('path')
      .attr('d', d => dueArcPath(getNodeRadius(d.data, d.__directPriority) + 3.5, d.__dueState))
      .attr('fill', 'none')
      .attr('stroke', d => dueColor(d.__dueState?.state))
      .attr('stroke-width', 2)
      .attr('stroke-linecap', 'round')
      .attr('opacity', d => d.__dueState?.state === 'overdue' ? .85 : .72)

    // 标签：顶层用衬线，末端用无衬线；分数只在检视卡显示。
    node.filter(d => labelPositions.has(d.data.id))
      .append('rect')
      .attr('class', 'node-label-backdrop')
      .attr('x', d => labelPositions.get(d.data.id).x - LABEL_BACKDROP_PADDING)
      .attr('y', d => {
        const position = labelPositions.get(d.data.id)
        return position.y - position.height / 2 - LABEL_BACKDROP_PADDING
      })
      .attr('width', d => labelPositions.get(d.data.id).width + LABEL_BACKDROP_PADDING * 2)
      .attr('height', d => labelPositions.get(d.data.id).height + LABEL_BACKDROP_PADDING * 2)
      .attr('rx', d => (labelPositions.get(d.data.id).height + LABEL_BACKDROP_PADDING * 2) / 2)
      .attr('fill', 'var(--ft-surface-hover)')
      .attr('opacity', d => previousById.has(d.data.id) ? LABEL_BACKDROP_OPACITY[theme] : 0)
      .attr('pointer-events', 'none')

    node.filter(d => labelPositions.has(d.data.id))
      .append('text')
      .attr('class', d => `node-label ${d.data.status === 'done' ? 'is-done' : ''}`)
      .attr('x', d => labelPositions.get(d.data.id).x)
      .attr('y', d => labelPositions.get(d.data.id).y)
      .attr('fill', 'var(--ft-text-primary)')
      .attr('font-family', d => labelPositions.get(d.data.id).fontFamily)
      .attr('font-size', d => labelPositions.get(d.data.id).fontSize)
      .attr('font-weight', d => labelPositions.get(d.data.id).fontWeight)
      .attr('paint-order', 'stroke fill')
      .attr('stroke', 'var(--ft-canvas)')
      .attr('stroke-width', 2)
      .attr('stroke-linejoin', 'round')
      .attr('pointer-events', 'auto')
      .attr('opacity', d => previousById.has(d.data.id) ? 1 : 0)
      .style('cursor', 'pointer')
      .each(function (d) {
        const position = labelPositions.get(d.data.id)
        const text = d3.select(this)
        const firstDy = -((position.lines.length - 1) * position.lineHeight) / 2
        position.lines.forEach((line, index) => {
          text.append('tspan')
            .attr('x', position.x)
            .attr('dy', index === 0 ? firstDy : position.lineHeight)
            .text(line)
        })
      })
      .on('click', (event, d) => {
        event.stopPropagation()
        setContextMenu(null)
        onNodeSelectRef.current?.(withDerivedWeightMeta(d))
      })
      .on('dblclick', (event, d) => {
        event.stopPropagation()
        onNodeToggleRef.current?.(d.data)
      })

    node.selectAll('.node-label')
      .transition()
      .delay(motionDuration(420))
      .duration(motionDuration(220))
      .ease(d3.easeCubicOut)
      .attr('opacity', 1)

    node.selectAll('.node-label-backdrop')
      .transition()
      .delay(motionDuration(420))
      .duration(motionDuration(220))
      .ease(d3.easeCubicOut)
      .attr('opacity', LABEL_BACKDROP_OPACITY[theme])

    node
      .transition()
      .duration(motionDuration(700))
      .ease(d3.easeCubicOut)
      .attr('transform', d => nodeTransform(d))

    const changedScoreIds = new Set(nodes
      .map(nodeItem => {
        const previous = previousById.get(nodeItem.data.id)
        return previous && Math.abs((nodeItem.__directPriority || 0) - (previous.__directPriority || 0)) > 0.01
          ? { id: nodeItem.data.id, delta: Math.abs((nodeItem.__directPriority || 0) - (previous.__directPriority || 0)) }
          : null
      })
      .filter(Boolean)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 3)
      .map(item => item.id))
    node.filter(d => changedScoreIds.has(d.data.id))
      .append('circle')
      .attr('class', 'priority-change-pulse')
      .attr('r', d => getNodeRadius(d.data, d.__directPriority) + 4)
      .attr('fill', 'none')
      .attr('stroke', 'var(--ft-accent)')
      .attr('stroke-width', 1.5)
      .attr('opacity', .78)
      .attr('pointer-events', 'none')
      .transition()
      .duration(motionDuration(700))
      .ease(d3.easeCubicOut)
      .attr('r', d => getNodeRadius(d.data, d.__directPriority) + 11)
      .attr('opacity', 0)
      .remove()

    // 居中定位
    const xs = nodes.map(d => d.y)
    const ys = nodes.map(d => d.x)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const treeH = maxY - minY
    const offsetX = MARGIN.left - Math.min(...xs)
    const offsetY = (height - treeH) / 2 - minY + 30
    if (!autoCenteredRef.current) {
      const centeredTransform = d3.zoomIdentity.translate(offsetX, offsetY)
      defaultTransformRef.current = centeredTransform
      currentTransformRef.current = centeredTransform
      if (svgRef.current && zoomRef.current) {
        d3.select(svgRef.current).call(zoomRef.current.transform, centeredTransform)
      } else {
        g.attr('transform', centeredTransform)
      }
      autoCenteredRef.current = true
    }

  }, [treeData, theme, userGoal, density, zoomScale, layers, startInlineRename, priorityCalculationVersion, highlightedNodeId])

  // ── 高亮：监听 highlightedNodeId 变化，更新节点圆圈 + 祖先路径 ──
  useEffect(() => {
    if (!gRef.current) return
    const g = d3.select(gRef.current)

    // 全部复位
    g.selectAll('.node-main-circle')
      .attr('stroke', d => nodeStrokeColor(d))
      .attr('stroke-width', d => nodeStrokeWidth(d))
      .attr('filter', d => nodeFilter(d))
    g.selectAll('.link')
      .attr('opacity', d => linkOpacity(d))
      .each(function () {
        applyLinkStrokeWidth(d3.select(this))
      })

    if (!highlightedNodeId || !rootRef.current) return

    // 找到目标节点
    const target = rootRef.current.descendants().find(d => d.data.id === highlightedNodeId)
    if (!target) return

    // 高亮目标节点的 circle
    g.selectAll(`.node[data-node-id="${highlightedNodeId}"] .node-main-circle`)
      .attr('stroke', 'var(--ft-ai)')
      .attr('stroke-width', 3)
      .attr('filter', 'url(#ft-glow)')

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
      .scaleExtent([ZOOM_MIN, ZOOM_MAX])
      .wheelDelta((event) => {
        const modeScale = event.deltaMode === 1 ? 0.025 : event.deltaMode ? 0.5 : 0.00075
        return -event.deltaY * modeScale
      })
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
        currentTransformRef.current = event.transform
        setZoomScale(prev => Math.abs(prev - event.transform.k) > 0.005 ? event.transform.k : prev)
        d3.select(gRef.current).attr('transform', event.transform)
      })

    zoomRef.current = zoom
    svg.call(zoom)
    svg.call(zoom.transform, currentTransformRef.current || d3.zoomIdentity)

    // 二指滑动 / 鼠标滚轮（无 ctrlKey）→ 平移画布；中键拖拽在下方事件代理里处理。
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
        const [pointerX, pointerY] = d3.pointer({ clientX, clientY }, gRef.current)
        const radius = getNodeRadius(targetNode.data, targetNode.__directPriority)
        const dx = pointerX - targetNode.y
        const dy = pointerY - targetNode.x
        const moveBand = Math.max(DROP_MOVE_BAND_MIN, radius * 0.65)
        const overMoveBand =
          Math.abs(dy) <= moveBand &&
          dx >= -radius - DROP_HIT_PADDING &&
          dx <= radius + DROP_LABEL_WIDTH

        if (overMoveBand) {
          return { mode: 'move', placement: null }
        }

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

        const radius = getNodeRadius(candidate.data, candidate.__directPriority)
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
        .attr('stroke', d => nodeStrokeColor(d))
        .attr('stroke-width', d => nodeStrokeWidth(d))
        .attr('filter', d => nodeFilter(d))
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

    const resolveBranchDragSource = (event) => {
      const handleEl =
        event.target.closest?.('.node-main-circle') ||
        event.target.closest?.('.node-drag-handle')

      if (handleEl) {
        const nodeEl = handleEl.closest?.('.node')
        const nodeId = nodeEl?.getAttribute('data-node-id')
        const hNode = nodeId
          ? rootRef.current?.descendants().find(n => n.data.id === nodeId)
          : null
        if (!hNode || hNode.data.type === 'root') return null
        return {
          hNode,
          nodeId,
          sourceEl: nodeEl,
          handleEl,
          addParentNode: hNode,
          addType: childTypeFor(hNode),
          addOnly: false,
          sameLevelAdd: false,
          lineStartX: hNode.y,
          lineStartY: hNode.x,
        }
      }

      const branchEl = event.target.closest?.('.terminal-branch-add-hit')
      const nodeId = branchEl?.getAttribute('data-target-id')
      if (!nodeId) return null

      const hNode = rootRef.current?.descendants().find(n => n.data.id === nodeId)
      if (!hNode || hNode.data.type === 'root') return null

      const nodeEl = gRef.current?.querySelector(`.node[data-node-id="${nodeId}"]`)
      const parentNode = hNode.parent?.data?.type === 'root' ? null : hNode.parent
      const [lineStartX, lineStartY] = d3.pointer(event, gRef.current)
      return {
        hNode,
        nodeId,
        sourceEl: nodeEl || branchEl,
        handleEl: branchEl,
        addParentNode: parentNode,
        addType: childTypeForParent(hNode.parent),
        addOnly: true,
        sameLevelAdd: true,
        lineStartX,
        lineStartY,
      }
    }

    const startCanvasPan = (event) => {
      if (event.button !== MIDDLE_MOUSE_BUTTON || !zoomRef.current) return false
      if (canvasPanRef.current.active) return true

      event.preventDefault()
      event.stopPropagation()
      window.getSelection?.()?.removeAllRanges?.()

      const svg = d3.select(svgEl)
      canvasPanRef.current = {
        active: true,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
        previousCursor: svgEl.style.cursor,
        previousBodyUserSelect: document.body.style.userSelect,
        previousBodyWebkitUserSelect: document.body.style.webkitUserSelect,
      }
      svgEl.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
      document.body.style.webkitUserSelect = 'none'
      setContextMenu(null)
      setTooltip(null)

      const cleanup = () => {
        const state = canvasPanRef.current
        document.removeEventListener('mousemove', onMove, listenerOptions)
        document.removeEventListener('mouseup', onUp, listenerOptions)
        window.removeEventListener('blur', onCancel)
        svgEl.style.cursor = state.previousCursor || ''
        if (state.previousBodyUserSelect !== undefined) {
          document.body.style.userSelect = state.previousBodyUserSelect
        }
        if (state.previousBodyWebkitUserSelect !== undefined) {
          document.body.style.webkitUserSelect = state.previousBodyWebkitUserSelect
        }
        canvasPanRef.current = {}
      }

      const onMove = (e) => {
        const state = canvasPanRef.current
        if (!state.active) return
        e.preventDefault()
        e.stopPropagation()

        const dx = e.clientX - state.lastX
        const dy = e.clientY - state.lastY
        state.lastX = e.clientX
        state.lastY = e.clientY
        if (dx === 0 && dy === 0) return

        state.moved = true
        svg.call(zoomRef.current.translateBy, dx, dy)
      }

      const onUp = (e) => {
        const moved = Boolean(canvasPanRef.current.moved)
        cleanup()
        e.preventDefault()
        e.stopPropagation()
        if (moved) suppressPostDragClick()
      }

      const onCancel = () => {
        cleanup()
      }

      document.addEventListener('mousemove', onMove, listenerOptions)
      document.addEventListener('mouseup', onUp, listenerOptions)
      window.addEventListener('blur', onCancel)
      return true
    }

    const startBranchDrag = (event, options) => {
      if (dragRef.current.node) return
      if ('button' in event && event.button !== 0) return

      // 起手范围：节点圆点/紧贴圆点的小 handle，或最末端枝干的透明命中线。
      // 注意：不用 .node-hit-area —— 那个向右延伸到 label 区，会误抓父节点。
      const source = resolveBranchDragSource(event)
      if (!source) return
      const { hNode, nodeId, sourceEl, handleEl } = source

      // 阻止浏览器默认行为（文本选中、三指拖拽等）
      event.preventDefault()
      event.stopPropagation()
      window.getSelection?.()?.removeAllRanges?.()

      const startX = source.lineStartX
      const startY = source.lineStartY
      const previewLine = d3.select(gRef.current)
        .append('path')
        .attr('class', 'drag-preview-link')
        .attr('d', dragPreviewPath(startX, startY, startX, startY))
        .attr('fill', 'none')
        .attr('stroke', 'var(--ft-ai)')
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
        .attr('fill', 'var(--ft-surface-raised)')
        .attr('stroke', 'var(--ft-ai)')
        .attr('stroke-width', 1)
      previewBadge.append('text')
        .attr('class', 'drag-preview-badge-text')
        .attr('fill', 'var(--ft-text-primary)')
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
        sourceEl,
        handleEl,
        previousHandleCursor: handleEl.style.cursor,
        addParentNode: source.addParentNode,
        addType: source.addType,
        addOnly: source.addOnly,
        sameLevelAdd: source.sameLevelAdd,
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
      if (sourceEl) sourceEl.style.cursor = 'grabbing'
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

        const drop = dragRef.current.dragging && !dragRef.current.addOnly
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
            label = addPreviewLabel(dragRef.current.addType, dragRef.current.sameLevelAdd)
          }
          dragRef.current.previewLine
            ?.attr('stroke', !drop?.node && addGesture ? 'var(--ft-accent)' : 'var(--ft-ai)')
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
              .attr('stroke', d => nodeStrokeColor(d))
              .attr('stroke-width', d => nodeStrokeWidth(d))
              .attr('filter', d => nodeFilter(d))
          }
          if (drop?.el) {
            d3.select(drop.el).select('.node-main-circle')
              .attr('stroke', drop.mode === 'reorder' ? 'var(--ft-warn)' : 'var(--ft-accent)')
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
          previousBodyUserSelect, handleEl, previousHandleCursor,
          addParentNode, addType, addOnly,
        } = dragRef.current
        restoreDragStyles({ sourceEl, previousBodyUserSelect })
        if (handleEl) handleEl.style.cursor = previousHandleCursor || ''
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

        const drop = addOnly ? null : findBranchDropTarget(endX, endY, node, sourceEl)
        if (drop?.node) {
          onDropRef.current?.(node.data, drop.node.data, {
            mode: drop.mode,
            placement: drop.placement,
          })
        } else if (isRightAddGesture(startX, startY, endX, endY)) {
          const parentData = addOnly
            ? (addParentNode?.data?.type === 'root' ? null : addParentNode?.data || null)
            : (addParentNode?.data || node.data)
          onLeafAddRef.current?.(
            parentData,
            addType || childTypeFor(node),
            { source: addOnly ? 'terminal-branch-drag' : 'node-right-drag' }
          )
        }
      }

      const onCancel = (e) => {
        if (!isSamePointer(e)) return
        cleanup()
        const { handleEl, previousHandleCursor } = dragRef.current
        restoreDragStyles(dragRef.current)
        if (handleEl) handleEl.style.cursor = previousHandleCursor || ''
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
      if (startCanvasPan(event)) return
      startBranchDrag(event, {
        moveEvent: 'mousemove',
        upEvent: 'mouseup',
        pointerId: null,
        usePointerCapture: false,
      })
    }

    const onAuxClick = (event) => {
      if (event.button !== MIDDLE_MOUSE_BUTTON) return
      event.preventDefault()
      event.stopPropagation()
    }

    const onClickCapture = (event) => {
      if (!suppressClickRef.current) return
      event.preventDefault()
      event.stopPropagation()
    }

    const listenerOptions = { capture: true, passive: false }
    svgEl.addEventListener('pointerdown', onPointerDown, listenerOptions)
    svgEl.addEventListener('mousedown', onMouseDown, listenerOptions)
    svgEl.addEventListener('auxclick', onAuxClick, listenerOptions)
    svgEl.addEventListener('click', onClickCapture, true)
    return () => {
      svgEl.removeEventListener('pointerdown', onPointerDown, listenerOptions)
      svgEl.removeEventListener('mousedown', onMouseDown, listenerOptions)
      svgEl.removeEventListener('auxclick', onAuxClick, listenerOptions)
      svgEl.removeEventListener('click', onClickCapture, true)
    }
  }, [])

  return (
    <div className="ft-tree-view" style={{ width: '100%', height: '100%', position: 'relative', overscrollBehavior: 'none' }}>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        role="tree"
        aria-label="专注树结构画布"
        aria-activedescendant={highlightedNodeId ? treeItemDomId(highlightedNodeId) : undefined}
        tabIndex={0}
        focusable="true"
        onKeyDown={handleTreeKeyDown}
        className="ft-tree-svg"
        style={{
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          touchAction: 'none',
          overscrollBehavior: 'none',
        }}
      >
        <g ref={gRef} />
      </svg>

      <CanvasControls
        zoomScale={zoomScale}
        onZoomIn={() => zoomBy(ZOOM_BUTTON_FACTOR)}
        onZoomOut={() => zoomBy(1 / ZOOM_BUTTON_FACTOR)}
        onReset={() => zoomRef.current?.scaleTo?.(d3.select(svgRef.current), 1)}
        onFit={resetZoom}
        showMore={controlsOpen}
        onToggleMore={() => setControlsOpen(value => !value)}
        density={density}
        onDensityChange={onDensityChange}
        onExpandAll={onExpandAll}
        onCollapseAll={onCollapseAll}
        layers={layers}
        onLayerChange={onLayerChange}
      />

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
          className="ft-inline-edit"
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
