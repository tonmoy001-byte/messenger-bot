/**
 * messenger.js
 * ─────────────────────────────────────────────────────────────
 * Facebook Messenger Send API helper functions.
 * Handles typing indicators and sending text messages.
 * Includes retry wrapper for rate-limited API calls.
 * ─────────────────────────────────────────────────────────────
 */

require("dotenv").config();
const axios = require("axios");
const { getMessengerToken } = require("./utils/tokenManager");
const { withRetry } = require("./utils/retry");

const MESSENGER_API = "https://graph.facebook.com/v19.0/me/messages";

/**
 * Send a typing "bubble" to show the bot is "thinking".
 * @param {string} recipientId - The Facebook user's PSID
 */
async function sendTyping(recipientId, pageId = null) {
  try {
    const token = await getMessengerToken(pageId);
    await withRetry(() => axios.post(
      MESSENGER_API,
      { recipient: { id: recipientId }, sender_action: "typing_on" },
      { params: { access_token: token } }
    ), "Messenger Typing");
  } catch (error) {
    console.error("⚠️  Typing indicator error:", error.message);
  }
}

/**
 * Send a text message to a user via Messenger.
 * @param {string} recipientId - The Facebook user's PSID
 * @param {string} text - The message text to send
 */
async function sendMessage(recipientId, text, pageId = null) {
  try {
    const token = await getMessengerToken(pageId);
    const chunks = splitMessage(text, 1900);

    for (const chunk of chunks) {
      await withRetry(() => axios.post(
        MESSENGER_API,
        {
          recipient: { id: recipientId },
          message: { text: chunk },
          messaging_type: "RESPONSE",
        },
        { params: { access_token: token } }
      ), "Messenger Send");
      if (chunks.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
    console.log(`✅ Message sent to ${recipientId}`);
  } catch (error) {
    console.error(
      "❌ Send message error:",
      error.response?.data || error.message
    );
  }
}

/**
 * Split a long message into chunks at sentence boundaries.
 * @param {string} text
 * @param {number} maxLength
 * @returns {string[]}
 */
function splitMessage(text, maxLength) {
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    // Try to split at sentence boundary
    let splitAt = remaining.lastIndexOf(". ", maxLength);
    if (splitAt === -1) splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt === -1) splitAt = maxLength;

    chunks.push(remaining.slice(0, splitAt + 1).trim());
    remaining = remaining.slice(splitAt + 1).trim();
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

/**
 * Download media from an external URL (e.g., Messenger attachment) and return as base64.
 * @param {string} url - The URL to download
 * @returns {Promise<{data: string, mimeType: string} | null>}
 */
async function downloadExternalMedia(url) {
  try {
    const response = await axios.get(url, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data, "binary");
    const base64Data = buffer.toString("base64");

    // Default to image/jpeg, try to guess from URL
    let mimeType = "image/jpeg";
    if (url.toLowerCase().includes(".png")) mimeType = "image/png";
    else if (url.toLowerCase().includes(".webp")) mimeType = "image/webp";
    else if (url.toLowerCase().includes(".gif")) mimeType = "image/gif";

    return {
      base64: base64Data,
      mimeType: mimeType,
    };
  } catch (error) {
    console.error("❌ Media Download Error:", error.message);
    return null;
  }
}

/**
 * Fetch a Messenger user's profile information.
 * Uses: https://graph.facebook.com/${senderId}?fields=first_name,last_name,profile_pic&access_token=${PAGE_ACCESS_TOKEN}
 * @param {string} senderId - The Facebook user's PSID (from event.sender.id)
 * @returns {Promise<Object|null>}
 */
async function getUserProfile(senderId, pageId = null) {
  try {
    const token = await getMessengerToken(pageId);
    if (!token) {
      console.error("❌ No access token for profile fetch");
      return null;
    }

    const url = `https://graph.facebook.com/${senderId}?fields=first_name,last_name,profile_pic&access_token=${token}`;
    const response = await axios.get(url);

    if (response.data && !response.data.error && (response.data.first_name || response.data.last_name)) {
      return response.data;
    }
    return null;
  } catch (error) {
    const errorMsg = error.response?.data?.error?.message || error.message;
    console.error("❌ Profile Fetch Error:", errorMsg);
    return null;
  }
}

module.exports = {
  sendTyping,
  sendMessage,
  downloadExternalMedia,
  getUserProfile,
};
