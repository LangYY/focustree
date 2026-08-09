import { cloneElement, isValidElement, useId } from 'react'

export default function Tooltip({ content, children, side = 'top', className = '' }) {
  const id = useId()
  const trigger = isValidElement(children)
    ? cloneElement(children, { 'aria-describedby': id })
    : <span className="ft-tooltip-trigger" tabIndex="0" aria-describedby={id}>{children}</span>
  return (
    <span className={`ft-tooltip ft-tooltip-${side} ${className}`}>
      {trigger}
      <span id={id} role="tooltip" className="ft-tooltip-content">{content}</span>
    </span>
  )
}
