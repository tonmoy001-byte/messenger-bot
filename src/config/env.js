/**
 * src/config/env.js
 * ─────────────────────────────────────────────────────────────
 * Environment variable validation and fail-hard logic.
 * ─────────────────────────────────────────────────────────────
 */

require("dotenv").config();

// Detect test runner environment
const isTest = process.env.NODE_ENV === "test" ||
               (process.argv && process.argv.some(arg => arg.includes("test"))) ||
               (require.main && require.main.filename && require.main.filename.includes("test"));

if (isTest) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === "cyberbot-admin-secret-key-change-in-production") {
    process.env.JWT_SECRET = "test-jwt-secret-key-32-characters";
  }
  if (!process.env.TOKEN_ENCRYPTION_KEY || process.env.TOKEN_ENCRYPTION_KEY === "temporary-key-do-not-use-in-production-123" || process.env.TOKEN_ENCRYPTION_KEY === "your_32_char_encryption_key_here") {
    process.env.TOKEN_ENCRYPTION_KEY = "test-encryption-key-32-characters-long";
  }
  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = "https://placeholder.supabase.co";
  }
  if (!process.env.SUPABASE_ANON_KEY) {
    process.env.SUPABASE_ANON_KEY = "placeholder";
  }
}

function requireEnv(name, { minLength = 1, forbid = [] } = {}) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Missing required env: ${name}`);
  }
  const value = v.trim();
  if (forbid.includes(value)) {
    throw new Error(`Security Exception: ${name} is still using the insecure default value`);
  }
  if (value.length < minLength) {
    throw new Error(`Security Exception: ${name} is too short (min length ${minLength})`);
  }
  return value;
}

function validateEnv() {
  // Always require these
  requireEnv("JWT_SECRET", {
    minLength: 16,
    forbid: ["cyberbot-admin-secret-key-change-in-production", "your_jwt_secret_key"]
  });

  requireEnv("TOKEN_ENCRYPTION_KEY", {
    minLength: 32,
    forbid: ["temporary-key-do-not-use-in-production-123", "your_32_char_encryption_key_here"]
  });

  // Database must be set
  requireEnv("SUPABASE_URL", { forbid: ["your_project_url"] });
  requireEnv("SUPABASE_ANON_KEY", { forbid: ["your_anon_key"] });

  // If in production, strictly enforce additional variables
  if (process.env.NODE_ENV === "production") {
    requireEnv("FB_APP_SECRET", { forbid: ["your_facebook_app_secret"] });
    requireEnv("VERIFY_TOKEN", { forbid: ["your_verify_token", "my_secret_verify_token_123"] });
  }
}

module.exports = {
  requireEnv,
  validateEnv,
  isTest
};
