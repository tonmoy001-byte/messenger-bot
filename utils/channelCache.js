/**
 * utils/channelCache.js
 * ─────────────────────────────────────────────────────────────
 * Lightweight, in-memory TTL lookup cache for channel-to-tenant mapping.
 * Bypasses database queries during incoming webhook packet processing.
 * ─────────────────────────────────────────────────────────────
 */

const cache = new Map();
const TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

/**
 * Generate a cache key.
 * @param {string} platform
 * @param {string} externalId
 * @returns {string}
 */
function makeKey(platform, externalId) {
  return `${platform}:${externalId}`;
}

/**
 * Get an item from the cache.
 * @param {string} platform
 * @param {string} externalId
 * @returns {Object|null}
 */
function get(platform, externalId) {
  const key = makeKey(platform, externalId);
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  return entry.data;
}

/**
 * Store an item in the cache with 5-minute expiry.
 * @param {string} platform
 * @param {string} externalId
 * @param {Object} data
 */
function set(platform, externalId, data) {
  const key = makeKey(platform, externalId);
  cache.set(key, {
    data,
    expiresAt: Date.now() + TTL,
  });
}

/**
 * Explicitly clear an item from the cache.
 * @param {string} platform
 * @param {string} externalId
 */
function invalidate(platform, externalId) {
  const key = makeKey(platform, externalId);
  cache.delete(key);
}

module.exports = {
  get,
  set,
  invalidate,
};
