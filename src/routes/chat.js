/**
 * src/routes/chat.js
 * Public website chat widget — tenant-scoped.
 * Tenant resolution lives in ../utils/tenantResolve (shared with products.js).
 */
const { runWithTenantContext } = require("../../utils/tenantContext");
const { resolveTenantFromRequest } = require("../utils/tenantResolve");

const resolveWebChatTenant = resolveTenantFromRequest;

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
  resolveTenantFromRequest,
};
