export const LABEL_MAX_CHARS_PER_LINE = 11
export const LABEL_MAX_LINES = 2
export const LABEL_VERTICAL_GAP = 4

export function splitLabelLines(
  value,
  maxCharsPerLine = LABEL_MAX_CHARS_PER_LINE,
  maxWidth = Number.POSITIVE_INFINITY,
  fontSize = 16,
) {
  const text = String(value ?? '').trim()
  if (!text) return ['']

  const maxChars = Math.max(1, Number(maxCharsPerLine) || LABEL_MAX_CHARS_PER_LINE)
  const widthLimit = Number.isFinite(Number(maxWidth))
    ? Math.max(Number(fontSize) || 16, Number(maxWidth))
    : Number.POSITIVE_INFINITY
  const chars = Array.from(text)
  const lines = []

  let cursor = 0
  while (cursor < chars.length && lines.length < LABEL_MAX_LINES) {
    const line = []
    while (cursor < chars.length && line.length < maxChars) {
      const next = [...line, chars[cursor]].join('')
      if (line.length && estimateTextWidth(next, fontSize) > widthLimit) break
      line.push(chars[cursor])
      cursor += 1
    }
    if (!line.length) {
      line.push(chars[cursor])
      cursor += 1
    }
    lines.push(line.join(''))
  }

  if (cursor < chars.length) {
    const lastIndex = lines.length - 1
    const lastLine = Array.from(lines[lastIndex] || '')
    while (
      lastLine.length > 0 &&
      estimateTextWidth(`${lastLine.join('')}…`, fontSize) > widthLimit
    ) {
      lastLine.pop()
    }
    lines[lastIndex] = `${lastLine.slice(0, Math.max(0, maxChars - 1)).join('')}…`
  }

  return lines
}

export function labelStyle(node) {
  const type = node?.data?.type || node?.type
  if (type === 'project' || type === 'category') {
    return {
      fontFamily: 'var(--ft-font-serif)',
      fontSize: 16,
      fontWeight: 500,
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
  getAnchorOffset = () => ({ x: 0, y: 0 }),
} = {}) {
  const positions = new Map()
  const occupiedByDepth = new Map()
  const visibleNodes = nodes
    .filter(node => node?.data?.type !== 'root' && shouldShow(node))
    .sort((a, b) => (a.x || 0) - (b.x || 0) || (a.depth || 0) - (b.depth || 0))

  visibleNodes.forEach(node => {
    const data = node.data || node
    const style = labelStyle(node)
    const requestedMaxWidth = Number(getMaxWidth(node, style))
    const maxWidth = Number.isFinite(requestedMaxWidth)
      ? Math.max(style.fontSize, requestedMaxWidth)
      : Number.POSITIVE_INFINITY
    const lines = splitLabelLines(data.name, LABEL_MAX_CHARS_PER_LINE, maxWidth, style.fontSize)
    const radius = Number(getRadius(node)) || 0
    const anchorOffset = getAnchorOffset(node, style) || {}
    const anchorX = Number(anchorOffset.x) || 0
    const anchorY = Number(anchorOffset.y) || 0
    const x = radius + 12 + anchorX
    const width = Math.max(...lines.map(line => estimateTextWidth(line, style.fontSize)), style.fontSize)
    const height = lines.length * style.lineHeight
    const baseTop = (node.x || 0) + anchorY - height / 2
    const left = (node.y || 0) + x
    const depth = node.depth || 0
    let offset = 0

    while (true) {
      const top = baseTop + offset
      const bottom = top + height
      let collision = null
      for (let candidateDepth = depth - 1; candidateDepth <= depth + 1 && !collision; candidateDepth += 1) {
        const candidates = occupiedByDepth.get(candidateDepth) || []
        collision = candidates.find(other => (
          left < other.right && left + width > other.left &&
          top < other.bottom + LABEL_VERTICAL_GAP && bottom > other.top - LABEL_VERTICAL_GAP
        ))
      }
      if (!collision) break
      offset = Math.max(offset, collision.bottom + LABEL_VERTICAL_GAP - baseTop)
    }

    const position = {
      x,
      y: anchorY + offset,
      width,
      height,
      lines,
      lineHeight: style.lineHeight,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      left,
      right: left + width,
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
