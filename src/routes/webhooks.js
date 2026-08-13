/**
 * src/routes/webhooks.js
 * Messenger / WhatsApp / Instagram webhook GET (verify) + POST (event) routes.
 */
const { verifyMetaSignature } = require("../utils/security");
const { verifyWebhookToken, getTenantByChannel } = require("../utils/webhookHelpers");
const { atomicDedupCheck } = require("../../utils/dedup");
const { runWithTenantContext } = require("../../utils/tenantContext");

function registerWebhookRoutes(app, { io, handleMessengerEvent, handleWhatsAppEvent, handleInstagramEvent }) {
  if (!app || typeof app.get !== "function") {
    throw new Error("registerWebhookRoutes requires an Express app");
  }
  if (app.__webhookRoutesRegistered) return;
  app.__webhookRoutesRegistered = true;

  app.get("/webhook/messenger", async (req, res) => {
     const challenge = req.query["hub.challenge"];
     const expectedToken = process.env.MESSENGER_VERIFY_TOKEN || process.env.VERIFY_TOKEN;
     const isValid = await verifyWebhookToken(req, "messenger", expectedToken);
     if (isValid) {
       console.log(" Messenger Webhook verified!");
       res.status(200).send(challenge);
     } else { res.sendStatus(403); }
   });

  app.post("/webhook/messenger", async (req, res) => {
    const body = req.body;
    if (body.object !== "page") return res.sendStatus(404);

    // Verify webhook signature
    const signature = req.headers["x-hub-signature-256"];
    const fbSecret = process.env.FB_APP_SECRET;
    const isProduction = process.env.NODE_ENV === "production";

    if (signature && !req.rawBody) {
      console.error(" [Webhook Error] x-hub-signature-256 is present but req.rawBody is missing! Check express body-parser configuration.");
    }

    if (isProduction || signature || fbSecret) {
      if (!signature || !fbSecret || !verifyMetaSignature(req.rawBody || "", signature, fbSecret)) {
        console.warn(` [Webhook] Signature verification failed or missing for Messenger (Signature: ${signature ? "Present" : "Missing"}, Secret: ${fbSecret ? "Present" : "Missing"})`);
        return res.sendStatus(403);
      }
    }

    res.status(200).send("EVENT_RECEIVED");
    for (const entry of body.entry || []) {
      const pageId = entry.id;
      for (const event of entry.messaging || []) {
        try {
          const externalId = event.recipient?.id || pageId;
          const channelInfo = await getTenantByChannel("messenger", externalId);
          if (!channelInfo || !channelInfo.tenant_id) {
            console.warn(` [Webhook] Warning: Unmapped Messenger pageId ${externalId}`);
            continue;
          }
          const tenant_id = channelInfo.tenant_id;

          const mid = event.message?.mid;
          const senderId = event.sender?.id;
          const text = event.message?.text || event.postback?.payload || event.message?.quick_reply?.payload || "";

          // Atomic dedup - single operation prevents race condition
          if (mid || (senderId && text && !event.message?.is_echo)) {
            if (await atomicDedupCheck(mid, senderId, text && !event.message?.is_echo ? text : null)) {
              console.log(` [Dedup] Skipping duplicate message: ${mid || senderId}`);
              continue;
            }
          }

          // Loop guard: ignore echoes from our own page
          if (senderId === pageId) {
            console.log(` [Loop] Skipping echo from own page: ${pageId}`);
            continue;
          }

          await runWithTenantContext({ tenant_id, role: "admin" }, async () => {
            await handleMessengerEvent(event, pageId, tenant_id);
          });
        } catch (err) { console.error(" Messenger Error:", err.message); }
      }
    }
  });

  app.get("/webhook/whatsapp", async (req, res) => {
     const challenge = req.query["hub.challenge"];
     const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN || process.env.VERIFY_TOKEN;
     const isValid = await verifyWebhookToken(req, "whatsapp", expectedToken);
     if (isValid) {
       console.log(" WhatsApp Webhook verified!");
       res.status(200).send(challenge);
     } else { res.sendStatus(403); }
   });

  app.post("/webhook/whatsapp", async (req, res) => {
    const body = req.body;
    if (body.object === "whatsapp_business_account") {
      // Verify webhook signature (X-Hub-Signature-256)
      const signature = req.headers["x-hub-signature-256"];
      const fbSecret = process.env.FB_APP_SECRET;
      const isProduction = process.env.NODE_ENV === "production";

      if (signature && !req.rawBody) {
        console.error(" [Webhook Error] x-hub-signature-256 is present but req.rawBody is missing! Check express body-parser configuration.");
      }

      if (isProduction || signature || fbSecret) {
        if (!signature || !fbSecret || !verifyMetaSignature(req.rawBody || "", signature, fbSecret)) {
          console.warn(` [Webhook] Signature verification failed or missing for WhatsApp (Signature: ${signature ? "Present" : "Missing"}, Secret: ${fbSecret ? "Present" : "Missing"})`);
          return res.sendStatus(403);
        }
      }

      res.status(200).send("EVENT_RECEIVED");
      for (const entry of body.entry || []) {
        const wabaId = entry.id;
        for (const change of entry.changes || []) {
          if (change.value && change.value.messages) {
            const phone_number_id = change.value.metadata?.phone_number_id || wabaId;
            const channelInfo = await getTenantByChannel("whatsapp", phone_number_id);
            if (!channelInfo || !channelInfo.tenant_id) {
              console.warn(` [Webhook] Warning: Unmapped WhatsApp phone_number_id ${phone_number_id}`);
              continue;
            }
            const tenant_id = channelInfo.tenant_id;

            const contact = (change.value.contacts && change.value.contacts[0]) ? change.value.contacts[0] : null;
            for (const message of change.value.messages) {
              try {
                const from = message.from;
                const text = message.text?.body || "";

                // Atomic dedup - single operation prevents race condition
                if (message.id || (from && text)) {
                  if (await atomicDedupCheck(message.id, from, text || null)) {
                    console.log(` [Dedup] Skipping duplicate WhatsApp message: ${message.id || from}`);
                    continue;
                  }
                }

                await runWithTenantContext({ tenant_id, role: "admin" }, async () => {
                  await handleWhatsAppEvent(message, contact, phone_number_id, tenant_id);
                });
              } catch (err) { console.error(" WhatsApp Error:", err.message); }
            }
          }
        }
      }
    } else { res.sendStatus(404); }
  });

  app.get("/webhook/instagram", async (req, res) => {
     const challenge = req.query["hub.challenge"];
     const expectedToken = process.env.INSTAGRAM_VERIFY_TOKEN || process.env.VERIFY_TOKEN;
     const isValid = await verifyWebhookToken(req, "instagram", expectedToken);
     if (isValid) {
       console.log(" Instagram Webhook verified!");
       res.status(200).send(challenge);
     } else { res.sendStatus(403); }
   });

  app.post("/webhook/instagram", async (req, res) => {
    const body = req.body;
    if (body.object !== "instagram") return res.sendStatus(404);

    // Verify webhook signature
    const signature = req.headers["x-hub-signature-256"];
    const fbSecret = process.env.FB_APP_SECRET;
    const isProduction = process.env.NODE_ENV === "production";

    if (signature && !req.rawBody) {
      console.error(" [Webhook Error] x-hub-signature-256 is present but req.rawBody is missing! Check express body-parser configuration.");
    }

    if (isProduction || signature || fbSecret) {
      if (!signature || !fbSecret || !verifyMetaSignature(req.rawBody || "", signature, fbSecret)) {
        console.warn(` [Webhook] Signature verification failed or missing for Instagram (Signature: ${signature ? "Present" : "Missing"}, Secret: ${fbSecret ? "Present" : "Missing"})`);
        return res.sendStatus(403);
      }
    }

    res.status(200).send("EVENT_RECEIVED");
    for (const entry of body.entry || []) {
      const pageId = entry.id;
      for (const event of entry.messaging || []) {
        try {
          const externalId = event.recipient?.id || pageId;
          const channelInfo = await getTenantByChannel("instagram", externalId);
          if (!channelInfo || !channelInfo.tenant_id) {
            console.warn(` [Webhook] Warning: Unmapped Instagram pageId ${externalId}`);
            continue;
          }
          const tenant_id = channelInfo.tenant_id;

          const mid = event.message?.mid || event.mid;
          const senderId = event.sender?.id;
          const text = event.message?.text || event.postback?.payload || event.message?.quick_reply?.payload || "";

          // Atomic dedup - single operation prevents race condition
          if (mid || (senderId && text && !event.message?.is_echo)) {
            if (await atomicDedupCheck(mid, senderId, text && !event.message?.is_echo ? text : null)) {
              console.log(` [Dedup] Skipping duplicate Instagram message: ${mid || senderId}`);
              continue;
            }
          }

          // Loop guard: ignore echoes from own page
          if (senderId === pageId) {
            console.log(` [Loop] Skipping echo from own IG page: ${pageId}`);
            continue;
          }

          await runWithTenantContext({ tenant_id, role: "admin" }, async () => {
            await handleInstagramEvent(event, pageId, tenant_id);
          });
        } catch (err) { console.error(" Instagram Error:", err.message); }
      }
    }
  });
}

module.exports = { registerWebhookRoutes };