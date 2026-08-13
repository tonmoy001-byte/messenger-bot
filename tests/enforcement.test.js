/**
 * tests/enforcement.test.js
 * ─────────────────────────────────────────────────────────────
 * Tenant-scope enforcement test suite (Phase 1).
 * Verifies requireTenantScope hard-fails in production, allowlist,
 * superadmin bypass, write-path guards, RAG fallback scoping,
 * and the shared tenant resolver.
 * ─────────────────────────────────────────────────────────────
 */

require("../src/config/env");

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

test("superadmin.js defines withSuperadmin and auth.js wraps login/refresh while index.js wraps bootstrap in it", () => {
  const fs = require("fs");
  const path = require("path");
  const superadminSrc = fs.readFileSync(
    path.join(__dirname, "..", "src", "config", "superadmin.js"), "utf8");
  assert.match(superadminSrc, /(?:const withSuperadmin = .*|function withSuperadmin\([^)]*\)[\s\S]*?)runWithTenantContext/);
  const authSrc = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "auth.js"), "utf8");
  const login = authSrc.slice(authSrc.indexOf('app.post("/api/auth/login"'), authSrc.indexOf('app.post("/api/auth/refresh"'));
  const refresh = authSrc.slice(authSrc.indexOf('app.post("/api/auth/refresh"'), authSrc.indexOf('app.post("/api/auth/logout"'));
  assert.match(login, /withSuperadmin\(/);
  assert.match(refresh, /withSuperadmin\(/);
  const src = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const bootStart = src.indexOf("await withSuperadmin(");
  const bootstrap = src.slice(bootStart, src.indexOf("startAutoPurgeCron", bootStart));
  assert.match(bootstrap, /withSuperadmin\(/);
});

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

const { resolveTenantFromRequest } = require("../src/routes/chat");

test("resolveTenantFromRequest resolves tenant from query tenant slug", async () => {
  const { Tenant } = require("../src/config/supabaseClient");
  const chain = {
    select() { return this; },
    eq() { return this; },
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
  const { Tenant } = require("../src/config/supabaseClient");
  const chain = {
    select() { return this; },
    eq() { return this; },
    is() { return this; },
    limit() { return this; },
    maybeSingle() { return Promise.resolve({ data: { id: "tenant-xyz" }, error: null }); },
  };
  const origClient = Tenant.client;
  Tenant.client = { from() { return chain; } };
  try {
    const result = await resolveTenantFromRequest({ body: {}, headers: { "x-tenant-id": "tenant-xyz" }, query: {} });
    assert.strictEqual(result.tenant_id, "tenant-xyz");
  } finally {
    Tenant.client = origClient;
  }
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
