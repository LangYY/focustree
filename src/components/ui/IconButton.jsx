export default function IconButton({
  icon: Icon,
  label,
  active = false,
  tone = 'default',
  badge,
  className = '',
  ...props
}) {
  return (
    <button
      type="button"
      className={`ft-icon-button ${active ? 'is-active' : ''} ft-icon-button-${tone} ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      {Icon ? <Icon size={19} strokeWidth={1.7} aria-hidden="true" /> : null}
      {badge != null && badge > 0 ? <span className="ft-icon-badge">{badge > 9 ? '9+' : badge}</span> : null}
    </button>
  )
}
