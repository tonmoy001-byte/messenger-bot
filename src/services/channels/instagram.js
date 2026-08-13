/**
 * instagram.js
 * ─────────────────────────────────────────────────────────────
 * Instagram Direct Messages API helper for Cyberbot.
 * Uses the same Graph API as Messenger but with Instagram-specific endpoints.
 * ────────────────────────────────────────────────────────────
 */

const axios = require("axios");
const { getInstagramToken } = require("../../../utils/tokenManager");

const INSTAGRAM_API_BASE = "https://graph.facebook.com/v19.0";

/**
 * Send a text message via Instagram Direct.
 */
async function sendInstagramMessage(recipientId, message, pageId) {
  try {
    const token = await getInstagramToken(pageId);
    if (!token) {
      console.error("❌ [Instagram] No token available");
      return false;
    }

    // Instagram uses the same send API as Messenger
    const url = `${INSTAGRAM_API_BASE}/me/messages?access_token=${token}`;
    
    // Chunk long messages
    const chunks = chunkMessage(message);
    
    for (const chunk of chunks) {
      await axios.post(url, {
        recipient: { id: recipientId },
        message: { text: chunk }
      });
      if (chunks.length > 1) await new Promise(r => setTimeout(r, 500));
    }
    
    return true;
  } catch (err) {
    console.error("❌ [Instagram Send Error]:", err.response?.data || err.message);
    return false;
  }
}

/**
 * Show typing indicator on Instagram.
 */
async function sendInstagramTyping(recipientId, pageId) {
  try {
    const token = await getInstagramToken(pageId);
    if (!token) return false;

    const url = `${INSTAGRAM_API_BASE}/me/messages?access_token=${token}`;
    await axios.post(url, {
      recipient: { id: recipientId },
      sender_action: "typing_on"
    });
    return true;
  } catch (err) {
    console.error("❌ [Instagram Typing Error]:", err.message);
    return false;
  }
}

/**
 * Download image from Instagram message attachment.
 */
async function downloadInstagramMedia(imageUrl) {
  try {
    const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
    const base64 = Buffer.from(response.data).toString("base64");
    const mimeType = response.headers["content-type"] || "image/jpeg";
    return {
      base64,
      mimeType
    };
  } catch (err) {
    console.error("❌ [Instagram Media Download Error]:", err.message);
    return null;
  }
}

/**
 * Get Instagram user profile (limited data available).
 */
async function getInstagramUserProfile(userId, pageId) {
  try {
    const token = await getInstagramToken(pageId);
    if (!token) return null;

    const url = `${INSTAGRAM_API_BASE}/${userId}?fields=id,name,profile_pic&access_token=${token}`;
    const response = await axios.get(url);
    return response.data;
  } catch (err) {
    console.error("❌ [Instagram Profile Error]:", err.response?.data || err.message);
    return null;
  }
}

/**
 * Split message into chunks respecting sentence boundaries.
 */
function chunkMessage(text, maxLen = 1900) {
  if (text.length <= maxLen) return [text];
  
  const chunks = [];
  let remaining = text;
  
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      if (remaining.length > 0) chunks.push(remaining);
      break;
    }
    
    let splitIndex = remaining.lastIndexOf(".", maxLen);
    if (splitIndex === -1 || splitIndex < maxLen / 2) {
      splitIndex = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitIndex === -1) splitIndex = maxLen;
    
    chunks.push(remaining.substring(0, splitIndex + 1).trim());
    remaining = remaining.substring(splitIndex + 1).trim();
  }
  
  return chunks;
}

module.exports = {
  sendInstagramMessage,
  sendInstagramTyping,
  downloadInstagramMedia,
  getInstagramUserProfile
};
