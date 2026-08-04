/**
 * utils/messagingWindow.js
 * ─────────────────────────────────────────────────────────────
 * 24-hour messaging window enforcement for WhatsApp.
 * Also handles Message Tags for non-promotional messaging.
 * ─────────────────────────────────────────────────────────────
 */

const { Message, Settings } = require("../db");
const { sendWhatsAppMessage } = require("../whatsapp");

/**
 * Check if a conversation is within the 24-hour customer-initiated window.
 * @param {string} uid - Customer ID (phone for WhatsApp, PSID for Messenger)
 * @param {string} platform - whatsapp | messenger | instagram
 * @returns {Promise<boolean>}
 */
async function isWithinMessagingWindow(uid, platform = "whatsapp") {
  try {
    const lastUserMessage = await Message.findOne({ uid, role: "user" })
      .sort({ createdAt: -1 });

    if (!lastUserMessage) return false;

    const ts = lastUserMessage.createdAt || lastUserMessage.timestamp;
    const lastTime = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
    if (isNaN(lastTime)) return false;
    const hoursSince = (Date.now() - lastTime) / (1000 * 60 * 60);
    return hoursSince < 24;
  } catch (err) {
    console.error(" [MessagingWindow] Check error:", err.message);
    return false;
  }
}

/**
 * Attempt to send via a WhatsApp Message Tag when outside 24h window.
 * Message Tags allow sending one non-promotional message outside the window.
 * @param {string} recipientId - Recipient phone number
 * @param {string} platform - whatsapp
 * @param {string} text - Message to send
 * @returns {Promise<boolean>} - true if sent successfully via tag
 */
async function sendViaTagIfExpired(recipientId, platform, text) {
  if (platform !== "whatsapp") return false;

  try {
    const { getWhatsAppToken: getWhatsAppTokenFromManager } = require("./tokenManager");
    const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const token = await getWhatsAppTokenFromManager();

    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
    const data = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipientId,
      type: "text",
      text: { body: text },
      // Using "UTILITY" tag for non-promotional service messages
      // Categories: ACCOUNT_UPDATE, PAYMENT_UPDATE, PERSONALFinance_UPDATE,
      //             SHIPPING_UPDATE, RESERVATION_UPDATE, ISSUE_RESOLUTION,
      //             APPOINTMENT_UPDATE, GAME_EVENT, TRANSPORTATION_UPDATE,
      //             TICKET_UPDATE, ALERT_UPDATE
      category: "UTILITY",
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    if (response.ok) {
      console.log(` [MessagingWindow] Sent via Utility tag to ${recipientId}`);
      return true;
    }

    const errData = await response.json();
    console.error(` [MessagingWindow] Tag send failed:`, errData);
    return false;
  } catch (err) {
    console.error(` [MessagingWindow] Tag send error:`, err.message);
    return false;
  }
}

module.exports = { isWithinMessagingWindow, sendViaTagIfExpired };
