# Tenant Enforcement (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce that every query/mutation on a tenant-owned table runs inside a tenant context, hard-failing in production when it does not, and close the three leak vectors (settings, RAG fallback, public product routes).

**Architecture:** Add a `requireTenantScope(tableName)` guard inside the single Model wrapper (`src/config/supabaseClient.js`) so all reads (via `applyFilter`) and all writes throw `TenantContextError` in production when no tenant context exists. Expand `MULTI_TENANT_TABLES` to the 10 remaining tables, add an idempotent DDL migration + settings backfill script, scope the RAG fallback + Pinecone vectors by `tenant_id`, and give public `/api/products` routes tenant resolution.

**Tech Stack:** Node.js (CommonJS), `node:test` runner, Supabase postgREST client wrapper, AsyncLocalStorage (`utils/tenantContext.js`), Express, Pinecone.

**Spec:** `docs/superpowers/specs/2026-08-11-tenant-enforcement-design.md`

**Self-review corrections folded in (2026-08-11):**
1. Task 2 test no longer references an undefined `mockQueryWith` helper — tests call `applyFilter` directly (it must be exported).
2. Task 3 uses an async-capable `withProduction` and calls real Model instance methods (the guard throws before any client access).
3. Task 4 is exact: a `withSuperadmin` helper + per-call wraps. **Correction vs spec:** signup (`/api/auth/signup`) does NOT need a wrap — it is behind `authenticateAdmin` (= `authenticateTenant`, index.js:183), which wraps the whole chain in `runWithTenantContext` (auth.js:72). Only login and refresh (public routes, `authLimiter` only) and the bootstrap init sequence run truly context-free.
4. Task 6 drops the impossible `embeddings.generateEmbedding` stub (rag.js destructures at require-time; the stub would not take effect). Instead the test relies on `generateEmbedding` returning `null` without `GOOGLE_AI_API_KEY` (test env), which naturally forces the fallback path.
5. Task 6: the fallback skips when there is no tenant context in ALL environments (not only production), which is strictly safer and identical at runtime because `retrieveContext` only ever runs inside `generateReply` (tenant context).
6. **Deviation vs spec §4:** enforcement tests live in a new `tests/enforcement.test.js` (self-contained mock) rather than extending `tests/tenantIsolation.test.js` (keeps existing 194-line suite untouched; surgical).

**Verification baseline (run first):** `node --test "tests/*.test.js"` → 44/44 pass (current HEAD `45cc917`).

**COMPLETION (2026-08-12):** All Tasks 1–8 implemented and verified. Checkboxes below were tracked during execution but not ticked in-file; final state: 64/64 backend tests pass, `node --check` clean on all touched files, production boot smoke-test passes (server starts; Redis gracefully falls back). Deviations from the plan's commit granularity: the working tree fused changes across files, so the plan's 8 proposed commits were collapsed into 3 verified commits (each passes the full suite):
- `f0ade65` — migration + backfill script (Task 5)
- `38f2334` — TenantContextError/requireTenantScope/MULTI_TENANT_TABLES + applyFilter + write-path guards + superadmin wraps + RAG/Pinecone scoping + resolver + public product routes + enforcement tests (Tasks 1–4, 6–7)
- `ca8df05` — README migration ordering note (Task 8)

Known verification gap (unchanged, recorded in plan): live-DB schema for `settings`/`payments`/etc. unverifiable from this env — get a working DB connection before running the phase1 migration against production.

---

## File Structure

- `src/config/supabaseClient.js` — MODIFY: expand `MULTI_TENANT_TABLES`, add `TenantContextError`, `ALLOWLIST_TABLES`, `requireTenantScope`; wire guard into `applyFilter` + `save`/`insertMany`/`findByIdAndUpdate`/`findByIdAndDelete`; export new symbols + `applyFilter`.
- `tests/enforcement.test.js` — CREATE: production hard-fail, allowlist, superadmin bypass, settings scoping, RAG fallback scoping, resolver tests.
- `index.js` — MODIFY: `withSuperadmin` helper; wraps for login `Admin.findOne`+`findByIdAndUpdate`, refresh `Admin.findOne`, bootstrap init sequence; public product routes tenant resolution.
- `utils/rag.js` — MODIFY: skip fallback without tenant context; add `.eq("tenant_id", ctx.tenant_id)`; add `tenant_id` to vector metadata; pass tenant to `queryVectors`.
- `utils/vectorDB.js` — MODIFY: `queryVectors(queryVector, filter, tenantId)` applies metadata filter.
- `src/routes/chat.js` — MODIFY: extract shared `resolveTenantFromRequest` (keep `resolveWebChatTenant` as a thin alias).
- `migration-phase1-tenant-columns.sql` — CREATE: idempotent DDL (tenant_id, deleted_at, indexes, settings unique constraint).
- `scripts/backfill-tenant-settings.js` — CREATE: one-time per-tenant settings backfill (app-level, wrapper-based, idempotent).
- `README.md` — MODIFY: migration ordering note.

---

### Task 1: `TenantContextError` + `requireTenantScope` + expanded `MULTI_TENANT_TABLES`

**Files:**
- Modify: `src/config/supabaseClient.js`
- Test: `tests/enforcement.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/enforcement.test.js`:

```js
// tests/enforcement.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const {
  MULTI_TENANT_TABLES,
  requireTenantScope,
  ALLOWLIST_TABLES,
  TenantContextError,
} = require("../src/config/supabaseClient");

const savedEnv = process.env.NODE_ENV;

async function withProduction(fn) {
  process.env.NODE_ENV = "production";
  try { return await fn(); } finally { process.env.NODE_ENV = savedEnv; }
}

test("MULTI_TENANT_TABLES includes settings and other unscoped tables", () => {
  for (const t of ["settings", "order_sessions", "payments", "broadcasts", "templates",
    "ecommerce_connections", "feedback", "conversation_analytics", "ads", "ad_clicks"]) {
    assert.ok(MULTI_TENANT_TABLES.includes(t), `expected ${t} in MULTI_TENANT_TABLES`);
  }
});

test("ALLOWLIST_TABLES includes tenant registry/mapping tables", () => {
  assert.ok(ALLOWLIST_TABLES.includes("tenants"));
  assert.ok(ALLOWLIST_TABLES.includes("tenant_channels"));
});

test("requireTenantScope allows non-tenant-owned tables with no context", () => {
  withProduction(() => {
    assert.doesNotThrow(() => requireTenantScope("not_a_tenant_table"));
  });
});

test("requireTenantScope allows allowlisted tables with no context", () => {
  withProduction(() => {
    assert.doesNotThrow(() => requireTenantScope("tenant_channels"));
    assert.doesNotThrow(() => requireTenantScope("tenants"));
  });
});

test("requireTenantScope throws TenantContextError in production without context", () => {
  withProduction(() => {
    assert.throws(() => requireTenantScope("products"), (err) => {
      assert.strictEqual(err.name, "TenantContextError");
      assert.strictEqual(err.statusCode, 500);
      return true;
    });
  });
});

test("requireTenantScope is lenient in non-production without context", () => {
  process.env.NODE_ENV = "development";
  try {
    assert.doesNotThrow(() => requireTenantScope("products"));
  } finally {
    process.env.NODE_ENV = savedEnv;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/enforcement.test.js`
Expected: FAIL — `MULTI_TENANT_TABLES`, `requireTenantScope`, `ALLOWLIST_TABLES`, `TenantContextError` not exported from supabaseClient.

- [ ] **Step 3: Implement in `src/config/supabaseClient.js`**

Expand the `MULTI_TENANT_TABLES` array (line 25) with the 10 new tables:

```js
const MULTI_TENANT_TABLES = [
  "admins",
  "users",
  "products",
  "orders",
  "knowledge_base",
  "messages",
  "integrations",
  "tenant_channels",
  "settings",
  "order_sessions",
  "payments",
  "broadcasts",
  "templates",
  "ecommerce_connections",
  "feedback",
  "conversation_analytics",
  "ads",
  "ad_clicks"
];
```

After the array (line 34), add:

```js
// Registry/mapping tables legitimately queried before a tenant context exists.
// ("tenants" is NOT in MULTI_TENANT_TABLES — it is special-cased in applyFilter;
//  "tenant_channels" is in MULTI_TENANT_TABLES but allowlisted here.)
const ALLOWLIST_TABLES = ["tenants", "tenant_channels"];

class TenantContextError extends Error {
  constructor(tableName) {
    super(`Missing tenant context: query on "${tableName}" requires a tenant context`);
    this.name = "TenantContextError";
    this.statusCode = 500;
  }
}

function requireTenantScope(tableName) {
  if (!MULTI_TENANT_TABLES.includes(tableName)) return;
  if (ALLOWLIST_TABLES.includes(tableName)) return;
  const ctx = getTenantContext();
  if (ctx && ctx.tenant_id) return;
  if (ctx && ctx.isSuperAdmin) return;
  if (process.env.NODE_ENV === "production") {
    throw new TenantContextError(tableName);
  }
  console.warn(`[TenantScope] ${tableName} queried without tenant context (dev mode)`);
}
```

- [ ] **Step 4: Export the new symbols**

In the `module.exports` block (line 838), add:

```js
  MULTI_TENANT_TABLES,
  ALLOWLIST_TABLES,
  requireTenantScope,
  TenantContextError,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/enforcement.test.js`
Expected: PASS (7 tests).

- [ ] **Step 6: Run full suite to confirm no regressions**

Run: `node --test "tests/*.test.js"`
Expected: all existing tests pass (44 + 7 new). `requireTenantScope` is not yet wired, so no behavior change.

- [ ] **Step 7: Commit**

```bash
git add src/config/supabaseClient.js tests/enforcement.test.js
git commit -m "feat(tenant): add requireTenantScope guard + expand MULTI_TENANT_TABLES"
```

---

### Task 2: Wire enforcement into `applyFilter` (read + filtered-write paths)

**Files:**
- Modify: `src/config/supabaseClient.js:56-74`
- Test: `tests/enforcement.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/enforcement.test.js`:

```js
const { applyFilter } = require("../src/config/supabaseClient");

test("applyFilter throws in production for tenant table without context", () => {
  withProduction(() => {
    const chain = { eq() { return chain; }, is() { return chain; } };
    assert.throws(() => applyFilter(chain, {}, "products"), /tenant context/i);
  });
});

test("applyFilter applies deleted_at IS NULL on tenant-owned reads without context (dev)", () => {
  const captured = [];
  const chain = {
    select() { return this; },
    eq() { return this; },
    is(col, val) { captured.push({ col, val }); return this; },
    limit() { return this; },
  };
  process.env.NODE_ENV = "development";
  try {
    applyFilter(chain, {}, "products");
  } finally {
    process.env.NODE_ENV = savedEnv;
  }
  const del = captured.find(c => c.col === "deleted_at");
  assert.ok(del, "deleted_at IS NULL filter should be applied");
  assert.strictEqual(del.val, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/enforcement.test.js`
Expected: FAIL — `applyFilter` not exported.

- [ ] **Step 3: Export `applyFilter`**

In `module.exports`, add `applyFilter,`.

- [ ] **Step 4: Wire guard into `applyFilter`**

At the top of `applyFilter` (line 57, first statement), insert:

```js
  requireTenantScope(tableName);
```

The existing `else` branch (no context, not superadmin) already applies `query.is("deleted_at", null)` for `MULTI_TENANT_TABLES` (lines 70-72) — this now covers the 10 new tables automatically. No change needed there.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/enforcement.test.js`
Expected: PASS.

- [ ] **Step 6: Run full suite**

Run: `node --test "tests/*.test.js"`
Expected: PASS. (Existing `tenantIsolation.test.js` runs queries under `runWithTenantContext`, so the guard passes; dev mode is lenient.)

- [ ] **Step 7: Commit**

```bash
git add src/config/supabaseClient.js tests/enforcement.test.js
git commit -m "feat(tenant): enforce tenant scope in applyFilter"
```

---

### Task 3: Wire enforcement into write paths

**Files:**
- Modify: `src/config/supabaseClient.js` — `save` (344), `insertMany` (357), `findByIdAndUpdate` (282), `findByIdAndDelete` (322)
- Test: `tests/enforcement.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/enforcement.test.js`:

```js
const { Product, Order } = require("../src/config/supabaseClient");
const { runWithTenantContext } = require("../utils/tenantContext");

test("save throws in production without tenant context", async () => {
  await withProduction(async () => {
    await assert.rejects(() => Product.save({ name: "x" }), TenantContextError);
  });
});

test("insertMany throws in production without tenant context", async () => {
  await withProduction(async () => {
    await assert.rejects(() => Product.insertMany([{ name: "x" }]), TenantContextError);
  });
});

test("findByIdAndUpdate throws in production without tenant context", async () => {
  await withProduction(async () => {
    await assert.rejects(() => Product.findByIdAndUpdate("id-1", { $set: { price: 5 } }), TenantContextError);
  });
});

test("findByIdAndDelete throws in production without tenant context", async () => {
  await withProduction(async () => {
    await assert.rejects(() => Product.findByIdAndDelete("id-1"), TenantContextError);
  });
});

test("save is allowed under tenant context in production and injects tenant_id", async () => {
  const captured = [];
  const chain = {
    insert(data) { captured.push(data); return this; },
    select() { return this; },
    single() { return Promise.resolve({ data: captured[0], error: null }); },
  };
  const origClient = Order.client;
  Order.client = { from() { return chain; } };
  try {
    await withProduction(async () => {
      await runWithTenantContext({ tenant_id: "tenant-x", role: "admin" }, async () => {
        await Order.save({ orderId: "O1" });
      });
    });
  } finally {
    Order.client = origClient;
  }
  assert.strictEqual(captured[0].tenant_id, "tenant-x");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/enforcement.test.js`
Expected: FAIL — writes proceed without throwing in production (and the `Product.save`/`findByIdAnd*` calls hit the real supabase client; the guard must throw first).

- [ ] **Step 3: Add guard calls**

At the top of each of these methods — `save` (line 344, before `const ctx`), `insertMany` (line 357), `findByIdAndUpdate` (line 282, before `const updateData`), `findByIdAndDelete` (line 322, before `const ctx`) — insert:

```js
    requireTenantScope(this.tableName);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/enforcement.test.js`
Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `node --test "tests/*.test.js"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config/supabaseClient.js tests/enforcement.test.js
git commit -m "feat(tenant): enforce tenant scope on write paths"
```

---

### Task 4: Superadmin context wraps for admin auth + bootstrap (index.js)

**Files:**
- Modify: `index.js` — login (239, 243), refresh (273), bootstrap start sequence (1718-1721)
- Test: `tests/enforcement.test.js`

Context note (verified): `authenticateAdmin === authenticateTenant` (index.js:183), which wraps the request chain in `runWithTenantContext` (auth.js:72). So every `/api/admin/*` handler — including `/api/auth/signup` — already runs inside a tenant context and needs no wrap. Only **login**, **refresh** (public routes behind `authLimiter` only) and the **startup bootstrap** run context-free.

- [ ] **Step 1: Write the failing test**

Append to `tests/enforcement.test.js`:

```js
test("index.js defines withSuperadmin and wraps login/refresh/bootstrap in it", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "index.js"), "utf8");
  assert.match(src, /const withSuperadmin = .*runWithTenantContext/);
  const login = src.slice(src.indexOf('app.post("/api/auth/login"'), src.indexOf('app.post("/api/auth/refresh"'));
  const refresh = src.slice(src.indexOf('app.post("/api/auth/refresh"'), src.indexOf('app.post("/api/auth/logout"'));
  const bootstrap = src.slice(src.indexOf("await withSuperadmin("), src.indexOf("startAutoPurgeCron"));
  assert.match(login, /withSuperadmin\(/);
  assert.match(refresh, /withSuperadmin\(/);
  assert.match(bootstrap, /withSuperadmin\(/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/enforcement.test.js`
Expected: FAIL — no `withSuperadmin` in index.js.

- [ ] **Step 3: Add the `withSuperadmin` helper**

After the import at line 16 (`const { runWithTenantContext } = require("./utils/tenantContext");`), add:

```js
const SUPERADMIN_CONTEXT = { role: "superadmin", isSuperAdmin: true, tenant_id: null };
const withSuperadmin = (fn) => runWithTenantContext(SUPERADMIN_CONTEXT, fn);
```

- [ ] **Step 4: Wrap login DB operations**

In the login handler (236-264), replace lines 239 and 243:

```js
    const admin = await withSuperadmin(() => Admin.findOne({ username }));
```
```js
    await withSuperadmin(() => Admin.findByIdAndUpdate(admin.id, { lastLoginAt: new Date() }));
```

- [ ] **Step 5: Wrap refresh DB operation**

In the refresh handler (266-287), replace line 273:

```js
    const admin = await withSuperadmin(() => Admin.findOne({ id: decoded.id }));
```

- [ ] **Step 6: Wrap bootstrap init sequence**

In `startServer` (1714-1733), replace lines 1718-1721:

```js
  await withSuperadmin(async () => {
    await initAdmin();
    await initSettings();
    await seedProducts();
    await initTemplates();
  });
```

(`initRAG` stays outside — it performs no Model operations.)

- [ ] **Step 7: Run test to verify it passes**

Run: `node --test tests/enforcement.test.js`
Expected: PASS.

- [ ] **Step 8: Syntax check + full suite**

Run: `node --check index.js` then `node --test "tests/*.test.js"`
Expected: `node --check` clean; tests PASS.

- [ ] **Step 9: Commit**

```bash
git add index.js tests/enforcement.test.js
git commit -m "feat(tenant): superadmin context for login/refresh + bootstrap lookups"
```

---

### Task 5: Migration DDL + settings backfill script

**Files:**
- Create: `migration-phase1-tenant-columns.sql`
- Create: `scripts/backfill-tenant-settings.js`
- Test: none (SQL + one-off script)

- [ ] **Step 1: Write the migration file**

Create `migration-phase1-tenant-columns.sql`:

```sql
-- ─────────────────────────────────────────────────────────────
-- Phase 1: tenant_id columns for remaining tenant-owned tables
-- Run AFTER migration.sql. See README "Migrations" section.
-- Idempotent: safe to run multiple times. ALTER/INDEX only —
-- these tables exist in the live DB but have no CREATE in the repo.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE settings ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_settings_tenant_id ON settings(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_tenant_config ON settings(tenant_id, configId);

ALTER TABLE order_sessions ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE order_sessions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_order_sessions_tenant_id ON order_sessions(tenant_id);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_payments_tenant_id ON payments(tenant_id);

ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_broadcasts_tenant_id ON broadcasts(tenant_id);

ALTER TABLE templates ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_templates_tenant_id ON templates(tenant_id);

ALTER TABLE ecommerce_connections ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE ecommerce_connections ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_ecommerce_connections_tenant_id ON ecommerce_connections(tenant_id);

ALTER TABLE feedback ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_feedback_tenant_id ON feedback(tenant_id);

ALTER TABLE conversation_analytics ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE conversation_analytics ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_conversation_analytics_tenant_id ON conversation_analytics(tenant_id);

ALTER TABLE ads ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE ads ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_ads_tenant_id ON ads(tenant_id);

ALTER TABLE ad_clicks ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE ad_clicks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_ad_clicks_tenant_id ON ad_clicks(tenant_id);
```

- [ ] **Step 2: Write the settings backfill script**

Create `scripts/backfill-tenant-settings.js`:

```js
/**
 * scripts/backfill-tenant-settings.js
 * One-time backfill: copy the global settings row into a per-tenant row
 * for every existing tenant. Idempotent (upsert keyed on tenant_id + configId).
 *
 * Run: node scripts/backfill-tenant-settings.js
 * Requires: working SUPABASE_URL / SUPABASE_ANON_KEY in .env
 */
const { Tenant, Settings } = require("../src/config/db");
const { runWithTenantContext } = require("../utils/tenantContext");

const COPY_KEYS = (row) => Object.fromEntries(
  Object.entries(row).filter(([k]) => !["id", "tenant_id", "deleted_at", "_doc"].includes(k))
);

async function backfill() {
  const globalRow = await Settings.findOne({ configId: "global" });
  const tenants = await Tenant.find({ deleted_at: null });
  console.log(`[Backfill] ${tenants.length} tenants, global settings ${globalRow ? "present" : "missing"}`);

  let updated = 0;
  for (const tenant of tenants) {
    const existing = await runWithTenantContext({ tenant_id: String(tenant.id), role: "admin" }, () =>
      Settings.findOne({ configId: "global" })
    );
    if (existing) continue;
    await runWithTenantContext({ tenant_id: String(tenant.id), role: "admin" }, async () => {
      await Settings.findOneAndUpdate(
        { configId: "global" },
        { $set: globalRow ? COPY_KEYS(globalRow) : { autoReply: true } },
        { new: true, upsert: true }
      );
    });
    updated++;
  }
  console.log(`[Backfill] Done. Created settings rows for ${updated} tenants.`);
  process.exit(0);
}

backfill().catch((err) => {
  console.error("[Backfill] Failed:", err.message);
  process.exit(1);
});
```

- [ ] **Step 3: Syntax check**

Run: `node --check scripts/backfill-tenant-settings.js`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add migration-phase1-tenant-columns.sql scripts/backfill-tenant-settings.js
git commit -m "feat(tenant): phase1 tenant-column migration + settings backfill script"
```

---

### Task 6: Scope RAG fallback + Pinecone vectors by tenant

**Files:**
- Modify: `utils/rag.js` (fallback at line 41; `indexKnowledgeEntry` metadata at 73-84; `retrieveContext` vector call at 27)
- Modify: `utils/vectorDB.js` (`queryVectors` at 70)
- Test: `tests/enforcement.test.js`

Test seam (verified): `generateEmbedding` returns `null` when `GOOGLE_AI_API_KEY` is unset (embeddings.js:21-25), so in the test env the vector path is skipped naturally and the fallback runs. No module stubbing is possible (rag.js destructures at require-time) and none is needed.

- [ ] **Step 1: Write the failing test**

Append to `tests/enforcement.test.js`:

```js
const { retrieveContext } = require("../utils/rag");
const { queryVectors } = require("../utils/vectorDB");

test("retrieveContext fallback filters knowledge_base by tenant_id from context", async () => {
  const captured = [];
  const chain = {
    select() { return this; },
    eq(col, val) { captured.push({ col, val }); return this; },
    is() { return this; },
    then(resolve) { resolve([]); },
  };
  const mockClient = { from(table) { captured.push({ table }); return chain; } };

  const { KnowledgeBase } = require("../src/config/supabaseClient");
  const origClient = KnowledgeBase.client;
  KnowledgeBase.client = mockClient;
  try {
    await runWithTenantContext({ tenant_id: "tenant-r", role: "admin" }, async () => {
      await retrieveContext("pricing question here");
    });
  } finally {
    KnowledgeBase.client = origClient;
  }

  assert.ok(captured.some(c => c.table === "knowledge_base"), "should query knowledge_base");
  const tenantEq = captured.find(c => c.col === "tenant_id");
  assert.ok(tenantEq, "tenant_id filter should be present");
  assert.strictEqual(tenantEq.val, "tenant-r");
});

test("retrieveContext returns '' without context in production (no DB query)", async () => {
  const { KnowledgeBase } = require("../src/config/supabaseClient");
  const origClient = KnowledgeBase.client;
  KnowledgeBase.client = { from() { throw new Error("should not query"); } };
  try {
    await withProduction(async () => {
      const res = await retrieveContext("pricing question here");
      assert.strictEqual(res, "");
    });
  } finally {
    KnowledgeBase.client = origClient;
  }
});

test("queryVectors accepts a tenantId and returns an array", async () => {
  const result = await queryVectors([0.1, 0.2], {}, "tenant-v");
  assert.ok(Array.isArray(result));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/enforcement.test.js`
Expected: FAIL — the fallback query has no `.eq("tenant_id", ...)` (captured has no tenant_id entry).

- [ ] **Step 3: Scope the fallback in `utils/rag.js`**

Import the context helper at top (after line 10):

```js
const { getTenantContext } = require("./tenantContext");
```

At the top of `retrieveContext` (line 22), read the context once:

```js
  const ctx = getTenantContext();
```

Replace the fallback query block (lines 41-44):

```js
    if (!ctx || !ctx.tenant_id) return "";

    const { data: entries, error } = await KnowledgeBase.client
      .from("knowledge_base")
      .select("title, content, category")
      .eq("isActive", true)
      .eq("tenant_id", ctx.tenant_id);
```

- [ ] **Step 4: Pass tenant_id to `queryVectors`**

In `retrieveContext`, line 27, pass the context tenant:

```js
      const matches = await queryVectors(queryEmbedding, filter, ctx ? ctx.tenant_id : null);
```

- [ ] **Step 5: Add tenant filter support in `utils/vectorDB.js`**

Modify `queryVectors` (line 70) to accept and merge a `tenantId`:

```js
async function queryVectors(queryVector, filter = {}, tenantId = null) {
  const idx = await initPinecone();
  if (!idx) return [];

  const finalFilter = { ...filter };
  if (tenantId) finalFilter.tenant_id = tenantId;

  try {
    const response = await idx.namespace(NAMESPACE).query({
      vector: queryVector,
      topK: TOP_K,
      includeMetadata: true,
      filter: Object.keys(finalFilter).length > 0 ? finalFilter : undefined
    });

    return response.matches || [];
  } catch (err) {
    console.error(" [VectorDB] Query error:", err.message);
    return [];
  }
}
```

(Production refusal for unscoped vector search is enforced in `retrieveContext` — it returns `""` before reaching the vector path when no tenant context exists. `queryVectors` has no other callers, verified.)

- [ ] **Step 6: Add tenant_id to vector metadata**

In `indexKnowledgeEntry` (rag.js ~73-84), add to the metadata object:

```js
        tenant_id: entry.tenant_id || null,
```

Verification note: this line is not covered by an automated test — the vector path needs an embedding (no key in test env), so it is verified by code review + `node --check`. Recorded decision.

- [ ] **Step 7: Run test to verify it passes**

Run: `node --test tests/enforcement.test.js`
Expected: PASS.

- [ ] **Step 8: Full suite**

Run: `node --test "tests/*.test.js"`
Expected: PASS. (`retrieveContext` is invoked only under tenant context at runtime — inside `generateReply`.)

- [ ] **Step 9: Commit**

```bash
git add utils/rag.js utils/vectorDB.js tests/enforcement.test.js
git commit -m "feat(tenant): scope RAG fallback + Pinecone vectors by tenant_id"
```

---

### Task 7: Shared tenant resolver + public product routes

**Files:**
- Modify: `src/routes/chat.js` — extract `resolveTenantFromRequest`
- Modify: `index.js` — public product routes (1317, 1324)
- Test: `tests/enforcement.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/enforcement.test.js`:

```js
const { resolveTenantFromRequest } = require("../src/routes/chat");

test("resolveTenantFromRequest resolves tenant from query tenant slug", async () => {
  const { Tenant } = require("../src/config/supabaseClient");
  const captured = [];
  const chain = {
    select() { return this; },
    eq(col, val) { captured.push({ col, val }); return this; },
    is() { return this; },
    limit() { return this; },
    maybeSingle() { return Promise.resolve({ data: { id: "t-1", slug: "acme" }, error: null }); },
  };
  const origClient = Tenant.client;
  Tenant.client = { from() { return chain; } };
  try {
    const result = await resolveTenantFromRequest({ body: {}, headers: {}, query: { tenant: "acme" } });
    assert.strictEqual(result.tenant_id, "t-1");
  } finally {
    Tenant.client = origClient;
  }
});

test("resolveTenantFromRequest resolves tenant from X-Tenant-ID header", async () => {
  const result = await resolveTenantFromRequest({ body: {}, headers: { "x-tenant-id": "tenant-xyz" }, query: {} });
  assert.strictEqual(result.tenant_id, "tenant-xyz");
});

test("resolveTenantFromRequest returns null for unresolved tenant in production", async () => {
  const { Tenant } = require("../src/config/supabaseClient");
  const chain = {
    select() { return this; },
    eq() { return this; },
    is() { return this; },
    limit() { return this; },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
  };
  const origClient = Tenant.client;
  Tenant.client = { from() { return chain; } };
  try {
    await withProduction(async () => {
      const result = await resolveTenantFromRequest({ body: {}, headers: {}, query: {} });
      assert.strictEqual(result, null);
    });
  } finally {
    Tenant.client = origClient;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/enforcement.test.js`
Expected: FAIL — `resolveTenantFromRequest` not exported.

- [ ] **Step 3: Extract the shared resolver in `src/routes/chat.js`**

Rename `resolveWebChatTenant` (line 14) to `resolveTenantFromRequest`, then add an alias right after it (before `registerChatRoutes`):

```js
const resolveWebChatTenant = resolveTenantFromRequest;
```

Update the `module.exports` block to include `resolveTenantFromRequest`.

- [ ] **Step 4: Wire public product routes in `index.js`**

At the top of index.js, update the chat import (line 84):

```js
const { registerChatRoutes, resolveTenantFromRequest } = require("./src/routes/chat");
```

Add a tenant-resolution middleware near the product routes, and update the two public GET handlers (lines 1317-1329):

```js
async function withPublicTenant(req, res, next) {
  const tenantInfo = await resolveTenantFromRequest(req);
  if (!tenantInfo || !tenantInfo.tenant_id) {
    return res.status(400).json({ error: "tenant required: pass ?tenant= or X-Tenant-ID header" });
  }
  return runWithTenantContext({ tenant_id: tenantInfo.tenant_id, role: "admin" }, next);
}

app.get("/api/products", withPublicTenant, async (req, res) => {
  try {
    const products = await Product.find({ isActive: true }).sort({ category: 1, createdAt: -1 });
    res.json(products);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/products/category/:category", withPublicTenant, async (req, res) => {
  try {
    const products = await Product.find({ category: req.params.category, isActive: true });
    res.json(products);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
```

Note: the existing handlers' exact current body must be preserved (only add the `withPublicTenant` middleware argument). Verify against the file at implementation time.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/enforcement.test.js`
Expected: PASS.

- [ ] **Step 6: Syntax check + full suite**

Run: `node --check index.js` then `node --test "tests/*.test.js"`
Expected: clean; PASS.

- [ ] **Step 7: Commit**

```bash
git add src/routes/chat.js index.js tests/enforcement.test.js
git commit -m "feat(tenant): public product routes resolve tenant like web chat"
```

---

### Task 8: README migration note + full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add migration ordering note to README**

Add a "Migrations" note near the existing status/setup text:

```md
### Migrations
Apply in order:
1. `migration.sql` — core schema + initial tenant columns
2. `migration-phase1-tenant-columns.sql` — tenant_id columns for the remaining tenant-owned tables
3. `node scripts/backfill-tenant-settings.js` — copy global settings into per-tenant rows (idempotent)
```

- [ ] **Step 2: Run the full backend suite**

Run: `node --test "tests/*.test.js"`
Expected: PASS (all tests, including 44 baseline + new enforcement cases).

- [ ] **Step 3: Smoke-boot the server (production mode)**

If a valid `.env` with `SUPABASE_URL`/`SUPABASE_ANON_KEY` is available:
- Run `NODE_ENV=production node index.js`.
- Verify `POST /api/auth/login` with a seeded admin returns 200 (proves the login wrap works under hard-fail).
- Verify `GET /api/products?tenant=acme` returns 200 and `GET /api/products` (no tenant) returns 400.

If no valid `.env` is present, record this as a known verification gap (env limitation) and rely on `node --check` + the automated suite.

- [ ] **Step 4: Self-review against spec**

Walk `docs/superpowers/specs/2026-08-11-tenant-enforcement-design.md` sections 1-3 and confirm each maps to a task:
- Enforcement helper + allowlist → Tasks 1-3
- Superadmin wraps (login/refresh, bootstrap) → Task 4 (signup excluded — context inherited, see Task 4 note)
- Migration + settings backfill + unique index → Task 5
- RAG fallback + vector partition → Task 6
- Public product routes + shared resolver → Task 7
- README ordering → Task 8

Also confirm the live-DB schema verification item from the spec (columns/types for `settings` etc.) is scheduled: obtain a working DB connection before running the migration in production.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(tenant): migration ordering for phase1 tenant columns"
```

---

## Known limitations (recorded, not blockers)

- Live DB schema for `settings`/`payments`/etc. is unverifiable from this environment (Supabase MCP auth fails on both DB roles; project `nvsvhvwrmlnvesqwlkqz`). Task 5 assumes `settings.configId` exists (used by all call sites) and `tenants.id` exists (used everywhere). Confirm column types via a working DB connection before applying the migration to production.
- `utils/dataRetention.js` cron (`purgeExpiredMessages`) calls `Message.deleteMany` context-free. It will throw under production hard-fail. This is intentional fail-closed behavior: the cron must be given a tenant context or superadmin wrap in a follow-up (out of scope for this plan; noted in the spec's background-work concern).
- The BullMQ workers (`utils/worker.js`) call `generateReply`/`saveMessage` context-free, but `enqueueMessage` is never invoked anywhere in the app, so workers are dormant. No change needed now; noted for future work.
- Conversation analyzer (`utils/conversationAnalyzer.js`) runs aggregations — invoked from admin routes under `authenticateAdmin`, so it inherits tenant context. Verified, no change needed.
- The `indexKnowledgeEntry` vector-metadata change (Task 6 Step 6) has no automated test (vector path requires an embedding, unavailable in tests). Verified by code review + `node --check`.
- Bootstrap admin is created with role `"admin"` and `tenant_id: null` (pre-existing); a tenant-less non-superadmin cannot authenticate past `authenticateTenant` (401 "tenant context missing"). This is pre-existing behavior, unchanged by this plan, and out of scope.
