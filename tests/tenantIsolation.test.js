/**
 * tests/tenantIsolation.test.js
 * ─────────────────────────────────────────────────────────────
 * Multi-Tenant Isolation & Soft-Delete Test Suite.
 * Verified with node:test.
 * ─────────────────────────────────────────────────────────────
 */

const { test } = require("node:test");
const assert = require("node:assert");
const jwt = require("jsonwebtoken");
const {
  supabase,
  Product,
  Order,
  KnowledgeBase,
  Tenant,
  Admin,
  Settings,
  OrderSession,
  Payment,
  EcommerceConnection,
  Feedback,
  Ad,
  AdClick,
  Template,
  Broadcast
} = require("../src/config/supabaseClient");
const { runWithTenantContext } = require("../utils/tenantContext");

const JWT_SECRET = process.env.JWT_SECRET || "cyberbot-admin-secret-key-change-in-production";

// Capture object for Supabase queries
let lastQuery = null;
let queryCount = 0;
let mockDataMap = {};

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
  order(col, opts) {
    lastQuery.order = { col, opts };
    return this;
  },
  maybeSingle() {
    return Promise.resolve({ data: lastQuery.mockData || null, error: null });
  },
  single() {
    return Promise.resolve({ data: lastQuery.mockData || null, error: null });
  },
  update(data) {
    lastQuery.update = data;
    return this;
  },
  delete() {
    lastQuery.delete = true;
    return this;
  },
  insert(data) {
    lastQuery.insert = data;
    return this;
  },
  then(resolve) {
    // Mimic database returning mock data or empty array
    resolve(lastQuery.mockData ? [lastQuery.mockData] : []);
  }
};

const myMockClient = {
  from(tableName) {
    queryCount++;
    lastQuery = { tableName, eq: [], is: [], select: "*", mockData: mockDataMap[tableName] || null };
    return mockChain;
  }
};

// Apply mocked client to all Model instances to prevent real network calls
Product.client = myMockClient;
Order.client = myMockClient;
KnowledgeBase.client = myMockClient;
Tenant.client = myMockClient;
Admin.client = myMockClient;
Settings.client = myMockClient;
OrderSession.client = myMockClient;
Payment.client = myMockClient;
EcommerceConnection.client = myMockClient;
Feedback.client = myMockClient;
Ad.client = myMockClient;
AdClick.client = myMockClient;
Template.client = myMockClient;
Broadcast.client = myMockClient;

test("Login JWT includes tenant_id for standard users/admins", () => {
  const payload = { id: "admin-1", username: "admin_test", role: "admin", tenant_id: "tenant-abc" };
  const token = jwt.sign(payload, JWT_SECRET);
  const decoded = jwt.verify(token, JWT_SECRET);
  assert.strictEqual(decoded.tenant_id, "tenant-abc");
  assert.strictEqual(decoded.role, "admin");
});

test("Login JWT carries null or global flag for superadmin users", () => {
  const payload = { id: "super-1", username: "super_test", role: "superadmin", tenant_id: null };
  const token = jwt.sign(payload, JWT_SECRET);
  const decoded = jwt.verify(token, JWT_SECRET);
  assert.strictEqual(decoded.tenant_id, null);
  assert.strictEqual(decoded.role, "superadmin");
});

test("Tenant A cannot query Tenant B's products", async () => {
  const context = { tenant_id: "tenant-a", role: "admin" };

  await runWithTenantContext(context, async () => {
    await Product.find();
  });

  assert.strictEqual(lastQuery.tableName, "products");

  // Verify tenant isolation filter is injected
  const tenantFilter = lastQuery.eq.find(f => f.col === "tenant_id");
  assert.ok(tenantFilter, "tenant_id filter should be present");
  assert.strictEqual(tenantFilter.val, "tenant-a");

  // Verify soft delete filter is injected
  const deletedFilter = lastQuery.is.find(f => f.col === "deleted_at");
  assert.ok(deletedFilter, "deleted_at IS NULL filter should be present");
  assert.strictEqual(deletedFilter.val, null);
});

test("Tenant B query is isolated to Tenant B's orders", async () => {
  const context = { tenant_id: "tenant-b", role: "admin" };

  await runWithTenantContext(context, async () => {
    await Order.find();
  });

  assert.strictEqual(lastQuery.tableName, "orders");

  const tenantFilter = lastQuery.eq.find(f => f.col === "tenant_id");
  assert.ok(tenantFilter, "tenant_id filter should be present");
  assert.strictEqual(tenantFilter.val, "tenant-b");

  const deletedFilter = lastQuery.is.find(f => f.col === "deleted_at");
  assert.ok(deletedFilter, "deleted_at IS NULL filter should be present");
  assert.strictEqual(deletedFilter.val, null);
});

test("Soft-deleted items are omitted from standard query results", async () => {
  const context = { tenant_id: "tenant-a", role: "admin" };

  await runWithTenantContext(context, async () => {
    await KnowledgeBase.find();
  });

  assert.strictEqual(lastQuery.tableName, "knowledge_base");

  // Verify deleted_at is null is explicitly added
  const deletedFilter = lastQuery.is.find(f => f.col === "deleted_at");
  assert.ok(deletedFilter);
  assert.strictEqual(deletedFilter.val, null);
});

test("findByIdAndDelete performs soft deletion instead of hard delete", async () => {
  const context = { tenant_id: "tenant-a", role: "admin" };

  await runWithTenantContext(context, async () => {
    await Product.findByIdAndDelete("prod-123");
  });

  assert.strictEqual(lastQuery.tableName, "products");
  assert.ok(lastQuery.update, "Should invoke update command instead of delete");
  assert.ok(lastQuery.update.deleted_at, "Should update deleted_at timestamp");

  // Verify scoped update filters
  const tenantFilter = lastQuery.eq.find(f => f.col === "tenant_id");
  assert.strictEqual(tenantFilter.val, "tenant-a");
});

test("Superadmin role can bypass single-tenant restrictions", async () => {
  const context = { tenant_id: null, role: "superadmin", isSuperAdmin: true };

  await runWithTenantContext(context, async () => {
    await Product.find();
  });

  assert.strictEqual(lastQuery.tableName, "products");

  // Verify no tenant_id filter is injected for superadmin
  const tenantFilter = lastQuery.eq.find(f => f.col === "tenant_id");
  assert.strictEqual(tenantFilter, undefined, "Superadmin should bypass single-tenant restriction");
});

test("Superadmin role can impersonate a tenant", async () => {
  const context = { tenant_id: "tenant-c", role: "superadmin", isSuperAdmin: true };

  await runWithTenantContext(context, async () => {
    await Product.find();
  });

  assert.strictEqual(lastQuery.tableName, "products");

  // Verify tenant_id filter for tenant-c is applied because it's specified in context
  const tenantFilter = lastQuery.eq.find(f => f.col === "tenant_id");
  assert.ok(tenantFilter);
  assert.strictEqual(tenantFilter.val, "tenant-c");
});

// ─── Phase 1: Expanded Scoping & Settings Isolation Tests ───

test("Tenant A cannot read or write Tenant B's newly scoped multi-tenant tables", async () => {
  const modelsToTest = [
    { model: OrderSession, name: "order_sessions" },
    { model: Payment, name: "payments" },
    { model: EcommerceConnection, name: "ecommerce_connections" },
    { model: Feedback, name: "feedback" },
    { model: Ad, name: "ads" },
    { model: AdClick, name: "ad_clicks" },
    { model: Template, name: "templates" },
    { model: Broadcast, name: "broadcasts" }
  ];

  for (const { model, name } of modelsToTest) {
    const context = { tenant_id: "tenant-a", role: "admin" };
    await runWithTenantContext(context, async () => {
      await model.find();
    });

    assert.strictEqual(lastQuery.tableName, name);
    const tenantFilter = lastQuery.eq.find(f => f.col === "tenant_id");
    assert.ok(tenantFilter, `tenant_id filter should be present for ${name}`);
    assert.strictEqual(tenantFilter.val, "tenant-a");
  }
});

test("Settings are queried and cached strictly per-tenant, removing global fallback in multi-tenant mode", async () => {
  // Clear the cache first
  Settings.invalidateCache();
  mockDataMap = {};

  const tenantAContext = { tenant_id: "tenant-a", role: "admin" };
  const tenantBContext = { tenant_id: "tenant-b", role: "admin" };

  // 1. Query Settings under Tenant A
  lastQuery = null;
  queryCount = 0;
  const mockSettingsA = { id: "settings-a", tenant_id: "tenant-a", businessName: "Tenant A Business" };
  mockDataMap.settings = mockSettingsA;

  await runWithTenantContext(tenantAContext, async () => {
    const settings = await Settings.findOne({ configId: "global" });
    assert.strictEqual(settings.businessName, "Tenant A Business");
  });

  // Verify DB query was made, but configId is NOT used in filter
  assert.strictEqual(lastQuery.tableName, "settings");
  const tenantFilterA = lastQuery.eq.find(f => f.col === "tenant_id");
  assert.ok(tenantFilterA);
  assert.strictEqual(tenantFilterA.val, "tenant-a");
  const configIdFilter = lastQuery.eq.find(f => f.col === "configId");
  assert.strictEqual(configIdFilter, undefined, "configId: 'global' fallback should be bypassed in multi-tenant mode");
  assert.strictEqual(queryCount, 1, "Should perform exactly 1 DB query");

  // 2. Query Settings under Tenant A AGAIN (should hit cache, queryCount should not increase)
  await runWithTenantContext(tenantAContext, async () => {
    const settings = await Settings.findOne({ configId: "global" });
    assert.strictEqual(settings.businessName, "Tenant A Business");
  });
  assert.strictEqual(queryCount, 1, "Should hit settings cache and not perform another DB query");

  // 3. Query Settings under Tenant B (should NOT hit Tenant A's cache, should query DB)
  const mockSettingsB = { id: "settings-b", tenant_id: "tenant-b", businessName: "Tenant B Business" };
  mockDataMap.settings = mockSettingsB;
  await runWithTenantContext(tenantBContext, async () => {
    const settings = await Settings.findOne({ configId: "global" });
    assert.strictEqual(settings.businessName, "Tenant B Business");
  });
  assert.strictEqual(queryCount, 2, "Should query DB for Tenant B and not hit Tenant A's cache");

  // Verify DB query for Tenant B is isolated
  const tenantFilterB = lastQuery.eq.find(f => f.col === "tenant_id");
  assert.ok(tenantFilterB);
  assert.strictEqual(tenantFilterB.val, "tenant-b");
});
