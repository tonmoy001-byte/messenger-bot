/**
 * utils/orderIdempotency.js
 * Deterministic order fingerprint for dedup.
 */
const crypto = require("crypto");

function buildOrderKey(uid, items) {
  const payload = JSON.stringify({
    uid,
    items: (items || []).map(i => ({ productId: i.productId, name: i.name, quantity: i.quantity, price: i.price })).sort((a, b) => (a.name || "").localeCompare(b.name || "")),
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

module.exports = { buildOrderKey };
