import { z } from 'zod'

// Env values are strings: `z.coerce.number()` turns '8080' into 8080 and 'abc' into NaN (rejected).
const count = (fallback: number) => z.coerce.number().int().positive().default(fallback)

/**
 * The schema mirrors env variable names one to one, so a validation issue's path
 * is the variable to fix. It is reshaped into the nested `Config` afterwards.
 */
const EnvSchema = z.object({
  PORT: count(3000),
  // 0 = no proxy in front (Express treats it as `false`); 1 = Traefik on Coolify (D7).
  TRUST_PROXY: z.coerce.number().int().nonnegative().default(1),
  LLM_PROVIDER: z.enum(['google', 'openai', 'anthropic']).default('google'),
  LLM_MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),
  LLM_TIMEOUT_MS: count(15_000),
  RATE_LIMIT_PER_MINUTE: count(5),
  RATE_LIMIT_PER_DAY: count(20),
  GLOBAL_PER_MINUTE: count(12),
  GLOBAL_DAILY_CAP: count(400),
  // Built client to serve in production (set in the Docker image); unset in dev.
  STATIC_DIR: z.string().min(1).optional(),
})

export type LlmProvider = z.infer<typeof EnvSchema>['LLM_PROVIDER']

export interface Config {
  port: number
  staticDir?: string
  trustProxy: number
  llm: { provider: LlmProvider; model: string; timeoutMs: number }
  rateLimit: { perMinute: number; perDay: number; globalPerMinute: number; globalDailyCap: number }
}

/**
 * Reads and validates the server config. API keys are not checked here:
 * each provider SDK reads its own variable (e.g. GOOGLE_GENERATIVE_AI_API_KEY).
 * @throws Error listing every invalid variable, so one restart fixes them all.
 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    throw new Error(`Invalid environment:\n  ${problems.join('\n  ')}`)
  }
  const e = parsed.data
  return {
    port: e.PORT,
    staticDir: e.STATIC_DIR,
    trustProxy: e.TRUST_PROXY,
    llm: { provider: e.LLM_PROVIDER, model: e.LLM_MODEL, timeoutMs: e.LLM_TIMEOUT_MS },
    rateLimit: {
      perMinute: e.RATE_LIMIT_PER_MINUTE,
      perDay: e.RATE_LIMIT_PER_DAY,
      globalPerMinute: e.GLOBAL_PER_MINUTE,
      globalDailyCap: e.GLOBAL_DAILY_CAP,
    },
  }
}
