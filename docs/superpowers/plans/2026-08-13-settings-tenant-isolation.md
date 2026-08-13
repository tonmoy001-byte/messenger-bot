# Per-Tenant Settings Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove and document that `settings` is isolated per-tenant (reads scoped, writes injected with `tenant_id`, all call sites running under tenant context), and make the DB migration executable when credentials are available.

**Architecture:** No behavior change needed — the data layer already enforces isolation. `settings` is in `MULTI_TENANT_TABLES` (`src/config/supabaseClient.js:36`), so the Model adapter's `applyFilter` auto-injects `tenant_id` on reads (line 100-101), and `save()`/upsert auto-inject it on writes (lines 303-307, 387-388). All call sites already run under tenant context: admin routes via `authenticateTenant` middleware, chat via `runWithTenantContext` (`src/routes/chat.js:55`), tokenManager/whatsappTemplates via `runWithTenantContext` in `src/routes/webhooks.js` (lines 78, 142, 214). The work is: **characterization tests** that lock in this behavior (red-green does not apply — the adapter already passes; the tests document the contract), a source-level call-site audit test, and migration documentation (the live-DB migration is blocked on credentials).

**Tech Stack:** Node.js/Express, CommonJS, `node:test`, Supabase Model adapter (ALS tenant context in `utils/tenantContext.js`).

---

## Task 1: Characterization test — settings reads are tenant-scoped

These tests document existing behavior. They are expected to pass immediately against the current adapter; if any fails, the adapter is broken and must be fixed.

**Files:**
- Create: `tests/settingsIsolation.test.js`

- [ ] **Step 1: Write the test file**

Create `tests/settingsIsolation.test.js`:

```js
/**
 * tests/settingsIsolation.test.js
 * Characterization tests: settings reads/writes are tenant-scoped via the
 * Model adapter (settings is in MULTI_TENANT_TABLES).
 */

const { test } = require("node:test");
const assert = require("node:assert");
const { Settings } = require("../src/config/supabaseClient");
const { runWithTenantContext } = require("../utils/tenantContext");

let lastQuery = null;
const mockChain = {
  select() { return this; },
  eq(col, val) { lastQuery.eq = lastQuery.eq || []; lastQuery.eq.push({ col, val }); return this; },
  is() { return this; },
  limit() { return this; },
  maybeSingle() { return Promise.resolve({ data: null, error: null }); },
  single() { return Promise.resolve({ data: null, error: null }); },
  insert(data) { lastQuery.insert = data; return this; },
  then(resolve) { resolve([]); },
};
const mockClient = {
  from(tableName) { lastQuery = { tableName, eq: [] }; return mockChain; }
};
const origClient = Settings.client;

function withMockedSettings(callback) {
  Settings.client = mockClient;
  try { return callback(); } finally { Settings.client = origClient; }
}

test("Settings.findOne injects tenant_id filter under tenant context", async () => {
  await withMockedSettings(async () => {
    await runWithTenantContext({ tenant_id: "tenant-a", role: "admin" }, async () => {
      await Settings.findOne({ configId: "global" });
    });
  });
  const tenantEq = lastQuery.eq.find(e => e.col === "tenant_id");
  assert.ok(tenantEq, "tenant_id filter must be present");
  assert.strictEqual(tenantEq.val, "tenant-a");
});

test("Settings.findOne does NOT inject tenant_id without context", async () => {
  await withMockedSettings(async () => {
    await Settings.findOne({ configId: "global" });
  });
  const tenantEq = lastQuery.eq.find(e => e.col === "tenant_id");
  assert.strictEqual(tenantEq, undefined, "no tenant_id filter without context");
});

test("Settings.save injects tenant_id under tenant context", async () => {
  await withMockedSettings(async () => {
    await runWithTenantContext({ tenant_id: "tenant-s", role: "admin" }, async () => {
      await Settings.save({ configId: "global", autoReply: true });
    });
  });
  assert.strictEqual(lastQuery.insert.tenant_id, "tenant-s");
});
```

- [ ] **Step 2: Run to confirm the contract holds**

Run: `node --test tests/settingsIsolation.test.js`
Expected: PASS (3/3). This documents the contract — tenant-scoped reads AND writes. If any test fails, the adapter isolation is broken and that failure must be fixed before proceeding.

- [ ] **Step 3: Commit**

```bash
git add tests/settingsIsolation.test.js
git commit -m "test: characterize per-tenant settings read/write scoping"
```

---

## Task 2: Source-level call-site audit for settings access

A structural test asserting that every module that touches `Settings` either sets tenant context itself (routes) or is only reachable through a tenant-context wrapper (webhook/channel path).

**Files:**
- Modify: `tests/settingsIsolation.test.js`

- [ ] **Step 1: Write the audit test**

Append to `tests/settingsIsolation.test.js`:

```js
test("all Settings call sites run under tenant context", () => {
  const fs = require("fs");
  const path = require("path");
  const root = path.join(__dirname, "..");

  // Files that touch Settings. Routes must self-scope via authenticateAdmin
  // middleware; utils are only reachable from tenant-scoped webhook handlers.
  const routeFiles = [
    "src/routes/admin.js",
    "src/routes/chat.js",
  ];
  const utilsFiles = [
    "utils/tokenManager.js",
    "utils/whatsappTemplates.js",
  ];

  const problems = [];

  for (const rel of routeFiles) {
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    if (!/authenticateAdmin|authenticateTenant/.test(src)) {
      problems.push(`${rel}: Settings accessed but no auth middleware in file`);
    }
  }

  for (const rel of utilsFiles) {
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    if (/(Settings\.)/.test(src) && !/runWithTenantContext|withSuperadmin/.test(src)) {
      problems.push(`${rel}: Settings used without tenant-context wrapper in file`);
    }
  }

  // The webhook entry points must wrap channel handling in tenant context.
  const webhooks = fs.readFileSync(path.join(root, "src/routes/webhooks.js"), "utf8");
  const handlers = fs.readFileSync(path.join(root, "src/services/channels/messageHandlers.js"), "utf8");
  if (!/runWithTenantContext/.test(webhooks)) {
    problems.push("src/routes/webhooks.js: no runWithTenantContext");
  }
  if (!/runWithTenantContext|withSuperadmin/.test(handlers)) {
    problems.push("src/services/channels/messageHandlers.js: no tenant-context wrapper");
  }

  assert.deepStrictEqual(problems, []);
});
```

- [ ] **Step 2: Run to confirm the audit passes**

Run: `node --test tests/settingsIsolation.test.js`
Expected: PASS. If it fails, each reported path is a real isolation gap — fix the file (wrap in `runWithTenantContext`/`withSuperadmin`, or ensure the route uses auth middleware) before proceeding.

- [ ] **Step 3: Commit**

```bash
git add tests/settingsIsolation.test.js
git commit -m "test: audit settings call sites for tenant context"
```

---

## Task 3: Document isolation invariant + migration execution

**Files:**
- Modify: `docs/TENANCY.md` (create if absent)

- [ ] **Step 1: Confirm the migration file already covers settings**

Run: `Select-String -Path migration-phase1-tenant-columns.sql -Pattern "ALTER TABLE settings"`

Expected: lines `8`, `9`, `10`, `11` — `ADD COLUMN tenant_id`, `ADD COLUMN deleted_at`, `CREATE INDEX idx_settings_tenant_id`, `CREATE UNIQUE INDEX idx_settings_tenant_config`. The unique index on `(tenant_id, configId)` is the invariant that makes the `configId: "global"` singleton per-tenant safe.

- [ ] **Step 2: Write the execution + verification section in `docs/TENANCY.md`**

If `docs/TENANCY.md` does not exist, create it with a title. Append:

```markdown
## Per-Tenant Settings

Settings rows are tenant-owned. `settings` is in `MULTI_TENANT_TABLES`
(`src/config/supabaseClient.js`), so the Model adapter injects `tenant_id`
on every read filter and write payload when tenant context is active.

### Invariant

`configId` is a *per-tenant* singleton key (default `"global"`). The unique
index `(tenant_id, configId)` enforces one settings row per tenant. Never
query settings without a tenant context in production — `requireTenantScope`
rejects it.

### Migration (not yet applied — requires DB credentials)

Run against the live database:

```sql
-- from migration-phase1-tenant-columns.sql
ALTER TABLE settings ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_settings_tenant_id ON settings(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_tenant_config ON settings(tenant_id, configId);
```

Verify:

```sql
SELECT column_name FROM information_schema.columns WHERE table_name = 'settings' AND column_name IN ('tenant_id','deleted_at');
-- expect 2 rows
SELECT indexname FROM pg_indexes WHERE tablename = 'settings' AND indexname IN ('idx_settings_tenant_id','idx_settings_tenant_config');
-- expect 2 rows
```
```

- [ ] **Step 3: Verify the diff is docs-only for this task**

Run: `git diff --stat`
Expected: only `docs/TENANCY.md` modified on top of the two prior test commits.

- [ ] **Step 4: Commit**

```bash
git add docs/TENANCY.md
git commit -m "docs: document per-tenant settings isolation and migration steps"
```

---

## Final Verification

- [ ] Run: `npm test`
  Expected: all suites pass (74 existing + new settingsIsolation tests).
- [ ] Run: `node scripts/route-audit.js diff`
  Expected: `Route audit OK: 72 routes match snapshot.`
- [ ] Run: `node --check tests/settingsIsolation.test.js`
  Expected: no syntax errors.
- [ ] Confirm working tree clean: `git status --short`
- [ ] State explicitly that the live-DB migration is **blocked on credentials** and reference the exact command in `docs/TENANCY.md` (Task 3 Step 2) for the operator.
