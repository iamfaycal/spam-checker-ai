import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import type { AnalysisResult } from '@spam-checker/shared'
import { useAiAnalysis } from '../../src/composables/useAiAnalysis'

const result = (summary: string): AnalysisResult => ({
  summary,
  riskLevel: 'medium',
  suggestions: ['One', 'Two', 'Three'],
})

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

/** A fetch whose responses the test releases by hand, in any order. */
function controllableFetch() {
  const pending: {
    init?: RequestInit
    respond: (r: Response) => void
    fail: (e: unknown) => void
  }[] = []
  const fetchMock = vi.fn(
    (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((respond, fail) => pending.push({ init, respond, fail })),
  )
  vi.stubGlobal('fetch', fetchMock)
  return pending
}

/** Run the composable inside an effect scope, as a component would. */
function setup(initial: string) {
  const text = ref(initial)
  const scope = effectScope()
  const analysis = scope.run(() => useAiAnalysis(text))!
  return { text, analysis, scope }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => vi.unstubAllGlobals())

describe('useAiAnalysis', () => {
  it('goes idle → loading → success and keeps the result', async () => {
    const pending = controllableFetch()
    const { analysis } = setup('Hello')
    expect(analysis.status.value).toBe('idle')

    const done = analysis.analyze()
    expect(analysis.status.value).toBe('loading')
    pending[0]?.respond(json(result('first')))
    await done

    expect(analysis.status.value).toBe('success')
    expect(analysis.result.value?.summary).toBe('first')
    expect(analysis.error.value).toBeNull()
  })

  it('applies only the latest of two quick analyses, and aborts the first (review focus #5)', async () => {
    const pending = controllableFetch()
    const { text, analysis } = setup('first text')

    const first = analysis.analyze()
    text.value = 'second text'
    const second = analysis.analyze()

    expect(pending[0]?.init?.signal?.aborted).toBe(true)
    pending[1]?.respond(json(result('second')))
    await second
    // The first answer arrives late, after all: it must not overwrite the second.
    pending[0]?.respond(json(result('first')))
    await first

    expect(analysis.result.value?.summary).toBe('second')
    expect(analysis.isStale.value).toBe(false)
  })

  it('does not show an error when the replaced request rejects with AbortError', async () => {
    const pending = controllableFetch()
    const { analysis } = setup('Hello')

    const first = analysis.analyze()
    const second = analysis.analyze()
    pending[0]?.fail(new DOMException('aborted', 'AbortError'))
    await first
    expect(analysis.status.value).toBe('loading')

    pending[1]?.respond(json(result('second')))
    await second
    expect(analysis.status.value).toBe('success')
    expect(analysis.error.value).toBeNull()
  })

  it('marks a result stale when the text was edited while it was being analyzed (review focus #5)', async () => {
    const pending = controllableFetch()
    const { text, analysis } = setup('Text as sent')

    const done = analysis.analyze()
    text.value = 'Text edited while waiting'
    pending[0]?.respond(json(result('for the sent text')))
    await done

    expect(analysis.result.value?.summary).toBe('for the sent text')
    expect(analysis.isStale.value).toBe(true)
    text.value = 'Text as sent'
    expect(analysis.isStale.value).toBe(false)
  })

  it('marks the result stale when the text changes, and fresh again when it changes back', async () => {
    const pending = controllableFetch()
    const { text, analysis } = setup('Hello')
    const done = analysis.analyze()
    pending[0]?.respond(json(result('ok')))
    await done
    expect(analysis.isStale.value).toBe(false)

    text.value = 'Hello!'
    expect(analysis.isStale.value).toBe(true)
    text.value = 'Hello'
    expect(analysis.isStale.value).toBe(false)
  })

  it('reports an API failure as error, with the typed ApiError', async () => {
    const pending = controllableFetch()
    const { analysis } = setup('Hello')
    const done = analysis.analyze()
    pending[0]?.respond(
      new Response(JSON.stringify({ error: { code: 'LLM_TIMEOUT', message: 'slow' } }), {
        status: 504,
      }),
    )
    await done

    expect(analysis.status.value).toBe('error')
    expect(analysis.error.value?.code).toBe('LLM_TIMEOUT')
    expect(analysis.isStale.value).toBe(false)
  })

  it('aborts the request in flight when its component goes away', async () => {
    const pending = controllableFetch()
    const { analysis, scope } = setup('Hello')
    void analysis.analyze()
    await flush()
    scope.stop()
    expect(pending[0]?.init?.signal?.aborted).toBe(true)
  })
})
