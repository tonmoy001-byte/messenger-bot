/**
 * utils/createOrderSafe.js
 * Idempotent local order creation used by the AI order flow.
 * Prefer this over HTTP round-trip to /api/orders/from-ai.
 */
const { Order } = require("../src/config/db");
const {
  buildOrderKey,
  claimOrderKey,
  markOrderCreated,
  findRecentDuplicateOrder,
} = require("./orderIdempotency");

async function createOrderSafe(uid, orderData) {
  try {
    const items = orderData.items || [];
    if (!uid || items.length === 0) {
      return { success: false, error: "Missing required fields" };
    }

    const orderKey = buildOrderKey(uid, items, {
      customerPhone: orderData.customerPhone,
      deliveryAddress: orderData.deliveryAddress,
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

    const recentDup = await findRecentDuplicateOrder(Order, uid, totalAmount);
    if (recentDup) {
      const existingId = recentDup.orderId || recentDup.id;
      await markOrderCreated(orderKey, existingId);
      return { success: true, orderId: existingId, duplicate: true, order: recentDup };
    }

    const orderId =
      "ORD-" +
      Date.now().toString(36).toUpperCase() +
      Math.random().toString(36).substring(2, 6).toUpperCase();

    const order = await Order.create({
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
    });

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

module.exports = { createOrderSafe };
