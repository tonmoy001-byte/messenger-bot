/**
 * utils/dedup.js
 * ─────────────────────────────────────────────────────────────
 * Message deduplication using Redis (with in-memory fallback).
 * Prevents processing duplicate webhook deliveries from Meta.
 * 
 * Two-layer dedup:
 * 1. Message ID (mid) — catches exact same webhook re-delivery
 * 2. Content-based — catches same message with different mids (Meta quirk)
 *    Uses sender+content+timeWindow to detect duplicates
 * ─────────────────────────────────────────────────────────────
 */

const Redis = require("ioredis");
const crypto = require("crypto");

let redis = null;
let redisAvailable = false;
const memoryCache = new Map(); // In-memory fallback for mid-based dedup
const contentCache = new Map(); // In-memory fallback for content-based dedup
const MEMORY_MAX = 10000;

const DEDUP_TTL_SECONDS = 86400; // 24 hours
const CONTENT_DEDUP_WINDOW_MS = 3000; // 3 second window for content dedup

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
    if (err.message?.includes("version")) {
      if (redisAvailable !== false) {
        console.warn(" [Dedup] Redis version too old (need 5.0+), using in-memory fallback");
        redisAvailable = false;
      }
    } else if (err.code !== "ECONNREFUSED") {
      console.error(" [Dedup] Redis error:", err.message);
    }
  });

  redis.on("connect", () => { redisAvailable = true; });
} catch (e) {
  console.warn(" [Dedup] Redis init failed, using in-memory fallback");
}

async function ensureConnected() {
  if (!redis) return false;
  if (redis.status === "wait") {
    try { await redis.connect(); } catch { return false; }
  }
  return redisAvailable;
}

/**
 * Check if a message ID has already been processed.
 * @param {string} mid - Message ID from the webhook event
 * @returns {Promise<boolean>} - true if already processed (duplicate)
 */
async function isDuplicate(mid) {
  if (!mid) return false;

  // Try Redis first
  if (await ensureConnected()) {
    try {
      const key = `dedup:${mid}`;
      const exists = await redis.exists(key);
      return exists === 1;
    } catch (err) {
      console.error(" [Dedup] Redis check error:", err.message);
    }
  }

  // In-memory fallback
  const entry = memoryCache.get(mid);
  if (entry && Date.now() - entry < DEDUP_TTL_SECONDS * 1000) {
    return true;
  }
  return false;
}

/**
 * Mark a message ID as processed.
 * @param {string} mid - Message ID from the webhook event
 * @returns {Promise<void>}
 */
async function markProcessed(mid) {
  if (!mid) return;

  // Try Redis first
  if (await ensureConnected()) {
    try {
      const key = `dedup:${mid}`;
      await redis.setex(key, DEDUP_TTL_SECONDS, "1");
      return;
    } catch (err) {
      console.error(" [Dedup] Redis mark error:", err.message);
    }
  }

  // In-memory fallback
  memoryCache.set(mid, Date.now());
  // Evict oldest if over limit
  if (memoryCache.size > MEMORY_MAX) {
    const oldest = memoryCache.keys().next().value;
    memoryCache.delete(oldest);
  }
}

/**
 * Atomic dedup check using Redis SET NX.
 * Prevents race condition where two identical webhooks both pass check-then-act.
 * Uses Redis SET NX (set-if-not-exists) for atomic check+mark in one operation.
 * @param {string} mid - Message ID from the webhook event
 * @param {string} senderId - User's PSID/phone
 * @param {string} text - Message text
 * @returns {Promise<boolean>} - true if duplicate (should skip)
 */
async function atomicDedupCheck(mid, senderId, text) {
  // Try Redis first (atomic SET NX)
  if (await ensureConnected()) {
    try {
      // Layer 1: mid-based
      if (mid) {
        const midKey = `dedup:${mid}`;
        const midFirst = await redis.set(midKey, "1", "EX", DEDUP_TTL_SECONDS, "NX");
        if (!midFirst) return true; // Already exists = duplicate
      }

      // Layer 2: content-based (catches same message with different mids)
      if (senderId && text) {
        const contentKey = getContentKey(senderId, text);
        const cKey = `content:${contentKey}`;
        const cFirst = await redis.set(cKey, "1", "EX", 5, "NX");
        if (!cFirst) return true;
      }

      return false; // Not a duplicate
    } catch (err) {
      console.error(" [Dedup] Redis atomic check error:", err.message);
      // Fall through to in-memory check
    }
  }

  // In-memory fallback (non-atomic but best-effort)
  if (mid) {
    const entry = memoryCache.get(mid);
    if (entry && Date.now() - entry < DEDUP_TTL_SECONDS * 1000) return true;
    memoryCache.set(mid, Date.now());
  }
  if (senderId && text) {
    const key = getContentKey(senderId, text);
    const entry = contentCache.get(key);
    if (entry && Date.now() - entry < CONTENT_DEDUP_WINDOW_MS) return true;
    contentCache.set(key, Date.now());
  }
  return false;
}

/**
 * Generate a content-based dedup key.
 * Rounds time to nearest CONTENT_DEDUP_WINDOW_MS to catch rapid duplicates.
 */
function getContentKey(senderId, text) {
  const timeWindow = Math.floor(Date.now() / CONTENT_DEDUP_WINDOW_MS);
  const hash = crypto.createHash("md5")
    .update(`${senderId}:${text}:${timeWindow}`)
    .digest("hex");
  return `dedup:content:${hash}`;
}

/**
 * Check if a message with same sender+content was recently processed.
 * Catches Meta sending duplicate webhooks with different mids.
 * @param {string} senderId - User's PSID/phone
 * @param {string} text - Message text
 * @returns {Promise<boolean>} - true if duplicate
 */
async function isContentDuplicate(senderId, text) {
  if (!senderId || !text) return false;
  const key = getContentKey(senderId, text);

  // Try Redis first
  if (await ensureConnected()) {
    try {
      const exists = await redis.exists(key);
      return exists === 1;
    } catch (err) {
      console.error(" [Dedup] Redis content check error:", err.message);
    }
  }

  // In-memory fallback
  const entry = contentCache.get(key);
  if (entry && Date.now() - entry < CONTENT_DEDUP_WINDOW_MS) {
    return true;
  }
  return false;
}

/**
 * Mark a message's content as recently processed.
 * @param {string} senderId - User's PSID/phone
 * @param {string} text - Message text
 * @returns {Promise<void>}
 */
async function markContentProcessed(senderId, text) {
  if (!senderId || !text) return;
  const key = getContentKey(senderId, text);

  // Try Redis first
  if (await ensureConnected()) {
    try {
      await redis.setex(key, Math.ceil(CONTENT_DEDUP_WINDOW_MS / 1000), "1");
      return;
    } catch (err) {
      console.error(" [Dedup] Redis content mark error:", err.message);
    }
  }

  // In-memory fallback
  contentCache.set(key, Date.now());
  // Evict old entries periodically
  if (contentCache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of contentCache) {
      if (now - v > CONTENT_DEDUP_WINDOW_MS) contentCache.delete(k);
    }
  }
}

/**
 * Get dedup stats for monitoring.
 */
async function getDedupStats() {
  if (await ensureConnected()) {
    try {
      const keys = await redis.keys("dedup:*");
      return { totalKeys: keys.length, backend: "redis" };
    } catch (err) {
      return { totalKeys: 0, backend: "redis", error: err.message };
    }
  }
  return { midCacheSize: memoryCache.size, contentCacheSize: contentCache.size, backend: "memory" };
}

async function closeRedis() {
  if (redis) await redis.quit().catch(() => {});
}

module.exports = {
  isDuplicate,
  markProcessed,
  isContentDuplicate,
  markContentProcessed,
  atomicDedupCheck,
  getContentKey,
  getDedupStats,
  closeRedis,
  redis,
};
