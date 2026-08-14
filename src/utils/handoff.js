/**
 * Human handoff state helpers.
 *
 * Handoff is stored on the tenant-scoped User metadata record so it follows
 * the customer conversation across Messenger and WhatsApp.
 */

const HANDOFF_STATUS = Object.freeze({
  AI_ACTIVE: "ai_active",
  HUMAN_REQUESTED: "human_requested",
  HUMAN_ACTIVE: "human_active",
});

const PAUSED_STATUSES = new Set([
  HANDOFF_STATUS.HUMAN_REQUESTED,
  HANDOFF_STATUS.HUMAN_ACTIVE,
  // Backwards compatibility with the status used before this state machine.
  "human_assigned",
]);

function getHandoffStatus(user) {
  return user?.metadata?.handoffStatus || HANDOFF_STATUS.AI_ACTIVE;
}

function isAiPaused(user) {
  return PAUSED_STATUSES.has(getHandoffStatus(user));
}

module.exports = {
  HANDOFF_STATUS,
  getHandoffStatus,
  isAiPaused,
};
