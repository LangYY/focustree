export default function Segmented({ options, value, onChange, className = '', ariaLabel }) {
  return (
    <div className={`ft-segmented ${className}`} role="group" aria-label={ariaLabel}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? 'is-active' : ''}
          onClick={() => onChange?.(option.value)}
          disabled={option.disabled}
          title={option.title}
        >
          {option.icon ? <option.icon size={14} strokeWidth={1.7} aria-hidden="true" /> : null}
          {option.label}
        </button>
      ))}
    </div>
  )
}
