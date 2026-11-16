import {
  APICallError,
  JSONParseError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  TypeValidationError,
  generateText,
  type LanguageModel,
} from 'ai'
import { setTimeout as sleep } from 'node:timers/promises'
import { z } from 'zod'
import {
  AnalysisResultSchema,
  RewriteResultSchema,
  type AnalysisResult,
  type RewriteResult,
} from '@spam-checker/shared'
import { AnalyzerError } from './errors.js'
import {
  REWRITE_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  buildRewritePrompt,
  buildUserPrompt,
  splitParagraphs,
} from './prompt.js'

/** The port the HTTP layer depends on (D3). Tests swap in a fake; main.ts wires the LLM. */
export interface Analyzer {
  analyze(text: string, signal?: AbortSignal): Promise<AnalysisResult>
  rewrite(text: string, suggestions: string[], signal?: AbortSignal): Promise<RewriteResult>
}

/**
 * What the model returns for a rewrite: one item per paragraph of the original, so the
 * paragraph structure is part of the schema rather than a request it can ignore (D25).
 */
function rewriteOutputSchema(paragraphCount: number) {
  return z.object({
    paragraphs: z
      .array(z.string().trim().min(1).describe('One paragraph of the rewritten email.'))
      .length(paragraphCount)
      .describe(`Exactly ${paragraphCount} paragraphs, in the order of the original email.`),
  })
}

export function createLlmAnalyzer(opts: {
  model: LanguageModel
  timeoutMs: number
  /** Pause before the single retry of a server or network error (default 1 s). */
  retryDelayMs?: number
}): Analyzer {
  const retryDelayMs = opts.retryDelayMs ?? 1000

  /**
   * One structured LLM call, shared by analyze and rewrite so they can't drift apart:
   * the timeout, the error classification (D22) and the final schema guard.
   */
  // `z.core.$ZodType` accepts both classic and mini schemas (the shared contract is mini: D24).
  async function generate<S extends z.core.$ZodType>(
    schema: S,
    instructions: string,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<z.infer<S>> {
    // One signal that fires on whichever comes first: our timeout or the caller giving up.
    const timeout = AbortSignal.timeout(opts.timeoutMs)
    const abortSignal = signal ? AbortSignal.any([signal, timeout]) : timeout

    const call = async () => {
      const result = await generateText({
        model: opts.model,
        instructions,
        prompt,
        output: Output.object({ schema }),
        temperature: 0.3,
        maxRetries: 0, // retries are decided below: the SDK would also retry a quota 429
        abortSignal,
      })
      return result.output
    }

    let output: unknown
    try {
      try {
        output = await call()
      } catch (error) {
        // One retry for a passing server or network error; never for a 429 (D22).
        if (!isTransient(error) || abortSignal.aborted) throw error
        // A short pause gives an overloaded model a chance to recover. It is abortable:
        // the timeout or the visitor leaving ends it at once (and is classified below).
        await sleep(retryDelayMs, undefined, { signal: abortSignal })
        output = await call()
      }
    } catch (error) {
      throw classify(error, timeout, signal)
    }

    // Final guard: never return something the contract doesn't allow, whatever the SDK did.
    const parsed = z.safeParse(schema, output)
    if (!parsed.success) throw new AnalyzerError('bad_output', { cause: parsed.error })
    return parsed.data
  }

  return {
    analyze: (text, signal) =>
      generate(AnalysisResultSchema, SYSTEM_PROMPT, buildUserPrompt(text), signal),
    rewrite: async (text, suggestions, signal) => {
      const paragraphCount = splitParagraphs(text).length
      const { paragraphs } = await generate(
        rewriteOutputSchema(paragraphCount),
        REWRITE_SYSTEM_PROMPT,
        buildRewritePrompt(text, suggestions),
        signal,
      )
      // The API contract is still one text, rebuilt with the original's blank-line breaks.
      const rewritten = RewriteResultSchema.safeParse({ rewrittenText: paragraphs.join('\n\n') })
      if (!rewritten.success) {
        throw new AnalyzerError('bad_output', { cause: rewritten.error })
      }
      return rewritten.data
    },
  }
}

/** A failure worth one retry: 5xx or network. A 429 is the shared quota: retrying only wastes it. */
function isTransient(error: unknown): boolean {
  return APICallError.isInstance(error) && error.isRetryable && error.statusCode !== 429
}

function classify(error: unknown, timeout: AbortSignal, caller?: AbortSignal): unknown {
  // The caller gave up (visitor closed the tab): not a failure to report, pass it through.
  if (caller?.aborted && !timeout.aborted) return error
  if (timeout.aborted) return new AnalyzerError('timeout', { cause: error })
  if (
    NoObjectGeneratedError.isInstance(error) ||
    NoOutputGeneratedError.isInstance(error) || // empty or safety-filtered answer
    TypeValidationError.isInstance(error) ||
    JSONParseError.isInstance(error)
  ) {
    return new AnalyzerError('bad_output', { cause: error })
  }
  // Network errors, 5xx, and the provider's own 429: the shared quota, not the visitor (D11).
  return new AnalyzerError('provider', { cause: error })
}
