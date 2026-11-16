import { describe, expect, it } from '@jest/globals'
import type { RequestHandler } from 'express'
import { AnalyzeRequestSchema, RewriteRequestSchema } from '@spam-checker/shared'
import { llmEndpoint } from '../src/http/llm-route.js'

const guard: RequestHandler = (_req, _res, next) => next()

describe('llmEndpoint', () => {
  it('chains validation, the guards and the route, in that order', () => {
    const handlers = llmEndpoint(
      AnalyzeRequestSchema,
      'bad input',
      [guard, guard],
      async () => ({}),
    )
    expect(handlers).toHaveLength(4)
    expect(handlers.slice(1, 3)).toEqual([guard, guard])
  })

  it('types the route body from the schema (checked by `npm run typecheck`)', () => {
    llmEndpoint(RewriteRequestSchema, '', [], async (body) => body.suggestions)
    // @ts-expect-error the analyze schema has no `suggestions`: a mismatched pair can't compile
    llmEndpoint(AnalyzeRequestSchema, '', [], async (body) => body.suggestions)
    expect(true).toBe(true)
  })
})
