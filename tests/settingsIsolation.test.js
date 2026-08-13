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
