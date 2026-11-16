import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { useRewrite } from '../../src/composables/useRewrite'

const SUGGESTIONS = ['Use their name', 'Drop "ASAP"', 'Say who you are']
// Whitespace and newlines on purpose: Undo must give back the original byte for byte.
const ORIGINAL = '  Dear friend,\n\n\tPlease answer ASAP.  \n'

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })

function setup(initial = ORIGINAL) {
  const text = ref(initial)
  const scope = effectScope()
  const rewriter = scope.run(() => useRewrite(text))!
  return { text, rewriter, scope }
}

afterEach(() => vi.unstubAllGlobals())

describe('useRewrite', () => {
  it('replaces the text with the rewrite and offers Undo', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json(200, { rewrittenText: 'Hi Marie,\n\nCould you reply this week?' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { text, rewriter } = setup()

    await rewriter.rewrite(SUGGESTIONS)

    expect(text.value).toBe('Hi Marie,\n\nCould you reply this week?')
    expect(rewriter.canUndo.value).toBe(true)
    expect(rewriter.status.value).toBe('idle')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      text: ORIGINAL,
      suggestions: SUGGESTIONS,
    })
  })

  it('undo restores the original exactly, whitespace and newlines included (review focus #5)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, { rewrittenText: 'Rewritten' })),
    )
    const { text, rewriter } = setup()
    await rewriter.rewrite(SUGGESTIONS)

    rewriter.undo()

    expect(text.value).toBe(ORIGINAL)
    expect(rewriter.canUndo.value).toBe(false)
  })

  it('after several rewrites in a row, Undo still goes back to the original', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock
      .mockResolvedValueOnce(json(200, { rewrittenText: 'First rewrite' }))
      .mockResolvedValueOnce(json(200, { rewrittenText: 'Second rewrite' }))
    vi.stubGlobal('fetch', fetchMock)
    const { text, rewriter } = setup()

    await rewriter.rewrite(SUGGESTIONS)
    await rewriter.rewrite(SUGGESTIONS)
    expect(text.value).toBe('Second rewrite')

    rewriter.undo()
    expect(text.value).toBe(ORIGINAL)
  })

  it('stops offering Undo once the user edits the rewritten text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, { rewrittenText: 'Rewritten' })),
    )
    const { text, rewriter } = setup()
    await rewriter.rewrite(SUGGESTIONS)

    text.value = 'Rewritten, then edited by hand'
    expect(rewriter.canUndo.value).toBe(false)
    rewriter.undo()
    expect(text.value).toBe('Rewritten, then edited by hand')
  })

  it('keeps the text and reports the error when the API refuses (429)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(429, { error: { code: 'RATE_LIMITED', message: 'x' } }, { 'retry-after': '12' }),
      ),
    )
    const { text, rewriter } = setup()
    await rewriter.rewrite(SUGGESTIONS)

    expect(text.value).toBe(ORIGINAL)
    expect(rewriter.status.value).toBe('error')
    expect(rewriter.error.value).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 12 })
    expect(rewriter.canUndo.value).toBe(false)
  })

  it('is loading while the request runs', async () => {
    let respond!: (r: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((r) => (respond = r))),
    )
    const { rewriter } = setup()

    const done = rewriter.rewrite(SUGGESTIONS)
    expect(rewriter.status.value).toBe('loading')
    respond(json(200, { rewrittenText: 'ok' }))
    await done
    expect(rewriter.status.value).toBe('idle')
  })

  it('never overwrites text that changed while the rewrite was running', async () => {
    let respond!: (r: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((r) => (respond = r))),
    )
    const { text, rewriter } = setup()

    const done = rewriter.rewrite(SUGGESTIONS)
    text.value = 'Typed meanwhile'
    respond(json(200, { rewrittenText: 'Rewritten' }))
    await done

    expect(text.value).toBe('Typed meanwhile')
    expect(rewriter.canUndo.value).toBe(false)
  })
})
