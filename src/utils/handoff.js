/**
 * Durable human handoff state and transition history.
 *
 * Current state is stored in conversation_handoffs. Every transition is also
 * appended to conversation_handoff_events for auditability and reminders.
 */

const { ConversationHandoff, ConversationHandoffEvent } = require("../config/db");
const { getTenantContext } = require("../../utils/tenantContext");

const HANDOFF_STATUS = Object.freeze({
  AI_ACTIVE: "ai_active",
  HUMAN_REQUESTED: "human_requested",
  HUMAN_ACTIVE: "human_active",
});

const PAUSED_STATUSES = new Set([
  HANDOFF_STATUS.HUMAN_REQUESTED,
  HANDOFF_STATUS.HUMAN_ACTIVE,
  // Backwards compatibility with the status used before the durable table.
  "human_assigned",
]);

function getHandoffStatus(value) {
  return value?.status || value?.metadata?.handoffStatus || HANDOFF_STATUS.AI_ACTIVE;
}

function isAiPaused(value) {
  return PAUSED_STATUSES.has(getHandoffStatus(value));
}

function resolveTenantId(tenant_id) {
  const context = getTenantContext();
  const resolved = context?.tenant_id || tenant_id;
  if (!resolved) throw new Error("tenant_id is required for handoff state");
  return String(resolved);
}

function requireConversationKey({ customer_uid, platform }) {
  if (!customer_uid || !platform) {
    throw new Error("customer_uid and platform are required for handoff state");
  }
}

async function getHandoffState({ tenant_id, customer_uid, platform, legacyUser = null }) {
  requireConversationKey({ customer_uid, platform });
  resolveTenantId(tenant_id);
  const row = await ConversationHandoff.findOne({ customer_uid, platform });
  if (row) return row;

  // Existing installations may still have the old metadata flag. Treat it as
  // paused until staff explicitly resumes AI, without losing compatibility.
  const legacyStatus = getHandoffStatus(legacyUser);
  if (PAUSED_STATUSES.has(legacyStatus)) {
    return {
      tenant_id: resolveTenantId(tenant_id),
      customer_uid,
      platform,
      status: legacyStatus,
      legacy: true,
    };
  }
  return null;
}

async function ensureHandoffState({ tenant_id, customer_uid, platform, customerMessageAt = new Date() }) {
  requireConversationKey({ customer_uid, platform });
  const tenantId = resolveTenantId(tenant_id);
  const existing = await ConversationHandoff.findOne({ customer_uid, platform });
  if (existing) {
    return ConversationHandoff.findOneAndUpdate(
      { customer_uid, platform },
      { $set: { last_customer_message_at: customerMessageAt, updated_at: new Date() } },
      { new: true }
    );
  }

  return ConversationHandoff.findOneAndUpdate(
    { customer_uid, platform },
    {
      $setOnInsert: {
        tenant_id: tenantId,
        customer_uid,
        platform,
        status: HANDOFF_STATUS.AI_ACTIVE,
        created_at: new Date(),
      },
      $set: {
        last_customer_message_at: customerMessageAt,
        updated_at: new Date(),
        last_transition_at: new Date(),
      },
    },
    { upsert: true, new: true }
  );
}

async function transitionHandoff({
  tenant_id,
  customer_uid,
  platform,
  status,
  actor_type = "system",
  actor_admin_id = null,
  reason = null,
  metadata = {},
}) {
  requireConversationKey({ customer_uid, platform });
  const tenantId = resolveTenantId(tenant_id);
  if (status === "human_assigned") status = HANDOFF_STATUS.HUMAN_ACTIVE;
  if (!Object.values(HANDOFF_STATUS).includes(status)) {
    throw new Error(`Invalid handoff status: ${status}`);
  }
  if (!["customer", "admin", "system"].includes(actor_type)) {
    throw new Error(`Invalid handoff actor_type: ${actor_type}`);
  }

  const previous = await ConversationHandoff.findOne({ customer_uid, platform });
  const now = new Date();
  const set = {
    tenant_id: tenantId,
    customer_uid,
    platform,
    status,
    reason,
    updated_at: now,
    last_transition_at: now,
  };

  if (status === HANDOFF_STATUS.HUMAN_REQUESTED) {
    set.requested_at = now;
    set.ai_paused_at = now;
  } else if (status === HANDOFF_STATUS.HUMAN_ACTIVE) {
    set.assigned_at = now;
    set.ai_paused_at = now;
    set.assigned_admin_id = actor_type === "admin" ? actor_admin_id : null;
  } else if (status === HANDOFF_STATUS.AI_ACTIVE) {
    set.resumed_at = now;
    set.assigned_admin_id = null;
  }

  const handoff = await ConversationHandoff.findOneAndUpdate(
    { customer_uid, platform },
    {
      $setOnInsert: {
        tenant_id: tenantId,
        customer_uid,
        platform,
        created_at: now,
      },
      $set: set,
    },
    { upsert: true, new: true }
  );

  await ConversationHandoffEvent.save({
    tenant_id: tenantId,
    handoff_id: handoff.id,
    customer_uid,
    platform,
    from_status: previous ? getHandoffStatus(previous) : null,
    to_status: status,
    actor_type,
    actor_admin_id: actor_type === "admin" ? actor_admin_id : null,
    reason,
    metadata,
    created_at: now,
  });

  return handoff;
}

module.exports = {
  HANDOFF_STATUS,
  getHandoffStatus,
  isAiPaused,
  resolveTenantId,
  getHandoffState,
  ensureHandoffState,
  transitionHandoff,
};
