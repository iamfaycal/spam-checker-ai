import { describe, expect, it, jest } from '@jest/globals'
import { MockLanguageModelV4 } from 'ai/test'
import request from 'supertest'
import { createLlmAnalyzer } from '../src/analysis/analyzer.js'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'

/** The real analyzer inside the real app; only the model is a mock (review focus #4). */
function appWithModelReplying(text: string) {
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  })
  const analyzer = createLlmAnalyzer({ model, timeoutMs: 1000 })
  return createApp({ analyzer, config: loadConfig({}) })
}

const answer = (suggestions: string[]) =>
  JSON.stringify({ summary: 'Risky.', riskLevel: 'high', suggestions })

describe('LLM output through the real analyzer and route', () => {
  it.each([
    ['2 suggestions', answer(['a', 'b'])],
    ['4 suggestions', answer(['a', 'b', 'c', 'd'])],
    ['a 121-character suggestion', answer(['a', 'b', 'c'.repeat(121)])],
    ['text that is not JSON', 'Sure! Here is my analysis.'],
  ])('answers 502 LLM_BAD_OUTPUT for %s, never a 500 or a pass-through', async (_, text) => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const res = await request(appWithModelReplying(text))
      .post('/api/analyze')
      .send({ text: 'Hello' })

    expect(res.status).toBe(502)
    expect(res.body).toEqual({ error: { code: 'LLM_BAD_OUTPUT', message: expect.any(String) } })
    jest.restoreAllMocks()
  })

  it('passes a valid answer through unchanged', async () => {
    const res = await request(appWithModelReplying(answer(['a', 'b', 'c'])))
      .post('/api/analyze')
      .send({ text: 'Hello' })
    expect(res.status).toBe(200)
    expect(res.body.suggestions).toEqual(['a', 'b', 'c'])
  })
})
