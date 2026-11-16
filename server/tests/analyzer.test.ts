import { describe, expect, it } from '@jest/globals'
import { APICallError } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import type { AnalysisResult } from '@spam-checker/shared'
import { createLlmAnalyzer } from '../src/analysis/analyzer.js'
import { AnalyzerError } from '../src/analysis/errors.js'
import { SYSTEM_PROMPT, buildUserPrompt } from '../src/analysis/prompt.js'

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

  it("maps the provider's own 429 (quota) to provider, never to a visitor rate limit", async () => {
    // As Google sends it: a 429 is retryable, so the SDK retries once (maxRetries: 1, ~2 s backoff).
    const quota = new APICallError({
      message: 'Resource has been exhausted',
      url: 'https://generativelanguage.googleapis.com',
      requestBodyValues: {},
      statusCode: 429,
    })
    const model = modelThrowing(quota)
    const error = await errorOf(analyzerFor(model, 15_000).analyze('x'))
    expect(error).toMatchObject({ kind: 'provider' })
    expect(model.doGenerateCalls).toHaveLength(2)
  }, 10_000)

  it('lets a caller abort through unchanged (the visitor left; nothing to report)', async () => {
    const controller = new AbortController()
    const pending = analyzerFor(modelHanging()).analyze('x', controller.signal)
    controller.abort()
    const error = await errorOf(pending)
    expect(error).not.toBeInstanceOf(AnalyzerError)
    expect(error).toMatchObject({ name: 'AbortError' })
  })
})
