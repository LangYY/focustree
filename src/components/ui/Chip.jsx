export default function Chip({
  children,
  active = false,
  tone = 'default',
  onClick,
  onRemove,
  className = '',
  ...props
}) {
  const classNames = `ft-chip ft-chip-${tone} ${active ? 'is-active' : ''} ${onClick ? 'is-interactive' : ''} ${className}`
  if (onClick && onRemove) {
    return (
      <span {...props} className={classNames} role="group">
        <button type="button" className="ft-chip-main" onClick={onClick} aria-pressed={active}>
          <span>{children}</span>
        </button>
        <button type="button" className="ft-chip-remove" onClick={event => { event.stopPropagation(); onRemove() }} aria-label="移除">×</button>
      </span>
    )
  }
  const Tag = onClick ? 'button' : 'span'
  return (
    <Tag
      {...props}
      type={onClick ? 'button' : undefined}
      className={classNames}
      aria-pressed={onClick ? active : undefined}
      onClick={onClick}
    >
      <span>{children}</span>
      {onRemove ? <button type="button" className="ft-chip-remove" onClick={event => { event.stopPropagation(); onRemove() }} aria-label="移除">×</button> : null}
    </Tag>
  )
}
