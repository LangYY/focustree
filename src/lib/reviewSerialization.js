const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu

export function serializeReview(review = {}) {
  const parts = []
  const opening = cleanText(review.opening)
  const closing = cleanText(review.closing)
  if (opening) parts.push(opening)
  if (review.wins?.length) parts.push(`\n本周进展：\n${review.wins.map(item => `· ${cleanText(item)}`).join('\n')}`)
  if (review.patterns?.length) parts.push(`\n看到的模式：\n${review.patterns.map(item => `· ${cleanText(item)}`).join('\n')}`)
  if (review.challenges?.length) parts.push(`\n想问你：\n${review.challenges.map(item => `· ${cleanText(item)}`).join('\n')}`)
  if (review.proposals?.length) {
    parts.push(`\n下周提议：\n${review.proposals.map(proposal => {
      const action = cleanText(typeof proposal === 'object' ? proposal.action : proposal)
      const rationale = cleanText(typeof proposal === 'object' ? proposal.rationale : '')
      return `· ${action}${rationale ? ` — ${rationale}` : ''}`
    }).join('\n')}`)
  }
  if (closing) parts.push(`\n${closing}`)
  return parts.join('\n')
}

function cleanText(value) {
  return String(value ?? '')
    .replace(EMOJI_RE, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
}
