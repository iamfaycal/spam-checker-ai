/**
 * Why an LLM call failed, in the three ways the HTTP layer needs to tell apart (D11):
 * - `timeout`: the model didn't answer in time (504)
 * - `bad_output`: it answered, but not with a valid analysis (502)
 * - `provider`: the provider failed or refused, including its own quota 429 (503)
 */
export type AnalyzerErrorKind = 'timeout' | 'bad_output' | 'provider'

const MESSAGES: Record<AnalyzerErrorKind, string> = {
  timeout: 'The LLM did not answer in time',
  bad_output: 'The LLM answer did not match the analysis schema',
  provider: 'The LLM provider failed',
}

export class AnalyzerError extends Error {
  override readonly name = 'AnalyzerError'

  constructor(
    readonly kind: AnalyzerErrorKind,
    options?: ErrorOptions,
  ) {
    super(MESSAGES[kind], options)
  }
}
