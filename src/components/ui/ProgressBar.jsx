export default function ProgressBar({ value = 0, tone = 'accent', className = '' }) {
  return (
    <span className={`ft-progress ${className}`} data-tone={tone}>
      <span style={{ width: `${Math.max(0, Math.min(100, Number(value) || 0))}%` }} />
    </span>
  )
}
