import { describe, expect, it, jest } from '@jest/globals'
import request from 'supertest'
import type { Analyzer } from '../src/analysis/analyzer.js'
import { AnalyzerError } from '../src/analysis/errors.js'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'

const SUGGESTIONS = ['Use their name', 'Drop "ASAP"', 'Say who you are']

function appWith(rewrite: Analyzer['rewrite'] = async () => ({ rewrittenText: 'Hi Marie' })) {
  const analyzer = {
    analyze: jest.fn<Analyzer['analyze']>(),
    rewrite: jest.fn(rewrite),
  }
  return { app: createApp({ analyzer, config: loadConfig({}) }), analyzer }
}

describe('POST /api/rewrite', () => {
  it('returns the rewritten text, sending the trimmed text and the suggestions', async () => {
    const { app, analyzer } = appWith()
    const res = await request(app)
      .post('/api/rewrite')
      .send({ text: '  Dear friend  ', suggestions: SUGGESTIONS })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ rewrittenText: 'Hi Marie' })
    expect(analyzer.rewrite).toHaveBeenCalledWith(
      'Dear friend',
      SUGGESTIONS,
      expect.any(AbortSignal),
    )
  })

  it.each([
    ['missing suggestions', { text: 'Hello' }],
    ['2 suggestions', { text: 'Hello', suggestions: ['a', 'b'] }],
    ['empty text', { text: ' ', suggestions: SUGGESTIONS }],
  ])('rejects %s with 400 INVALID_INPUT, without calling the LLM', async (_, body) => {
    const { app, analyzer } = appWith()
    const res = await request(app).post('/api/rewrite').send(body)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_INPUT')
    expect(analyzer.rewrite).not.toHaveBeenCalled()
  })

  it('maps LLM failures like /api/analyze', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const { app } = appWith(async () => {
      throw new AnalyzerError('bad_output')
    })
    const res = await request(app)
      .post('/api/rewrite')
      .send({ text: 'Hi', suggestions: SUGGESTIONS })

    expect(res.status).toBe(502)
    expect(res.body.error.code).toBe('LLM_BAD_OUTPUT')
    jest.restoreAllMocks()
  })
})
