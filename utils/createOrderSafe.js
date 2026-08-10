/**
 * utils/createOrderSafe.js
 * Idempotent local order creation used by the AI order flow.
 * Prefer this over HTTP round-trip to /api/orders/from-ai.
 */
const { Order } = require("../src/config/db");
const { getTenantContext } = require("./tenantContext");
const {
  buildOrderKey,
  claimOrderKey,
  markOrderCreated,
  findRecentDuplicateOrder,
} = require("./orderIdempotency");

function resolveTenantId(orderData = {}) {
  const ctx = getTenantContext();
  if (ctx && ctx.tenant_id) return String(ctx.tenant_id);
  if (orderData.tenant_id) return String(orderData.tenant_id);
  return null;
}

async function createOrderSafe(uid, orderData = {}) {
  try {
    const items = orderData.items || [];
    if (!uid || items.length === 0) {
      return { success: false, error: "Missing required fields" };
    }

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

    // Explicit tenant_id so the row is scoped even if ALS is missing
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
  } catch (err) {
    console.error("❌ Failed to create order (safe path):", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { createOrderSafe, resolveTenantId };
