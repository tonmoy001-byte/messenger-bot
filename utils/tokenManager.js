/**
 * utils/tokenManager.js
 * ─────────────────────────────────────────────────────────────
 * Unified token management for Messenger, WhatsApp, and Instagram.
 * Handles token retrieval from Integration, Settings, or Environment.
 * ─────────────────────────────────────────────────────────────
 */

const { Settings, Integration } = require("../db");
const { decrypt } = require("../security");

async function getAccessToken(platform, externalId = null) {
  try {
    if (externalId) {
      const typeMap = { messenger: 'facebook', whatsapp: 'whatsapp', instagram: 'instagram' };
      const integration = await Integration.findOne({ externalId, type: typeMap[platform] || platform });
      if (integration && integration.accessToken) {
        const token = decrypt(integration.accessToken);
        if (token) {
          console.log(` [TokenManager] Using integration token for ${platform}`);
          return token;
        }
      }
    }

    const settings = await Settings.findOne({ configId: "global" });
    if (settings) {
      const settingsKeyMap = { messenger: 'messengerApiKey', whatsapp: 'whatsappApiKey', instagram: 'instagramApiKey' };
      const settingsKey = settingsKeyMap[platform];
      if (settingsKey && settings[settingsKey]) {
        console.log(` [TokenManager] Using settings token for ${platform}`);
        return settings[settingsKey];
      }
    }

    const envKeyMap = { messenger: 'PAGE_ACCESS_TOKEN', whatsapp: 'WHATSAPP_TOKEN', instagram: 'INSTAGRAM_TOKEN' };
    const envKey = envKeyMap[platform];
    const envToken = process.env[envKey];
    if (envToken) {
      console.log(` [TokenManager] Using env token for ${platform}`);
      return envToken;
    }

    console.warn(` [TokenManager] No token found for ${platform}`);
    return null;
  } catch (err) {
    console.error(` [TokenManager] Error fetching ${platform} token:`, err.message);
    return null;
  }
}

async function getMessengerToken(pageId = null) { return getAccessToken('messenger', pageId); }
async function getWhatsAppToken(wabaId = null) { return getAccessToken('whatsapp', wabaId); }
async function getInstagramToken(pageId = null) { return getAccessToken('instagram', pageId); }

module.exports = { getAccessToken, getMessengerToken, getWhatsAppToken, getInstagramToken };
