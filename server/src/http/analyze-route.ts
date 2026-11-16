import type { RequestHandler } from 'express'
import type { AnalysisResult, AnalyzeRequest } from '@spam-checker/shared'
import type { Analyzer } from '../analysis/analyzer.js'

export function analyzeRoute(analyzer: Analyzer): RequestHandler {
  return async (req, res) => {
    // Validated and trimmed by validateBody() earlier in the chain (see app.ts).
    const { text } = res.locals.body as AnalyzeRequest

    // If the visitor leaves before we answer, stop the LLM call instead of paying for it.
    const controller = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) controller.abort()
    })

    let result: AnalysisResult
    try {
      result = await analyzer.analyze(text, controller.signal)
    } catch (error) {
      if (controller.signal.aborted) return // nobody is listening any more (D22)
      throw error // Express 5 forwards it to the error handler
    }
    res.json(result)
  }
}
