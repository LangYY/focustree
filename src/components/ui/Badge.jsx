export default function Badge({ children, tone = 'neutral', className = '' }) {
  return <span className={`ft-badge ft-badge-${tone} ${className}`}>{children}</span>
}
