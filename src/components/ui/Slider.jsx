function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function snap(value, min, max, step) {
  const snapped = min + Math.round((value - min) / step) * step
  const precision = String(step).split('.')[1]?.length || 0
  return Number(clamp(snapped, min, max).toFixed(precision + 2))
}

export default function Slider({
  value = 0,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  label,
  valueText,
  showValue = false,
  changed = false,
  className = '',
  ...props
}) {
  const numericValue = snap(Number(value) || 0, min, max, step)
  const text = valueText ?? String(numericValue)
  const commit = next => onChange?.(snap(Number(next), min, max, step))
  const handleKeyDown = event => {
    let next = null
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = numericValue - step
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = numericValue + step
    if (event.key === 'Home') next = min
    if (event.key === 'End') next = max
    if (next == null) return
    event.preventDefault()
    commit(next)
  }

  return (
    <label className={`ft-slider ${changed ? 'is-changed' : ''} ${className}`}>
      {label ? <span className="ft-slider-label">{label}</span> : null}
      <input
        {...props}
        type="range"
        role="slider"
        min={min}
        max={max}
        step={step}
        value={numericValue}
        onChange={event => commit(event.target.value)}
        onKeyDown={handleKeyDown}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={numericValue}
        aria-valuetext={text}
      />
      {showValue ? <output className="ft-slider-value">{text}</output> : null}
    </label>
  )
}
