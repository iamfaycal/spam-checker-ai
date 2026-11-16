import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalysisResult, ErrorCode } from '@spam-checker/shared'
import { ApiError, analyzeEmail, errorMessage, rewriteEmail } from '../../src/lib/api'

const RESULT: AnalysisResult = {
  summary: 'High risk.',
  riskLevel: 'high',
  suggestions: ['Remove "ASAP"', 'Drop the ROI promise', 'Say who you are'],
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function stubFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (e) {
    return e
  }
  throw new Error('expected the promise to reject')
}

afterEach(() => vi.unstubAllGlobals())

describe('analyzeEmail', () => {
  it('POSTs the text as JSON to /api/analyze and returns the analysis', async () => {
    const fetchMock = stubFetch(async () => json(200, RESULT))
    await expect(analyzeEmail('Hello')).resolves.toEqual(RESULT)

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/analyze')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({ 'content-type': 'application/json' })
    expect(JSON.parse(String(init?.body))).toEqual({ text: 'Hello' })
  })

  it('rejects a 200 whose body breaks the contract as LLM_BAD_OUTPUT', async () => {
    stubFetch(async () => json(200, { ...RESULT, suggestions: ['a', 'b'] }))
    const error = await errorOf(analyzeEmail('Hello'))
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'LLM_BAD_OUTPUT' })
  })

  it('rejects a 200 that is not JSON as LLM_BAD_OUTPUT', async () => {
    stubFetch(async () => new Response('<html>oops</html>', { status: 200 }))
    expect(await errorOf(analyzeEmail('Hello'))).toMatchObject({ code: 'LLM_BAD_OUTPUT' })
  })

  it('maps a 429 to RATE_LIMITED and reads Retry-After', async () => {
    stubFetch(async () =>
      json(429, { error: { code: 'RATE_LIMITED', message: 'slow down' } }, { 'retry-after': '30' }),
    )
    expect(await errorOf(analyzeEmail('Hello'))).toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 30,
    })
  })

  it('takes the code from the error body, whatever the status', async () => {
    stubFetch(async () => json(503, { error: { code: 'DAILY_CAP_REACHED', message: 'x' } }))
    expect(await errorOf(analyzeEmail('Hello'))).toMatchObject({ code: 'DAILY_CAP_REACHED' })
  })

  it('maps an error body that is not ours (e.g. a proxy HTML page) to INTERNAL', async () => {
    stubFetch(async () => new Response('<html>Bad Gateway</html>', { status: 502 }))
    expect(await errorOf(analyzeEmail('Hello'))).toMatchObject({ code: 'INTERNAL' })
  })

  it('maps a failed fetch to NETWORK', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await errorOf(analyzeEmail('Hello'))).toMatchObject({ code: 'NETWORK' })
  })

  it('lets a deliberate abort through as an AbortError, not NETWORK', async () => {
    stubFetch(async (_url, init) => {
      init?.signal?.throwIfAborted()
      return json(200, RESULT)
    })
    const controller = new AbortController()
    controller.abort()
    const error = await errorOf(analyzeEmail('Hello', controller.signal))
    expect(error).not.toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ name: 'AbortError' })
  })
})

describe('errorMessage', () => {
  it.each([
    ['RATE_LIMITED', 42, 'Too many AI requests — try again in 42s.'],
    ['RATE_LIMITED', undefined, 'Too many AI requests — try again shortly.'],
    ['DAILY_CAP_REACHED', undefined, "The demo's daily AI quota is used up. Try again tomorrow."],
    ['INVALID_INPUT', undefined, 'Add some text (max 5,000 characters).'],
    ['PAYLOAD_TOO_LARGE', undefined, 'Add some text (max 5,000 characters).'],
    ['LLM_TIMEOUT', undefined, "The AI couldn't analyze this email. Try again."],
    ['LLM_BAD_OUTPUT', undefined, "The AI couldn't analyze this email. Try again."],
    ['LLM_UNAVAILABLE', undefined, "The AI couldn't analyze this email. Try again."],
    ['NETWORK', undefined, 'Network error — check your connection.'],
    ['NOT_FOUND', undefined, 'Something went wrong. Try again.'],
    ['INTERNAL', undefined, 'Something went wrong. Try again.'],
  ] as const)('%s (retry %s) → %s', (code: ErrorCode | 'NETWORK', retry, message) =>
    expect(errorMessage(new ApiError(code, retry))).toBe(message),
  )

  it.each([
    [42, 'Too many AI requests — try again in 42s.'],
    [150, 'Too many AI requests — try again in 3 min.'],
    [3600, 'Too many AI requests — try again in 1 h.'],
    [84213, 'Too many AI requests — try again in 23 h 24 min.'],
  ])('formats a %is wait for people, not as raw seconds', (seconds, message) =>
    expect(errorMessage(new ApiError('RATE_LIMITED', seconds))).toBe(message),
  )

  it('names the action that failed', () =>
    expect(errorMessage(new ApiError('LLM_TIMEOUT'), 'rewrite')).toBe(
      "The AI couldn't rewrite this email. Try again.",
    ))
})

describe('rewriteEmail', () => {
  it('POSTs the text and suggestions to /api/rewrite and returns the rewrite', async () => {
    const fetchMock = stubFetch(async () => json(200, { rewrittenText: 'Hi Marie' }))
    await expect(rewriteEmail('Dear friend', ['a', 'b', 'c'])).resolves.toEqual({
      rewrittenText: 'Hi Marie',
    })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/rewrite')
    expect(JSON.parse(String(init?.body))).toEqual({
      text: 'Dear friend',
      suggestions: ['a', 'b', 'c'],
    })
  })

  it('rejects an empty rewrite as LLM_BAD_OUTPUT', async () => {
    stubFetch(async () => json(200, { rewrittenText: '' }))
    expect(await errorOf(rewriteEmail('Hi', ['a', 'b', 'c']))).toMatchObject({
      code: 'LLM_BAD_OUTPUT',
    })
  })
})
