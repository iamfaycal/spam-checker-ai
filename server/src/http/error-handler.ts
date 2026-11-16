import type { ErrorRequestHandler, Response } from 'express'
import type { ApiErrorBody, ErrorCode } from '@spam-checker/shared'
import { AnalyzerError, type AnalyzerErrorKind } from '../analysis/errors.js'

/** Every error response has the same shape (D11): `{ error: { code, message } }`. */
export function sendError(res: Response, status: number, code: ErrorCode, message: string): void {
  const body: ApiErrorBody = { error: { code, message } }
  res.status(status).json(body)
}

const ANALYZER_ERRORS: Record<AnalyzerErrorKind, [number, ErrorCode, string]> = {
  timeout: [504, 'LLM_TIMEOUT', 'The AI took too long to answer.'],
  bad_output: [502, 'LLM_BAD_OUTPUT', 'The AI returned an invalid analysis.'],
  // Includes the provider's own 429: the shared quota is the problem, not this visitor.
  provider: [503, 'LLM_UNAVAILABLE', 'The AI service is unavailable right now.'],
}

/**
 * Errors raised by express.json() carry a `type` ('entity.too.large', 'entity.parse.failed',
 * 'charset.unsupported'...) and a 4xx `status`. Requiring both keeps an unrelated error that
 * happens to have a `type` field from being reported as a bad request.
 */
function isBodyParserError(err: unknown): err is { type: string; status: number } {
  if (typeof err !== 'object' || err === null) return false
  const { type, status } = err as { type?: unknown; status?: unknown }
  return typeof type === 'string' && typeof status === 'number' && status >= 400 && status < 500
}

// Express recognises an error handler by its 4 parameters.
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err)

  if (err instanceof AnalyzerError) {
    // The cause (missing API key, quota, bad JSON...) is for the operator, not the visitor.
    console.error(`LLM call failed (${err.kind})`, err.cause)
    const [status, code, message] = ANALYZER_ERRORS[err.kind]
    return sendError(res, status, code, message)
  }
  if (isBodyParserError(err)) {
    return err.type === 'entity.too.large'
      ? sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'The request body is larger than 20kb.')
      : sendError(res, 400, 'INVALID_INPUT', 'The request body is not valid JSON.')
  }

  // Unexpected: log the details here, never send them to the client.
  console.error(err)
  sendError(res, 500, 'INTERNAL', 'Something went wrong.')
}
