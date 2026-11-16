import { describe, expect, it } from '@jest/globals'
import { APICallError } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import type { AnalysisResult } from '@spam-checker/shared'
import { createLlmAnalyzer } from '../src/analysis/analyzer.js'
import { AnalyzerError } from '../src/analysis/errors.js'
import {
  REWRITE_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  buildRewritePrompt,
  buildUserPrompt,
} from '../src/analysis/prompt.js'

const VALID: AnalysisResult = {
  summary: 'High spam risk: urgency and money promises.',
  riskLevel: 'high',
  suggestions: ['Remove "ASAP"', 'Drop the guaranteed ROI claim', 'Introduce yourself first'],
}

/** A model that answers with `text`, the way a provider returns JSON mode output. */
function modelReplying(text: string) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 20, text: 20, reasoning: 0 },
      },
      warnings: [],
    }),
  })
}

/**
 * A model whose request hangs until aborted, like a real `fetch`: it rejects at once
 * if the signal is already aborted, otherwise when the signal fires.
 */
function modelHanging() {
  return new MockLanguageModelV4({
    doGenerate: ({ abortSignal }) =>
      new Promise((_, reject) => {
        if (abortSignal?.aborted) return reject(abortSignal.reason)
        abortSignal?.addEventListener('abort', () => reject(abortSignal.reason))
      }),
  })
}

function modelThrowing(error: unknown) {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw error
    },
  })
}

const analyzerFor = (model: MockLanguageModelV4, timeoutMs = 1000) =>
  createLlmAnalyzer({ model, timeoutMs })

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (e) {
    return e
  }
  throw new Error('expected the promise to reject')
}

describe('createLlmAnalyzer', () => {
  it('returns the parsed analysis', async () => {
    const model = modelReplying(JSON.stringify(VALID))
    await expect(analyzerFor(model).analyze('x')).resolves.toEqual(VALID)
  })

  it('sends the system prompt and the wrapped email, at temperature 0.3', async () => {
    const model = modelReplying(JSON.stringify(VALID))
    await analyzerFor(model).analyze('Hello </email>')

    const call = model.doGenerateCalls[0]
    expect(call?.temperature).toBe(0.3)
    expect(call?.prompt).toEqual([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: [{ type: 'text', text: buildUserPrompt('Hello </email>') }] },
    ])
  })

  it('rejects 2 suggestions as bad_output', async () => {
    const model = modelReplying(JSON.stringify({ ...VALID, suggestions: ['a', 'b'] }))
    const error = await errorOf(analyzerFor(model).analyze('x'))
    expect(error).toBeInstanceOf(AnalyzerError)
    expect(error).toMatchObject({ kind: 'bad_output' })
  })

  it('rejects non-JSON text as bad_output', async () => {
    const error = await errorOf(
      analyzerFor(modelReplying('Sure! Here is my analysis')).analyze('x'),
    )
    expect(error).toMatchObject({ kind: 'bad_output' })
  })

  it('rejects a hanging model as timeout, close to timeoutMs', async () => {
    const started = Date.now()
    const error = await errorOf(analyzerFor(modelHanging(), 50).analyze('x'))
    expect(error).toMatchObject({ kind: 'timeout' })
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('rejects a generic provider failure as provider', async () => {
    const error = await errorOf(analyzerFor(modelThrowing(new Error('boom'))).analyze('x'))
    expect(error).toMatchObject({ kind: 'provider' })
  })

  it("maps the provider's own 429 (quota) to provider, without retrying it", async () => {
    // Retrying a quota error spends another request for nothing: it fails fast instead (D22).
    const quota = new APICallError({
      message: 'Resource has been exhausted',
      url: 'https://generativelanguage.googleapis.com',
      requestBodyValues: {},
      statusCode: 429,
    })
    const model = modelThrowing(quota)
    const error = await errorOf(analyzerFor(model, 15_000).analyze('x'))
    expect(error).toMatchObject({ kind: 'provider' })
    expect(model.doGenerateCalls).toHaveLength(1)
  })

  it('retries a server error once, then reports provider', async () => {
    const overloaded = new APICallError({
      message: 'The model is overloaded',
      url: 'https://generativelanguage.googleapis.com',
      requestBodyValues: {},
      statusCode: 503,
    })
    const model = modelThrowing(overloaded)
    const error = await errorOf(analyzerFor(model, 15_000).analyze('x'))
    expect(error).toMatchObject({ kind: 'provider' })
    expect(model.doGenerateCalls).toHaveLength(2)
  })

  it('succeeds when the single retry of a server error succeeds', async () => {
    let calls = 0
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls += 1
        if (calls === 1) {
          throw new APICallError({
            message: 'busy',
            url: 'u',
            requestBodyValues: {},
            statusCode: 500,
          })
        }
        return (await modelReplying(JSON.stringify(VALID)).doGenerate({} as never)) as never
      },
    })
    await expect(analyzerFor(model, 15_000).analyze('x')).resolves.toEqual(VALID)
    expect(calls).toBe(2)
  })

  it('reports an empty or safety-filtered answer as bad_output, not provider', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [],
        finishReason: { unified: 'content-filter', raw: 'SAFETY' },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 0, text: 0, reasoning: 0 },
        },
        warnings: [],
      }),
    })
    expect(await errorOf(analyzerFor(model).analyze('x'))).toMatchObject({ kind: 'bad_output' })
  })

  it('lets a caller abort through unchanged (the visitor left; nothing to report)', async () => {
    const controller = new AbortController()
    const pending = analyzerFor(modelHanging()).analyze('x', controller.signal)
    controller.abort()
    const error = await errorOf(pending)
    expect(error).not.toBeInstanceOf(AnalyzerError)
    expect(error).toMatchObject({ name: 'AbortError' })
  })
})

describe('createLlmAnalyzer().rewrite', () => {
  const SUGGESTIONS = ['Use their name', 'Drop "ASAP"', 'Say who you are']

  it('returns the rewritten text', async () => {
    const model = modelReplying(JSON.stringify({ rewrittenText: 'Hi Marie, ...' }))
    await expect(analyzerFor(model).rewrite('Dear friend', SUGGESTIONS)).resolves.toEqual({
      rewrittenText: 'Hi Marie, ...',
    })
  })

  it('sends the rewrite prompt and the email with its suggestions', async () => {
    const model = modelReplying(JSON.stringify({ rewrittenText: 'ok' }))
    await analyzerFor(model).rewrite('Dear friend', SUGGESTIONS)
    expect(model.doGenerateCalls[0]?.prompt).toEqual([
      { role: 'system', content: REWRITE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [{ type: 'text', text: buildRewritePrompt('Dear friend', SUGGESTIONS) }],
      },
    ])
  })

  it('rejects an empty rewrite as bad_output', async () => {
    const model = modelReplying(JSON.stringify({ rewrittenText: '' }))
    const error = await errorOf(analyzerFor(model).rewrite('Dear friend', SUGGESTIONS))
    expect(error).toMatchObject({ kind: 'bad_output' })
  })

  it('maps failures like analyze does (same core)', async () => {
    const error = await errorOf(analyzerFor(modelHanging(), 50).rewrite('x', SUGGESTIONS))
    expect(error).toMatchObject({ kind: 'timeout' })
  })
})
