import type { RequestHandler } from 'express'

/**
 * A route that calls the LLM with the body validateBody() already parsed (see app.ts).
 * If the visitor leaves before we answer, the call is aborted instead of paid for,
 * and nothing is sent (D22). LLM failures go to the error handler (Express 5).
 */
export function llmRoute<Body>(
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
