import { anthropic } from '@ai-sdk/anthropic'
import { google } from '@ai-sdk/google'
import { openai } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import type { Config } from '../config.js'

/**
 * The only place that knows about concrete providers (D2). Switching provider is
 * LLM_PROVIDER + LLM_MODEL + that provider's API key env var; no code change.
 * Each provider reads its key lazily (e.g. GOOGLE_GENERATIVE_AI_API_KEY) at call time.
 */
export function createModel(llm: Config['llm']): LanguageModel {
  switch (llm.provider) {
    case 'google':
      return google(llm.model)
    case 'openai':
      return openai(llm.model)
    case 'anthropic':
      return anthropic(llm.model)
  }
}
