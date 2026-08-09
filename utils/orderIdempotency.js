/**
 * utils/orderIdempotency.js
 * ───────────────────────────────────────────────────────────
 * Deterministic order fingerprint + Redis-backed short-window
 * idempotency to prevent duplicate orders from concurrent or
 * retried requests.
 * ───────────────────────────────────────────────────────────
 */
const crypto = require("crypto");
const Redis = require("ioredis");

const IDEMPOTENCY_TTL_SECONDS = 120; // 2 minute window
const MEMORY_MAX = 5000;

let redis = null;
let redisAvailable = false;
const memoryCache = new Map(); // key -> { orderId, createdAt }

try {
  redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 3) return null;
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true,
    connectTimeout: 3000,
  });

  redis.on("error", (err) => {
    if (err.code !== "ECONNREFUSED") {
      console.error("[OrderIdempotency] Redis error:", err.message);
    }
    redisAvailable = false;
  });

  redis.on("connect", () => {
    redisAvailable = true;
  });
} catch (e) {
  console.warn("[OrderIdempotency] Redis init failed, using in-memory fallback");
}

async function ensureConnected() {
  if (!redis) return false;
  if (redis.status === "wait") {
    try {
      await redis.connect();
    } catch {
      return false;
    }
  }
  return redisAvailable;
}

/**
 * Build a stable fingerprint for an order attempt.
 * Includes tenant_id, uid, items, and optional customer identifiers
 * so idempotency keys never collide across tenants.
 */
function buildOrderKey(uid, items, extra = {}) {
  const normalizedItems = (items || [])
    .map((i) => ({
      productId: i.productId || i.id || null,
      name: (i.name || "").trim().toLowerCase(),
      quantity: Number(i.quantity) || 1,
      price: Number(i.price) || 0,
    }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  const payload = JSON.stringify({
    tenant_id: String(extra.tenant_id || ""),
    uid: String(uid || ""),
    items: normalizedItems,
    phone: (extra.customerPhone || extra.phone || "").replace(/\D/g, ""),
    address: (extra.deliveryAddress || extra.address || "").trim().toLowerCase().slice(0, 120),
  });

  return crypto.createHash("sha256").update(payload).digest("hex");
}

/**
 * Atomically claim an order key for the short idempotency window.
 * @returns {Promise<{ isDuplicate: boolean, orderId?: string }>}
 */
async function claimOrderKey(orderKey, orderId) {
  if (!orderKey) return { isDuplicate: false };

  const key = `order:idemp:${orderKey}`;

  if (await ensureConnected()) {
    try {
      const set = await redis.set(key, orderId || "pending", "EX", IDEMPOTENCY_TTL_SECONDS, "NX");
      if (set === null) {
        const existing = await redis.get(key);
        return { isDuplicate: true, orderId: existing || undefined };
      }
      return { isDuplicate: false };
    } catch (err) {
      console.error("[OrderIdempotency] Redis claim error:", err.message);
    }
  }

  const now = Date.now();
  const entry = memoryCache.get(orderKey);
  if (entry && now - entry.createdAt < IDEMPOTENCY_TTL_SECONDS * 1000) {
    return { isDuplicate: true, orderId: entry.orderId };
  }

  memoryCache.set(orderKey, { orderId: orderId || "pending", createdAt: now });
  if (memoryCache.size > MEMORY_MAX) {
    const oldest = memoryCache.keys().next().value;
    memoryCache.delete(oldest);
  }
  return { isDuplicate: false };
}

async function markOrderCreated(orderKey, orderId) {
  if (!orderKey || !orderId) return;

  const key = `order:idemp:${orderKey}`;

  if (await ensureConnected()) {
    try {
      const ttl = await redis.ttl(key);
      if (ttl > 0) {
        await redis.setex(key, ttl, orderId);
      } else {
        await redis.setex(key, IDEMPOTENCY_TTL_SECONDS, orderId);
      }
      return;
    } catch (err) {
      console.error("[OrderIdempotency] Redis mark error:", err.message);
    }
  }

  const entry = memoryCache.get(orderKey);
  if (entry) {
    entry.orderId = orderId;
  } else {
    memoryCache.set(orderKey, { orderId, createdAt: Date.now() });
  }
}

/**
 * Find a recent duplicate order for the same uid (+ optional tenant).
 * @param {object} OrderModel
 * @param {string} uid
 * @param {number} totalAmount
 * @param {object|number} [optionsOrWindow] - { tenant_id, windowMs } or legacy windowMs number
 */
async function findRecentDuplicateOrder(OrderModel, uid, totalAmount, optionsOrWindow = {}) {
  if (!OrderModel || !uid) return null;

  let windowMs = 120000;
  let tenant_id = null;
  if (typeof optionsOrWindow === "number") {
    windowMs = optionsOrWindow;
  } else if (optionsOrWindow && typeof optionsOrWindow === "object") {
    if (optionsOrWindow.windowMs) windowMs = optionsOrWindow.windowMs;
    if (optionsOrWindow.tenant_id) tenant_id = optionsOrWindow.tenant_id;
  }

  try {
    const since = new Date(Date.now() - windowMs);
    const filter = {
      uid,
      totalAmount,
      createdAt: { $gte: since },
    };
    // Explicit tenant filter when available (Model may also scope via ALS)
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

module.exports = {
  buildOrderKey,
  claimOrderKey,
  markOrderCreated,
  findRecentDuplicateOrder,
  IDEMPOTENCY_TTL_SECONDS,
};
