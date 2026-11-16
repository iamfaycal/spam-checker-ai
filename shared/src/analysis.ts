import { z } from 'zod'

/**
 * API contract shared by the server and the client (D1).
 * The `.describe()` texts are forwarded to the LLM by the AI SDK as field-level guidance.
 */

export const MAX_TEXT_LENGTH = 5000
export const SUGGESTION_COUNT = 3
export const MAX_SUMMARY_LENGTH = 400
export const MAX_SUGGESTION_LENGTH = 120

export const AnalyzeRequestSchema = z.object({
  // `.trim()` runs before the length checks, so "   " is rejected and surrounding spaces don't count.
  text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
})

export const RiskLevelSchema = z
  .enum(['low', 'medium', 'high'])
  .describe('How likely the email is to land in the spam folder.')

/** Exactly 3 short suggestions: produced by /api/analyze, sent back to /api/rewrite. */
export const SuggestionsSchema = z
  .array(
    z
      .string()
      .min(1)
      .max(MAX_SUGGESTION_LENGTH)
      .describe('One concrete improvement, starting with a verb, tied to the text.'),
  )
  .length(SUGGESTION_COUNT)
  .describe(`Exactly ${SUGGESTION_COUNT} actionable suggestions.`)

export const AnalysisResultSchema = z.object({
  summary: z
    .string()
    .min(1)
    .max(MAX_SUMMARY_LENGTH)
    .describe('1-2 sentences explaining the spam risk and its main causes.'),
  riskLevel: RiskLevelSchema,
  suggestions: SuggestionsSchema,
})

export const RewriteRequestSchema = z.object({
  text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  suggestions: SuggestionsSchema,
})

export const RewriteResultSchema = z.object({
  // Same cap as the input, so a rewritten email can always be analyzed again.
  rewrittenText: z
    .string()
    .min(1)
    .max(MAX_TEXT_LENGTH)
    .describe('The full rewritten email body, plain text, paragraphs preserved.'),
})

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>
export type RiskLevel = z.infer<typeof RiskLevelSchema>
export type RewriteRequest = z.infer<typeof RewriteRequestSchema>
export type RewriteResult = z.infer<typeof RewriteResultSchema>

/** Stable error codes (D11): the UI picks its message from the code, never from the text. */
export const ERROR_CODES = [
  'INVALID_INPUT',
  'NOT_FOUND',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'DAILY_CAP_REACHED',
  'LLM_TIMEOUT',
  'LLM_BAD_OUTPUT',
  'LLM_UNAVAILABLE',
  'INTERNAL',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string }
}
