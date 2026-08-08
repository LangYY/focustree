import EmptyState from '../ui/EmptyState'
import Legend from './Legend'
import TodayPill from './TodayPill'
import TreeView from './TreeView'

export default function CanvasStage({
  theme,
  treeData,
  treeLoading,
  dailyFocus,
  onNodeSelect,
  onNodeToggle,
  onContextAction,
  resetZoomRef,
  highlightedNodeId,
  onLeafAdd,
  onDropBranch,
  onRenameNode,
  priorityCalculationVersion,
  density,
  onDensityChange,
  onExpandAll,
  onCollapseAll,
  onExample,
  userGoal,
  layers,
  onLayerChange,
  onLegendHover,
}) {
  if (treeLoading) return <div className="ft-loading-state"><span className="ft-loading-line" />正在把树长出来…</div>
  if (!treeData) return <EmptyState onExample={onExample} examples={['我现在同时在做三件事，有点乱', '帮我把这段项目描述整理成结构', '我这周该先做什么']} />
  return (
    <div className="ft-canvas-stage">
      <TodayPill {...dailyFocus} />
      <TreeView
        treeData={treeData}
        theme={theme}
        userGoal={userGoal}
        density={density}
        onDensityChange={onDensityChange}
        onExpandAll={onExpandAll}
        onCollapseAll={onCollapseAll}
        onNodeSelect={onNodeSelect}
        onNodeToggle={onNodeToggle}
        onContextAction={onContextAction}
        resetZoomRef={resetZoomRef}
        highlightedNodeId={highlightedNodeId}
        onLeafAdd={onLeafAdd}
        onDropBranch={onDropBranch}
        onRenameNode={onRenameNode}
        priorityCalculationVersion={priorityCalculationVersion}
        layers={layers}
        onLayerChange={onLayerChange}
        onLegendHover={onLegendHover}
      />
      <Legend onHover={onLegendHover} />
    </div>
  )
}
