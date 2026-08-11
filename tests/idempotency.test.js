const { test } = require("node:test");
const assert = require("node:assert");
const { buildOrderKey } = require("../utils/orderIdempotency");

test("buildOrderKey is stable for same uid+items", () => {
  const items = [{ productId: "p1", name: "Phone", quantity: 1, price: 100 }];
  const a = buildOrderKey("u1", items);
  const b = buildOrderKey("u1", [{ productId: "p1", name: "Phone", quantity: 1, price: 100 }]);
  assert.strictEqual(a, b);
});

test("buildOrderKey differs for different quantity", () => {
  const a = buildOrderKey("u1", [{ productId: "p1", name: "Phone", quantity: 1, price: 100 }]);
  const b = buildOrderKey("u1", [{ productId: "p1", name: "Phone", quantity: 2, price: 100 }]);
  assert.notStrictEqual(a, b);
});

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

const { resolveTenantId } = require("../utils/createOrderSafe");

test("resolveTenantId prefers ALS context over payload", () => {
  const { runWithTenantContext } = require("../utils/tenantContext");
  const result = runWithTenantContext({ tenant_id: "als-tenant" }, () =>
    resolveTenantId({ tenant_id: "payload-tenant" })
  );
  assert.strictEqual(result, "als-tenant");
});

test("resolveTenantId falls back to payload tenant_id", () => {
  assert.strictEqual(resolveTenantId({ tenant_id: "payload-tenant" }), "payload-tenant");
  assert.strictEqual(resolveTenantId({}), null);
});
