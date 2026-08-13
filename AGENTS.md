# Cyberbot — Agent Instructions

## Project Overview

Multi-channel AI chatbot SaaS ("Cyberbot") with Messenger, WhatsApp, Instagram, and website support.

**Stack:** Node.js/Express backend, Next.js 16 (App Router) dashboard, Supabase (PostgreSQL), Groq (Qwen 3.6 27B) + Gemini 2.5 Flash AI, Socket.io real-time.

## Architecture

```
index.js              → Thin entry: requires ./src/server (Docker/start-all.js/package.json keep `node index.js`)
src/server.js         → Single entry: createApp(), init (admin/settings/products/templates/RAG), graceful shutdown
src/app.js            → Composition root: Express app + HTTP server + Socket.IO, CORS, limiters, registers all routes
src/routes/*.js       → Route modules (health, orders, chat, auth, integrations, webhooks, admin, ads, products, knowledge)
src/services/ai/gemini.js → AI provider abstraction (Groq primary, Gemini fallback)
src/services/channels/ → messageHandlers.js factory + messenger.js/whatsapp.js/instagram.js channel adapters
src/config/supabaseClient.js → Supabase client + Model adapters
utils/queue.js        → Bull queue with exponential dedup, retry, DLQ
utils/retry.js        → Webhook retry queue with dead letter queue
dashboard/            → Next.js 16 dashboard (shadcn/ui, Tailwind CSS 4)
```

## Code Style

- CommonJS (`require`/`module.exports`) in backend
- TypeScript in `dashboard-new/`
- No comments unless requested
- Follow existing patterns — check neighboring files before adding new ones

## Development Workflow

When working on this project, follow the skill lifecycle:

1. **Bug fix** → `systematic-debugging` → `test-driven-development` → verify
2. **New feature** → `writing-plans` → implement → `verification-before-completion`
3. **UI work** → `ui-ux-pro-max` or `frontend-design` for design; shadcn/ui components already installed
4. **API changes** → Add/extend route modules in `src/routes/*.js`; register in `src/app.js` (check existing patterns there)
5. **Security review** → `security-and-hardening` from `agent-skills/`
6. **Performance** → `performance-optimization` from `agent-skills/`

## Mandatory Skill Gate

**Before changing anything in the codebase (edit, add, delete, or move a file; write or modify any code), you MUST load and follow the relevant skills below. This is not optional.**

Apply the gate in this order:

1. **`brainstorming`** — Always load first for any feature, component, or behavior change. Clarify intent and requirements before writing any code.
2. **`writing-plans`** — Load for any multi-step task. Produce an explicit plan with verifiable success criteria before touching code.
3. **`systematic-debugging`** — Load when diagnosing any bug, test failure, or unexpected behavior, before proposing fixes.
4. **`test-driven-development`** — Load before implementing any feature or bugfix. Write tests first, then implement.
5. **`security-and-hardening`** — Load for any code that handles user input, auth, credentials, webhooks, or third-party platform callbacks.
6. **`api-and-interface-design`** — Load when adding or modifying any API route, webhook contract, or module boundary.
7. **`observability-and-instrumentation`** — Load when adding logging, metrics, or anything that runs in production.
8. **`performance-optimization`** — Load when changing code that could affect latency, throughput, or load (AI calls, Socket.io, queues, DB queries).
9. **`ui-ux-pro-max`** — Load for any dashboard/UI change.
10. **`verification-before-completion`** — Load before claiming any work is done. Run the verification commands and confirm output first.

When multiple skills apply, finish the gate (process skills first: brainstorming → writing-plans → systematic-debugging → test-driven-development — then implementation skills), then follow `verification-before-completion` before declaring success.

## Key Conventions

- **Auth:** JWT in httpOnly cookies (`admin_token`), `authenticateAdmin` middleware reads header OR cookie
- **API proxy:** Dashboard → Next.js rewrites → Express backend (port 3000)
- **Knowledge base:** `type` column: `business_info` (always in prompt) vs `rag` (keyword-matched)
- **AI prompt:** Built dynamically from `settings` table + `knowledge_base` (business_info entries)
- **Supabase:** Use existing Model adapters in `supabaseClient.js`, don't write raw SQL for CRUD
- **shadcn/ui v6:** Uses `@base-ui/react` — `render` prop, not `asChild`
- **Database:** Quoted camelCase identifiers: `"businessPhone"`, `"businessEmail"`, etc.

## Available Skills

Superpowers skills (auto-discovered):
- `systematic-debugging` — Use for any bug or test failure
- `test-driven-development` — Use before implementing features
- `verification-before-completion` — Use before claiming work is done
- `writing-plans` — Use for multi-step implementations
- `brainstorming` — Use before creative/design work
- `ui-ux-pro-max` — Use for dashboard UI work

Agent-skills (installed to `~/.config/opencode/skills/`):
- `security-and-hardening` — OWASP audit, input validation
- `performance-optimization` — Measure first, optimize what matters
- `api-and-interface-design` — Stable API contracts
- `code-review-and-quality` — Five-axis review
- `observability-and-instrumentation` — Structured logging, metrics

All 24 agent-skills available in `agent-skills/skills/` for reference.

## Testing

Tests use the built-in `node:test` runner (no jest needed). Tests live in `tests/*.test.js`.
- Run the full backend suite: `npm test` (alias: `npm run test:unit`)
- Backend: Add unit tests under `tests/` for new `utils/` modules
- Dashboard: Next.js built-in testing (`@testing-library/react`)
- Always verify with `node index.js` (backend) and `npm run build` (dashboard) before claiming done

## Common Pitfalls

- Don't use `asChild` on shadcn/ui components — use `render` prop (v6 uses @base-ui/react)
- Don't hardcode business info in prompts — always fetch from DB via `getBusinessInfoContext()`
- Don't use `keywords` field in knowledge base — it's `tags`
- Don't use `name`/`email` in team members — it's `username`/`role`
- Don't use `POST` for settings save without `updates` parameter — backend expects `{ updates: {...} }`
- Don't forget `role: "model"` (not `"agent"`) in conversation messages

---

## Karpathy Guidelines (Behavioral)

These 4 principles reduce common LLM coding mistakes. Bias toward caution over speed — for trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

**Test:** Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let the agent loop independently. Weak criteria ("make it work") require constant clarification.
