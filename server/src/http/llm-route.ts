import type { RequestHandler } from 'express'
import type { z } from 'zod'
import { validateBody } from './validate-body.js'

/**
 * A route that calls the LLM with the body validateBody() already parsed (see app.ts).
 * If the visitor leaves before we answer, the call is aborted instead of paid for,
 * and nothing is sent (D22). LLM failures go to the error handler (Express 5).
 */
function llmRoute<Body>(
  run: (body: Body, signal: AbortSignal) => Promise<unknown>,
): RequestHandler {
  return async (_req, res) => {
    const body = res.locals.body as Body

    const controller = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) controller.abort()
    })

    let result: unknown
    try {
      result = await run(body, controller.signal)
    } catch (error) {
      if (controller.signal.aborted) return // nobody is listening any more
      throw error
    }
    res.json(result)
  }
}

/**
 * One LLM endpoint: validate the body, run the guards (the global caps, after validation
 * so junk doesn't spend them: D8), then call the LLM. `run` receives the schema's own type,
 * so a route can't be paired with the wrong schema without a compile error.
 */
export function llmEndpoint<S extends z.core.$ZodType>(
  schema: S,
  invalidMessage: string,
  guards: readonly RequestHandler[],
  run: (body: z.infer<S>, signal: AbortSignal) => Promise<unknown>,
): RequestHandler[] {
  return [validateBody(schema, invalidMessage), ...guards, llmRoute<z.infer<S>>(run)]
}
