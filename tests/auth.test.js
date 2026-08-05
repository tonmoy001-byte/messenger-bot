const { test } = require("node:test");
const assert = require("node:assert");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "cyberbot-admin-secret-key-change-in-production";
const { signRefreshToken, verifyRefreshToken } = require("../utils/refreshToken");

test("signRefreshToken then verifyRefreshToken round-trips admin id", () => {
  const refresh = signRefreshToken({ id: "42", username: "boss" }, JWT_SECRET);
  const decoded = verifyRefreshToken(refresh, JWT_SECRET);
  assert.strictEqual(decoded.id, "42");
});

test("verifyRefreshToken returns null on tampered token", () => {
  const refresh = signRefreshToken({ id: "42", username: "boss" }, JWT_SECRET);
  const tampered = refresh.slice(0, -4) + "AAAA";
  const result = verifyRefreshToken(tampered, JWT_SECRET);
  assert.strictEqual(result, null);
});