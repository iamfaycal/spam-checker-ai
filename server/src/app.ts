import { resolve } from 'node:path'
import express, { type Express } from 'express'
import helmet from 'helmet'
import { AnalyzeRequestSchema, MAX_TEXT_LENGTH } from '@spam-checker/shared'
import type { Analyzer } from './analysis/analyzer.js'
import type { Config } from './config.js'
import { analyzeRoute } from './http/analyze-route.js'
import { errorHandler, sendError } from './http/error-handler.js'
import { createRateLimiters } from './http/rate-limit.js'
import { validateBody } from './http/validate-body.js'

export interface AppDeps {
  analyzer: Analyzer
  config: Config
  /** Built client to serve in production (one origin, no CORS: D18). */
  staticDir?: string
}

/** Builds the app from its dependencies, so tests inject a fake analyzer (D3). */
export function createApp(deps: AppDeps): Express {
  const app = express()
  // How many proxy hops to trust when reading the client IP from X-Forwarded-For (D7).
  app.set('trust proxy', deps.config.trustProxy)
  app.use(helmet())

  // Infra probe: never parsed, never rate limited.
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  const limits = createRateLimiters(deps.config.rateLimit)
  const api = express.Router()
  // Per IP, before body parsing: malformed and oversized requests count too (D8).
  api.use('/analyze', ...limits.perIp)
  api.use(express.json({ limit: '20kb' }))
  api.post(
    '/analyze',
    validateBody(
      AnalyzeRequestSchema,
      `Send { "text": "..." } with 1 to ${MAX_TEXT_LENGTH} characters.`,
    ),
    ...limits.global, // after validation: only requests that reach the LLM spend the shared quota
    analyzeRoute(deps.analyzer),
  )
  // Anything else under /api: same error shape as every other API error (D11).
  api.use((_req, res) => sendError(res, 404, 'NOT_FOUND', 'No such API route.'))
  app.use('/api', api)

  if (deps.staticDir) {
    const root = resolve(deps.staticDir)
    app.use(express.static(root))
    // SPA fallback: any other GET gets the client's index.html (/api never gets here).
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next()
      res.sendFile(resolve(root, 'index.html'))
    })
  }

  app.use(errorHandler)
  return app
}
