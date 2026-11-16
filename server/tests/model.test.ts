import { describe, expect, it } from '@jest/globals'
import { createModel } from '../src/llm/model.js'

describe('createModel', () => {
  it.each([
    ['google', 'gemini-3.5-flash-lite'],
    ['openai', 'gpt-5-mini'],
    ['anthropic', 'claude-haiku-5-5'],
  ] as const)('builds a %s model with the configured id', (provider, model) => {
    const created = createModel({ provider, model, timeoutMs: 1 })
    expect(typeof created).toBe('object')
    expect(created).toMatchObject({ modelId: model })
    expect(String((created as { provider: string }).provider)).toContain(provider)
  })
})
