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
const { supabase, Product, Order, KnowledgeBase, Tenant, Admin } = require("../supabaseClient");
const { runWithTenantContext } = require("../utils/tenantContext");

const JWT_SECRET = process.env.JWT_SECRET || "cyberbot-admin-secret-key-change-in-production";

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
    lastQuery = { tableName, eq: [], is: [], select: "*", mockData: null };
    return mockChain;
  }
};

// Apply mocked client to all Model instances to prevent real network calls
Product.client = myMockClient;
Order.client = myMockClient;
KnowledgeBase.client = myMockClient;
Tenant.client = myMockClient;
Admin.client = myMockClient;

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
