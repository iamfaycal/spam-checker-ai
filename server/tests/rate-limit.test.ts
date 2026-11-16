import { describe, expect, it, jest } from '@jest/globals'
import request from 'supertest'
import type { AnalysisResult } from '@spam-checker/shared'
import { createApp } from '../src/app.js'
import { loadConfig, type Config } from '../src/config.js'

const RESULT: AnalysisResult = {
  summary: 'Low risk.',
  riskLevel: 'low',
  suggestions: ['Add a greeting', 'Shorten the subject', 'Sign with your name'],
}

/** A fresh app per test, so limiter counters never leak between tests. */
function appWith(rateLimit: Partial<Config['rateLimit']> = {}) {
  const base = loadConfig({})
  const config: Config = {
    ...base,
    trustProxy: 1,
    rateLimit: { perMinute: 2, perDay: 3, globalPerMinute: 10, globalDailyCap: 4, ...rateLimit },
  }
  const analyze = jest.fn(async () => RESULT)
  return { app: createApp({ analyzer: { analyze }, config }), analyze }
}

/** As Traefik would forward it: the proxy appends the address it saw last. */
const analyzeFrom = (app: ReturnType<typeof appWith>['app'], xForwardedFor: string) =>
  request(app).post('/api/analyze').set('X-Forwarded-For', xForwardedFor).send({ text: 'Hello' })

describe('per-IP limits', () => {
  it('answers the 3rd request in a minute from one IP with 429 RATE_LIMITED and Retry-After', async () => {
    const { app, analyze } = appWith()
    await analyzeFrom(app, '1.1.1.1').expect(200)
    await analyzeFrom(app, '1.1.1.1').expect(200)
    const res = await analyzeFrom(app, '1.1.1.1')

    expect(res.status).toBe(429)
    expect(res.body).toEqual({ error: { code: 'RATE_LIMITED', message: expect.any(String) } })
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0)
    expect(analyze).toHaveBeenCalledTimes(2)
  })

  it('gives each IP its own budget', async () => {
    const { app } = appWith()
    await analyzeFrom(app, '1.1.1.1').expect(200)
    await analyzeFrom(app, '1.1.1.1').expect(200)
    await analyzeFrom(app, '2.2.2.2').expect(200)
    await analyzeFrom(app, '2.2.2.2').expect(200)
  })

  it('applies the daily limit across minutes', async () => {
    const { app } = appWith({ perMinute: 100, perDay: 3 })
    for (let i = 0; i < 3; i++) await analyzeFrom(app, '1.1.1.1').expect(200)
    const res = await analyzeFrom(app, '1.1.1.1')
    expect(res.status).toBe(429)
    expect(res.body.error.code).toBe('RATE_LIMITED')
  })

  it('cannot be bypassed by forging X-Forwarded-For (trust proxy = 1 hop)', async () => {
    const { app } = appWith()
    // The client invents the left part; the proxy appends the real address (1.1.1.1) last.
    await analyzeFrom(app, '9.9.9.1, 1.1.1.1').expect(200)
    await analyzeFrom(app, '9.9.9.2, 1.1.1.1').expect(200)
    const res = await analyzeFrom(app, '9.9.9.3, 1.1.1.1')
    expect(res.status).toBe(429)
  })

  it('counts rejected requests too, so probing is not free (D8)', async () => {
    const { app, analyze } = appWith()
    await request(app)
      .post('/api/analyze')
      .set('X-Forwarded-For', '1.1.1.1')
      .set('content-type', 'application/json')
      .send('{"text": "unterminated')
      .expect(400)
    await request(app)
      .post('/api/analyze')
      .set('X-Forwarded-For', '1.1.1.1')
      .send({ text: 'a'.repeat(25 * 1024) })
      .expect(413)

    const res = await analyzeFrom(app, '1.1.1.1')
    expect(res.status).toBe(429)
    expect(analyze).not.toHaveBeenCalled()
  })
})

describe('global caps (shared LLM quota)', () => {
  it('answers past the daily cap with 503 DAILY_CAP_REACHED, whatever the IP', async () => {
    const { app, analyze } = appWith()
    for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4']) {
      await analyzeFrom(app, ip).expect(200)
    }
    const res = await analyzeFrom(app, '5.5.5.5')

    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('DAILY_CAP_REACHED')
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0)
    expect(analyze).toHaveBeenCalledTimes(4)
  })

  it('answers past the per-minute cap with 503 LLM_UNAVAILABLE and Retry-After', async () => {
    const { app } = appWith({ globalPerMinute: 3, globalDailyCap: 100 })
    for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
      await analyzeFrom(app, ip).expect(200)
    }
    const res = await analyzeFrom(app, '4.4.4.4')

    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('LLM_UNAVAILABLE')
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0)
  })
})

describe('health probe', () => {
  it('is never rate limited', async () => {
    const { app } = appWith()
    for (let i = 0; i < 10; i++) {
      await request(app).get('/api/health').set('X-Forwarded-For', '1.1.1.1').expect(200)
    }
  })
})
