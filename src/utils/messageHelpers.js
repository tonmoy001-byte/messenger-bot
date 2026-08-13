/**
 * src/utils/messageHelpers.js
 * Shared message persistence helpers (chat + channel handlers).
 */
const { User, Message } = require("../config/db");

async function upsertUser(uid, platform, name = null, profilePic = null) {
  await User.findOneAndUpdate(
    { uid },
    { $set: { platform, name: name || null, profilePic: profilePic || null, lastSeen: new Date() } },
    { upsert: true, new: true }
  );
}

async function saveMessage(uid, role, content, mediaUrl = null, platform = "messenger") {
  await Message.save({ uid, role, content, mediaUrl, platform, timestamp: new Date() });
}

module.exports = { upsertUser, saveMessage };