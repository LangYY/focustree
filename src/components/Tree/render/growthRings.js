export function ringValues(radius, cultivationScore, dense = false) {
  const cultivation = Math.max(0, Math.min(100, Number(cultivationScore) || 0)) / 100
  if (cultivation < 0.15) return []
  const count = dense ? 1 : Math.max(1, Math.min(4, Math.round(cultivation * 4)))
  return Array.from({ length: count }, (_, index) => ({
    radius: radius + 4 + (index + 1) * (3 + cultivation * 3),
    opacity: 0.18 * (1 - index / count) * (0.4 + cultivation * 0.6),
  }))
}
