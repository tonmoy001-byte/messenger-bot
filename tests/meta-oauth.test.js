const { test } = require("node:test");
const assert = require("node:assert");
const { getTenantContext } = require("../utils/tenantContext");
const { upsertMetaIntegrations } = require("../src/routes/auth");

test("upsertMetaIntegrations runs Integration writes inside a superadmin tenant context", async () => {
  const { Integration } = require("../src/config/supabaseClient");
  let ctxAtCall = null;
  const calls = [];
  const orig = Integration.findOneAndUpdate;
  Integration.findOneAndUpdate = (filter, update, options) => {
    ctxAtCall = getTenantContext();
    calls.push({ filter, update, options });
    return Promise.resolve({});
  };
  try {
    await upsertMetaIntegrations(
      [{ id: "page-1", name: "Shop Page" }],
      "long-token-value"
    );
  } finally {
    Integration.findOneAndUpdate = orig;
  }
  assert.ok(ctxAtCall, "expected a tenant context during the write");
  assert.strictEqual(ctxAtCall.isSuperAdmin, true, "superadmin bypasses tenant-scope enforcement");
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].filter.type, "facebook");
  assert.strictEqual(calls[0].filter.externalId, "page-1");
  assert.strictEqual(calls[0].update.$set.name, "Shop Page");
  assert.ok(calls[0].update.$set.accessToken, "token is encrypted before storage");
});

test("upsertMetaIntegrations handles empty page list without error", async () => {
  const { Integration } = require("../src/config/supabaseClient");
  const orig = Integration.findOneAndUpdate;
  Integration.findOneAndUpdate = () => Promise.resolve({});
  try {
    await assert.doesNotReject(upsertMetaIntegrations([], "long-token-value"));
  } finally {
    Integration.findOneAndUpdate = orig;
  }
});