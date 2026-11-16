# Decision log

One entry per non-obvious choice. Format: **Context → Decision → Alternatives → Consequences.**
New entries are added during the build (see "Working agreement" in the plan). Status: `proposed` until reviewed by me, then `accepted`.

---

## D1 — Monorepo with a shared contract package — accepted

- **Context:** frontend and backend must agree on the request/response shape.
- **Decision:** npm workspaces with `shared` (zod schemas + inferred types), `server` and `client`.
- **Alternatives:** two repos (brief asks for one); duplicated types in the client (drift risk); OpenAPI + codegen (heavy for 2 routes).
- **Consequences:** one source of truth, also used at runtime to validate LLM output and API responses. Cost: `shared` must be built before `server` in Docker/CI.

## D2 — Vercel AI SDK + zod structured output — accepted

- **Context:** brief asks for structured data and a provider-agnostic design.
- **Decision:** `ai` + `@ai-sdk/google` structured output, using the D1 schema.
- **Alternatives:** official provider SDKs behind a hand-written adapter (more code, same result); raw `fetch` to Gemini JSON mode (simplest, locked to one provider).
- **Consequences:** changing provider = `LLM_PROVIDER` + `LLM_MODEL` env vars. The SDK ships a mock model, so the LLM layer is unit-testable without network.

## D3 — `Analyzer` port injected into `createApp` — accepted

- **Context:** HTTP tests must not call a real LLM.
- **Decision:** `createApp({ analyzer, config })`; the route depends on the `Analyzer` interface only. `main.ts` is the only place wiring the real model.
- **Alternatives:** `jest.mock` of the SDK module (couples tests to implementation details).
- **Consequences:** route tests use a `jest.fn()` fake; a fresh app per test also isolates rate-limit stores.

## D4 — Express 5 — accepted

- **Context:** async route handlers.
- **Decision:** Express 5, which forwards rejected promises to the error handler.
- **Alternatives:** Express 4 + `express-async-errors` or try/catch in every handler.
- **Consequences:** less boilerplate; one central error handler.

## D5 — Gemini 3.5 Flash Lite, free tier, dedicated project — accepted

- **Context:** cheap demo; measured free quota: 15 RPM, 250K TPM, 500 RPD per Cloud project.
- **Decision:** `gemini-3.5-flash-lite` on a Cloud project used only for this demo.
- **Alternatives:** paid tier (no data-usage caveat, costs money); bigger model (slower, unnecessary for short emails).
- **Consequences:** Google may use free-tier inputs for training. This is stated in the README. Quota drives D6.

## D6 — Four rate limiters, in-memory — accepted

- **Context:** public route; abuse must not burn the 15 RPM / 500 RPD quota.
- **Decision:**
  - Per IP: 5/min and 20/day (429 `RATE_LIMITED` + `Retry-After`).
  - Global: 12/min (503 `LLM_UNAVAILABLE`) and 400/day (503 `DAILY_CAP_REACHED`).
  - `express-rate-limit` with the in-memory store. All values come from env.
- **Alternatives:** per-IP only (many IPs together exceed Google's RPM); Redis store (needed only with several instances); CAPTCHA (friction, overkill for a demo).
- **Consequences:** our limits fire before Google's. The single-instance limitation is documented, and the fix is a Redis store.

## D7 — `trust proxy = 1` — accepted

- **Context:** on Coolify, Traefik sits in front of Express.
- **Decision:** trust exactly one proxy hop, configurable via `TRUST_PROXY`.
- **Alternatives:**
  - `false`: every visitor shares the proxy's IP, so one limit applies to all.
  - `true`: the client can forge `X-Forwarded-For` and bypass the limits.
- **Consequences:** `req.ip` is the address Traefik saw. Covered by a spoofing test, and checked once on the deployed app.

## D8 — Rejected requests still count toward limits — accepted

- **Context:** a 400 costs nothing to us, but unlimited 400s allow probing and log flooding.
- **Decision:** limiters run before validation.
- **Alternatives:** `skipFailedRequests` (friendlier to typos).
- **Consequences:** a user who sends an empty text spends one request. That's acceptable, and the UI also disables the button on empty text.

## D9 — Input limits — accepted

- **Decision:** text 1–5,000 characters after trim; JSON body ≤ 20kb; LLM timeout 15 s.
- **Why:** bounds token cost per call (~2–3K tokens), so the 250K TPM limit is never the bottleneck. Real emails fit easily.

## D10 — Prompt-injection mitigation — accepted

- **Context:** the email is untrusted text sent to an LLM.
- **Decision:**
  - The text is wrapped in `<email>…</email>`. Any closing tag inside it, in any case or spacing (`</EMAIL>`, `< /email >`), is escaped to `&lt;/email&gt;`, which is no longer tag-shaped. (`</ email>`, the first idea, still looks like a tag to a lenient model.)
  - The system prompt says the content is data, never instructions.
  - The output is validated by schema.
  - Output is rendered as text, never HTML.
- **Alternatives:** a second "guard" LLM call (doubles cost and quota).
- **Consequences:** the worst case is a wrong but well-formed analysis shown to the person who wrote the injection. It can't damage anything else.

## D11 — Error contract — accepted

- **Decision:** one body shape, `{ error: { code, message } }`.

  | Condition                                  | Status | Code                                    |
  | ------------------------------------------ | ------ | --------------------------------------- |
  | Invalid input                              | 400    | `INVALID_INPUT`                         |
  | Body too large                             | 413    | `PAYLOAD_TOO_LARGE`                     |
  | Per-IP limit                               | 429    | `RATE_LIMITED`                          |
  | Global caps                                | 503    | `LLM_UNAVAILABLE` / `DAILY_CAP_REACHED` |
  | LLM timeout                                | 504    | `LLM_TIMEOUT`                           |
  | Invalid LLM output                         | 502    | `LLM_BAD_OUTPUT`                        |
  | Provider error, including Google's own 429 | 503    | `LLM_UNAVAILABLE`                       |
  | Anything else                              | 500    | `INTERNAL`, no details                  |

- **Why:** a 429 means "you, slow down". It must not appear when the shared quota is the problem. Stable codes let the UI pick its message without parsing text.

## D12 — Analysis on click, not as you type — accepted

- **Decision:** an "Analyze with AI" button. Editing after a result marks it outdated, and a new click aborts any in-flight request.
- **Alternatives:** debounced auto-analysis (feels magic, but with 15 RPM the quota is gone in minutes).
- **Consequences:** one call per intention. A late response can never overwrite a newer one.

## D13 — Answer in the email's language — accepted

- **Why:** an English summary of a French email would be odd for the user. One sentence in the system prompt.

## D14 — Rewrite as its own route, sharing the rate-limit budget — accepted

- **Decision:** `POST /api/rewrite { text, suggestions[3] } → { rewrittenText }`. The same limiters are mounted once over both routes.
- **Alternatives:** one route with a `mode` field (a union schema, less readable); separate budgets (would double what one visitor can spend).
- **Consequences:** each route keeps a single input format and is simpler to test.

## D15 — Rewrite UX: replace + undo — accepted

- **Decision:** the rewritten text replaces the editor content and the previous text is kept for one-click Undo. The analysis becomes outdated. Undo disappears once the user edits by hand.
- **Alternatives:** a side-by-side diff (nicer, much more UI work).

## D16 — Spam rules ported from the existing tool — accepted

- **Decision:** ~770 rules plus the original scoring formula, generated from the live script, with credit in the file header.
- **Alternatives:** a hand-made list (behaves differently from the tool we're duplicating).
- **Consequences:** the client confirmed reuse (2026-11-16). Swapping the list later wouldn't touch the engine.

## D17 — Highlighting without jQuery — accepted

- **Decision:** a transparent textarea over a backdrop div with identical metrics, scroll synced. All user text is HTML-escaped before the `<mark>` tags are added.
- **Alternatives:** `contenteditable` (caret and paste bugs); keeping the jQuery plugin (mixes two UI models in a Vue app).
- **Consequences:** XSS is covered by a test with `<img onerror>`.

## D18 — One Docker image, Express serves the client — accepted

- **Decision:** a multi-stage `node:24-alpine` image. In production, Express serves `client/dist` and the API on one origin.
- **Alternatives:** two services (an nginx frontend and an API); needs CORS and two deploys.
- **Consequences:** no CORS, one Coolify resource, healthcheck on `/api/health`.

## D19 — Git workflow: feature branches + PRs, CI from day one — accepted

- **Decision:**
  - `main` is protected and requires green CI.
  - There are 6 PRs, one per vertical slice (see the plan), each with a template-free description: what, why, how tested, and decisions added.
  - Inside a PR, one commit per task. Merge with a merge commit so task commits stay visible.
- **Alternatives:** committing straight to `main` (no visible review trail); one PR per task (13 PRs is noise for a solo test).
- **Consequences:** the GitHub history shows how the work was split, CI on every change, and the reasoning in each PR.

## D20 — Toolchain: ESM everywhere, TypeScript 5.9 pinned — accepted

- **Context:** the latest TypeScript is 7.0, but `ts-jest` (Jest transform, D3 tests) needs `<7` and `typescript-eslint` needs `<6.1`. The plan doesn't say whether packages use ESM or CommonJS.
- **Decision:**
  - TypeScript `~5.9.3` in every package.
  - Every package is ESM (`"type": "module"`), compiled with `module: NodeNext`, so relative imports carry a `.js` extension (`./analysis.js`).
  - `strict` plus `noUncheckedIndexedAccess`: `array[i]` is typed `T | undefined`, which matters for the offset maths in the highlighter.
  - Prettier formats the whole repo (docs included), and `npm run lint` checks both ESLint and Prettier.
  - Workspaces are listed as they are created; root scripts use `--workspaces --if-present`, so a new package is covered by CI just by joining the list.
- **Alternatives:** TypeScript 7 (faster compiler, but breaks the Jest and ESLint toolchain today); CommonJS (simpler for Jest, but the AI SDK and Vite ecosystem are ESM-first).
- **Consequences:**
  - `ai` and `@ai-sdk/*` are ESM-only, so the server's Jest runs in ESM mode: `ts-jest` with `useESM`, Node's `--experimental-vm-modules` flag, and imports from `@jest/globals` instead of global `jest`.
  - Checked in Task 2: Jest loads `ai` and its test mocks (`MockLanguageModelV4`).
  - Moving to TS 7 later is a version bump once `ts-jest` and `typescript-eslint` support it.

## D21 — Env config: fail fast, report every error at once — accepted

- **Context:** a wrong variable on Coolify should stop the container at boot, not surface on the first visitor's request.
- **Decision:**
  - A zod schema whose keys are the env variable names. Each validation error therefore names the variable to fix, and every invalid variable is listed in one error.
  - Numbers must be positive integers. `TRUST_PROXY` also accepts `0` (no proxy in front, as in local dev).
  - API keys are not validated here, because each provider SDK reads its own variable.
- **Alternatives:** reading `process.env` where it's used (failures surface late, defaults scattered); a config library (overkill for 9 variables).
- **Consequences:**
  - `loadConfig` takes the env as an argument, so tests never touch `process.env`.
  - A variable set to an empty string (`PORT=`) is an error, not the default. Leave it unset to use the default.
