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
