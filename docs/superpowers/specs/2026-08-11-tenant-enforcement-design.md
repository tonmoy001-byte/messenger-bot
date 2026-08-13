# Design: Enforce `tenant_id` on Every Database Operation

Date: 2026-08-11
Status: Draft (approved S1–S3; pending spec review)
Branch: `fix/phase0-multi-tenant-hardening` (Phase 1 work)
Preceded by: `docs/superpowers/plans/2026-08-10-phase0-multi-tenant-hardening.md`, PR #15

## Objective

Enforce tenant isolation at the data layer so no query or mutation on a
tenant-owned table can ever run unscoped, in every environment. This is Phase 1
of ROADMAP section 2 (multi-tenancy & data model).

User-chosen scope decisions (recorded during brainstorming):

- **Include all remaining tables** (ROADMAP Phase 1.1), not just the riskiest ones.
- **Hard-fail in production**: tenant-owned tables throw/return 500 on queries
  without tenant context when `NODE_ENV=production`; non-production is lenient
  (warn). Superadmin context and a small allowlist bypass.
- **Public product routes** resolve the tenant like `/api/chat` (400 when
  unresolvable) instead of being left context-less.

## Current state (verified)

- Every table operation already routes through the `Model` wrapper in
  `src/config/supabaseClient.js` (Mongoose-drop-in). `applyFilter` (line 56)
  scopes reads/filtered writes when `ctx.tenant_id` exists; otherwise only
  soft-delete filtering applies (no rejection) — a silent cross-tenant read
  path.
- `save`/`insertMany` inject `tenant_id` only when context exists; otherwise
  inserts a tenant-less row.
- Hard-delete paths (`findByIdAndDelete`, `deleteOne`, `deleteMany` when no
  context) bypass tenant scoping entirely.
- `MULTI_TENANT_TABLES` (line 25) covers 8 tables. Unscoped Model tables:
  `settings`, `order_sessions`, `payments`, `broadcasts`, `templates`,
  `ecommerce_connections`, `feedback`, `conversation_analytics`, `ads`,
  `ad_clicks`.
- RAG fallback in `utils/rag.js` (line 41) bypasses the wrapper via raw
  `KnowledgeBase.client.from("knowledge_base")` — leaks all tenants' KB.
- Vector search (`utils/vectorDB.js`) uses a single Pinecone namespace
  (`NAMESPACE = "default"`) with linear metadata-filter support (line 79).
- `settings` is global (`configId: "global"`), referenced at many call sites;
  not tenant-scoped today.
- Webhook handlers and admin routes already resolve/run in tenant context
  (verified S1 exploration).
- Legitimate context-free lookups exist: `verifyWebhookToken` and
  `getTenantByChannel` query `Tenant`/`TenantChannel` before a tenant context
  exists; admin auth (`Admin.findOne({ username })`) at index.js:207/239/273
  and startup bootstrap (~1661/1681) run outside any context.

## Design

### 1. Enforcement helper in the Model wrapper (supabaseClient.js)

Single helper called at the top of every wrapper path that touches a
tenant-owned table:

```
requireTenantScope(tableName) → throws TenantContextError in production
```

| Condition | Result |
|---|---|
| table not in `MULTI_TENANT_TABLES` | allow |
| table in allowlist (`tenants`, `tenant_channels`) | allow |
| `ctx.tenant_id` present | allow (normal scoped path) |
| `ctx.isSuperAdmin` true (superadmin context, `tenant_id: null`) | allow |
| `NODE_ENV === "production"` | **throw** `TenantContextError` (status 500) |
| otherwise (dev/test) | log warning, allow |

Enforcement points (6, all inside the wrapper):
- `applyFilter` (line 56) — covers `find`, `findOne`, `countDocuments`,
  `distinct`, `aggregate`, `updateOne`, `updateMany`, filtered deletes.
- `save`/`create` (line 344), `insertMany` (line 357) — reject tenant-less writes.
- `findByIdAndUpdate` (line 282), `findByIdAndDelete` (line 322) — query paths
  outside `applyFilter`.

`TenantContextError`: typed error with `name` and `statusCode = 500`, so
existing `catch (err) { res.status(500).json({ error: err.message }) }`
handlers work untouched.

Context-free call sites made explicit (surgical wraps, no allowlist widening):
- Admin auth: `Admin.findOne({ username })` in signup/login/refresh →
  wrapped in `runWithTenantContext({ role: "superadmin", isSuperAdmin: true,
  tenant_id: null }, ...)`.
- Startup bootstrap (default admin + settings seed) — superadmin wrap.

Background-work concern (flagged for plan): Bull jobs / webhook retry jobs in
`utils/queue.js` / `utils/retry.js` must run inside `runWithTenantContext`
before touching tenant tables; audit enqueue data during implementation.

### 2. Data model changes (migration + per-tenant settings) — APPROVED S2

**2A. Expand `MULTI_TENANT_TABLES`** with the 10 unscoped tables above.

**2B. Migration** — new file `migration-phase1-tenant-columns.sql` (run after
`migration.sql`, noted in README/start docs so it is not skipped), for each of
the 10 tables:
- `ALTER TABLE <table> ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL`
- `ALTER TABLE <table> ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE`
- `CREATE INDEX IF NOT EXISTS idx_<table>_tenant_id ON <table>(tenant_id)`

Mirrors existing pattern (migration.sql:36–68). `ON DELETE SET NULL` per-table
type matches existing sibling tables; `tenant_channels`/`conversations` keep
their existing `ON DELETE CASCADE` (not being changed).

VERIFIED FINDING (self-review): `migration.sql` creates only `tenants`,
`tenant_channels`, `conversations` and ALTERs 7 other tables. The 10 Phase 1
tables (`settings`, `order_sessions`, `payments`, `broadcasts`, `templates`,
`ecommerce_connections`, `feedback`, `conversation_analytics`, `ads`,
`ad_clicks`) exist in the live DB but have NO CREATE statements in the repo.
→ Phase 1 migration must be purely idempotent ALTER/INDEX (as above), never
`CREATE TABLE`. Their full schema is defined only inside the live Supabase
project (project id `nvsvhvwrmlnvesqwlkqz`). Live-DB schema confirmation is an
implementation-time verification step: Supabase MCP auth currently fails for
both `supabase_read_only_user` and `postgres` roles, so schema must be pulled
via a working DB connection during implementation before finalizing column
types (esp. `settings` JSON/JSONB vs text columns).

**2C. Per-tenant settings** (ROADMAP 2.2):
- Keep `configId: "global"` as the key VALUE; tenant isolation comes from
  `tenant_id`. Read auto-scopes via `applyFilter`; upsert auto-injects
  `tenant_id` (line 267). So `Settings.findOne({ configId: "global" })` call
  sites need no change once `settings` is in MULTI_TENANT_TABLES and rows have
  `tenant_id`.
- **Idempotent backfill** (in migration): for each existing tenant, upsert a
  settings row copied from the current global row. `INSERT ... ON CONFLICT
  (tenant_id, configId) DO NOTHING` — requires a unique raw constraint on
  `(tenant_id, configId)`, added in the same migration:
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_tenant_config ON settings(tenant_id, configId)`.
  Source of truth = current global row.
- Global fallback row: left in place, only reachable via superadmin context
  post-migration. Documented choice.
- Bootstrap: global seed becomes superadmin-context write; new tenant signup
  creates a settings row for the tenant.

**2D. `conversation_analytics` included** (approved by reviewer — real
cross-tenant leak if omitted). Not on ROADMAP line 61 list; adding anyway.

**2E. Public product routes** (`index.js:1317, 1324`):
- Extract shared `resolveTenantFromRequest(req)` from `resolveWebChatTenant`
  (`src/routes/chat.js`); checks query `?tenant=` (slug or tenant_id) then
  `X-Tenant-ID` header.
- Wrap both GET handlers in `runWithTenantContext`; unresolvable → 400
  (matches `/api/chat`). `src/routes/chat.js` reuses the shared helper.

Refinements folded in:
- README notes ordered migration sequence (`migration.sql` →
  `migration-phase1-tenant-columns.sql`).
- Products are never visible without a tenant (400 default).
- Auto `deleted_at IS NULL` filter on tenant-owned reads in the wrapper
  (prevents future "forgot soft-delete filter" bugs).

### 3. RAG / vector isolation (S3)

1. **RAG fallback** (`utils/rag.js:41`): add `tenant_id` eq from
   `getTenantContext()`; no tenant context → skip fallback (return "") in
   production. `retrieveContext` only runs under `generateReply` (tenant
   context), so this matches wrapper scoping. `getBusinessInfoContext`
   (gemini.js:29) uses `KnowledgeBase.find` (already scoped) — unchanged.
2. **Vector partition**: `indexKnowledgeEntry` adds `tenant_id` to Pinecone
   metadata; `queryVectors` accepts `tenant_id` and applies `filter:
   { tenant_id }` (vectorDB.js:79 linear filter support). `retrieveContext`
   passes `ctx.tenant_id`. No context in production → skip vector retrieval.
   Single namespace retained (ROADMAP 3.4 objective met via metadata filter).

### 4. Tests

Extend `tests/tenantIsolation.test.js` (existing mock chain captures queries
without a live DB):
1. Read/update/delete on MULTI_TENANT_TABLES with no context → throws
   `TenantContextError` when `NODE_ENV=production`; allowed (warn) otherwise.
2. `tenants` / `tenant_channels` reads allowed without context (allowlist).
3. Superadmin context bypasses enforcement.
4. `settings` upsert injects `tenant_id`; read scopes correctly.
5. Cross-tenant: tenant A `find` never emits tenant B's `tenant_id`.
6. RAG fallback emits `.eq("tenant_id", <ctx>)`; skips when context-less in
   production.

Tests set/restore `process.env.NODE_ENV` around cases (same pattern as mock
chain).

## Success criteria

- `NODE_ENV=production`: every tenant-owned query/mutation without tenant
  context throws; no tenant-less rows can be inserted.
- Settings per-tenant: tenant A settings independent of tenant B
  (ROADMAP 2.2 success criteria).
- Tenant A cannot read tenant B's knowledge base, vector vectors, products,
  messages, orders, or settings (cross-tenant test suite).
- Public `/api/products*` returns 400 without a resolvable tenant.
- Backend test suite passes (currently 44 tests; ~6 new + extended cases).

## Files touched (planned)

- `src/config/supabaseClient.js` — MULTI_TENANT_TABLES, `requireTenantScope`,
  write-path enforcement, auto soft-delete filter, `TenantContextError`.
- `migration-phase1-tenant-columns.sql` — new; columns + index + settings backfill.
- `utils/rag.js` — scoped fallback + tenant metadata/filter for vectors.
- `utils/vectorDB.js` — `queryVectors(tenant_id)` support.
- `index.js` — public products tenant resolution, admin-auth/bootstrap
  superadmin wraps.
- `utils/tenantResolver.js` (new) or fold into `src/routes/chat.js` — shared
  `resolveTenantFromRequest`.
- `src/routes/chat.js` — reuse shared helper.
- `tests/tenantIsolation.test.js` — extended.
- `README.md` — migration ordering note.

## Out of scope

- Payments callbacks / Shopify-Woo tenancy gaps (ROADMAP 4) — not started.
- Audit logging (ROADMAP review item).
- RLS policies at the Postgres level (deferred; application-layer enforcement
  is the Phase 1 mechanism).