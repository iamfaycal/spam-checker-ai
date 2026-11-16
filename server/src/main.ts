import { createLlmAnalyzer } from './analysis/analyzer.js'
import { createApp } from './app.js'
import { loadConfig, type Config } from './config.js'
import { createModel } from './llm/model.js'

/** The composition root: the only place that wires real dependencies together (D3). */

let config: Config
try {
  config = loadConfig(process.env)
} catch (error) {
  // Fail at boot, not on the first visitor's request (D21).
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

const analyzer = createLlmAnalyzer({
  model: createModel(config.llm),
  timeoutMs: config.llm.timeoutMs,
})
const app = createApp({ analyzer, config, staticDir: config.staticDir })

const server = app.listen(config.port, () => {
  console.log(
    `Listening on :${config.port} (${config.llm.provider}/${config.llm.model}` +
      `${config.staticDir ? `, serving ${config.staticDir}` : ''})`,
  )
})

// Docker/Coolify stop the container with SIGTERM: finish in-flight requests, then exit.
function shutdown(signal: string) {
  console.log(`${signal} received, closing`)
  server.close(() => process.exit(0))
  // An LLM call can take up to LLM_TIMEOUT_MS; don't wait forever after that.
  setTimeout(() => process.exit(1), config.llm.timeoutMs + 5_000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
