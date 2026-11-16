import { describe, expect, it } from 'vitest'
import { escapeHtml, toHighlightedHtml } from '../../src/lib/highlight'
import { findHits, type SpamHit } from '../../src/lib/spam-check'

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () =>
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    ))

  it('leaves ordinary text alone', () => expect(escapeHtml('Hello, Marie!')).toBe('Hello, Marie!'))
})

describe('toHighlightedHtml', () => {
  it('escapes user HTML and wraps hits in a category mark (review focus #1)', () => {
    const text = '<img src=x onerror=alert(1)> ASAP'
    const html = toHighlightedHtml(text, findHits(text))

    expect(html).toContain('&lt;img')
    expect(html).toContain('<mark class="hit hit--urgency">ASAP</mark>')
    expect(html).not.toContain('<img')
  })

  it('escapes the text inside a mark too', () => {
    const hits: SpamHit[] = [{ start: 0, end: 7, keyword: 'x', category: 'shady' }]
    expect(toHighlightedHtml('<b>&</b>', hits)).toBe(
      '<mark class="hit hit--shady">&lt;b&gt;&amp;&lt;/b</mark>&gt;',
    )
  })

  it('keeps the text between and after hits, in order', () => {
    const text = 'Act now, it is free. Bye'
    const hits: SpamHit[] = [
      { start: 0, end: 7, keyword: 'Act now', category: 'urgency' },
      { start: 15, end: 19, keyword: 'Free', category: 'money' },
    ]
    expect(toHighlightedHtml(text, hits)).toBe(
      '<mark class="hit hit--urgency">Act now</mark>, it is <mark class="hit hit--money">free</mark>. Bye',
    )
  })

  it('returns the escaped text when there are no hits', () =>
    expect(toHighlightedHtml('a < b', [])).toBe('a &lt; b'))

  it('adds a line after a trailing newline, so the last line keeps its height', () => {
    expect(toHighlightedHtml('Hi\n', [])).toBe('Hi\n\n')
    expect(toHighlightedHtml('Hi', [])).toBe('Hi')
  })
})
