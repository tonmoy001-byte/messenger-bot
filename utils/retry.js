/**
 * utils/retry.js
 * ─────────────────────────────────────────────────────────────
 * Exponential backoff retry wrapper for API calls.
 * 3 retries: 2s → 4s → 8s for HTTP 429 / Meta error 4 / 17.
 * ─────────────────────────────────────────────────────────────
 */

const RETRYABLE_STATUS_CODES = [429];
const RETRYABLE_META_ERROR_CODES = [4, 17]; // rate_limits, temporary_error
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

function isRetryable(error) {
  if (!error) return false;

  // HTTP 429
  if (error.response?.status === 429) return true;

  // HTTP 408 Request Timeout
  if (error.response?.status === 408) return true;

  // Meta Graph API error codes 4 (rate limits) and 17 (temporary error)
  const fbCode = error.response?.data?.error?.code;
  if (fbCode === 4 || fbCode === 17) return true;

  // Network errors - only ECONNRESET (server definitely didn't receive)
  // ETIMEDOUT removed: server likely received the request, retry would duplicate
  if (error.code === 'ECONNRESET') return true;
  if (error.message?.includes('ECONNRESET')) return true;

  return false;
}

function getRetryAfter(error) {
  // Respect Retry-After header from 429 responses
  const retryAfter = error.response?.headers?.['retry-after'];
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, 30000); // Cap at 30s
    }
  }
  return null;
}

/**
 * Retry an async function with exponential backoff.
 * @param {Function} fn - Async function to retry
 * @param {string} label - Label for logging
 * @param {object} options - { maxRetries, baseDelay }
 * @returns {Promise<*>} - Result of fn
 */
async function withRetry(fn, label = "API", options = {}) {
  const { maxRetries = MAX_RETRIES, baseDelay = BASE_DELAY_MS } = options;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt === maxRetries || !isRetryable(err)) {
        throw err;
      }

      // Check for Retry-After header first
      const retryAfterMs = getRetryAfter(err);
      const delay = retryAfterMs || baseDelay * Math.pow(2, attempt);

      console.log(
        ` [${label}] Retryable error (attempt ${attempt + 1}/${maxRetries + 1}): ` +
        `${err.message} — waiting ${delay}ms`
      );

      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}

module.exports = { withRetry, isRetryable, MAX_RETRIES, BASE_DELAY_MS };
