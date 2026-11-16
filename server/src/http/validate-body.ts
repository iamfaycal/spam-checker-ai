import type { RequestHandler } from 'express'
import { z } from 'zod'
import { sendError } from './error-handler.js'

/**
 * Validates `req.body` against a schema. On success the parsed (trimmed) value is
 * stored in `res.locals.body` for the route; on failure it answers 400 INVALID_INPUT
 * and the request goes no further, in particular not through the global caps (D8).
 */
export function validateBody(schema: z.core.$ZodType, message: string): RequestHandler {
  return (req, res, next) => {
    const parsed = z.safeParse(schema, req.body)
    if (!parsed.success) return sendError(res, 400, 'INVALID_INPUT', message)
    res.locals.body = parsed.data
    next()
  }
}
