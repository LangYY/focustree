export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  loading = false,
  className = '',
  type = 'button',
  ...props
}) {
  return (
    <button
      {...props}
      type={type}
      className={`ft-button ft-button-${variant} ft-button-${size} ${className}`}
      aria-busy={loading || undefined}
      disabled={props.disabled || loading}
    >
      {Icon ? <Icon size={size === 'sm' ? 13 : 15} strokeWidth={1.8} aria-hidden="true" /> : null}
      <span>{loading ? '处理中…' : children}</span>
    </button>
  )
}
