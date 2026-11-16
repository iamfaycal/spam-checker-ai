import type { RequestHandler } from 'express'
import { AnalyzeRequestSchema, MAX_TEXT_LENGTH, type AnalysisResult } from '@spam-checker/shared'
import type { Analyzer } from '../analysis/analyzer.js'
import { sendError } from './error-handler.js'

export function analyzeRoute(analyzer: Analyzer): RequestHandler {
  return async (req, res) => {
    const parsed = AnalyzeRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      return sendError(
        res,
        400,
        'INVALID_INPUT',
        `Send { "text": "..." } with 1 to ${MAX_TEXT_LENGTH} characters.`,
      )
    }

    // If the visitor leaves before we answer, stop the LLM call instead of paying for it.
    const controller = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) controller.abort()
    })

    let result: AnalysisResult
    try {
      result = await analyzer.analyze(parsed.data.text, controller.signal)
    } catch (error) {
      if (controller.signal.aborted) return // nobody is listening any more (D22)
      throw error // Express 5 forwards it to the error handler
    }
    res.json(result)
  }
}
