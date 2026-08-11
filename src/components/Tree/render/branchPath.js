export function branchPath(link, parentWidth, childWidth, samples = 24) {
  const source = link?.source
  const target = link?.target
  if (!source || !target) return ''
  const p0 = { x: source.y, y: source.x }
  const p1 = { x: target.y, y: target.x }
  const midX = p0.x + (p1.x - p0.x) * 0.5
  const upper = []
  const lower = []
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples
    const point = cubicPoint(p0, { x: midX, y: p0.y }, { x: midX, y: p1.y }, p1, t)
    const tangent = cubicTangent(p0, { x: midX, y: p0.y }, { x: midX, y: p1.y }, p1, t)
    const length = Math.hypot(tangent.x, tangent.y) || 1
    const normal = { x: -tangent.y / length, y: tangent.x / length }
    const eased = t * t * (3 - 2 * t)
    const width = lerp(parentWidth, childWidth, eased) * (1 - 0.12 * t ** 3)
    upper.push([point.x + normal.x * width / 2, point.y + normal.y * width / 2])
    lower.push([point.x - normal.x * width / 2, point.y - normal.y * width / 2])
  }
  const points = [...upper, ...lower.reverse()]
  return `M${points.map(([x, y]) => `${x},${y}`).join(' L')} Z`
}

export function centerLinePath(link) {
  const source = link?.source
  const target = link?.target
  if (!source || !target) return ''
  const midX = source.y + (target.y - source.y) * 0.5
  return `M${source.y},${source.x} C${midX},${source.x} ${midX},${target.x} ${target.y},${target.x}`
}

export function branchTangent(link, t = 0.88) {
  const source = link?.source
  const target = link?.target
  if (!source || !target) return { x: 1, y: 0 }

  const p0 = { x: source.y, y: source.x }
  const p1 = { x: target.y, y: target.x }
  const midX = p0.x + (p1.x - p0.x) * 0.5
  const amount = Math.max(0, Math.min(1, Number(t) || 0))
  const tangent = cubicTangent(
    p0,
    { x: midX, y: p0.y },
    { x: midX, y: p1.y },
    p1,
    amount,
  )
  const length = Math.hypot(tangent.x, tangent.y) || 1
  return { x: tangent.x / length, y: tangent.y / length }
}

function cubicPoint(p0, c0, c1, p1, t) {
  const mt = 1 - t
  return {
    x: mt ** 3 * p0.x + 3 * mt ** 2 * t * c0.x + 3 * mt * t ** 2 * c1.x + t ** 3 * p1.x,
    y: mt ** 3 * p0.y + 3 * mt ** 2 * t * c0.y + 3 * mt * t ** 2 * c1.y + t ** 3 * p1.y,
  }
}

function cubicTangent(p0, c0, c1, p1, t) {
  const mt = 1 - t
  return {
    x: 3 * mt ** 2 * (c0.x - p0.x) + 6 * mt * t * (c1.x - c0.x) + 3 * t ** 2 * (p1.x - c1.x),
    y: 3 * mt ** 2 * (c0.y - p0.y) + 6 * mt * t * (c1.y - c0.y) + 3 * t ** 2 * (p1.y - c1.y),
  }
}

function lerp(start, end, amount) {
  return start + (end - start) * amount
}
