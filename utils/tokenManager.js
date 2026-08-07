/**
 * utils/tokenManager.js
 * ─────────────────────────────────────────────────────────────
 * Unified token management for Messenger, WhatsApp, and Instagram.
 * Handles multi-tier token lookup with caching and fallback.
 * ─────────────────────────────────────────────────────────────
 */

const { Settings, Integration, TenantChannel } = require("../db");
const { decrypt } = require("../security");
const channelCache = require("./channelCache");

/**
 * Resolve Access Token using Multi-Tier Lookup Order:
 * 1. tenant_channels table (lookup by platform & externalId, using channelCache)
 * 2. Fallback to integrations table
 * 3. Fallback to settings table
 * 4. Fallback to environment variables
 */
async function getAccessToken(platform, externalId = null) {
  try {
    if (externalId) {
      // Tier 1: tenant_channels table
      let channelInfo = channelCache.get(platform, externalId);
      if (!channelInfo) {
        const channel = await TenantChannel.findOne({ platform, externalId, deleted_at: null });
        if (channel) {
          channelInfo = {
            tenant_id: channel.tenant_id,
            verifyToken: channel.verifyToken,
            accessToken: channel.accessToken,
          };
          channelCache.set(platform, externalId, channelInfo);
        }
      }

      if (channelInfo && channelInfo.accessToken) {
        const token = decrypt(channelInfo.accessToken);
        if (token) {
          console.log(` [TokenManager] Using tenant_channels token for ${platform} (${externalId})`);
          return token;
        }
      }

      // Tier 2: integrations table
      const typeMap = { messenger: 'facebook', whatsapp: 'whatsapp', instagram: 'instagram' };
      const integration = await Integration.findOne({ externalId, type: typeMap[platform] || platform });
      if (integration && integration.accessToken) {
        // Skip revoked integrations
        if (integration.revokedAt) {
          console.warn(` [TokenManager] Skipping revoked integration token for ${platform} (${externalId})`);
        } else {
          const token = decrypt(integration.accessToken);
          if (token) {
            console.log(` [TokenManager] Using integration token for ${platform} (${externalId})`);
            return token;
          }
        }
      }
    }

    // Tier 3: settings table
    const settings = await Settings.findOne({ configId: "global" });
    if (settings) {
      const settingsKeyMap = { messenger: 'messengerApiKey', whatsapp: 'whatsappApiKey', instagram: 'instagramApiKey' };
      const settingsKey = settingsKeyMap[platform];
      if (settingsKey && settings[settingsKey]) {
        console.log(` [TokenManager] Using settings token for ${platform}`);
        return settings[settingsKey];
      }
    }

    // Tier 4: environment variables
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

/**
 * Handle token revocation when an API call returns error code 190.
 * Marks the integration as inactive and sets revokedAt timestamp.
 * @param {string} platform - messenger | whatsapp | instagram
 * @param {string} externalId - Page ID, WABA ID, etc.
 */
async function handleTokenRevocation(platform, externalId) {
  try {
    const typeMap = { messenger: 'facebook', whatsapp: 'whatsapp', instagram: 'instagram' };
    const integration = await Integration.findOne({
      externalId,
      type: typeMap[platform] || platform,
    });

    if (integration) {
      integration.revokedAt = new Date();
      integration.isActive = false;
      await integration.save();
      console.warn(` [TokenManager] REVOKED ${platform} token for ${externalId} — marking inactive`);
    }

    // Also check Settings
    const settings = await Settings.findOne({ configId: "global" });
    if (settings) {
      const fieldMap = { messenger: 'messengerRevoked', whatsapp: 'whatsappRevoked', instagram: 'instagramRevoked' };
      const field = fieldMap[platform];
      if (field) {
        settings[field] = true;
        settings[`${field}At`] = new Date();
        await settings.save();
        console.warn(` [TokenManager] REVOKED ${platform} token in Settings`);
      }
    }

    // Notify via webhook (if configured)
    const io = global.io;
    if (io) {
      io.emit("token_revoked", { platform, externalId, revokedAt: new Date() });
    }
  } catch (err) {
    console.error(` [TokenManager] Revocation error:`, err.message);
  }
}

async function getMessengerToken(pageId = null) { return getAccessToken('messenger', pageId); }
async function getWhatsAppToken(wabaId = null) { return getAccessToken('whatsapp', wabaId); }
async function getInstagramToken(pageId = null) { return getAccessToken('instagram', pageId); }

module.exports = {
  getAccessToken,
  getMessengerToken,
  getWhatsAppToken,
  getInstagramToken,
  handleTokenRevocation,
};
