/**
 * utils/dataRetention.js
 * ─────────────────────────────────────────────────────────────
 * PII data privacy: auto-purge messages, expiry enforcement,
 * GDPR-compliant delete endpoint.
 * ─────────────────────────────────────────────────────────────
 */

const { Message } = require("../src/config/db");
const { supabase } = require("../src/config/supabaseClient");

const DEFAULT_RETENTION_DAYS = 30;

/**
 * Delete all messages older than the retention period.
 * Runs as a cron job (e.g., daily).
 */
async function purgeExpiredMessages(retentionDays = DEFAULT_RETENTION_DAYS) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    // Check Supabase directly for messages with expiresAt
    if (supabase) {
      const { data, error } = await supabase
        .from("messages")
        .delete()
        .lte("expiresAt", new Date().toISOString())
        .not("expiresAt", "is", null);

      if (error) {
        console.error(" [DataRetention] Supabase purge error:", error.message);
      } else {
        console.log(` [DataRetention] Purged expired messages from Supabase`);
      }
    }

    // Also clean up old messages (older than retention period)
    const result = await Message.deleteMany({
      createdAt: { $lt: cutoffDate },
      expiresAt: { $exists: false },
    });

    if (result?.deletedCount > 0) {
      console.log(` [DataRetention] Purged ${result.deletedCount} messages older than ${retentionDays} days`);
    }

    return { success: true };
  } catch (err) {
    console.error(" [DataRetention] Purge error:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Delete all messages for a specific user (GDPR right to erasure).
 * @param {string} uid - User ID
 * @returns {Promise<{deleted: number}>}
 */
async function deleteUserMessages(uid) {
  try {
    // Delete from Supabase
    if (supabase) {
      await supabase.from("messages").delete().eq("uid", uid);
    }

    // Delete from MongoDB
    const result = await Message.deleteMany({ uid });

    console.log(` [DataRetention] Deleted ${result?.deletedCount || 0} messages for user ${uid}`);
    return { deleted: result?.deletedCount || 0 };
  } catch (err) {
    console.error(` [DataRetention] Delete user messages error:`, err.message);
    return { deleted: 0, error: err.message };
  }
}

/**
 * Set expiry on messages for a user.
 * @param {string} uid - User ID
 * @param {number} days - Days from now until expiry
 */
async function setMessageExpiry(uid, days = DEFAULT_RETENTION_DAYS) {
  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    const result = await Message.updateMany(
      { uid, expiresAt: { $exists: false } },
      { $set: { expiresAt } }
    );

    console.log(` [DataRetention] Set ${result?.modifiedCount || 0} messages to expire in ${days} days for ${uid}`);
  } catch (err) {
    console.error(` [DataRetention] Set expiry error:`, err.message);
  }
}

/**
 * Start the auto-purge cron (runs daily at 3 AM).
 */
function startAutoPurgeCron() {
  const cron = require("node-cron");
  cron.schedule("0 3 * * *", async () => {
    console.log(" [DataRetention] Running daily purge...");
    await purgeExpiredMessages();
  });
  console.log(" [DataRetention] Auto-purge cron started (daily 3 AM)");
}

module.exports = {
  purgeExpiredMessages,
  deleteUserMessages,
  setMessageExpiry,
  startAutoPurgeCron,
  DEFAULT_RETENTION_DAYS,
};
