import EmptyState from '../ui/EmptyState'
import Legend from './Legend'
import TodayPill from './TodayPill'
import TreeView from './TreeView'
import { ONBOARDING_STEPS } from '../../lib/onboarding.js'
import { OnboardingDecision, OnboardingReading, OnboardingWelcome } from '../Onboarding/Onboarding.jsx'

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
  onboarding,
}) {
  if (treeLoading) return <div className="ft-loading-state"><span className="ft-loading-line" />正在把树长出来…</div>
  if (!treeData) {
    if (onboarding?.active) {
      return (
        <div className="ft-canvas-stage ft-onboarding-empty-canvas">
          <OnboardingStep onboarding={onboarding} />
        </div>
      )
    }
    return <EmptyState onExample={onExample} examples={['我现在同时在做三件事，有点乱', '帮我把这段项目描述整理成结构', '我这周该先做什么']} />
  }
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
      {onboarding?.active && STAGE_STEPS.has(onboarding.step) ? (
        <div className="ft-onboarding-stage-layer">
          <OnboardingStep onboarding={onboarding} />
        </div>
      ) : null}
    </div>
  )
}

// 占据画布的三步：介绍产品、讲怎么读树、再让用户选怎么开始。
const STAGE_STEPS = new Set([
  ONBOARDING_STEPS.WELCOME,
  ONBOARDING_STEPS.READING,
  ONBOARDING_STEPS.DECISION,
])

function OnboardingStep({ onboarding }) {
  if (!onboarding?.active) return null
  if (onboarding.step === ONBOARDING_STEPS.WELCOME) {
    return <OnboardingWelcome onNext={onboarding.next} onSkip={onboarding.skip} />
  }
  if (onboarding.step === ONBOARDING_STEPS.READING) {
    return (
      <OnboardingReading
        channelIndex={onboarding.channelIndex}
        onNext={onboarding.next}
        onBack={onboarding.back}
        onSkip={onboarding.skip}
      />
    )
  }
  if (onboarding.step === ONBOARDING_STEPS.DECISION) {
    return (
      <OnboardingDecision
        onChooseReal={onboarding.chooseReal}
        onChooseExample={onboarding.chooseExample}
        onBack={onboarding.back}
        onSkip={onboarding.skip}
        exampleLoading={onboarding.exampleLoading}
      />
    )
  }
  return null
}
