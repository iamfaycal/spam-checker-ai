import { describe, expect, it } from 'vitest'
import {
  AnalysisResultSchema,
  AnalyzeRequestSchema,
  MAX_TEXT_LENGTH,
  RewriteRequestSchema,
  RewriteResultSchema,
} from '../src/index.js'

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

describe('RewriteRequestSchema', () => {
  const valid = { text: '  Hello  ', suggestions: ['a', 'b', 'c'] }

  it('trims the text and accepts 3 suggestions', () =>
    expect(RewriteRequestSchema.parse(valid)).toEqual({
      text: 'Hello',
      suggestions: ['a', 'b', 'c'],
    }))

  it('rejects 2 suggestions', () =>
    expect(RewriteRequestSchema.safeParse({ ...valid, suggestions: ['a', 'b'] }).success).toBe(
      false,
    ))

  it('rejects a missing suggestions field', () =>
    expect(RewriteRequestSchema.safeParse({ text: 'Hello' }).success).toBe(false))

  it('rejects text over 5000 chars', () =>
    expect(RewriteRequestSchema.safeParse({ ...valid, text: 'a'.repeat(5001) }).success).toBe(
      false,
    ))
})

describe('RewriteResultSchema', () => {
  it('accepts a rewritten text', () =>
    expect(RewriteResultSchema.parse({ rewrittenText: 'Hi' })).toEqual({ rewrittenText: 'Hi' }))

  it('rejects an empty or over-long rewrite', () => {
    expect(RewriteResultSchema.safeParse({ rewrittenText: '' }).success).toBe(false)
    expect(RewriteResultSchema.safeParse({ rewrittenText: 'a'.repeat(5001) }).success).toBe(false)
  })
})
