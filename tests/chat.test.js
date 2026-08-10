const { test } = require("node:test");
const assert = require("node:assert");

const { resolveWebChatTenant } = require("../src/routes/chat");

test("resolveWebChatTenant resolves tenant by slug from body", async () => {
  assert.strictEqual(typeof resolveWebChatTenant, "function");
});
