const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  HANDOFF_STATUS,
  getHandoffStatus,
  isAiPaused,
  resolveTenantId,
  getHandoffState,
} = require("../src/utils/handoff");
const { runWithTenantContext } = require("../utils/tenantContext");

test("new customers are AI active by default", () => {
  assert.equal(getHandoffStatus({}), HANDOFF_STATUS.AI_ACTIVE);
  assert.equal(isAiPaused({}), false);
});

test("human-requested conversations pause AI", () => {
  const user = { metadata: { handoffStatus: HANDOFF_STATUS.HUMAN_REQUESTED } };
  assert.equal(getHandoffStatus(user), HANDOFF_STATUS.HUMAN_REQUESTED);
  assert.equal(isAiPaused(user), true);
});

test("staff-active conversations pause AI", () => {
  const user = { metadata: { handoffStatus: HANDOFF_STATUS.HUMAN_ACTIVE } };
  assert.equal(isAiPaused(user), true);
});

test("legacy human_assigned status remains paused", () => {
  const user = { metadata: { handoffStatus: "human_assigned" } };
  assert.equal(isAiPaused(user), true);
});

test("resume state enables AI again", () => {
  const user = { metadata: { handoffStatus: HANDOFF_STATUS.AI_ACTIVE } };
  assert.equal(isAiPaused(user), false);
});

test("tenant context takes precedence over a supplied tenant ID", () => {
  runWithTenantContext({ tenant_id: "tenant-from-context" }, () => {
    assert.equal(resolveTenantId("tenant-from-request"), "tenant-from-context");
  });
});

test("handoff state fails closed without tenant context", async () => {
  await assert.rejects(
    () => getHandoffState({ customer_uid: "customer-1", platform: "messenger" }),
    /tenant_id is required/
  );
});
