/**
 * utils/createOrderSafe.js
 * Idempotent local order creation used by the AI order flow.
 * Prefer this over HTTP round-trip to /api/orders/from-ai.
 *
 * Tenant isolation:
 * - Resolves tenant_id from orderData.tenant_id or AsyncLocalStorage context
 * - Includes tenant_id in idempotency fingerprint
 * - Persists tenant_id on the order row
 * - Scopes DB duplicate checks by tenant when available
 * - In production, refuses create without tenant_id
 */
const { Order } = require("../src/config/db");
const {
  buildOrderKey,
  claimOrderKey,
  markOrderCreated,
  findRecentDuplicateOrder,
} = require("./orderIdempotency");
const { getTenantContext, runWithTenantContext } = require("./tenantContext");

function resolveTenantId(orderData = {}) {
  if (orderData.tenant_id) return orderData.tenant_id;
  const ctx = getTenantContext();
  return (ctx && ctx.tenant_id) || null;
}

async function createOrderSafeInner(uid, orderData, tenant_id) {
  const items = orderData.items || [];
  if (!uid || items.length === 0) {
    return { success: false, error: "Missing required fields" };
  }

  const orderKey = buildOrderKey(uid, items, {
    customerPhone: orderData.customerPhone,
    deliveryAddress: orderData.deliveryAddress,
    tenant_id,
  });

  const claim = await claimOrderKey(orderKey, "pending");
  if (claim.isDuplicate) {
    return {
      success: true,
      orderId: claim.orderId,
      duplicate: true,
    };
  }

  const totalAmount = items.reduce(
    (sum, item) => sum + Number(item.price) * Number(item.quantity || 1),
    0
  );

  const recentDup = await findRecentDuplicateOrder(Order, uid, totalAmount, {
    tenant_id,
  });
  if (recentDup) {
    const existingId = recentDup.orderId || recentDup.id;
    await markOrderCreated(orderKey, existingId);
    return { success: true, orderId: existingId, duplicate: true, order: recentDup };
  }

  const orderId =
    "ORD-" +
    Date.now().toString(36).toUpperCase() +
    Math.random().toString(36).substring(2, 6).toUpperCase();

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

  if (tenant_id) {
    orderPayload.tenant_id = tenant_id;
  }

  const order = await Order.create(orderPayload);

  await markOrderCreated(orderKey, order.orderId);

  try {
    const { markAdConversion } = require("./adTracking");
    await markAdConversion(uid, order.id || order.orderId);
  } catch (_) {
    /* optional */
  }

  return { success: true, orderId: order.orderId, order };
}

async function createOrderSafe(uid, orderData = {}) {
  try {
    const tenant_id = resolveTenantId(orderData);
    const ctx = getTenantContext();

    if (!tenant_id && process.env.NODE_ENV === "production") {
      console.error("❌ createOrderSafe: tenant_id required in production");
      return { success: false, error: "tenant_id required" };
    }

    if (tenant_id && (!ctx || ctx.tenant_id !== tenant_id)) {
      return await runWithTenantContext(
        { tenant_id, role: (ctx && ctx.role) || "system", isSuperAdmin: false },
        () => createOrderSafeInner(uid, orderData, tenant_id)
      );
    }

    return await createOrderSafeInner(uid, orderData, tenant_id);
  } catch (err) {
    console.error("❌ Failed to create order (safe path):", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { createOrderSafe, resolveTenantId };
