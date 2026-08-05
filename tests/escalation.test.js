// tests/escalation.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { shouldEscalate } = require("../utils/escalation");

test("shouldEscalate true when user asks for human agent", () => {
  assert.strictEqual(shouldEscalate("Can I talk to a human agent?"), true);
});

test("shouldEscalate false for normal question", () => {
  assert.strictEqual(shouldEscalate("What is the price of the phone?"), false);
});
