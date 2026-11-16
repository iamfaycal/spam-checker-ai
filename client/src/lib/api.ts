import { z } from 'zod'
import {
  AnalysisResultSchema,
  ERROR_CODES,
  type AnalysisResult,
  type ErrorCode,
} from '@spam-checker/shared'

export type ApiErrorCode = ErrorCode | 'NETWORK'

/** Every failure the UI can show, by stable code (D11): the UI never parses messages. */
export class ApiError extends Error {
  override readonly name = 'ApiError'

  constructor(
    readonly code: ApiErrorCode,
    readonly retryAfterSeconds?: number,
  ) {
    super(code)
  }
}

const ApiErrorBodySchema = z.object({
  error: z.object({ code: z.enum(ERROR_CODES), message: z.string() }),
})

function retryAfter(response: Response): number | undefined {
  const seconds = Number(response.headers.get('retry-after'))
  return Number.isInteger(seconds) && seconds > 0 ? seconds : undefined
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

/**
 * POST /api/analyze. Resolves with an analysis that is valid by the shared schema,
 * or rejects with an ApiError. A deliberate abort is passed through as an AbortError,
 * so the caller can tell "replaced by a newer request" from a real failure.
 */
export async function analyzeEmail(text: string, signal?: AbortSignal): Promise<AnalysisResult> {
  let response: Response
  try {
    response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new ApiError('NETWORK')
  }

  const body = await readJson(response)
  if (response.ok) {
    // Trust nothing: the same schema the server used guards what reaches the UI.
    const parsed = AnalysisResultSchema.safeParse(body)
    if (!parsed.success) throw new ApiError('LLM_BAD_OUTPUT')
    return parsed.data
  }

  // An error from our API has a code; anything else (e.g. a proxy's HTML 502) doesn't.
  const parsed = ApiErrorBodySchema.safeParse(body)
  throw new ApiError(parsed.success ? parsed.data.error.code : 'INTERNAL', retryAfter(response))
}

/** User-facing copy for each code. The switch is exhaustive: a new code won't compile without one. */
export function errorMessage(error: ApiError): string {
  switch (error.code) {
    case 'RATE_LIMITED':
      return error.retryAfterSeconds
        ? `Too many analyses — try again in ${error.retryAfterSeconds}s.`
        : 'Too many analyses — try again shortly.'
    case 'DAILY_CAP_REACHED':
      return "The demo's daily AI quota is used up. Try again tomorrow."
    case 'INVALID_INPUT':
    case 'PAYLOAD_TOO_LARGE':
      return 'Add some text (max 5,000 characters).'
    case 'LLM_TIMEOUT':
    case 'LLM_BAD_OUTPUT':
    case 'LLM_UNAVAILABLE':
      return "The AI couldn't analyze this email. Try again."
    case 'NETWORK':
      return 'Network error — check your connection.'
    case 'NOT_FOUND':
    case 'INTERNAL':
      return 'Something went wrong. Try again.'
  }
}
