import { ChevronsDown, ChevronsUp, MoreHorizontal, Maximize2, Minus, Plus } from 'lucide-react'
import Segmented from '../ui/Segmented'

export default function CanvasControls({ zoomScale = 1, onZoomIn, onZoomOut, onReset, onFit, onToggleMore, showMore, density, onDensityChange, onExpandAll, onCollapseAll, layers, onLayerChange }) {
  return (
    <div className={`ft-canvas-controls ${showMore ? 'is-expanded' : ''}`} onMouseDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
      <div className="ft-control-column">
        <ControlButton icon={Plus} label="放大" onClick={onZoomIn} />
        <button type="button" className="ft-zoom-readout" onClick={onReset} title="复位到 100%">{Math.round(zoomScale * 100)}%</button>
        <ControlButton icon={Minus} label="缩小" onClick={onZoomOut} />
        <div className="ft-control-rule" />
        <ControlButton icon={Maximize2} label="全局视图" onClick={onFit} />
        <ControlButton icon={MoreHorizontal} label={showMore ? '收起更多' : '展开更多'} active={showMore} onClick={onToggleMore} />
      </div>
      {showMore ? (
        <div className="ft-control-more">
          <div className="ft-control-more-actions">
            <button type="button" onClick={onExpandAll}><ChevronsDown size={14} />展开全部</button>
            <button type="button" onClick={onCollapseAll}><ChevronsUp size={14} />折叠全部</button>
          </div>
          <Segmented
            className="ft-density-control"
            ariaLabel="树节点密度"
            value={density}
            onChange={onDensityChange}
            options={[{ value: 'sparse', label: '疏' }, { value: 'medium', label: '中' }, { value: 'dense', label: '密' }]}
          />
          <div className="ft-layer-control">
            {[
              ['dueArc', '期限弧'],
              ['rings', '年轮'],
            ].map(([key, label]) => (
              <label key={key}><input type="checkbox" checked={layers?.[key] !== false} onChange={event => onLayerChange?.(key, event.target.checked)} /><span>{label}</span></label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ControlButton({ icon: Icon, label, onClick, active = false }) {
  return <button type="button" className={`ft-control-button ${active ? 'is-active' : ''}`} onClick={onClick} title={label} aria-label={label}><Icon size={16} strokeWidth={1.7} /></button>
}
