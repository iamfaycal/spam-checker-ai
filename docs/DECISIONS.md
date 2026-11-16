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
- **Consequences:**
  - Changing provider means setting `LLM_PROVIDER`, `LLM_MODEL` and that provider's API key. `createModel` is the only file that names providers.
  - The SDK ships a mock model (`MockLanguageModelV4`), so the LLM layer is unit-testable without network.
  - With v7 we call `generateText` with `output: Output.object({ schema })` (`generateObject` is deprecated) and pass the system prompt as `instructions` (`system` is deprecated).

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
- **Consequences:** Google may use free-tier inputs for training. This is stated in the README **and in the app**, under the Analyze button, where visitors actually decide to send their text. Quota drives D6.

## D6 — Four rate limiters, in-memory — accepted

- **Context:** public route; abuse must not burn the 15 RPM / 500 RPD quota.
- **Decision:**
  - Per IP: 5/min and 20/day (429 `RATE_LIMITED` + `Retry-After`).
  - Global: 12/min (503 `LLM_UNAVAILABLE`) and 400/day (503 `DAILY_CAP_REACHED`).
  - `express-rate-limit` with the in-memory store. All values come from env.
- **Alternatives:** per-IP only (many IPs together exceed Google's RPM); Redis store (needed only with several instances); CAPTCHA (friction, overkill for a demo).
- **Consequences:**
  - Our limits fire before Google's. The single-instance limitation is documented, and the fix is a Redis store.
  - Only the per-IP limiters send `RateLimit` headers (draft-8). The global ones send none, because they would overwrite the visitor's own numbers with the shared counter. Every rejection carries `Retry-After`.

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
- **Consequences:**
  - A user who sends an empty text spends one request. That's acceptable, and the UI also disables the button on empty text.
  - The per-IP limiters are mounted on `/api/analyze` before `express.json()`, so an oversized (413) or malformed (400) body also counts against that IP.
  - The global caps are mounted after validation (`validateBody`), so only requests that reach the LLM count. Junk can't drain the shared quota, and requests that reach the LLM and fail (timeout, provider error) still count, because they did spend quota.
  - The library's `skipFailedRequests` was rejected: it would also refund 502/503/504 answers, which did spend quota.

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
  - Rewrite: the suggestions come back from the client, so they are untrusted too. Each is flattened to one line (no injected "4." item) and can't close `<email>` or `<suggestions>`. The rewrite prompt says they only describe edits to this email.
- **Alternatives:** a second "guard" LLM call (doubles cost and quota).
- **Consequences:** the worst case is a wrong but well-formed analysis shown to the person who wrote the injection. It can't damage anything else.

## D11 — Error contract — accepted

- **Decision:** one body shape, `{ error: { code, message } }`. A body-parser rejection is recognised by its `type` **and** a 4xx `status`, so no other error carrying a `type` field becomes a 400.

  | Condition                                  | Status | Code                                    |
  | ------------------------------------------ | ------ | --------------------------------------- |
  | Invalid input                              | 400    | `INVALID_INPUT`                         |
  | Body too large                             | 413    | `PAYLOAD_TOO_LARGE`                     |
  | Unknown `/api` route                       | 404    | `NOT_FOUND`                             |
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
- **Consequences:**
  - One call per intention. A late response can never overwrite a newer one.
  - The button is disabled, with the reason shown, when the text is empty or over 5,000 characters, the same limits the server enforces.
  - After a `429`, the card counts down `Retry-After` and keeps "Try again" disabled until it reaches 0, since an earlier click would only get another 429.

## D13 — Answer in the email's language — accepted

- **Why:** an English summary of a French email would be odd for the user. One sentence in the system prompt.

## D14 — Rewrite as its own route, sharing the rate-limit budget — accepted

- **Decision:** `POST /api/rewrite { text, suggestions[3] } → { rewrittenText }`. The same limiters are mounted once over both routes.
- **Alternatives:** one route with a `mode` field (a union schema, less readable); separate budgets (would double what one visitor can spend).
- **Consequences:**
  - Each route keeps a single input format and is simpler to test.
  - Both routes share the server code paths: `validateBody(schema)`, one `llmRoute` (abort on disconnect), and one analyzer core (`generate`: timeout, error kinds, final schema guard).
  - The same limiter instances are mounted on both paths, so one IP has one bucket and the global caps count both. Tests check it, and a mutation with separate limiter sets fails them.
  - `rewrittenText` is capped at 5,000 characters like the input, so a rewrite can always be re-analyzed.

## D15 — Rewrite UX: replace + undo — accepted

- **Decision:** the rewritten text replaces the editor content and the previous text is kept for one-click Undo. The analysis becomes outdated. Undo disappears once the user edits by hand.
- **Alternatives:** a side-by-side diff (nicer, much more UI work).
- **Consequences:**
  - `canUndo` is derived: true only while the editor still holds exactly the rewritten text. Any hand edit hides Undo, with no extra bookkeeping. Undo stays offered after re-analyzing the rewrite.
  - The editor is read-only while a rewrite runs, and the composable refuses to apply a rewrite if the text changed meanwhile, so typed text is never overwritten.
  - Undo restores the original byte for byte (tested with whitespace, tabs and newlines).
  - The Undo button is rendered outside the analysis states, so it stays reachable even when the re-analysis of a rewrite fails (for example, the daily cap is reached) or is still running. It is hidden only while a new rewrite runs.
  - After several rewrites in a row, Undo still returns to the original: the first text is kept while the editor holds a rewrite.
  - Rate-limited rewrites count down `Retry-After` like analyses, and Rewrite stays disabled until the wait is over. Waits are shown for people ("42s", "3 min", "23 h 24 min").

## D16 — Spam rules ported from the existing tool — accepted

- **Decision:** ~770 rules plus the original scoring formula, generated from the live script, with credit in the file header.
- **Alternatives:** a hand-made list (behaves differently from the tool we're duplicating).
- **Consequences:**
  - The client confirmed reuse (2026-11-16). Swapping the list later wouldn't touch the engine.
  - 769 rules were extracted by a one-off script that read the original file as text (nothing executed). Every pattern compiled, with no duplicates.
  - Patterns are kept verbatim, including redundant escapes like `[\$\.\,]`, so the file can be checked against the source. ESLint's `no-useless-escape` is disabled for that file only.

## D17 — Highlighting without jQuery — accepted

- **Decision:** a transparent textarea over a backdrop div with identical metrics, scroll synced. All user text is HTML-escaped before the `<mark>` tags are added.
- **Alternatives:** `contenteditable` (caret and paste bugs); keeping the jQuery plugin (mixes two UI models in a Vue app).
- **Consequences:**
  - XSS is covered by a test with `<img onerror>`, on the pure function and on the mounted component.
  - Both layers use `scrollbar-gutter: stable`, so their text width is the same whether or not a scrollbar shows. The original instead shifts its overlay 99px off-screen.
  - A trailing newline gets one extra `\n` in the overlay, the same trick as highlight-within-textarea.
  - The textarea has `overscroll-behavior: none`. macOS and iOS elastic bounce moves the text without changing `scrollTop`, so the overlay can't follow and the words briefly leave their highlights. Side effect: while the pointer is over the editor, scrolling doesn't chain to the page once the editor reaches its end. The alternative, both layers in one scroll container with an auto-growing textarea, would keep chaining but is a bigger change.
  - Checked in a real browser (Playwright, 1280px and 375px): textarea and overlay have the same scroll height and text width, scroll stays in sync, and the page never scrolls sideways.

## D18 — One Docker image, Express serves the client — accepted

- **Decision:** a multi-stage `node:24-alpine` image. In production, Express serves `client/dist` and the API on one origin.
- **Alternatives:** two services (an nginx frontend and an API); needs CORS and two deploys.
- **Consequences:**
  - No CORS, one Coolify resource, healthcheck on `/api/health`.
  - Three stages: build (all deps), deps (`npm ci --omit=dev` for server and shared only), and runtime (those deps + `shared/dist`, `server/dist`, `client/dist`). The image runs as `node`, with exec-form `CMD` so node receives `SIGTERM`. Checked: healthy, page + assets + SPA fallback, a live analysis, no CSP errors in a browser, and a clean stop in under 1 s.
  - The client's packages (`vue`, `zod`, `shared`) are **devDependencies**: Vite bundles them into static files at build time. As runtime deps, Vue's optional TypeScript peer leaked into the production install (TypeScript is about 23 MB). Moving them took the image from 227 to 198 MB.
  - CI builds the image and smoke-tests it (healthy, `/api/health`, the page) after the test job.
  - **The image must be served over HTTPS.** helmet's default CSP includes `upgrade-insecure-requests`. On the first, plain-HTTP deploy (Coolify's sslip.io address), browsers fetched the JS and CSS over HTTPS, hit Traefik's self-signed certificate, and showed a blank page. Since the demo is HTTPS-only (Let's Encrypt), helmet's defaults are kept, and the README's deploy steps require HTTPS.

## D19 — Git workflow: feature branches + PRs, CI from day one — accepted

- **Decision:**
  - `main` only changes through a PR with green CI. Branch protection enforces it, since the repo was made public (branch protection isn't available on a free private repo, so until then it was a convention). The rules: pull request required (0 approvals: a solo author can't approve their own PR), checks `test` and `docker` must pass, no force push or deletion, admins included. A direct push to `main` is refused (GH006).
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
  - `LLM_MODEL` defaults to the Gemini model only with the default provider. With `LLM_PROVIDER=openai` or `anthropic`, a missing `LLM_MODEL` is a boot error, instead of a server that starts and then fails every request.
  - `loadConfig` takes the env as an argument, so tests never touch `process.env`.
  - A variable set to an empty string (`PORT=`) is an error, not the default. Leave it unset to use the default.

## D22 — LLM failures: three kinds, and a visitor leaving is not a failure — accepted

- **Context:** the route must turn every LLM failure into the right status (D11), and a request can also stop because the visitor closed the tab.
- **Decision:**
  - The analyzer throws `AnalyzerError` with one of three kinds: `timeout`, `bad_output` or `provider`.
  - **Timeout:** our own `AbortSignal.timeout(LLM_TIMEOUT_MS)`, combined with the caller's signal through `AbortSignal.any`. If our timeout signal fired, the kind is `timeout`, whatever error the SDK raised.
  - **Bad output:** the SDK's `NoObjectGeneratedError`, `TypeValidationError` and `JSONParseError`. Then `AnalysisResultSchema` parses the result again as a final guard.
  - **Provider:** everything else, including the provider's own 429. That 429 means the shared quota ran out, not that this visitor sent too much.
  - **Caller abort:** re-thrown unchanged, not wrapped. Nobody is listening for the answer, so there is nothing to report. The route aborts its signal when the connection closes before the answer is sent, which also stops a paid LLM call, and then sends nothing.
  - `temperature: 0.3`. One retry for a passing server or network error, done by the analyzer itself (`maxRetries: 0` in the SDK), **never for a 429**: a quota error fails fast.
  - An empty or safety-filtered answer (`NoOutputGeneratedError`) is `bad_output` (502), not `provider`.
  - The error handler logs the kind and the underlying cause of every `AnalyzerError` on the server (for example a missing API key), and sends the visitor only the generic code and message.
- **Alternatives:**
  - The SDK's own `timeout` option, which can't tell "too slow" from "visitor left".
  - Mapping a caller abort to `provider`, which would log a failure that never happened.
- **Consequences:**
  - The retry waits **1 s** first (`retryDelayMs`), giving an overloaded model a moment to recover. The wait is abortable: the timeout or the visitor leaving ends it at once. Tests check both the pause and that a timeout during it isn't delayed.
  - The SDK's `maxRetries` can't exclude a status code, so the retry lives in the analyzer. It's tested: a 429 makes 1 call, a 503 makes 2, and a 503 followed by a success resolves.
  - A 5xx retry can make one global-cap slot cost two upstream requests. The caps (12/min, 400/day) leave headroom under Google's 15/500 for it.

## D23 — Spam engine: where we differ from the original tool — accepted

- **Context:** the port must look and score like the original (spec: visual duplicate), but the original has quirks.
- **Decision:**
  - **Overlaps:** one hit per span, the longest match. The original keeps nested matches, so "Dear friend" counts as both "Dear [email/friend/somebody]" and "Friend".
  - **Word count:** whitespace-separated words of the trimmed text. The original's `split(/\s+/).length - 1` is off by one unless the text starts with whitespace. Its own sample only shows 57 because its editor text starts with a newline.
  - **Kept as in the original:** the score formula (hits + 20 if money or shady + 10 if urgency or overpromise; Poor > 20, Okay > 5), and the read time `round(words / 200)`, shown as "a few seconds" or "N min".
- **Alternatives:** a bug-for-bug copy, with nested highlights and a word count that depends on leading whitespace; or the plan's own read-time rule ("a few seconds" under 60 words, "~N min"), which wouldn't match the screenshot.
- **Consequences:**
  - Highlights never nest, so the editor overlay (Task 9) stays simple.
  - On text with nested matches, our hit count is a little lower than the original's. The label can differ only near a threshold. On the sample it doesn't: 8 hits, score 38, Poor (the original gets 9).

## D24 — Client API errors: every code has a message, and nothing unknown crashes the card — accepted

- **Context:** the card must show something sensible for every failure: our error codes, a network drop, a proxy's own error page, or a request we cancelled ourselves.
- **Decision:**
  - `analyzeEmail` returns an analysis validated by the shared schema, or throws `ApiError` with a code (`ErrorCode` or `NETWORK`) and `retryAfterSeconds` read from `Retry-After`.
  - A 200 that breaks the contract is `LLM_BAD_OUTPUT`. An error body that isn't `{ error: { code } }`, such as Traefik's HTML 502 while the server restarts, is `INTERNAL`.
  - A request the client aborted on purpose stays an `AbortError`. `useAiAnalysis` drops any outcome, answer or error, of a request that a newer one replaced (D12).
  - `errorMessage` is an exhaustive `switch`, so adding a code without copy fails the type check. It names the action that failed ("couldn't analyze" or "couldn't rewrite"). The rate-limit copy says "Too many AI requests", because analyze and rewrite share one budget. Codes the plan didn't list map to: `PAYLOAD_TOO_LARGE` → the input message; `NOT_FOUND` and `INTERNAL` → "Something went wrong. Try again."; `RATE_LIMITED` with no `Retry-After` → "try again shortly".
- **Alternatives:** showing the server's `message` field (couples the UI to server wording, D11); mapping unknown bodies by HTTP status (guesses about responses we don't control).
- **Consequences:**
  - The client bundles zod, the cost of validating responses with the same schema as the server (D1).
  - **The shared contract and the client use `zod/mini`**, whose functional API tree-shakes, where classic zod ships whole. Measured: classic zod took the JS from 36.5 to 62.0 kB gzipped; with mini it's 45.3 kB (−16.7 kB, −27%).
  - Same rules, different spelling: `.check(z.trim(), z.minLength(1), z.describe(...))` instead of chained methods. The AI SDK converts mini schemas to JSON Schema with their descriptions, and a test pins that exact JSON Schema.
  - Server-only code (env config, the rewrite output schema) keeps classic zod, which reads better and never reaches the browser. Server helpers that receive shared schemas are typed `z.core.$ZodType`, which accepts both.
  - An ESLint `no-restricted-imports` rule forbids `'zod'` in `client/` and `shared/src/`, so classic zod can't slip back into the bundle. Vite aliases `@spam-checker/shared` to its source, so the client never needs a prior build.

## D25 — Rewrite keeps the email's paragraphs by schema, not by request — accepted

- **Context:** asked in the prompt to "keep the paragraph breaks", Gemini still sometimes returned the whole rewrite as one paragraph. A live rewrite of the 4-paragraph sample came back as a single block.
- **Decision:**
  - The server splits the original into paragraphs (blocks separated by blank lines) and asks the model for `{ paragraphs: string[] }` with **exactly that many items**. The count is in the JSON schema the model must follow (`minItems` = `maxItems`) and stated in the prompt.
  - The server joins the items with blank lines. The API contract doesn't change: the client still receives `{ rewrittenText }`, at most 5,000 characters.
  - A rewrite with the wrong number of paragraphs, or an empty one, is `bad_output` (502, "The AI couldn't rewrite this email. Try again.").
- **Alternatives:**
  - A stronger instruction in the prompt: it can still be ignored, and nothing would catch it.
  - Detecting merged paragraphs and re-splitting them on the server: guesswork about where the breaks belong.
- **Consequences:**
  - The structure is enforced, and checked twice (by the SDK and by our schema guard), like the analysis.
  - Single line breaks inside a paragraph (for example a signature, "Best,\nPaul") stay inside its item.
  - Checked live: 3 rewrites of the 4-paragraph sample, all with 4 paragraphs.
  - A model that can't keep the structure costs the visitor a retry instead of silently merging their text.
