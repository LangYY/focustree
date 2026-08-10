export function stripReviewDecorations(value) {
  return String(value ?? '')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu, '')
    .replace(/^\s*---+\s*$/gm, '')
    .replace(/^\s*[·•]\s*/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim()
}

const SECTION_NAMES = {
  '本周进展': 'wins',
  '看到的模式': 'patterns',
  '想问你': 'challenges',
  '下周提议': 'proposals',
  WINS: 'wins',
  PATTERNS: 'patterns',
  CHALLENGES: 'challenges',
  PROPOSALS: 'proposals',
}

export function formatReviewContent(review) {
  const source = review?.parsed ?? review?.summary ?? ''
  return isReviewObject(source) ? normalizeReviewObject(source) : parseSerializedReview(source)
}

function isReviewObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeReviewObject(value) {
  return {
    opening: cleanReviewText(value.opening),
    wins: normalizeTextList(value.wins),
    patterns: normalizeTextList(value.patterns),
    challenges: normalizeTextList(value.challenges),
    proposals: normalizeProposals(value.proposals),
    closing: cleanReviewText(value.closing),
  }
}

function normalizeTextList(value) {
  return Array.isArray(value)
    ? value.map(cleanReviewText).filter(Boolean)
    : []
}

function normalizeProposals(value) {
  if (!Array.isArray(value)) return []
  return value.map(proposal => {
    if (isReviewObject(proposal)) {
      return {
        action: cleanReviewText(proposal.action),
        rationale: cleanReviewText(proposal.rationale),
      }
    }
    return proposalFromLine(proposal)
  }).filter(proposal => proposal.action || proposal.rationale)
}

function parseSerializedReview(value) {
  const clean = stripReviewDecorations(value)
  const result = emptyReview()
  let section = null
  let proposalGap = false

  for (const rawLine of clean.split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      if (section === 'proposals') proposalGap = true
      continue
    }

    const heading = SECTION_NAMES[normalizeHeading(line)]
    if (heading) {
      section = heading
      proposalGap = false
      continue
    }

    if (section === 'proposals' && proposalGap && !line.includes('—')) {
      result.closing = appendText(result.closing, line)
      section = null
      proposalGap = false
      continue
    }

    if (section === 'wins' || section === 'patterns' || section === 'challenges') {
      result[section].push(line)
    } else if (section === 'proposals') {
      result.proposals.push(proposalFromLine(line))
      proposalGap = false
    } else if (!result.opening) {
      result.opening = line
    } else {
      result.closing = appendText(result.closing, line)
    }
  }

  return result
}

function emptyReview() {
  return { opening: '', wins: [], patterns: [], challenges: [], proposals: [], closing: '' }
}

function normalizeHeading(value) {
  return value.replace(/[：:。.!！?？]+$/u, '').trim()
}

function proposalFromLine(value) {
  const text = cleanReviewText(value)
  const [action, rationale] = text.split(/\s+[—-]\s+/, 2)
  return { action: action || '', rationale: rationale || '' }
}

function cleanReviewText(value) {
  return stripReviewDecorations(value)
    .replace(/\s*\n\s*/g, ' ')
    .trim()
}

function appendText(current, value) {
  return current ? `${current} ${value}` : value
}
