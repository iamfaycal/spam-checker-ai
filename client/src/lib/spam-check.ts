import { SPAM_RULES } from './spam-words'

export type SpamCategory = 'urgency' | 'shady' | 'overpromise' | 'money' | 'unnatural'

export const SPAM_CATEGORIES: readonly SpamCategory[] = [
  'urgency',
  'shady',
  'overpromise',
  'money',
  'unnatural',
]

export interface SpamRule {
  pattern: RegExp
  keyword: string
  category: SpamCategory
}

/** One spam word found in the text: `text.slice(start, end)` is the matched word. */
export interface SpamHit {
  start: number
  end: number
  keyword: string
  category: SpamCategory
}

export type ScoreLabel = 'Great' | 'Okay' | 'Poor'

/**
 * Every rule match in the text, sorted by position. Where matches overlap
 * ("Dear friend" and "Friend"), only the longest is kept (D23).
 */
export function findHits(text: string, rules: readonly SpamRule[] = SPAM_RULES): SpamHit[] {
  const matches: SpamHit[] = []
  for (const { pattern, keyword, category } of rules) {
    // matchAll works on an internal copy of the regex, so the shared /g regexes keep
    // lastIndex at 0 and every call starts from the beginning of the text.
    for (const m of text.matchAll(pattern)) {
      if (m[0].length === 0) continue
      matches.push({ start: m.index, end: m.index + m[0].length, keyword, category })
    }
  }

  // Longest first (earliest on ties); keep a match only if it overlaps nothing kept so far.
  matches.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)
  const kept: SpamHit[] = []
  for (const m of matches) {
    if (!kept.some((k) => m.start < k.end && k.start < m.end)) kept.push(m)
  }
  return kept.sort((a, b) => a.start - b.start)
}

/** Unique keywords per category, in order of appearance; every category is present. */
export function groupByCategory(hits: readonly SpamHit[]): Record<SpamCategory, string[]> {
  const groups = Object.fromEntries(SPAM_CATEGORIES.map((c) => [c, [] as string[]])) as Record<
    SpamCategory,
    string[]
  >
  for (const { category, keyword } of hits) {
    if (!groups[category].includes(keyword)) groups[category].push(keyword)
  }
  return groups
}

/** The original tool's formula: one point per hit, plus a penalty per kind of category present. */
export function scoreLabel(hits: readonly SpamHit[]): ScoreLabel {
  const has = (category: SpamCategory) => hits.some((h) => h.category === category)
  const score =
    hits.length +
    (has('money') || has('shady') ? 20 : 0) +
    (has('urgency') || has('overpromise') ? 10 : 0)
  return score > 20 ? 'Poor' : score > 5 ? 'Okay' : 'Great'
}

export function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}

/** The original tool's formula: 200 words per minute, rounded. */
export function readTime(words: number): string {
  const minutes = Math.round(words / 200)
  return minutes === 0 ? 'a few seconds' : `${minutes} min`
}
