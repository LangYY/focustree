export const LABEL_VERTICAL_GAP = 4
// 标签坐在节点正上方，这是文字基线到节点圆心的最小距离（再加上半径）。
export const LABEL_ABOVE_GAP = 9
// 单行文字的包围盒相对基线的上下分配：基线以上约 0.78 个行高，以下留出降部。
const ASCENT_RATIO = 0.78

export function truncateLabel(value, maxWidth = Number.POSITIVE_INFINITY, fontSize = 16) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const limit = Number(maxWidth)
  if (!Number.isFinite(limit) || estimateTextWidth(text, fontSize) <= limit) return text

  const chars = Array.from(text)
  while (chars.length > 1 && estimateTextWidth(`${chars.join('')}…`, fontSize) > limit) chars.pop()
  return `${chars.join('')}…`
}

export function labelStyle(node) {
  const type = node?.data?.type || node?.type
  // 字族全应用统一，层级只由字号和字重区分。
  if (type === 'project' || type === 'category') {
    return {
      fontFamily: 'var(--ft-font-sans)',
      fontSize: 15,
      fontWeight: 600,
      lineHeight: 20,
    }
  }
  return {
    fontFamily: 'var(--ft-font-sans)',
    fontSize: 12.5,
    fontWeight: 400,
    lineHeight: 17,
  }
}

export function layoutLabelPositions(nodes, {
  getRadius = () => 0,
  shouldShow = () => true,
  getMaxWidth = () => Number.POSITIVE_INFINITY,
} = {}) {
  const positions = new Map()
  const occupiedByDepth = new Map()
  // 标签在节点上方，发生碰撞时只能继续往上让。从画布最下方开始放置，
  // 后放的标签永远是往已放置的那些之上躲，不会反过来把它们推开。
  const visibleNodes = nodes
    .filter(node => node?.data?.type !== 'root' && shouldShow(node))
    .sort((a, b) => (b.x || 0) - (a.x || 0) || (a.depth || 0) - (b.depth || 0))

  visibleNodes.forEach(node => {
    const data = node.data || node
    const style = labelStyle(node)
    const requestedMaxWidth = Number(getMaxWidth(node, style))
    const maxWidth = Number.isFinite(requestedMaxWidth)
      ? Math.max(style.fontSize, requestedMaxWidth)
      : Number.POSITIVE_INFINITY
    const text = truncateLabel(data.name, maxWidth, style.fontSize)
    const radius = Number(getRadius(node)) || 0

    const width = Math.max(estimateTextWidth(text, style.fontSize), style.fontSize)
    const height = style.lineHeight
    const baseline = -(radius + LABEL_ABOVE_GAP)
    const left = node.y || 0
    const right = left + width
    const depth = node.depth || 0
    const baseTop = (node.x || 0) + baseline - height * ASCENT_RATIO

    let offset = 0
    while (true) {
      const top = baseTop + offset
      const bottom = top + height
      let collision = null
      for (let candidateDepth = depth - 1; candidateDepth <= depth + 1 && !collision; candidateDepth += 1) {
        const candidates = occupiedByDepth.get(candidateDepth) || []
        collision = candidates.find(other => (
          left < other.right && right > other.left &&
          top < other.bottom + LABEL_VERTICAL_GAP && bottom > other.top - LABEL_VERTICAL_GAP
        ))
      }
      if (!collision) break
      offset = Math.min(offset, collision.top - LABEL_VERTICAL_GAP - (baseTop + height))
    }

    const position = {
      x: 0,
      y: baseline + offset,
      width,
      height,
      text,
      lineHeight: style.lineHeight,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      left,
      right,
      top: baseTop + offset,
      bottom: baseTop + offset + height,
    }
    positions.set(data.id, position)
    const occupied = occupiedByDepth.get(depth) || []
    occupied.push(position)
    occupiedByDepth.set(depth, occupied)
  })

  return positions
}

export function estimateTextWidth(text, fontSize) {
  return Array.from(text).reduce((width, character) => {
    const isNarrow = (character.codePointAt(0) || 0) <= 0xff
    return width + fontSize * (isNarrow ? 0.62 : 1)
  }, 0)
}
