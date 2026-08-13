# Cyberbot — Implementation Roadmap

Product: multi-tenant AI commerce bot for real shops (BD-first): Meta + web chat → AI replies → orders → dashboard ops.

Repo reality: a capable monolith that has most of the product surface, but architecture and multi-tenancy are unfinished. The biggest risks are structure (`index.js` god-file), incomplete multi-tenancy, and a few open security holes — not missing features.

Good to ~70% of a shippable product. The gap is finishing multi-tenant boundaries and shrinking the monolith so features don't cross shops.

---

## 0. Status Dashboard

Grade key: `Fragile` = needs work, `OK` = works but incomplete, `Strong` = solid.

| # | Area | Current state | Grade | Action | Status |
|---|------|---------------|-------|--------|--------|
| 1 | Entry / API | `src/server.js` (single entry) + `src/app.js` (composition root) + `src/routes/*` (10 modules); `index.js` is a one-line re-export | Strong | DONE: split into `src/routes/*` + thin `src/app.js`; single entry `src/server.js` | Done |
| 2 | Multi-tenancy & data model | `MULTI_TENANT_TABLES` covers 7 tables; 9+ tables un-scoped; settings are global (`configId: "global"`) | Fragile | UPDATE (P0/P1): tenant columns + expanded table list + per-tenant settings | Partly in PR branches |
| 3 | Security & auth | Order HTTP endpoint open on master; JWT/env/token-enc/webhook-signature good | OK | UPDATE (P0): protect order API, `INTERNAL_ORDER_SECRET`, audit log, rate limits | Partly in PR branches |
| 4 | Order & payments | Robust chat path (`createOrderSafe` idempotency); HTTP path weak on master; Shopify/Woo tenancy gaps; payments single-tenant | Fragile | UPDATE (P0/P1): tenant on every order + tenant payment creds + callbacks | Not started |
| 5 | AI / RAG / knowledge | Groq→Gemini, RAG, business_info vs rag types — strong core | Strong | UPDATE (P1): namespaced RAG, per-tenant retrieval only | Not started |
| 6 | Channels | `tenant_channels` mapping good; root `messenger.js`/`instagram.js` outside services; web chat lacks tenant resolution | OK | UPDATE (P0/P1): web chat tenant resolution; move helpers under `src/services/channels/` | P0 partly in PR branches |
| 7 | Dashboard (Next.js) | Full page set; proxy exists; risk: shows data backend doesn't isolate yet | OK | UPDATE (P1): auth+tenant on every fetch; empty states; tenant switcher; onboarding | Not started |
| 8 | Queues / reliability | BullMQ+Redis+dedup+window good; memory idempotency fallback is process-local risk | Fragile | UPDATE (P1): Redis required in prod; optional worker process; DLQ visibility | Not started |
| 9 | Database / migrations | Single incremental `migration.sql`; incomplete tenant columns | Fragile | UPDATE (P0): one migration for remaining columns+indexes; BUILD (P2) numbered migrations | Not started |
| 10 | DevOps / Docker | Multi-stage decent; compose = app+Redis; `.env.example` incomplete | OK | UPDATE (P1): env docs, single entry in Docker, staging compose | P1 partially in PR branch |
| 11 | Tests | Good start (tenantIsolation, rbac, auth, idempotency, security); mocks only, few cross-tenant E2E | OK | UPDATE (P1): tenant-A-vs-B tests; order API integration test | Not started |
| 12 | Docs & hygiene | README overclaims multi-tenant security; patch scripts + root clutter | OK | UPDATE: honest README; TENANCY.md + DEPLOY.md; REMOVE patch scripts | Partly in PR branch |

---

## 1. Phase 0 — Stop the bleeding (1–2 days)

**Goal:** close the two open security/multi-tenant gaps and remove one-shot scripts so the repo is pushable.

### 1.1 Tenant order isolation + protected order API
- **Carry-over:** `fix/tenant-order-isolation` has `src/routes/orders.js` (protected `POST /api/orders/from-ai`), `createOrderSafe`, `orderIdempotency`/`orderFlow` deltas. Rebase onto master and complete.
- **UPDATE (P0):** Auth required on `POST /api/orders/from-ai` in `index.js:1434` (JWT via `authenticateAdmin` OR service-to-service `INTERNAL_ORDER_SECRET` header).
- **UPDATE (P0):** `createOrderSafe` and idempotency key must include `tenant_id` so an order created for tenant A can never dedupe/return a tenant B order.
- **UPDATE (P0):** Tenant is resolved before ALS wraps the order path (from JWT, header, or channel mapping).
- **Success criteria:** unauthenticated request → 401; no-tenant request → 401/422; tenant A cannot read/create tenant B orders; duplicate request with same key+tenant → 409 with same orderId.

### 1.2 Web chat tenant resolution
- **Carry-over:** `fix/web-chat-tenant-and-env-hygiene` adds `src/routes/chat.js`. Rebase and adapt.
- **UPDATE (P0):** `POST /api/chat` in `index.js:794` must resolve tenant before ALS — accept site key / channel id / `?tenant=` in the widget payload; reject requests that cannot map to exactly one tenant.
- **UPDATE (P0):** Replace global `Settings.findOne({ configId: "global" })` lookup with tenant-scoped settings.
- **Success criteria:** web chat without a resolvable tenant → 400; chat for two tenants never shares users/messages/settings.

### 1.3 Remove patch scripts + document internal secret
- **REMOVE:** `scripts/apply-order-and-health-patch.js` and any one-shot "patch the monolith" scripts.
- **UPDATE (P1):** `.env.example` gains `INTERNAL_ORDER_SECRET` + production checklist comments.
- **Success criteria:** no patch scripts in repo; `.env.example` documents the secret; README no longer claims multi-tenant security is complete.

---

## 2. Phase 1 — Real multi-tenant data (3–7 days)

**Goal:** every tenant-owned row is physically scoped; cross-tenant leaks are impossible at the DB layer.

### 2.1 Migration: tenant columns + indexes
- **UPDATE (P0):** Add `tenant_id` (+ indexes, `deleted_at` soft-delete where missing) to: `order_sessions`, `payments`, `ecommerce_connections`, `settings`, `feedback`, `ads`, `ad_clicks`, `templates`, `broadcasts`. (Replaces/augments `migration.sql`.)
- **UPDATE (P0):** Extend `MULTI_TENANT_TABLES` in `src/config/supabaseClient.js:25` to match.
- **UPDATE (P0):** New rows require `tenant_id` (NOT NULL default where safe, or strict validation in model layer for existing rows).
- **Success criteria:** every listed table returns 401/400 on tenantless access; no table in a tenant query returns rows outside its tenant.

### 2.2 Per-tenant settings
- **UPDATE (P1):** Settings move from global `configId: "global"` to per-tenant rows; migrations/seed may still exist for a single active shop but must not be the multi-tenant path.
- **Success criteria:** tenant A settings independent of tenant B; no shared global row referenced in tenant-scoped code paths.

### 2.3 Isolation test suite
- **BUILD (P1):** Tests proving Tenant A cannot read/create Tenant B orders/products/messages/settings.
- **BUILD (P1):** Integration test for protected `/api/orders/from-ai` → 401 without secret/JWT.

---

## 3. Phase 2 — Structure (1–2 weeks)

**Goal:** shrink the monolith so routes are individually securable/testable.

### 3.1 Split `index.js` → `src/routes/*`
- **UPDATE (P1):** Extract `src/routes/auth.js`, `webhooks.js`, `admin.js`, `products.js`, `knowledge.js`, `ads.js`, `chat.js` (carry-over from branch), `orders.js` (carry-over), `health.js` (done).
- **UPDATE (P1):** Thin `src/app.js` composes them via shared `register*Routes(app)` pattern already started.
- **Success criteria:** `index.js` no longer contains route handlers; each route module testable in isolation; behavior unchanged (tests pass).

### 3.2 Single entry point
- **UPDATE (P1):** `src/server.js` is the only entry; `index.js` becomes a re-export or is deleted; Docker `CMD`, `start-all.js`, docs updated.
- **Success criteria:** `node src/server.js` and container both start the same app; no dual-start confusion.

### 3.3 Channel helpers under services
- **UPDATE (P1):** Move root `messenger.js`/`instagram.js` send helpers under `src/services/channels/`; keep root files as re-exports or remove after comment-checking usages.
- **Success criteria:** no channel send logic referenced from root; webhook handlers import from services path.

### 3.4 Tenant-namespaced RAG
- **UPDATE (P1):** Partition Pinecone vector store by `tenant_id` (namespace or metadata filter); system prompt + product list fetched from current tenant only; remove global seed knowledge that leaks across tenants in prod.

---

## 4. Phase 3 — Product depth (ongoing)

- **BUILD:** Tenant onboarding API — create tenant → channel → first admin.
- **BUILD:** Superadmin tenant switcher + audited impersonate (controlled header, audit log).
- **BUILD:** Payments fully tenant-scoped (extend `utils/payments.js`) + COD / bKash / Nagad callback verification with tenant context.
- **UPDATE (P1):** Order status transitions + notifications per channel.
- **BUILD:** Optional separate worker process (`utils/worker.js` as real entry).
- **UPDATE (P1):** Redis required in production — no silent memory-only idempotency across instances.
- **UPDATE (P1):** Audit log for admin actions (team, products, settings, order status).
- **UPDATE (P1):** Rate limits tightened on webhooks + chat.
- **UPDATE (P1):** Dashboard: every fetch through authenticated proxy carrying tenant, never trust client `tenant_id`; empty states + errors when tenant context missing; live conversation actions tightened; remove dead demo data.
- **UPDATE (P2):** DLQ dashboard / retry visibility.
- **BUILD (P2):** Numbered migrations folder / Supabase migration workflow; drop reliance on app-layer-only isolation.
- **UPDATE:** `docs/TENANCY.md` + `docs/DEPLOY.md`; META_SETUP production webhook URLs + per-tenant notes; honest README.

---

## 5. Not building now

- Full microservices split.
- New channels (Telegram, etc.) before tenancy is solid.
- Heavy ML fine-tune pipeline before RAG is tenant-safe.
- Big UI redesign before API isolation matches the screens.
- Rotate/revoke Meta tokens UI is deferred (encrypted storage partially exists) unless P0/P1 stabilize first.

---

## 6. Roadmap → verifiable tasks

Each roadmap item above becomes a task with: **file/area, action (UPDATE/BUILD/REMOVE), why (P0/P1/P2), success criteria**. Execution follows the Mandatory Skill Gate in `AGENTS.md`:

1. `brainstorming` → 2. `writing-plans` → 3. (debugging if bug) → 4. `test-driven-development` → implementation skills (`security-and-hardening`, `api-and-interface-design`, `observability-and-instrumentation`, `performance-optimization`, `ui-ux-pro-max` as applicable) → 10. `verification-before-completion`.

Sequencing note: Phase 0 first (unblocks everything), then Phase 1 migrations (make SaaS real), then Phase 2 structure (make it maintainable), then Phase 3 depth. Each phase is independently shipable and should be merged before starting the next.