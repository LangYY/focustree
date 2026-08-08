const ARC_ANGLES = Object.freeze({ overdue: 360, today: 300, three_days: 210, week: 120 })

export function dueArcPath(radius, dueState) {
  const degrees = ARC_ANGLES[dueState?.state]
  if (!degrees) return null
  if (degrees >= 360) return `M0,${-radius} A${radius},${radius} 0 1 1 0,${radius} A${radius},${radius} 0 1 1 0,${-radius}`
  const start = -Math.PI / 2
  const end = start + degrees * Math.PI / 180
  const largeArc = degrees > 180 ? 1 : 0
  const x0 = Math.cos(start) * radius
  const y0 = Math.sin(start) * radius
  const x1 = Math.cos(end) * radius
  const y1 = Math.sin(end) * radius
  return `M${x0},${y0} A${radius},${radius} 0 ${largeArc} 1 ${x1},${y1}`
}

export function dueColor(state) {
  if (state === 'overdue' || state === 'today') return 'var(--ft-danger)'
  return 'var(--ft-warn)'
}
