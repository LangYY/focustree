import { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { getNodeRadius, getNodeColor, getLinkStrokeWidth } from '../../lib/treeUtils'
import ContextMenu from './ContextMenu'
import NodeTooltip from './NodeTooltip'

const MARGIN = { top: 20, right: 120, bottom: 20, left: 60 }
const NODE_H_GAP = 220
const NODE_V_GAP = 48

export default function TreeView({ treeData, density, onNodeClick, onContextAction, resetZoomRef, highlightedNodeId }) {
  const svgRef  = useRef(null)
  const gRef    = useRef(null)
  const zoomRef = useRef(null)
  const rootRef = useRef(null)   // 缓存 d3 hierarchy root，供高亮 effect 使用

  const [contextMenu, setContextMenu] = useState(null)  // { x, y, node }
  const [tooltip, setTooltip]         = useState(null)  // { x, y, node }

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

    const svg    = d3.select(svgRef.current)
    const width  = svgRef.current.clientWidth
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

    // 点击：折叠/展开
    node.filter(d => d.data.type !== 'root')
      .on('click', (event, d) => {
        event.stopPropagation()
        setContextMenu(null)
        onNodeClick?.(d.data)
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

    // 圆圈
    node.filter(d => d.data.type !== 'root')
      .append('circle')
      .attr('r', d => getNodeRadius(d.data.type))
      .attr('fill', d => getNodeColor(d.data))
      .attr('stroke', '#1f2937')
      .attr('stroke-width', 1.5)

    // 完成勾
    node.filter(d => d.data.status === 'done')
      .append('text')
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
    g.selectAll('.node circle')
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
    g.selectAll(`.node[data-node-id="${highlightedNodeId}"] circle`)
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
      .on('zoom', (event) => {
        d3.select(gRef.current).attr('transform', event.transform)
      })

    zoomRef.current = zoom
    svg.call(zoom)
    svg.on('click.bg', () => setContextMenu(null))

    return () => svg.on('.zoom', null).on('click.bg', null)
  }, [])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ background: '#0f1117' }}
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
