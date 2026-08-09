/**
 * src/routes/chat.js
 * Public website chat widget — tenant-scoped.
 *
 * Tenant resolution (first match):
 *   body.tenant_id | body.tenantId | header X-Tenant-ID
 *   body.tenant | body.tenantSlug | body.slug | body.siteKey | headers X-Tenant-Slug / X-Site-Key | query.tenant
 *
 * Production: unresolved tenant → 400.
 * Non-production: optional DEFAULT_TENANT_ID / DEFAULT_TENANT_SLUG fallback.
 */
const { Tenant } = require("../config/db");
const { runWithTenantContext } = require("../../utils/tenantContext");

async function resolveWebChatTenant(req) {
  const body = req.body || {};
  const headers = req.headers || {};
  const query = req.query || {};

  const tenantId =
    body.tenant_id ||
    body.tenantId ||
    headers["x-tenant-id"] ||
    headers["X-Tenant-ID"] ||
    null;

  const tenantSlug =
    body.tenant ||
    body.tenantSlug ||
    body.slug ||
    body.siteKey ||
    body.site_key ||
    headers["x-tenant-slug"] ||
    headers["X-Tenant-Slug"] ||
    headers["x-site-key"] ||
    headers["X-Site-Key"] ||
    query.tenant ||
    null;

  if (tenantId) {
    const row = await Tenant.findOne({ id: String(tenantId) });
    if (row && !row.deleted_at && row.status !== "suspended") {
      return {
        tenant_id: String(row.id || row.tenant_id || tenantId),
        slug: row.slug || null,
      };
    }
    return null;
  }

  if (tenantSlug) {
    const row = await Tenant.findOne({
      slug: String(tenantSlug).trim().toLowerCase(),
    });
    if (row && !row.deleted_at && row.status !== "suspended") {
      return { tenant_id: String(row.id), slug: row.slug || String(tenantSlug) };
    }
    return null;
  }

  if (process.env.NODE_ENV !== "production") {
    const fallbackId = process.env.DEFAULT_TENANT_ID;
    const fallbackSlug = process.env.DEFAULT_TENANT_SLUG;
    if (fallbackId) {
      const row = await Tenant.findOne({ id: String(fallbackId) });
      if (row) return { tenant_id: String(row.id), slug: row.slug || null };
      return { tenant_id: String(fallbackId), slug: null };
    }
    if (fallbackSlug) {
      const row = await Tenant.findOne({
        slug: String(fallbackSlug).trim().toLowerCase(),
      });
      if (row) return { tenant_id: String(row.id), slug: row.slug || fallbackSlug };
    }
  }

  return null;
}

/**
 * @param {import('express').Express} app
 * @param {object} deps
 */
function registerChatRoutes(app, deps) {
  if (!app || typeof app.post !== "function") {
    throw new Error("registerChatRoutes requires an Express app");
  }
  if (app.__chatRoutesRegistered) return;
  app.__chatRoutesRegistered = true;

  const {
    chatLimiter,
    generateReply,
    upsertUser,
    saveMessage,
    io,
    extractAdContext,
    trackAdClick,
    Settings,
  } = deps;

  app.post("/api/chat", chatLimiter, async (req, res) => {
    const { message, userId, mediaData, referral } = req.body || {};
    if (!message && !mediaData) {
      return res.status(400).json({ error: "Message or image is required" });
    }

    const tenantInfo = await resolveWebChatTenant(req);
    if (!tenantInfo || !tenantInfo.tenant_id) {
      return res.status(400).json({
        error:
          "tenant required: pass tenant slug or tenant_id (body.tenant / body.tenant_id / X-Tenant-Slug / X-Tenant-ID)",
      });
    }

    const tenant_id = tenantInfo.tenant_id;
    const senderId =
      userId || "web-user-" + Math.random().toString(36).substring(7);
    console.log(
      ` [Web Chat] tenant=${tenant_id} ${senderId}: "${message || "[Image]"}"`
    );

    try {
      await runWithTenantContext({ tenant_id, role: "admin" }, async () => {
        await upsertUser(senderId, "web");
        await saveMessage(senderId, "user", message || "[Image]");
        if (io && typeof io.emit === "function") {
          io.emit("new_message", {
            uid: senderId,
            role: "user",
            content: message || "[Image]",
            timestamp: new Date(),
            tenant_id,
          });
        }

        const adContext = extractAdContext ? extractAdContext(referral) : null;
        if (adContext && trackAdClick) {
          await trackAdClick(senderId, "web", adContext, message);
        }

        let settings = await Settings.findOne({ configId: "global" });
        if (!settings) settings = { autoReply: true };
        if (!settings.autoReply) {
          return res.json({
            reply: "Auto-reply is off.",
            userId: senderId,
            tenant_id,
          });
        }

        const reply = await generateReply(
          senderId,
          message,
          mediaData,
          "Web User",
          adContext,
          tenant_id
        );
        await saveMessage(senderId, "model", reply);
        if (io && typeof io.emit === "function") {
          io.emit("new_message", {
            uid: senderId,
            role: "model",
            content: reply,
            timestamp: new Date(),
            tenant_id,
          });
        }
        res.json({ reply, userId: senderId, tenant_id });
      });
    } catch (err) {
      console.error(" Web Chat Error:", err.message);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
}

module.exports = {
  registerChatRoutes,
  resolveWebChatTenant,
};
