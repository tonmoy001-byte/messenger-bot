/**
 * tests/webhookRouting.test.js
 * ─────────────────────────────────────────────────────────────
 * Section 2: Channel Tenancy, Webhook Routing, & Cache Test Suite.
 * Verified with node:test.
 * ─────────────────────────────────────────────────────────────
 */

const { test } = require("node:test");
const assert = require("node:assert");
const channelCache = require("../utils/channelCache");
const tokenManager = require("../utils/tokenManager");
const { encrypt } = require("../src/utils/security");
const supabaseModels = require("../src/config/supabaseClient");

// Capture object for Supabase queries
let lastQuery = null;

// Mock chain to capture Supabase queries without a live DB
const mockChain = {
  select(fields = "*") {
    lastQuery.select = fields;
    return this;
  },
  eq(col, val) {
    lastQuery.eq = lastQuery.eq || [];
    lastQuery.eq.push({ col, val });
    return this;
  },
  is(col, val) {
    lastQuery.is = lastQuery.is || [];
    lastQuery.is.push({ col, val });
    return this;
  },
  limit(n) {
    lastQuery.limit = n;
    return this;
  },
  maybeSingle() {
    return Promise.resolve({ data: lastQuery.mockData || null, error: null });
  },
  single() {
    return Promise.resolve({ data: lastQuery.mockData || null, error: null });
  },
  then(resolve) {
    resolve(lastQuery.mockData ? [lastQuery.mockData] : []);
  }
};

const myMockClient = {
  mockData: null,
  from(tableName) {
    lastQuery = { tableName, eq: [], is: [], select: "*", mockData: this.mockData };
    return mockChain;
  }
};

// Directly reassign the `.client` instance property on all exported models to avoid prototype shadowing
for (const key of Object.keys(supabaseModels)) {
  if (supabaseModels[key] && typeof supabaseModels[key] === "object" && supabaseModels[key].client) {
    supabaseModels[key].client = myMockClient;
  }
}

test("Channel Cache get/set/invalidate with TTL", async () => {
  // Test Set & Get
  const data = { tenant_id: "tenant-1", verifyToken: "token123", accessToken: "secret" };
  channelCache.set("messenger", "page-123", data);

  const cached = channelCache.get("messenger", "page-123");
  assert.deepStrictEqual(cached, data);

  // Test Invalidate
  channelCache.invalidate("messenger", "page-123");
  const cleared = channelCache.get("messenger", "page-123");
  assert.strictEqual(cleared, null);
});

test("Multi-Tier Token Lookup Order", async () => {
  // Clean cache first
  channelCache.invalidate("messenger", "page-abc");

  const secretToken = "decrypted-secret-token";
  const encryptedToken = encrypt(secretToken);

  // Mock TenantChannel DB record via global mockData property
  myMockClient.mockData = { tenant_id: "tenant-abc", verifyToken: "vt", accessToken: encryptedToken };

  const token = await tokenManager.getAccessToken("messenger", "page-abc");
  assert.strictEqual(token, secretToken);
});

test("Cache bypasses database queries on subsequent token requests", async () => {
  const secretToken = "acc-abc";
  const encryptedToken = encrypt(secretToken);

  const cachedPayload = { tenant_id: "t-abc", verifyToken: "vt-abc", accessToken: encryptedToken };
  channelCache.set("whatsapp", "phone-abc", cachedPayload);

  // Set mockData to null to verify it is NOT queried from DB
  myMockClient.mockData = null;

  const token = await tokenManager.getAccessToken("whatsapp", "phone-abc");
  assert.strictEqual(token, secretToken);

  channelCache.invalidate("whatsapp", "phone-abc");
});
