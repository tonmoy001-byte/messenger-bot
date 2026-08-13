/**
 * src/services/channels/messageHandlers.js
 * Per-channel inbound message handlers, exposed as a factory so runtime-only
 * deps (io, upsertUser, saveMessage) stay explicit — no hidden globals.
 */
const { User, Settings } = require("../../config/db");
const { generateReply } = require("../ai/gemini");
const {
  sendMessage,
  sendTyping,
  getUserProfile,
  downloadExternalMedia,
} = require("./messenger");
const {
  sendWhatsAppMessage,
  markWhatsAppAsRead,
  downloadWhatsAppMedia,
} = require("./whatsapp");
const {
  sendInstagramMessage,
  sendInstagramTyping,
  downloadInstagramMedia,
  getInstagramUserProfile,
} = require("./instagram");
const { extractAdContext, trackAdClick } = require("../../../utils/adTracking");
const { detectComplaint } = require("../../../utils/complaintDetector");
const { shouldEscalate } = require("../../../utils/escalation");
const { isDuplicate, markProcessed } = require("../../../utils/dedup");
const { handleTokenRevocation } = require("../../../utils/tokenManager");
const { isWithinMessagingWindow, sendViaTagIfExpired } = require("../../../utils/messagingWindow");

function createMessageHandlers({ io, upsertUser, saveMessage }) {
  async function handleMessengerEvent(event, pageId, tenant_id) {
    try {
      const senderId = event.sender?.id;
      if (!senderId || event.message?.is_echo) return;
      // Loop guard: skip messages from the page itself
      if (senderId === pageId) {
        console.log(` [Loop] Messenger: skipping echo from page ${pageId}`);
        return;
      }
      let text = event.message?.text || event.postback?.payload || event.message?.quick_reply?.payload;
      let mediaData = null;
      if (event.message?.attachments && event.message.attachments[0].type === "image") {
        const imageUrl = event.message.attachments[0].payload.url;
        mediaData = await downloadExternalMedia(imageUrl);
        if (!text) text = "Analyze this image";
      }
      if (!text && !mediaData) return;
      let displayName = null;
      let profilePic = null;
      try {
        const profile = await getUserProfile(senderId, pageId);
        if (profile) {
          displayName = profile.name || [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || profile.first_name || null;
          profilePic = profile.profile_pic || null;
        }
      } catch (profileErr) {
        // Token may be revoked — check for error code 190
        if (profileErr?.response?.data?.error?.code === 190) {
          await handleTokenRevocation("messenger", pageId);
        }
      }
      displayName = displayName || `User ${senderId.slice(-8)}`;
      console.log(" [Messenger] %s (%s): \"%s\"", senderId, displayName, text || "[Image]");
      await upsertUser(senderId, "messenger", displayName, profilePic);
      const messageContent = text || "[Image]";
      const mediaUrl = event.message?.attachments?.[0]?.type === "image" ? event.message.attachments[0].payload.url : null;
      await saveMessage(senderId, "user", messageContent, mediaUrl);
      io.emit("new_message", { uid: senderId, role: "user", content: text || "[Image]", timestamp: new Date(), customerName: displayName });
      
      // Ad tracking: Check for referral data from Facebook ads
      const referralData = event.referral || event.message?.referral || null;
      const adContext = extractAdContext(referralData);
      if (adContext) {
        await trackAdClick(senderId, "facebook", adContext, text);
      }
      
      const complaint = text ? detectComplaint(text) : { isComplaint: false, isHandoffRequest: false, sentiment: "neutral" };
      if (complaint.isComplaint || complaint.isHandoffRequest) {
        io.emit("complaint_detected", { uid: senderId, customerName: displayName, complaint, message: text });
      }
      if (shouldEscalate(text)) {
        await User.findOneAndUpdate(
          { uid: senderId },
          { $set: { "metadata.handoffStatus": "human_assigned" } },
          { upsert: true }
        );
        io.emit("human_handoff_message", { uid: senderId, customerName: displayName, message: text });
      }
      let settings = await Settings.findOne({ configId: "global" });
      if (!settings) settings = { autoReply: true };
      if (!settings.autoReply) return;

      // Check if conversation is assigned to human
      const user = await User.findOne({ uid: senderId });
      if (user?.metadata?.handoffStatus === "human_assigned") {
        io.emit("human_handoff_message", { uid: senderId, customerName: displayName, message: text });
        return;
      }

      await sendTyping(senderId, pageId);
      let reply;
      try { reply = await generateReply(senderId, text, mediaData, displayName, adContext, tenant_id); }
      catch (aiErr) { console.error(" AI Error:", aiErr.message); reply = "Thank you for your message! We'll get back to you shortly."; }
      await saveMessage(senderId, "model", reply);
      await sendMessage(senderId, reply, pageId);
      io.emit("new_message", { uid: senderId, role: "model", content: reply, timestamp: new Date() });
    } catch (err) {
      console.error(" Messenger Handler Error:", err.message);
      // Check for token revocation error
      if (err?.response?.data?.error?.code === 190) {
        await handleTokenRevocation("messenger", pageId);
      }
      // Error message dedup - max 1 error message per 5 minutes per user
      try {
        const senderId = event.sender?.id;
        if (senderId) {
          const errorKey = `error:${senderId}:${Math.floor(Date.now() / 300000)}`;
          if (!await isDuplicate(errorKey)) {
            await markProcessed(errorKey);
            await sendMessage(senderId, "I'm having a little trouble right now. Please try again in a moment.", pageId);
          }
        }
      } catch (e) { /* Don't cascade errors */ }
    }
  }

  async function handleWhatsAppEvent(message, contact, wabaId, tenant_id) {
    try {
      const from = message.from;
      const messageId = message.id;
      const rawName = contact?.profile?.name;
      const displayName = rawName || `+${from.slice(0, 2)}****${from.slice(-4)}`;
      let text = message.text?.body;
      let mediaData = null;
      if (message.type === "image") { text = message.image.caption || "Analyze this image"; mediaData = await downloadWhatsAppMedia(message.image.id, wabaId); }
      else if (message.type !== "text") return;
      if (!from || (!text && !mediaData)) return;
      console.log(" [WhatsApp] %s (%s): \"%s\"", from, displayName, text || "[Image]");
      await upsertUser(from, "whatsapp", displayName);
      await saveMessage(from, "user", text || "[Image]", null, "whatsapp");
      io.emit("new_message", { uid: from, role: "user", content: text || "[Image]", timestamp: new Date(), customerName: displayName });
      const complaint = text ? detectComplaint(text) : { isComplaint: false, isHandoffRequest: false, sentiment: "neutral" };
      if (complaint.isComplaint || complaint.isHandoffRequest) {
        io.emit("complaint_detected", { uid: from, customerName: displayName, complaint, message: text });
      }
      if (shouldEscalate(text)) {
        await User.findOneAndUpdate(
          { uid: from },
          { $set: { "metadata.handoffStatus": "human_assigned" } },
          { upsert: true }
        );
        io.emit("human_handoff_message", { uid: from, customerName: displayName, message: text });
      }
      await markWhatsAppAsRead(messageId, wabaId).catch(() => {});
      let settings = await Settings.findOne({ configId: "global" });
      if (!settings) settings = { autoReply: true };
      if (!settings.autoReply) return;

      // Check if conversation is assigned to human
      const waUser = await User.findOne({ uid: from });
      if (waUser?.metadata?.handoffStatus === "human_assigned") {
        io.emit("human_handoff_message", { uid: from, customerName: displayName, message: text });
        return;
      }

      // 24-hour window check
      const withinWindow = await isWithinMessagingWindow(from, "whatsapp");
      if (!withinWindow) {
        console.log(` [WhatsApp] Outside 24h window for ${from}, attempting utility tag...`);
        const tagResult = await sendViaTagIfExpired(from, "whatsapp", "We received your message! Our team will respond during business hours.");
        if (!tagResult) {
          console.log(` [WhatsApp] Cannot send to ${from} — outside 24h window and no tag available`);
          return;
        }
      }

      const reply = await generateReply(from, text, mediaData, displayName, null, tenant_id);
      await saveMessage(from, "model", reply, null, "whatsapp");
      await sendWhatsAppMessage(from, reply, wabaId);
      io.emit("new_message", { uid: from, role: "model", content: reply, timestamp: new Date() });
    } catch (err) {
      console.error(" WhatsApp Handler Error:", err.message);
      // Check for token revocation
      if (err?.response?.data?.error?.code === 190 || err?.response?.data?.error?.message?.includes("OAuthException")) {
        await handleTokenRevocation("whatsapp", process.env.WHATSAPP_BUSINESS_ACCOUNT_ID);
      }
      // Error message dedup - max 1 error message per 5 minutes per user
      try {
        const from = message.from;
        if (from) {
          const errorKey = `error:${from}:${Math.floor(Date.now() / 300000)}`;
          if (!await isDuplicate(errorKey)) {
            await markProcessed(errorKey);
            await sendWhatsAppMessage(from, "I'm having a little trouble right now. Please try again in a moment.", wabaId);
          }
        }
      } catch (e) { /* Don't cascade errors */ }
    }
  }

  async function handleInstagramEvent(event, pageId, tenant_id) {
    try {
      const senderId = event.sender?.id;
      if (!senderId || event.message?.is_echo) return;
      // Loop guard: skip messages from the page itself
      if (senderId === pageId) {
        console.log(` [Loop] Instagram: skipping echo from page ${pageId}`);
        return;
      }
      let text = event.message?.text || event.postback?.payload || event.message?.quick_reply?.payload;
      let mediaData = null;
      if (event.message?.attachments && event.message.attachments[0].type === "image") {
        const imageUrl = event.message.attachments[0].payload.url;
        mediaData = await downloadInstagramMedia(imageUrl);
        if (!text) text = "Analyze this image";
      }
      if (!text && !mediaData) return;
      let displayName = null;
      let profilePic = null;
      try {
        const profile = await getInstagramUserProfile(senderId, pageId);
        if (profile) { displayName = profile.name || null; profilePic = profile.profile_pic || null; }
      } catch (profileErr) {
        if (profileErr?.response?.data?.error?.code === 190) {
          await handleTokenRevocation("instagram", pageId);
        }
      }
      displayName = displayName || "IG User " + senderId.slice(-8);
      console.log(' [Instagram] %s (%s): "%s"', senderId, displayName, text || "[Image]");
      await upsertUser(senderId, "instagram", displayName, profilePic);
      await saveMessage(senderId, "user", text || "[Image]", null, "instagram");
      io.emit("new_message", { uid: senderId, role: "user", content: text || "[Image]", timestamp: new Date(), customerName: displayName });
      
      // Ad tracking: Check for referral data from Instagram ads
      const referralData = event.referral || event.message?.referral || null;
      const adContext = extractAdContext(referralData);
      if (adContext) {
        await trackAdClick(senderId, "instagram", adContext, text);
      }
      
      const complaint = text ? detectComplaint(text) : { isComplaint: false, isHandoffRequest: false, sentiment: "neutral" };
      if (complaint.isComplaint || complaint.isHandoffRequest) {
        io.emit("complaint_detected", { uid: senderId, customerName: displayName, complaint, message: text });
      }
      if (shouldEscalate(text)) {
        await User.findOneAndUpdate(
          { uid: senderId },
          { $set: { "metadata.handoffStatus": "human_assigned" } },
          { upsert: true }
        );
        io.emit("human_handoff_message", { uid: senderId, customerName: displayName, message: text });
      }
      let settings = await Settings.findOne({ configId: "global" });
      if (!settings) settings = { autoReply: true };
      if (!settings.autoReply) return;

      // Check if conversation is assigned to human
      const igUser = await User.findOne({ uid: senderId });
      if (igUser?.metadata?.handoffStatus === "human_assigned") {
        io.emit("human_handoff_message", { uid: senderId, customerName: displayName, message: text });
        return;
      }

      await sendInstagramTyping(senderId, pageId);
      let reply;
      try { reply = await generateReply(senderId, text, mediaData, displayName, adContext, tenant_id); }
      catch (aiErr) { console.error(" AI Error:", aiErr.message); reply = "Thank you for your message! We'll get back to you shortly."; }
      await saveMessage(senderId, "model", reply, null, "instagram");
      await sendInstagramMessage(senderId, reply, pageId);
      io.emit("new_message", { uid: senderId, role: "model", content: reply, timestamp: new Date() });
    } catch (err) {
      console.error(" Instagram Handler Error:", err.message);
      if (err?.response?.data?.error?.code === 190) {
        await handleTokenRevocation("instagram", pageId);
      }
      // Error message dedup - max 1 error message per 5 minutes per user
      try {
        const senderId = event.sender?.id;
        if (senderId) {
          const errorKey = `error:${senderId}:${Math.floor(Date.now() / 300000)}`;
          if (!await isDuplicate(errorKey)) {
            await markProcessed(errorKey);
            await sendInstagramMessage(senderId, "I'm having a little trouble right now. Please try again in a moment.", pageId);
          }
        }
      } catch (e) { /* Don't cascade errors */ }
    }
  }

  return { handleMessengerEvent, handleWhatsAppEvent, handleInstagramEvent };
}

module.exports = { createMessageHandlers };