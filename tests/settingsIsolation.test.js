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

test("declared tenant-scoped Settings surface carries tenant context", () => {
  const fs = require("fs");
  const path = require("path");
  const root = path.join(__dirname, "..");

  // Tenant-scoping contract for every module that touches Settings:
  //  1. Route files that read/write Settings must establish tenant context
  //     themselves — either via the authenticateAdmin/authenticateTenant middleware
  //     (admin APIs; the middleware wraps the handler in runWithTenantContext) or by
  //     wrapping the handler in runWithTenantContext (public web-chat API).
  //  2. The webhook entry point must wrap every channel-handler invocation in
  //     runWithTenantContext. That wrapper is what scopes the whole channel path
  //     (messageHandlers.js, channel adapters, and the helper modules below), so
  //     those files are not required to establish context themselves.
  //  3. Helper modules that touch Settings may only be imported from that
  //     tenant-scoped channel path, the webhook entry, or the superadmin-scoped
  //     server init — never from unscoped route code.
  //  NOTE: this audit covers the declared route/webhook/helper surface above. It
  //  is NOT proof that every Settings read in the repo is tenant-scoped: BullMQ
  //  workers (utils/worker.js → utils/messagingWindow.js → tokenManager →
  //  Settings.findOne, and generateReply at src/services/ai/gemini.js:337) run
  //  without tenant context — a tracked follow-up, out of scope here.
  const routeFiles = [
    "src/routes/admin.js",
    "src/routes/chat.js",
  ];
  const helperFiles = [
    "utils/tokenManager.js",
    "utils/whatsappTemplates.js",
  ];

  const problems = [];

  for (const rel of routeFiles) {
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    if (!/(authenticateAdmin|authenticateTenant|runWithTenantContext)/.test(src)) {
      problems.push(`${rel}: Settings accessed but no tenant-context mechanism in file`);
    }
  }

  // Webhook entry points must wrap channel handling in tenant context.
  const webhooks = fs.readFileSync(path.join(root, "src/routes/webhooks.js"), "utf8");
  if (!/runWithTenantContext/.test(webhooks)) {
    problems.push("src/routes/webhooks.js: no runWithTenantContext");
  }

  // Helpers that touch Settings are only safe if every importer lives on the
  // tenant-scoped channel path or the superadmin-scoped init path.
  const allowedImporters = [
    /^src\/services\/channels\//,
    /^src\/routes\/webhooks\.js$/,
    /^src\/server\.js$/,
    /^utils\//,
    /^tests\//,
  ];
  for (const rel of helperFiles) {
    const moduleName = rel.split(/[\\/]/).pop().replace(/\.js$/, "");
    for (const importer of findHelperImporters(root, moduleName)) {
      if (!allowedImporters.some((re) => re.test(importer))) {
        problems.push(`${importer}: imports ${rel} outside the tenant-scoped surface`);
      }
    }
  }

  assert.deepStrictEqual(problems, []);

  function findHelperImporters(root, moduleName) {
    const importers = [];
    const requireRe = new RegExp(`require\\(["'][^"']*\\/?${moduleName}(?:\\.js)?["']\\)`);
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".js") && requireRe.test(fs.readFileSync(full, "utf8"))) {
          importers.push(path.relative(root, full).split(path.sep).join("/"));
        }
      }
    }
    for (const dir of ["src", "utils", "tests"]) walk(path.join(root, dir));
    return importers;
  }
});
