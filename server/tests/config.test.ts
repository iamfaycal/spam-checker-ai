import { describe, expect, it } from '@jest/globals'
import { loadConfig } from '../src/config.js'

describe('loadConfig', () => {
  it('returns the documented defaults for an empty env', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      trustProxy: 1,
      llm: { provider: 'google', model: 'gemini-3.5-flash-lite', timeoutMs: 15000 },
      rateLimit: { perMinute: 5, perDay: 20, globalPerMinute: 12, globalDailyCap: 400 },
    })
  })

  it('reads overrides from env strings', () => {
    const config = loadConfig({
      PORT: '8080',
      LLM_PROVIDER: 'anthropic',
      LLM_MODEL: 'claude-haiku-5-5',
      GLOBAL_DAILY_CAP: '100',
    })
    expect(config.port).toBe(8080)
    expect(config.llm).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-5-5' })
    expect(config.rateLimit.globalDailyCap).toBe(100)
  })

  it('accepts TRUST_PROXY=0 (no proxy in front, e.g. local dev)', () =>
    expect(loadConfig({ TRUST_PROXY: '0' }).trustProxy).toBe(0))

  it('names the key when a number is invalid', () =>
    expect(() => loadConfig({ RATE_LIMIT_PER_MINUTE: 'abc' })).toThrow(/RATE_LIMIT_PER_MINUTE/))

  it('rejects a zero rate limit', () =>
    expect(() => loadConfig({ RATE_LIMIT_PER_DAY: '0' })).toThrow(/RATE_LIMIT_PER_DAY/))

  it('rejects an unknown provider', () =>
    expect(() => loadConfig({ LLM_PROVIDER: 'mistral' })).toThrow(/LLM_PROVIDER/))

  it('lists every invalid key in one error', () => {
    const load = () => loadConfig({ PORT: '-1', LLM_TIMEOUT_MS: '1.5' })
    expect(load).toThrow(/PORT/)
    expect(load).toThrow(/LLM_TIMEOUT_MS/)
  })
})
