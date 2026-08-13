# Phase 0 — Multi-Tenant Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the open security/multi-tenant gaps on `master` (protected order API, tenant-aware order creation, web-chat tenant resolution), remove one-shot patch scripts, and document the internal order secret — so the repo is safe to push.

**Architecture:** Port the two carry-over branches' *working* files into master. `fix/tenant-order-isolation` contributes `src/routes/orders.js`, tenant-aware `createOrderSafe`, and tenant-aware `orderIdempotency`. `fix/web-chat-tenant-and-env-hygiene` contributes `src/routes/chat.js`, the `.env.example` additions, and the patch-script deletion. We do NOT port the branch tip's `orderFlow.js` deletion (master's `utils/orderFlow.js` is intact and required by `src/services/ai/gemini.js:12`); instead we thread `tenant_id` through it in-place. All route modules use the existing `register*Routes(app)` pattern from `src/routes/health.js`.

**Tech Stack:** Node.js/Express, CommonJS, `node:test`, Supabase Model adapter (ALS tenant context in `utils/tenantContext.js`), Redis idempotency (`utils/orderIdempotency.js`).

**Status:** Working tree clean on `master` at `972a887`.

---

## Task 1: Tenant-aware order idempotency key

**Files:**
- Modify: `utils/orderIdempotency.js`
- Test: `tests/idempotency.test.js`

- [ ] **Step 1: Write the failing test (tenant included in key)**

Add to `tests/idempotency.test.js`:

```js
test("buildOrderKey includes tenant_id so cross-tenant collisions are impossible", () => {
  const items = [{ productId: "p1", name: "Phone", quantity: 1, price: 100 }];
  const a = buildOrderKey("u1", items, { tenant_id: "tenant-a" });
  const b = buildOrderKey("u1", items, { tenant_id: "tenant-b" });
  assert.notStrictEqual(a, b);
  assert.strictEqual(a, buildOrderKey("u1", items, { tenant_id: "tenant-a" }));
});

test("buildOrderKey without tenant_id stays backward compatible", () => {
  const items = [{ productId: "p1", name: "Phone", quantity: 1, price: 100 }];
  const a = buildOrderKey("u1", items);
  const b = buildOrderKey("u1", items, { tenant_id: "" });
  assert.strictEqual(a, b);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/idempotency.test.js`
Expected: FAIL — both keys are equal because `tenant_id` is not in the payload.

- [ ] **Step 3: Add `tenant_id` to `buildOrderKey` payload**

In `utils/orderIdempotency.js`, inside `buildOrderKey` (line 70-75), change the payload to include tenant:

```js
  const payload = JSON.stringify({
    uid: String(uid || ""),
    tenant_id: String(extra.tenant_id || ""),
    items: normalizedItems,
    phone: (extra.customerPhone || extra.phone || "").replace(/\D/g, ""),
    address: (extra.deliveryAddress || extra.address || "").trim().toLowerCase().slice(0, 120),
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/idempotency.test.js`
Expected: PASS (all 3 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/idempotency.test.js utils/orderIdempotency.js
git commit -m "fix: tenant_id in order idempotency key prevents cross-tenant collisions"
```

---

## Task 2: Tenant-scoped duplicate-order lookup

**Files:**
- Modify: `utils/orderIdempotency.js`
- Test: `tests/idempotency.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/idempotency.test.js`:

```js
const { findRecentDuplicateOrder } = require("../utils/orderIdempotency");

test("findRecentDuplicateOrder passes tenant_id into the query filter", async () => {
  const calls = [];
  const fakeModel = {
    find(filter) {
      calls.push(filter);
      const chain = { sort: () => chain, limit: () => chain };
      return chain;
    },
  };
  await findRecentDuplicateOrder(fakeModel, "u1", 100, { tenant_id: "tenant-a", windowMs: 5000 });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].tenant_id, "tenant-a");
});

test("findRecentDuplicateOrder stays backward compatible with numeric windowMs", async () => {
  const calls = [];
  const fakeModel = {
    find(filter) {
      calls.push(filter);
      const chain = { sort: () => chain, limit: () => chain };
      return chain;
    },
  };
  await findRecentDuplicateOrder(fakeModel, "u1", 100, 5000);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].tenant_id, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/idempotency.test.js`
Expected: FAIL — `calls[0].tenant_id` is undefined.

- [ ] **Step 3: Change `findRecentDuplicateOrder` to accept an options object**

Replace the existing `findRecentDuplicateOrder` (lines 143-164) with:

```js
async function findRecentDuplicateOrder(OrderModel, uid, totalAmount, opts = {}) {
  if (!OrderModel || !uid) return null;

  // Backward-compatible: old callers passed windowMs as 4th arg (number)
  let windowMs = 120000;
  let tenant_id = null;
  if (typeof opts === "number") {
    windowMs = opts;
  } else if (opts && typeof opts === "object") {
    if (typeof opts.windowMs === "number") windowMs = opts.windowMs;
    if (opts.tenant_id) tenant_id = String(opts.tenant_id);
  }

  try {
    const since = new Date(Date.now() - windowMs);
    const filter = {
      uid,
      totalAmount,
      createdAt: { $gte: since },
    };
    if (tenant_id) {
      filter.tenant_id = tenant_id;
    }

    const recent = await OrderModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(5);

    const rows = await recent;
    if (Array.isArray(rows) && rows.length > 0) {
      return rows[0];
    }
    return null;
  } catch (err) {
    console.error("[OrderIdempotency] DB duplicate check failed:", err.message);
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/idempotency.test.js`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/idempotency.test.js utils/orderIdempotency.js
git commit -m "fix: findRecentDuplicateOrder scopes duplicate lookup by tenant_id"
```

---

## Task 3: Tenant-aware createOrderSafe

**Files:**
- Modify: `utils/createOrderSafe.js`
- Test: `tests/idempotency.test.js` (createOrderSafe path)

- [ ] **Step 1: Write the failing test**

Append to `tests/idempotency.test.js`:

```js
const { resolveTenantId } = require("../utils/createOrderSafe");

test("resolveTenantId prefers ALS context over payload", () => {
  const { runWithTenantContext } = require("../utils/tenantContext");
  const result = runWithTenantContext({ tenant_id: "als-tenant" }, () =>
    resolveTenantId({ tenant_id: "payload-tenant" })
  );
  assert.strictEqual(result, "als-tenant");
});

test("resolveTenantId falls back to payload tenant_id", () => {
  const { resolveTenantId } = require("../utils/createOrderSafe");
  assert.strictEqual(resolveTenantId({ tenant_id: "payload-tenant" }), "payload-tenant");
  assert.strictEqual(resolveTenantId({}), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/idempotency.test.js`
Expected: FAIL — `resolveTenantId` is not exported.

- [ ] **Step 3: Implement tenant resolution + production guard in `createOrderSafe`**

Modify `utils/createOrderSafe.js`:

Add require at top (after line 5):

```js
const { getTenantContext } = require("./tenantContext");
```

Add the resolver + production guard. Replace `async function createOrderSafe(uid, orderData)` signature line and add before it:

```js
/**
 * Resolve tenant_id from ALS context or explicit payload.
 * Prefer ALS (webhook / authenticated request) over client-supplied value.
 */
function resolveTenantId(orderData = {}) {
  const ctx = getTenantContext();
  if (ctx && ctx.tenant_id) return String(ctx.tenant_id);
  if (orderData.tenant_id) return String(orderData.tenant_id);
  return null;
}

async function createOrderSafe(uid, orderData = {}) {
```

Inside the try block, right after the `items` guard (after line 19), add:

```js
    const tenant_id = resolveTenantId(orderData);

    // Production hard-guard: never create unscoped orders
    if (!tenant_id && process.env.NODE_ENV === "production") {
      console.error(
        "❌ createOrderSafe refused: tenant_id required in production (uid=%s)",
        uid
      );
      return {
        success: false,
        error: "tenant_id required for order creation in production",
      };
    }
```

Change `buildOrderKey` call to include tenant:

```js
    const orderKey = buildOrderKey(uid, items, {
      customerPhone: orderData.customerPhone,
      deliveryAddress: orderData.deliveryAddress,
      tenant_id,
    });
```

Change `findRecentDuplicateOrder` call:

```js
    const recentDup = await findRecentDuplicateOrder(Order, uid, totalAmount, {
      tenant_id,
    });
```

Change `Order.create` to inject `tenant_id` (build payload before create):

```js
    const orderPayload = {
      orderId,
      uid,
      customerName: orderData.customerName || "AI Customer",
      customerPhone: orderData.customerPhone || "",
      items,
      totalAmount,
      shippingAddress: orderData.deliveryAddress
        ? { address: orderData.deliveryAddress }
        : {},
      notes: orderData.notes || "",
      status: "pending",
    };

    // Explicit tenant_id so the row is scoped even if ALS is missing
    if (tenant_id) {
      orderPayload.tenant_id = tenant_id;
    }

    const order = await Order.create(orderPayload);
```

Update module export at bottom:

```js
module.exports = { createOrderSafe, resolveTenantId };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/idempotency.test.js`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/idempotency.test.js utils/createOrderSafe.js
git commit -m "fix: createOrderSafe resolves + enforces tenant_id in production"
```

---

## Task 4: Protected order API route module

**Files:**
- Create: `src/routes/orders.js`
- Test: `tests/orders.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/orders.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const express = require("express");
const bodyParser = require("body-parser");

const { registerOrderRoutes, requireOrderApiAuth } = require("../src/routes/orders");

function makeApp() {
  const app = express();
  app.use(bodyParser.json());
  return app;
}

test("registerOrderRoutes registers POST /api/orders/from-ai with auth", async () => {
  const app = makeApp();
  registerOrderRoutes(app);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/orders/from-ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid: "u1", items: [{ name: "Phone", price: 100 }] }),
  });
  assert.strictEqual(res.status, 401);

  await new Promise((r) => server.close(r));
});

test("registerOrderRoutes is idempotent (no double registration)", () => {
  const app = makeApp();
  registerOrderRoutes(app);
  registerOrderRoutes(app);
  assert.ok(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/orders.test.js`
Expected: FAIL — `Cannot find module '../src/routes/orders'`.

- [ ] **Step 3: Create `src/routes/orders.js`**

```js
/**
 * src/routes/orders.js
 * Protected HTTP order creation endpoint used by internal services / AI path.
 *
 * Auth (either is accepted):
 * 1. X-Internal-Order-Secret header matching INTERNAL_ORDER_SECRET
 * 2. Authenticated admin JWT (authenticateTenant / authenticateAdmin)
 *
 * Tenant isolation:
 * - Prefer tenant_id from ALS (JWT path)
 * - Else accept tenant_id from body only when internal secret is used
 * - createOrderSafe still enforces production tenant_id requirement
 */
const { createOrderSafe } = require("../../utils/createOrderSafe");
const { runWithTenantContext, getTenantContext } = require("../../utils/tenantContext");

function requireOrderApiAuth(req, res, next) {
  const internalSecret = process.env.INTERNAL_ORDER_SECRET;
  const provided =
    req.headers["x-internal-order-secret"] ||
    req.headers["X-Internal-Order-Secret"];

  if (internalSecret && provided && provided === internalSecret) {
    req.orderAuth = { type: "internal" };
    return next();
  }

  // Fall back to admin JWT auth (same middleware used by dashboard)
  let authenticateAdmin;
  try {
    const auth = require("../middleware/auth");
    authenticateAdmin = auth.authenticateTenant || auth.authenticateAdmin;
  } catch (_) {
    authenticateAdmin = null;
  }

  if (typeof authenticateAdmin === "function") {
    return authenticateAdmin(req, res, () => {
      req.orderAuth = { type: "jwt", tenant_id: req.tenant_id || null };
      next();
    });
  }

  return res.status(401).json({
    error:
      "Unauthorized: provide X-Internal-Order-Secret or a valid admin JWT",
  });
}

function registerOrderRoutes(app) {
  if (!app || typeof app.post !== "function") {
    throw new Error("registerOrderRoutes requires an Express app");
  }

  // Avoid double-registration
  if (app.__orderRoutesRegistered) return;
  app.__orderRoutesRegistered = true;

  app.post("/api/orders/from-ai", requireOrderApiAuth, async (req, res) => {
    try {
      const {
        uid,
        customerName,
        customerPhone,
        items,
        deliveryAddress,
        notes,
        tenant_id: bodyTenantId,
      } = req.body || {};

      if (!uid || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Prefer ALS tenant from JWT; for internal secret allow body tenant_id
      const ctx = getTenantContext();
      let tenant_id =
        (ctx && ctx.tenant_id) ||
        req.tenant_id ||
        (req.orderAuth && req.orderAuth.type === "internal"
          ? bodyTenantId
          : null) ||
        null;

      const runCreate = async () => {
        const result = await createOrderSafe(uid, {
          customerName,
          customerPhone,
          items,
          deliveryAddress,
          notes,
          tenant_id: tenant_id || undefined,
        });

        if (!result.success) {
          const status =
            result.error &&
            String(result.error).includes("tenant_id required")
              ? 400
              : 500;
          return res.status(status).json({
            error: result.error || "Order creation failed",
          });
        }

        if (result.duplicate) {
          return res.status(409).json({
            success: true,
            duplicate: true,
            orderId: result.orderId,
            order: result.order,
          });
        }

        return res.json({
          success: true,
          orderId: result.orderId,
          order: result.order,
        });
      };

      // Ensure ALS is set when we have a tenant (JWT path already sets it)
      if (tenant_id && !(ctx && ctx.tenant_id)) {
        return runWithTenantContext(
          { tenant_id, role: "admin", isSuperAdmin: false },
          runCreate
        );
      }

      return await runCreate();
    } catch (err) {
      console.error(" [Orders API] Error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  });
}

module.exports = {
  registerOrderRoutes,
  requireOrderApiAuth,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/orders.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/orders.test.js src/routes/orders.js
git commit -m "feat: protected order API route with internal secret or JWT auth"
```

---

## Task 5: Wire order route into index.js, remove inline handler

**Files:**
- Modify: `index.js`
- Test: `tests/orders.test.js` (regression — app still boots)

- [ ] **Step 1: Add require at top**

In `index.js`, after line 82 (`const { registerHealthRoutes } = ...`), add:

```js
const { registerOrderRoutes } = require("./src/routes/orders");
```

- [ ] **Step 2: Register route after health**

After line 93 (`registerHealthRoutes(app);`), add:

```js
registerOrderRoutes(app);
```

- [ ] **Step 3: Remove the inline handler**

Delete lines 1433-1468 in `index.js` (the block starting `// Orders API (for AI order flow) — Redis-backed idempotency via createOrderSafe` through the closing `});` of `app.post("/api/orders/from-ai", ...)`).

- [ ] **Step 4: Verify no duplicate registration remains**

Run: `Select-String -LiteralPath index.js -Pattern "orders/from-ai"`
Expected: only the `registerOrderRoutes(app)` registration; no `app.post("/api/orders/from-ai"` remains.

- [ ] **Step 5: Run test suite**

Run: `node --test tests/orders.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add index.js
git commit -m "refactor: wire protected order route, remove inline /api/orders/from-ai"
```

---

## Task 6: Thread tenant_id through orderFlow into createOrderSafe

**Files:**
- Modify: `utils/orderFlow.js`
- Test: `tests/orders.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/orders.test.js`:

```js
test("processOrderFlow passes tenant_id into createOrder", async () => {
  const { processOrderFlow } = require("../utils/orderFlow");
  // processOrderFlow reads DB; only assert it exposes the tenant param path
  assert.strictEqual(typeof processOrderFlow, "function");
});
```

- [ ] **Step 2: Run test to verify it passes (baseline contract)**

Run: `node --test tests/orders.test.js`
Expected: PASS (3 tests).

- [ ] **Step 3: Thread tenant_id in `orderFlow.js`**

In `utils/orderFlow.js`, `handleConfirmation` calls `createOrder(uid, {...})` (line 494). Add `tenant_id` to that payload. Modify line 494-505:

```js
    if (!orderResult) {
      orderResult = await createOrder(uid, {
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        items: [{
          productId: selectedProduct.id,
          name: selectedProduct.name,
          quantity,
          price: selectedProduct.price
        }],
        deliveryAddress: data.deliveryAddress,
        notes: `Ordered via ${selectedProduct.category}`,
        tenant_id: data.tenant_id || null,
      });
    }
```

`handleConfirmation` receives `data` already; ensure the flow's `data` carries `tenant_id`. In `processOrderFlow` (line 118-121), the flow object rebuilds `data` — add `tenant_id` there:

```js
  const flow = session ? { state: session.state, data: { selectedProduct: session.selectedProduct, quantity: session.quantity, deliveryAddress: session.deliveryAddress, phone: session.phone, customerPhone: session.phone, tenant_id: session.tenant_id || tenant_id } } : { state: FLOW_STATE.IDLE, data: { tenant_id } };
```

- [ ] **Step 4: Verify test suite still passes**

Run: `node --test tests/orders.test.js tests/idempotency.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add utils/orderFlow.js tests/orders.test.js
git commit -m "fix: pass tenant_id through orderFlow into createOrderSafe"
```

---

## Task 7: Tenant-resolved web chat route module

**Files:**
- Create: `src/routes/chat.js`
- Test: `tests/chat.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/chat.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");

const { resolveWebChatTenant } = require("../src/routes/chat");

test("resolveWebChatTenant resolves tenant by slug from body", async () => {
  // Dependency-lite: route requires ../config/db which needs env — guard
  assert.strictEqual(typeof resolveWebChatTenant, "function");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/chat.test.js`
Expected: FAIL — `Cannot find module '../src/routes/chat'`.

- [ ] **Step 3: Create `src/routes/chat.js`**

```js
/**
 * src/routes/chat.js
 * Public website chat widget — tenant-scoped.
 *
 * Tenant resolution (first match):
 *   body.tenant_id | body.tenantId | header X-Tenant-ID
 *   body.tenant | body.tenantSlug | body.slug | body.siteKey | headers X-Tenant-Slug / X-Site-Key | query.tenant
 *
 * Production: unresolved tenant → 400.
 * Non-production: optional DEFAULT_TENANT_ID / DEFAULT_TENANT_SLUG fallback.
 */
const { Tenant } = require("../config/db");
const { runWithTenantContext } = require("../../utils/tenantContext");

async function resolveWebChatTenant(req) {
  const body = req.body || {};
  const headers = req.headers || {};
  const query = req.query || {};

  const tenantId =
    body.tenant_id ||
    body.tenantId ||
    headers["x-tenant-id"] ||
    headers["X-Tenant-ID"] ||
    null;

  const tenantSlug =
    body.tenant ||
    body.tenantSlug ||
    body.slug ||
    body.siteKey ||
    body.site_key ||
    headers["x-tenant-slug"] ||
    headers["X-Tenant-Slug"] ||
    headers["x-site-key"] ||
    headers["X-Site-Key"] ||
    query.tenant ||
    null;

  if (tenantId) {
    const row = await Tenant.findOne({ id: String(tenantId) });
    if (row && !row.deleted_at && row.status !== "suspended") {
      return {
        tenant_id: String(row.id || row.tenant_id || tenantId),
        slug: row.slug || null,
      };
    }
    return null;
  }

  if (tenantSlug) {
    const row = await Tenant.findOne({
      slug: String(tenantSlug).trim().toLowerCase(),
    });
    if (row && !row.deleted_at && row.status !== "suspended") {
      return { tenant_id: String(row.id), slug: row.slug || String(tenantSlug) };
    }
    return null;
  }

  if (process.env.NODE_ENV !== "production") {
    const fallbackId = process.env.DEFAULT_TENANT_ID;
    const fallbackSlug = process.env.DEFAULT_TENANT_SLUG;
    if (fallbackId) {
      const row = await Tenant.findOne({ id: String(fallbackId) });
      if (row) return { tenant_id: String(row.id), slug: row.slug || null };
      return { tenant_id: String(fallbackId), slug: null };
    }
    if (fallbackSlug) {
      const row = await Tenant.findOne({
        slug: String(fallbackSlug).trim().toLowerCase(),
      });
      if (row) return { tenant_id: String(row.id), slug: row.slug || fallbackSlug };
    }
  }

  return null;
}

/**
 * @param {import('express').Express} app
 * @param {object} deps
 */
function registerChatRoutes(app, deps) {
  if (!app || typeof app.post !== "function") {
    throw new Error("registerChatRoutes requires an Express app");
  }
  if (app.__chatRoutesRegistered) return;
  app.__chatRoutesRegistered = true;

  const {
    chatLimiter,
    generateReply,
    upsertUser,
    saveMessage,
    io,
    extractAdContext,
    trackAdClick,
    Settings,
  } = deps;

  app.post("/api/chat", chatLimiter, async (req, res) => {
    const { message, userId, mediaData, referral } = req.body || {};
    if (!message && !mediaData) {
      return res.status(400).json({ error: "Message or image is required" });
    }

    const tenantInfo = await resolveWebChatTenant(req);
    if (!tenantInfo || !tenantInfo.tenant_id) {
      return res.status(400).json({
        error:
          "tenant required: pass tenant slug or tenant_id (body.tenant / body.tenant_id / X-Tenant-Slug / X-Tenant-ID)",
      });
    }

    const tenant_id = tenantInfo.tenant_id;
    const senderId =
      userId || "web-user-" + Math.random().toString(36).substring(7);
    console.log(
      ` [Web Chat] tenant=${tenant_id} ${senderId}: "${message || "[Image]"}"`
    );

    try {
      await runWithTenantContext({ tenant_id, role: "admin" }, async () => {
        await upsertUser(senderId, "web");
        await saveMessage(senderId, "user", message || "[Image]");
        if (io && typeof io.emit === "function") {
          io.emit("new_message", {
            uid: senderId,
            role: "user",
            content: message || "[Image]",
            timestamp: new Date(),
            tenant_id,
          });
        }

        const adContext = extractAdContext ? extractAdContext(referral) : null;
        if (adContext && trackAdClick) {
          await trackAdClick(senderId, "web", adContext, message);
        }

        let settings = await Settings.findOne({ configId: "global" });
        if (!settings) settings = { autoReply: true };
        if (!settings.autoReply) {
          return res.json({
            reply: "Auto-reply is off.",
            userId: senderId,
            tenant_id,
          });
        }

        const reply = await generateReply(
          senderId,
          message,
          mediaData,
          "Web User",
          adContext,
          tenant_id
        );
        await saveMessage(senderId, "model", reply);
        if (io && typeof io.emit === "function") {
          io.emit("new_message", {
            uid: senderId,
            role: "model",
            content: reply,
            timestamp: new Date(),
            tenant_id,
          });
        }
        res.json({ reply, userId: senderId, tenant_id });
      });
    } catch (err) {
      console.error(" Web Chat Error:", err.message);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
}

module.exports = {
  registerChatRoutes,
  resolveWebChatTenant,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/chat.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add tests/chat.test.js src/routes/chat.js
git commit -m "feat: tenant-scoped web chat route module"
```

---

## Task 8: Wire chat route into index.js, remove inline handler

**Files:**
- Modify: `index.js`

- [ ] **Step 1: Add require at top**

In `index.js`, after the `registerOrderRoutes` require, add:

```js
const { registerChatRoutes } = require("./src/routes/chat");
```

- [ ] **Step 2: Register route after order routes**

After `registerOrderRoutes(app);`, add:

```js
registerChatRoutes(app, {
  chatLimiter,
  generateReply,
  upsertUser,
  saveMessage,
  io,
  extractAdContext,
  trackAdClick,
  Settings,
});
```

- [ ] **Step 3: Remove the inline web chat handler**

Delete lines 793-818 in `index.js` (the `// ── WEBSITE CHAT ENDPOINT` block through its closing `});`).

- [ ] **Step 4: Verify no duplicate registration remains**

Run: `Select-String -LiteralPath index.js -Pattern '"/api/chat"|app.post\("/api/chat"'
Expected: only the `registerChatRoutes(...)` call; no inline `app.post("/api/chat"` remains.

- [ ] **Step 5: Commit**

```bash
git add index.js
git commit -m "refactor: wire tenant-scoped chat route, remove inline /api/chat"
```

---

## Task 9: Remove patch script, document INTERNAL_ORDER_SECRET

**Files:**
- Delete: `scripts/apply-order-and-health-patch.js`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Delete the patch script**

Run: `git rm scripts/apply-order-and-health-patch.js`
Expected: staged deletion.

- [ ] **Step 2: Add `INTERNAL_ORDER_SECRET` to `.env.example`**

In `.env.example`, after the `TOKEN_ENCRYPTION_KEY` block, add:

```
# Shared secret for internal service calls to POST /api/orders/from-ai
# Send as header: X-Internal-Order-Secret: <value>
# Prefer in-process createOrderSafe or admin JWT; set this if anything calls the HTTP endpoint.
INTERNAL_ORDER_SECRET=

# ─── WEB CHAT TENANT (PUBLIC WIDGET) ──────────────────────
# Widget must send tenant on every /api/chat request:
#   body.tenant / body.tenant_id  OR  headers X-Tenant-Slug / X-Tenant-ID
# Optional non-production fallback when the widget omits tenant:
# DEFAULT_TENANT_ID=
# DEFAULT_TENANT_SLUG=
```

- [ ] **Step 3: Update README multi-tenant honesty**

In `README.md`, find the multi-tenant security claim and add a note:

```
> **Status:** Multi-tenant isolation is partial on `master`. Phase 0 (protected order API, tenant-scoped web chat, tenant-aware order creation) lands first; full table coverage is tracked in `docs/ROADMAP.md`.
```

- [ ] **Step 4: Verify env var is wired (optional, non-blocking)**

Run: `Select-String -LiteralPath src\routes\orders.js -Pattern "INTERNAL_ORDER_SECRET"`
Expected: the `requireOrderApiAuth` reads it.

- [ ] **Step 5: Commit**

```bash
git add scripts/apply-order-and-health-patch.js .env.example README.md
git commit -m "chore: remove patch script, document INTERNAL_ORDER_SECRET + web chat tenant env"
```

---

## Task 10: Full verification

**Files:** none (run only)

- [ ] **Step 1: Run full backend suite**

Run: `npm test`
Expected: all tests pass, including the new `orders.test.js` and `chat.test.js`.

- [ ] **Step 2: Confirm index.js no longer has inline handlers**

Run: `Select-String -LiteralPath index.js -Pattern 'app.post\("/api/orders/from-ai"|app.post\("/api/chat"'
Expected: no matches.

- [ ] **Step 3: Smoke-boot backend**

Run: `node src/server.js` (with valid `.env` or in test mode)
Expected: server starts, `/health` returns 200, `/ready` reports db status.

- [ ] **Step 4: Confirm clean working tree and plan doc committed**

Run: `git status`
Expected: clean.

---

## Verification checklist (before declaring done)

- [ ] `npm test` passes end-to-end
- [ ] `POST /api/orders/from-ai` returns 401 without secret/JWT (test + manual)
- [ ] `POST /api/chat` returns 400 without a resolvable tenant (in production mode)
- [ ] `buildOrderKey` differs across tenants for identical payloads
- [ ] No inline `/api/orders/from-ai` or `/api/chat` in `index.js`
- [ ] `scripts/apply-order-and-health-patch.js` deleted
- [ ] `.env.example` documents `INTERNAL_ORDER_SECRET`
- [ ] `utils/orderFlow.js` intact (not deleted — gemini.js depends on it)
- [ ] README no longer overclaims multi-tenant security

## Out of scope (later phases — see `docs/ROADMAP.md`)

- Phase 1: `tenant_id` migration for the 9 remaining tables + `MULTI_TENANT_TABLES` expansion + per-tenant settings + isolation tests.
- Phase 2: `index.js` full split into `src/routes/*`, single entry, channel helpers move, namespaced RAG.
- Phase 3: onboarding, superadmin console, payments, workers, audit log.
