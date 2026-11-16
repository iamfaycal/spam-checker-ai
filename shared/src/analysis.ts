import * as z from 'zod/mini'

/**
 * API contract shared by the server and the client (D1).
 *
 * Written with `zod/mini` because the client bundles it: the functional API tree-shakes,
 * where classic zod ships whole (D24). Same rules, different spelling: `.check(...)`
 * instead of chained methods. `z.describe(...)` texts reach the LLM as field-level
 * guidance through the AI SDK's JSON Schema.
 */

export const MAX_TEXT_LENGTH = 5000
export const SUGGESTION_COUNT = 3
export const MAX_SUMMARY_LENGTH = 400
export const MAX_SUGGESTION_LENGTH = 120

/** Trimmed first, so "   " is rejected and surrounding spaces don't count toward the limit. */
const emailText = () => z.string().check(z.trim(), z.minLength(1), z.maxLength(MAX_TEXT_LENGTH))

export const AnalyzeRequestSchema = z.object({ text: emailText() })

export const RiskLevelSchema = z
  .enum(['low', 'medium', 'high'])
  .check(z.describe('How likely the email is to land in the spam folder.'))

/** Exactly 3 short suggestions: produced by /api/analyze, sent back to /api/rewrite. */
export const SuggestionsSchema = z
  .array(
    z.string().check(
      z.trim(), // a suggestion of only spaces is no suggestion (they come back from the client)
      z.minLength(1),
      z.maxLength(MAX_SUGGESTION_LENGTH),
      z.describe('One concrete improvement, starting with a verb, tied to the text.'),
    ),
  )
  .check(
    z.length(SUGGESTION_COUNT),
    z.describe(`Exactly ${SUGGESTION_COUNT} actionable suggestions.`),
  )

export const AnalysisResultSchema = z.object({
  summary: z
    .string()
    .check(
      z.minLength(1),
      z.maxLength(MAX_SUMMARY_LENGTH),
      z.describe('1-2 sentences explaining the spam risk and its main causes.'),
    ),
  riskLevel: RiskLevelSchema,
  suggestions: SuggestionsSchema,
})

export const RewriteRequestSchema = z.object({
  text: emailText(),
  suggestions: SuggestionsSchema,
})

export const RewriteResultSchema = z.object({
  // Same cap as the input, so a rewritten email can always be analyzed again.
  rewrittenText: z.string().check(z.minLength(1), z.maxLength(MAX_TEXT_LENGTH)),
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
