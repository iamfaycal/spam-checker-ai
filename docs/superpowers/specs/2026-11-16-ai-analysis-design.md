# AI Analysis for Spam Checker — Design

## Intent

Technical test for a client mission. Rebuild the Mailmeteor-style Spam Checker
(https://mailmeteor.com/spam-checker) in Vue and add an **AI analysis** card.
The reviewer mostly judges **code quality and tests**, then the demo.

Brief (client's words):
- Frontend: new "AI Analysis" card with a summary of the analysis and 3 improvement suggestions.
- Backend: a single route that calls an LLM provider with the text + a system prompt framing
  the analysis, and returns the summary and the three suggestions as structured data.
  The route is public, so it must limit calls to prevent abuse.
- Deliverable: one GitHub repo with frontend and backend.

## Goals
- Visual duplicate of the existing tool: editor with live keyword highlighting, score/words/read time, category list.
- AI card as in the reference screenshot: summary, risk badge (low/medium/high), 3 suggestions.
- `POST /api/analyze` returning validated structured JSON (summary, risk, 3 suggestions).
- "Rewrite with AI": `POST /api/rewrite` applies the 3 suggestions. The editor text is replaced, with one-click Undo, and the analysis is marked outdated.
- Abuse protection: per-IP limits, a global daily cap below the provider quota, input-size cap.
- Provider-agnostic LLM layer; default Gemini `gemini-3.5-flash-lite` (free tier).
- Strong test coverage (Jest + Supertest on the server, Vitest on the client), CI on GitHub Actions.
- Demo deployed on the user's Coolify server as one Docker image.

## Non-goals
- Accounts, persistence, analytics, multi-instance rate limiting (in-memory store is enough for one container; Redis noted in README).
- Pixel-perfect copy of Mailmeteor's CSS or brand assets.

## Anti-goals
- Calling the LLM on every keystroke (burns the free quota).
- Trusting LLM output unvalidated, or rendering user text as raw HTML.

## Approaches considered
1. **Vercel AI SDK + zod structured output (chosen).** One schema validates the LLM output and types the API; switching provider = env var. Cost: one dependency family.
2. Provider SDKs behind a hand-written adapter interface. More code to test, same result.
3. Raw `fetch` to Gemini with JSON mode. Simplest, but not provider-agnostic.

## Decisions (user)
- Vue frontend duplicating the current tool; Node/Express/TypeScript/Jest backend; Gemini Flash Lite free tier; Coolify deploy.
- Rewrite with AI is in scope. "One route" was not a hard requirement.

## Decisions (Claude's calls — check these)
- npm-workspaces monorepo: `shared` (zod schemas + types), `server`, `client`.
- Rewrite has its own route (`/api/rewrite`) rather than a `mode` flag: one schema per route stays simpler to validate and test. Both routes share one rate-limit budget.
- Analysis triggered by an explicit "Analyze with AI" button, not on input. Card flags the result as outdated when the text changes.
- Summary and suggestions written in the email's own language.
- Limits: text 1–5,000 chars; 5 req/min and 50 req/day per IP; 1,000 req/day global (free tier ≈1,500 RPD, unverified); LLM timeout 15 s. All env-configurable.
- `trust proxy` = 1 hop (Coolify's Traefik), env-configurable.
- Express serves the built client in production → one image, one domain, no CORS.
- Free-tier data may be used by Google for training: stated in README.
