import { describe, expect, it } from 'vitest'
import {
  findHits,
  groupByCategory,
  readTime,
  scoreLabel,
  wordCount,
  type SpamHit,
  type SpamRule,
} from '../../src/lib/spam-check'

// The default text of the original tool (and of the reference screenshot).
const SAMPLE = `Dear friend,

I am a Financial Consultant in control of privately owned funds placed for long term investments.

My client intends to invest these funds in projects. I am willing to finance projects at a guaranteed 5% ROI per annum for projects ranging from 2 years term and above but not exceeding 12 years.

Please answer ASAP.`

const hit = (category: SpamHit['category'], keyword = 'x'): SpamHit => ({
  start: 0,
  end: 1,
  keyword,
  category,
})

describe('findHits (real rules)', () => {
  it('finds the expected spam words in the sample email', () => {
    const hits = findHits(SAMPLE)
    const found = hits.map((h) => [h.keyword, h.category])
    expect(found).toContainEqual(['ASAP', 'urgency'])
    expect(found).toContainEqual(['Guaranteed', 'overpromise'])
    expect(found).toContainEqual(['Privately owned funds', 'shady'])
  })

  it('finds nothing in an ordinary email', () =>
    expect(findHits('Hello Marie, see you tomorrow.')).toEqual([]))

  it('returns offsets that slice back to the matched words, sorted by start', () => {
    const hits = findHits(SAMPLE)
    for (const h of hits) {
      expect(SAMPLE.slice(h.start, h.end).toLowerCase()).toMatch(/\S/)
    }
    expect(SAMPLE.slice(...range(hits, 'ASAP'))).toBe('ASAP')
    expect(SAMPLE.slice(...range(hits, 'Privately owned funds'))).toBe('privately owned funds')
    expect(hits.map((h) => h.start)).toEqual([...hits.map((h) => h.start)].sort((a, b) => a - b))
  })

  it('keeps one hit, the longest, where rules overlap ("Dear friend" vs "Friend")', () => {
    const hits = findHits('Dear friend, hello')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ start: 0, end: 11, category: 'unnatural' })
  })

  it('gives the same result on every call (global regexes are stateful)', () =>
    expect(findHits(SAMPLE)).toEqual(findHits(SAMPLE)))

  it('returns nothing for empty text', () => expect(findHits('')).toEqual([]))
})

describe('findHits (engine, custom rules)', () => {
  const rules: SpamRule[] = [
    { pattern: /\bact\b/gi, keyword: 'Act', category: 'urgency' },
    { pattern: /\bact now\b/gi, keyword: 'Act now', category: 'urgency' },
    { pattern: /\bfree\b/gi, keyword: 'Free', category: 'money' },
  ]

  it('prefers the longest of overlapping matches', () =>
    expect(findHits('Act now!', rules)).toEqual([
      { start: 0, end: 7, keyword: 'Act now', category: 'urgency' },
    ]))

  it('finds every occurrence, case-insensitively', () =>
    expect(findHits('free FREE Free', rules).map((h) => h.start)).toEqual([0, 5, 10]))
})

describe('groupByCategory', () => {
  it('lists unique keywords per category, with every category present', () => {
    const groups = groupByCategory([
      hit('urgency', 'ASAP'),
      hit('urgency', 'ASAP'),
      hit('money', 'Cash'),
    ])
    expect(groups).toEqual({
      urgency: ['ASAP'],
      shady: [],
      overpromise: [],
      money: ['Cash'],
      unnatural: [],
    })
  })
})

describe('scoreLabel (original formula)', () => {
  it.each([
    ['no hits', [], 'Great'],
    ['5 unnatural hits (score 5)', Array(5).fill(hit('unnatural')), 'Great'],
    ['6 unnatural hits (score 6)', Array(6).fill(hit('unnatural')), 'Okay'],
    ['1 urgency hit (1 + 10)', [hit('urgency')], 'Okay'],
    ['1 overpromise hit (1 + 10)', [hit('overpromise')], 'Okay'],
    ['1 money hit (1 + 20)', [hit('money')], 'Poor'],
    ['1 shady hit (1 + 20)', [hit('shady')], 'Poor'],
  ] as const)('%s → %s', (_, hits, label) => expect(scoreLabel([...hits])).toBe(label))

  it('rates the sample email Poor', () => expect(scoreLabel(findHits(SAMPLE))).toBe('Poor'))
})

describe('wordCount', () => {
  it('counts the sample email as 57 words', () => expect(wordCount(SAMPLE)).toBe(57))
  it('ignores surrounding and repeated whitespace', () =>
    expect(wordCount('  hello   world \n')).toBe(2))
  it('counts a single word', () => expect(wordCount('hello')).toBe(1))
  it('counts empty or blank text as 0', () => {
    expect(wordCount('')).toBe(0)
    expect(wordCount(' \n ')).toBe(0)
  })
})

describe('readTime (original formula: round(words / 200))', () => {
  it.each([
    [0, 'a few seconds'],
    [57, 'a few seconds'],
    [99, 'a few seconds'],
    [100, '1 min'],
    [450, '2 min'],
    [1000, '5 min'],
  ])('%i words → %s', (words, label) => expect(readTime(words)).toBe(label))
})

function range(hits: SpamHit[], keyword: string): [number, number] {
  const h = hits.find((x) => x.keyword === keyword)
  if (!h) throw new Error(`no hit for ${keyword}`)
  return [h.start, h.end]
}
