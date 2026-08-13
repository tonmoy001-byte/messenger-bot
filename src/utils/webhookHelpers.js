/**
 * src/utils/webhookHelpers.js
 * Shared webhook verification + tenant-channel resolution (Messenger/WhatsApp/Instagram).
 */
const { Tenant, TenantChannel } = require("../config/db");
const channelCache = require("../../utils/channelCache");

async function verifyWebhookToken(req, platform, globalToken) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];

  if (mode !== "subscribe") return false;

  const tenantSlug = req.query.tenant;
  const reqPlatform = req.query.platform || platform;

  if (tenantSlug) {
    const tenant = await Tenant.findOne({ slug: tenantSlug });
    if (!tenant) return false;

    const channel = await TenantChannel.findOne({ tenant_id: tenant.id, platform: reqPlatform });
    if (!channel || channel.deleted_at) return false;

    return token === channel.verifyToken;
  }

  const fallbackToken = process.env.META_WEBHOOK_VERIFY_TOKEN || globalToken || process.env.VERIFY_TOKEN;
  return token === fallbackToken;
}

async function getTenantByChannel(platform, externalId) {
  const cached = channelCache.get(platform, externalId);
  if (cached) return cached;

  const channel = await TenantChannel.findOne({ platform, externalId, deleted_at: null });
  if (channel) {
    const data = {
      tenant_id: channel.tenant_id,
      verifyToken: channel.verifyToken,
      accessToken: channel.accessToken,
    };
    channelCache.set(platform, externalId, data);
    return data;
  }
  return null;
}

module.exports = { verifyWebhookToken, getTenantByChannel };