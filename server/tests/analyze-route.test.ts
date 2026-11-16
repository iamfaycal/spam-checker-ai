import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import type { AnalysisResult } from '@spam-checker/shared'
import type { Analyzer } from '../src/analysis/analyzer.js'
import { AnalyzerError, type AnalyzerErrorKind } from '../src/analysis/errors.js'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'

const RESULT: AnalysisResult = {
  summary: 'Low risk.',
  riskLevel: 'low',
  suggestions: ['Add a greeting', 'Shorten the subject', 'Sign with your name'],
}

const config = loadConfig({})

function fakeAnalyzer(impl: Analyzer['analyze'] = async () => RESULT) {
  const analyze = jest.fn(impl)
  return { analyzer: { analyze }, analyze }
}

const appWith = (analyzer: Analyzer) => createApp({ analyzer, config })

describe('POST /api/analyze', () => {
  it('returns the analysis for valid text, sending the trimmed text to the analyzer', async () => {
    const { analyzer, analyze } = fakeAnalyzer()
    const res = await request(appWith(analyzer)).post('/api/analyze').send({ text: '  Hello  ' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual(RESULT)
    expect(analyze).toHaveBeenCalledWith('Hello', expect.any(AbortSignal))
  })

  it.each([
    ['empty text', { text: '' }],
    ['missing text', {}],
    ['a number', { text: 42 }],
  ])('rejects %s with 400 INVALID_INPUT, without calling the analyzer', async (_, body) => {
    const { analyzer, analyze } = fakeAnalyzer()
    const res = await request(appWith(analyzer)).post('/api/analyze').send(body)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_INPUT')
    expect(analyze).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON with 400 INVALID_INPUT', async () => {
    const { analyzer, analyze } = fakeAnalyzer()
    const res = await request(appWith(analyzer))
      .post('/api/analyze')
      .set('content-type', 'application/json')
      .send('{"text": "unterminated')

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_INPUT')
    expect(analyze).not.toHaveBeenCalled()
  })

  it('rejects a body over 20kb with 413 PAYLOAD_TOO_LARGE', async () => {
    const { analyzer, analyze } = fakeAnalyzer()
    const res = await request(appWith(analyzer))
      .post('/api/analyze')
      .send({ text: 'a'.repeat(25 * 1024) })

    expect(res.status).toBe(413)
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE')
    expect(analyze).not.toHaveBeenCalled()
  })

  it.each([
    ['bad_output', 502, 'LLM_BAD_OUTPUT'],
    ['timeout', 504, 'LLM_TIMEOUT'],
    ['provider', 503, 'LLM_UNAVAILABLE'],
  ] as const)('maps AnalyzerError %s to %i %s', async (kind: AnalyzerErrorKind, status, code) => {
    const { analyzer } = fakeAnalyzer(async () => {
      throw new AnalyzerError(kind)
    })
    const res = await request(appWith(analyzer)).post('/api/analyze').send({ text: 'Hi' })

    expect(res.status).toBe(status)
    expect(res.body).toEqual({ error: { code, message: expect.any(String) } })
  })

  it('hides unexpected errors behind 500 INTERNAL, and logs them server-side', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { analyzer } = fakeAnalyzer(async () => {
      throw new Error('secret detail')
    })
    const res = await request(appWith(analyzer)).post('/api/analyze').send({ text: 'Hi' })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('INTERNAL')
    expect(res.text).not.toContain('secret detail')
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('aborts the analyzer signal when the client disconnects', async () => {
    let received: AbortSignal | undefined
    let markCalled!: () => void
    const called = new Promise<void>((resolve) => (markCalled = resolve))
    const { analyzer } = fakeAnalyzer((_text, signal) => {
      received = signal
      markCalled()
      // Like a real LLM call: settles only when aborted.
      return new Promise((_, reject) =>
        signal?.addEventListener('abort', () => reject(signal.reason)),
      )
    })
    const server = appWith(analyzer).listen(0)
    const { port } = server.address() as AddressInfo

    try {
      const client = new AbortController()
      const response = fetch(`http://127.0.0.1:${port}/api/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Hi' }),
        signal: client.signal,
      }).catch(() => 'client aborted')

      await called
      client.abort()
      await response
      await waitFor(() => received?.aborted === true)

      expect(received?.aborted).toBe(true)
    } finally {
      // Even if the test fails, never leave a server open: Jest would hang waiting on it.
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  })
})

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const res = await request(appWith(fakeAnalyzer().analyzer)).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })
})

describe('static client (production)', () => {
  let dir: string
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function appServing() {
    dir = mkdtempSync(join(tmpdir(), 'client-'))
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Spam Checker</title>')
    writeFileSync(join(dir, 'app.js'), 'console.log(1)')
    return createApp({ analyzer: fakeAnalyzer().analyzer, config, staticDir: dir })
  }

  it('serves the built files', async () => {
    const res = await request(appServing()).get('/app.js')
    expect(res.status).toBe(200)
    expect(res.text).toBe('console.log(1)')
  })

  it('falls back to index.html for client routes', async () => {
    const res = await request(appServing()).get('/some/client/route')
    expect(res.status).toBe(200)
    expect(res.text).toContain('Spam Checker')
  })

  it('does not answer unknown /api routes with index.html', async () => {
    const res = await request(appServing()).get('/api/nope')
    expect(res.status).toBe(404)
    expect(res.text).not.toContain('Spam Checker')
  })
})

async function waitFor(condition: () => boolean, timeoutMs = 1000) {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('condition not met in time')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
