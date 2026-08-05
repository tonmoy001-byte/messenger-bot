const { test } = require("node:test");
const assert = require("node:assert");
const logger = require("../utils/logger");

test("logger exposes standard levels", () => {
  assert.strictEqual(typeof logger.info, "function");
  assert.strictEqual(typeof logger.error, "function");
  assert.strictEqual(typeof logger.warn, "function");
  assert.strictEqual(typeof logger.debug, "function");
});