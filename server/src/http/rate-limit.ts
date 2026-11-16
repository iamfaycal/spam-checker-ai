import type { Request, RequestHandler, Response } from 'express'
import { rateLimit, type Options, type RateLimitInfo } from 'express-rate-limit'
import type { ErrorCode } from '@spam-checker/shared'
import type { Config } from '../config.js'
import { sendError } from './error-handler.js'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

/** Seconds until this limiter's window resets, as sent in `Retry-After`. */
function retryAfterSeconds(req: Request, options: Options): number {
  const info = (req as Request & Record<string, RateLimitInfo | undefined>)[
    options.requestPropertyName
  ]
  const ms = info?.resetTime ? info.resetTime.getTime() - Date.now() : options.windowMs
  return Math.max(1, Math.ceil(ms / 1000))
}

function rejectWith(status: number, code: ErrorCode, message: (seconds: number) => string) {
  return (req: Request, res: Response, _next: unknown, options: Options) => {
    const seconds = retryAfterSeconds(req, options)
    res.setHeader('Retry-After', String(seconds))
    sendError(res, status, code, message(seconds))
  }
}

/** One visitor (by IP, see trust proxy in app.ts): 429, "you, slow down". */
function perIp(windowMs: number, limit: number): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8', // tells the client its own remaining budget
    legacyHeaders: false,
    handler: rejectWith(429, 'RATE_LIMITED', (s) => `Too many analyses. Try again in ${s}s.`),
  })
}

/**
 * Everyone together, one shared counter: protects the LLM quota (D6).
 * 503, not 429: the visitor did nothing wrong, the service is saturated (D11).
 * No RateLimit headers: they would overwrite the visitor's own per-IP numbers.
 */
function global(windowMs: number, limit: number, code: ErrorCode, message: string): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    keyGenerator: () => 'global',
    standardHeaders: false,
    legacyHeaders: false,
    handler: rejectWith(503, code, () => message),
  })
}

/**
 * The four limiters, in order: per-IP minute, per-IP day, global minute, global day.
 * Mount them before body parsing, so rejected requests count too (D8).
 */
export function createRateLimiters(cfg: Config['rateLimit']): RequestHandler[] {
  return [
    perIp(MINUTE, cfg.perMinute),
    perIp(DAY, cfg.perDay),
    global(MINUTE, cfg.globalPerMinute, 'LLM_UNAVAILABLE', 'The AI is busy. Try again shortly.'),
    global(DAY, cfg.globalDailyCap, 'DAILY_CAP_REACHED', "Today's AI quota is used up."),
  ]
}
