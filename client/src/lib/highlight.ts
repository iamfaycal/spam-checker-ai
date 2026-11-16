import type { SpamHit } from './spam-check'

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c)
}

/**
 * The editor backdrop's HTML: the text with each hit wrapped in a <mark> (D17).
 * Every piece of user text goes through escapeHtml, so this string is safe for v-html;
 * the only tags in it are the marks added here. `hits` must be sorted and
 * non-overlapping, which findHits guarantees.
 */
export function toHighlightedHtml(text: string, hits: readonly SpamHit[]): string {
  let html = ''
  let pos = 0
  for (const hit of hits) {
    html += escapeHtml(text.slice(pos, hit.start))
    html += `<mark class="hit hit--${hit.category}">${escapeHtml(text.slice(hit.start, hit.end))}</mark>`
    pos = hit.end
  }
  html += escapeHtml(text.slice(pos))
  // A div drops a trailing newline that a textarea shows as an empty last line;
  // one more keeps both the same height (same trick as highlight-within-textarea).
  return text.endsWith('\n') ? `${html}\n` : html
}
