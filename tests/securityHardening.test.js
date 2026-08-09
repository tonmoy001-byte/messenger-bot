/**
 * tests/securityHardening.test.js
 * ─────────────────────────────────────────────────────────────
 * Security Validation & Hardening Test Suite.
 * Verified with node:test.
 * ─────────────────────────────────────────────────────────────
 */

const { test } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const { verifyMetaSignature } = require("../src/utils/security");
const { requireEnv } = require("../src/config/env");

test("requireEnv throws error on missing environment variables", () => {
  assert.throws(() => {
    requireEnv("NON_EXISTENT_VAR_FOR_TESTS");
  }, /Missing required env/);
});

test("requireEnv throws error on insecure forbidden values", () => {
  process.env.FORBIDDEN_TEST_VAR = "insecure-value-123";
  assert.throws(() => {
    requireEnv("FORBIDDEN_TEST_VAR", { forbid: ["insecure-value-123"] });
  }, /Security Exception/);
  delete process.env.FORBIDDEN_TEST_VAR;
});

test("requireEnv throws error if value is too short", () => {
  process.env.SHORT_TEST_VAR = "short";
  assert.throws(() => {
    requireEnv("SHORT_TEST_VAR", { minLength: 10 });
  }, /is too short/);
  delete process.env.SHORT_TEST_VAR;
});

test("verifyMetaSignature returns true for valid signatures", () => {
  const secret = "my_little_secret";
  const payload = JSON.stringify({ object: "page", entry: [] });
  const signature = "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");

  const isValid = verifyMetaSignature(payload, signature, secret);
  assert.strictEqual(isValid, true);
});

test("verifyMetaSignature returns false for tampered payload or secret", () => {
  const secret = "my_little_secret";
  const payload = JSON.stringify({ object: "page", entry: [] });
  const signature = "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");

  const isInvalidPayload = verifyMetaSignature(payload + "tampered", signature, secret);
  const isInvalidSecret = verifyMetaSignature(payload, signature, "wrong_secret");

  assert.strictEqual(isInvalidPayload, false);
  assert.strictEqual(isInvalidSecret, false);
});
