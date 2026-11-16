import { describe, expect, it } from 'vitest'
import { AnalysisResultSchema, AnalyzeRequestSchema, MAX_TEXT_LENGTH } from '../src/index.js'

describe('AnalyzeRequestSchema', () => {
  it('trims and accepts valid text', () =>
    expect(AnalyzeRequestSchema.parse({ text: '  hi  ' })).toEqual({ text: 'hi' }))

  it('rejects whitespace-only text', () =>
    expect(AnalyzeRequestSchema.safeParse({ text: '   ' }).success).toBe(false))

  it('accepts text of exactly the max length', () =>
    expect(AnalyzeRequestSchema.safeParse({ text: 'a'.repeat(MAX_TEXT_LENGTH) }).success).toBe(
      true,
    ))

  it('rejects text over 5000 chars', () =>
    expect(AnalyzeRequestSchema.safeParse({ text: 'a'.repeat(5001) }).success).toBe(false))

  it('measures length after trimming', () =>
    expect(
      AnalyzeRequestSchema.safeParse({ text: `  ${'a'.repeat(MAX_TEXT_LENGTH)}  ` }).success,
    ).toBe(true))
})

describe('AnalysisResultSchema', () => {
  const valid = { summary: 's', riskLevel: 'high', suggestions: ['a', 'b', 'c'] }

  it('accepts a well-formed result', () => expect(AnalysisResultSchema.parse(valid)).toEqual(valid))

  it('rejects 2 or 4 suggestions', () => {
    expect(AnalysisResultSchema.safeParse({ ...valid, suggestions: ['a', 'b'] }).success).toBe(
      false,
    )
    expect(
      AnalysisResultSchema.safeParse({ ...valid, suggestions: ['a', 'b', 'c', 'd'] }).success,
    ).toBe(false)
  })

  it('rejects unknown riskLevel', () =>
    expect(AnalysisResultSchema.safeParse({ ...valid, riskLevel: 'extreme' }).success).toBe(false))

  it('rejects a suggestion over 120 chars', () =>
    expect(
      AnalysisResultSchema.safeParse({ ...valid, suggestions: ['a', 'b', 'c'.repeat(121)] })
        .success,
    ).toBe(false))

  it('rejects a summary over 400 chars', () =>
    expect(AnalysisResultSchema.safeParse({ ...valid, summary: 's'.repeat(401) }).success).toBe(
      false,
    ))
})
