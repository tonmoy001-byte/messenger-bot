// tests/rbac.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "cyberbot-admin-secret-key-change-in-production";
const { makeRequireRole } = require("../utils/rbac");

function mockRes() {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  return res;
}

test("requireRole('admin') allows admin token", () => {
  const requireRole = makeRequireRole("admin");
  const token = jwt.sign({ id: "1", username: "boss", role: "admin" }, JWT_SECRET);
  const req = { admin: jwt.verify(token, JWT_SECRET) };
  let nextCalled = false;
  const res = mockRes();
  requireRole(req, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true);
});

test("requireRole('admin') rejects agent token with 403", () => {
  const requireRole = makeRequireRole("admin");
  const token = jwt.sign({ id: "2", username: "agent1", role: "agent" }, JWT_SECRET);
  const req = { admin: jwt.verify(token, JWT_SECRET) };
  const res = mockRes();
  requireRole(req, res, () => {});
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.error, "Insufficient permissions");
});