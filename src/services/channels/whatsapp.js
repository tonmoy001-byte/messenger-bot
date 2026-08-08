/**
 * whatsapp.js
 * ─────────────────────────────────────────────────────────────
 * WhatsApp Cloud API helper functions.
 * Handles sending text messages and other WhatsApp interactions.
 * Includes retry wrapper for rate-limited API calls.
 * ─────────────────────────────────────────────────────────────
 */

require("dotenv").config();
const axios = require("axios");
const { getWhatsAppToken: getWhatsAppTokenFromManager } = require("../../../utils/tokenManager");
const { withRetry } = require("../../../utils/retry");

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

// Wrapper for backward compatibility
async function getWhatsAppToken(wabaId = null) {
  return getWhatsAppTokenFromManager(wabaId);
}

/**
 * Send a text message via WhatsApp Cloud API.
 * @param {string} to - Recipient's phone number (with country code, no +)
 * @param {string} text - Message content
 */
async function sendWhatsAppMessage(to, text, wabaId = null) {
  try {
    const token = await getWhatsAppToken(wabaId);
    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
    const data = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "text",
      text: { body: text },
    };

    const response = await withRetry(() => axios.post(url, data, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }), "WhatsApp Send");

    return response.data;
  } catch (error) {
    console.error(
      "❌ WhatsApp Send Error:",
      error.response ? error.response.data : error.message
    );
    throw error;
  }
}

/**
 * Mark a message as read (optional but recommended for official API).
 * @param {string} messageId
 */
async function markWhatsAppAsRead(messageId, wabaId = null) {
  try {
    const token = await getWhatsAppToken(wabaId);
    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
    const data = {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    };

    await axios.post(url, data, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("❌ WhatsApp Read Status Error:", error.message);
  }
}

/**
 * Download media from WhatsApp (e.g., Image) and return as base64.
 * @param {string} mediaId - The media ID from WhatsApp webhook
 * @returns {Promise<{data: string, mimeType: string} | null>}
 */
async function downloadWhatsAppMedia(mediaId, wabaId = null) {
  try {
    const token = await getWhatsAppToken(wabaId);
    // 1. Get the media download URL from WhatsApp API
    const url = `https://graph.facebook.com/v19.0/${mediaId}`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const mediaUrl = response.data.url;
    const mimeType = response.data.mime_type;

    if (!mediaUrl) return null;

    // 2. Download the actual media bytes using the URL
    // Note: Use the same Authorization header for the download
    const mediaResponse = await axios.get(mediaUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      responseType: "arraybuffer",
    });

    const base64Data = Buffer.from(mediaResponse.data, "binary").toString("base64");

    return {
      base64: base64Data,
      mimeType: mimeType,
    };
  } catch (error) {
    console.error(
      "❌ WhatsApp Media Download Error:",
      error.response ? error.response.data : error.message
    );
    return null;
  }
}

/**
 * Check if we're within the 24-hour customer service window.
 * WhatsApp allows free-form messages only within 24 hours of the last customer message.
 * @param {string} uid - Customer ID
 * @returns {Promise<boolean>} - True if within 24-hour window
 */
async function isWithin24HourWindow(uid) {
  try {
    const { Message } = require("../../config/db");
    const lastCustomerMessage = await Message.findOne({ uid, role: "user" })
      .sort({ createdAt: -1 });
    
    if (!lastCustomerMessage) return false;
    
    const ts = lastCustomerMessage.createdAt || lastCustomerMessage.timestamp;
    const hoursSinceLastMessage = (Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60);
    return hoursSinceLastMessage < 24;
  } catch (err) {
    console.error(" [24h Window Check Error]:", err.message);
    return false;
  }
}

module.exports = {
  sendWhatsAppMessage,
  markWhatsAppAsRead,
  downloadWhatsAppMedia,
  isWithin24HourWindow,
};
