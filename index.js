require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const http = require("http");
const crypto = require("crypto");
const socketIo = require("socket.io");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const axios = require("axios");
const rateLimit = require("express-rate-limit");
const path = require("path");
const next = require("next");
const { encrypt, decrypt, verifyMetaSignature } = require("./src/utils/security");
const { connectDB, User, Message, Admin, Order, Product, Settings, Integration, OrderSession, Payment, Broadcast, Template, EcommerceConnection, KnowledgeBase, Feedback, ConversationAnalytics, Ad, AdClick, Tenant, TenantChannel } = require("./src/config/db");

const { runWithTenantContext } = require("./utils/tenantContext");
const channelCache = require("./utils/channelCache");

const { generateReply } = require("./src/services/ai/gemini");
const { sendMessage, sendTyping, getUserProfile, downloadExternalMedia } = require("./src/services/channels/messenger");
const { sendWhatsAppMessage, markWhatsAppAsRead, downloadWhatsAppMedia, isWithin24HourWindow } = require("./src/services/channels/whatsapp");
const { sendInstagramMessage, sendInstagramTyping, downloadInstagramMedia, getInstagramUserProfile } = require("./src/services/channels/instagram");
const { createBkashPayment, executeBkashPayment, createNagadPayment, markCOD } = require("./utils/payments");
const { matchProducts, buildMatchResponse } = require("./utils/imageMatcher");
const { detectComplaint } = require("./utils/complaintDetector");
const { shouldEscalate } = require("./utils/escalation");
const { sendTemplateMessage, getTemplates, deleteTemplate, createWhatsAppTemplate, seedTemplates } = require("./utils/whatsappTemplates");
const { testShopifyConnection, syncShopifyProducts, createShopifyOrder, getShopifyOrders, verifyShopifyWebhook } = require("./utils/shopify");
const { testWooConnection, syncWooProducts, createWooOrder, getWooOrders, verifyWooWebhook } = require("./utils/woocommerce");
const { retrieveContext, indexKnowledgeEntry, indexProduct, indexAllProducts, indexAllKnowledge, unindexEntry, buildRAGPrompt } = require("./utils/rag");
const { initPinecone, getIndexStats } = require("./utils/vectorDB");
const { analyzeConversations, identifyFailurePatterns, suggestKnowledgeAdditions, exportFineTuningData } = require("./utils/conversationAnalyzer");
const { extractAdContext, trackAdClick, markAdConversion, getUserAdContext, getAdPerformance, getRecentClicks } = require("./utils/adTracking");
const { isDuplicate, markProcessed, isContentDuplicate, markContentProcessed, atomicDedupCheck, closeRedis } = require("./utils/dedup");
const { enqueueMessage, getQueueStats, closeQueues } = require("./utils/queue");
const { closeWorkers } = require("./utils/worker");
const { isWithinMessagingWindow } = require("./utils/messagingWindow");
const { purgeExpiredMessages, deleteUserMessages, setMessageExpiry, startAutoPurgeCron } = require("./utils/dataRetention");
const { handleTokenRevocation } = require("./utils/tokenManager");
const { makeRequireRole } = require("./utils/rbac");
const { signRefreshToken, verifyRefreshToken } = require("./utils/refreshToken");
const { registerHealthRoutes } = require("./src/routes/health");
const { registerOrderRoutes } = require("./src/routes/orders");
const { registerChatRoutes, resolveTenantFromRequest } = require("./src/routes/chat");
const { withSuperadmin } = require("./src/config/superadmin");
const { verifyWebhookToken, getTenantByChannel } = require("./src/utils/webhookHelpers");
const { upsertUser, saveMessage } = require("./src/utils/messageHelpers");
const { createMessageHandlers } = require("./src/services/channels/messageHandlers");

const dev = process.env.NODE_ENV !== "production";
const dashboardDir = path.join(__dirname, "dashboard");
const nextApp = next({ dev, dir: dashboardDir });
const nextHandle = nextApp.getRequestHandler();

const app = express();
const server = http.createServer(app);

// Public health endpoints (available whether started via index.js or src/server.js)
registerHealthRoutes(app);

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim()).filter(Boolean)
  : [];

const io = socketIo(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0) {
        if (process.env.NODE_ENV !== "production") {
          return callback(null, true);
        }
        return callback(new Error("CORS: ALLOWED_ORIGINS not configured in production"));
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("CORS: Origin not allowed"));
    },
    methods: ["GET", "POST"],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ["websocket", "polling"]
});

const { handleMessengerEvent, handleWhatsAppEvent, handleInstagramEvent } = createMessageHandlers({ io, upsertUser, saveMessage });

const { requireEnv, validateEnv } = require("./src/config/env");

// Run global environment variable validation on startup
validateEnv();

const PORT = process.env.PORT || 3000;
const JWT_SECRET = requireEnv("JWT_SECRET", {
  minLength: 16,
  forbid: ["cyberbot-admin-secret-key-change-in-production", "your_jwt_secret_key"]
});

const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { error: "Too many requests" }, standardHeaders: true, legacyHeaders: false });
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: "Rate limit exceeded" } });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: "Too many auth attempts" } });

app.use(express.json({
  limit: "10mb",
  verify: (req, _res, buf) => { req.rawBody = buf.toString(); }
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "landing")));

registerOrderRoutes(app);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.length > 0) {
    if (allowedOrigins.includes(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
    }
  } else {
    if (process.env.NODE_ENV !== "production") {
      res.header("Access-Control-Allow-Origin", origin || "*");
    } else {
      console.warn("⚠️ WARNING: ALLOWED_ORIGINS is not set in production! CORS requests will be blocked.");
    }
  }
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Tenant-ID");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
  res.header("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

registerChatRoutes(app, {
  chatLimiter,
  generateReply,
  upsertUser,
  saveMessage,
  io,
  extractAdContext,
  trackAdClick,
  Settings,
});

// ─── AUTH MIDDLEWARE ──────────────────────────────────────
const { authenticateTenant } = require("./src/middleware/auth");
const authenticateAdmin = authenticateTenant;

const requireAdmin = makeRequireRole("admin");

// ─── AUTH ROUTES ──────────────────────────────────────────
app.post("/api/auth/signup", authLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
  const { username, password, role, tenant_id } = req.body;
  try {
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }
    const existing = await Admin.findOne({ username });
    if (existing) {
      return res.status(400).json({ error: "Username already exists" });
    }

    const isSuperAdmin = req.user?.role === "superadmin";
    const finalRole = isSuperAdmin ? (role || "agent") : "agent";
    const finalTenantId = isSuperAdmin ? (tenant_id || null) : (req.tenant_id || null);

    const hashedPassword = await bcrypt.hash(password, 10);
    const newAdmin = await Admin.save({
      username,
      password: hashedPassword,
      role: finalRole,
      tenant_id: finalTenantId,
      createdAt: new Date(),
    });

    res.status(201).json({
      success: true,
      username: newAdmin.username,
      role: newAdmin.role,
      tenant_id: newAdmin.tenant_id || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const { username, password } = req.body;
  try {
    const admin = await withSuperadmin(() => Admin.findOne({ username }));
    if (!admin) return res.status(401).json({ error: "Invalid credentials" });
    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });
    await withSuperadmin(() => Admin.findByIdAndUpdate(admin.id, { lastLoginAt: new Date() }));
    const token = jwt.sign({ id: admin.id, username: admin.username, role: admin.role, tenant_id: admin.tenant_id || null }, JWT_SECRET, { expiresIn: "24h" });
    res.cookie("admin_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 24 * 60 * 60 * 1000,
    });
    const refreshToken = signRefreshToken({ id: admin.id, username: admin.username }, JWT_SECRET);
    res.cookie("admin_refresh", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/auth",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    res.json({ token, username: admin.username, role: admin.role, tenant_id: admin.tenant_id || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/refresh", authLimiter, async (req, res) => {
  try {
    const cookies = req.headers.cookie || "";
    const match = cookies.match(/admin_refresh=([^;]+)/);
    if (!match) return res.status(401).json({ error: "No refresh token" });
    const decoded = verifyRefreshToken(match[1], JWT_SECRET);
    if (!decoded || !decoded.id) return res.status(401).json({ error: "Invalid refresh token" });
    const admin = await withSuperadmin(() => Admin.findOne({ id: decoded.id }));
    if (!admin) return res.status(401).json({ error: "User not found" });
    const token = jwt.sign({ id: admin.id, username: admin.username, role: admin.role, tenant_id: admin.tenant_id || null }, JWT_SECRET, { expiresIn: "24h" });
    res.cookie("admin_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 24 * 60 * 60 * 1000,
    });
    res.json({ token, username: admin.username, role: admin.role, tenant_id: admin.tenant_id || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("admin_token", { path: "/" });
  res.clearCookie("admin_refresh", { path: "/api/auth" });
  res.json({ success: true });
});

app.get("/api/auth/meta/url", authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const type = req.query.type || "facebook";
    const redirectUri = process.env.META_REDIRECT_URI || `${process.env.BASE_URL || "http://localhost:3000"}/api/auth/meta/callback`;
    const scopes = type === "whatsapp"
      ? "whatsapp_business_management,whatsapp_business_messaging"
      : "pages_show_list,pages_manage_metadata,pages_messaging,instagram_basic,instagram_manage_messages";

    const state = crypto.randomBytes(16).toString("hex");
    res.cookie("meta_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 10 * 60 * 1000 // 10 minutes
    });

    const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${process.env.FB_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&response_type=code&state=${state}`;
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/auth/meta/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.status(400).send("No code provided");

    // Retrieve state from cookie
    const cookies = req.headers.cookie || "";
    const match = cookies.match(/meta_oauth_state=([^;]+)/);
    const cookieState = match ? match[1] : null;

    res.clearCookie("meta_oauth_state");

    if (!state || !cookieState || state !== cookieState) {
      return res.status(400).send("CSRF Validation Failed: State mismatch or missing.");
    }

    const redirectUri = process.env.META_REDIRECT_URI || `${process.env.BASE_URL || "http://localhost:3000"}/api/auth/meta/callback`;
    const tokenRes = await axios.get(`https://graph.facebook.com/v19.0/oauth/access_token?client_id=${process.env.FB_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${process.env.FB_APP_SECRET}&code=${code}`);
    const { access_token: shortToken } = tokenRes.data;
    const longRes = await axios.get(`https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.FB_APP_ID}&client_secret=${process.env.FB_APP_SECRET}&fb_exchange_token=${shortToken}`);
    const { access_token: longToken } = longRes.data;
    const encrypted = encrypt(longToken);
    const pagesRes = await axios.get(`https://graph.facebook.com/v19.0/me/accounts?access_token=${longToken}`);
    for (const page of pagesRes.data.data || []) {
      await Integration.findOneAndUpdate(
        { type: "facebook", externalId: page.id },
        { $set: { name: page.name, accessToken: encrypted, isActive: true, metadata: { longLivedToken: encrypt(longToken) } } },
        { upsert: true }
      );
    }
    res.redirect("/?auth=success");
  } catch (err) {
    console.error("Meta OAuth Error:", err.message);
    res.redirect("/?auth=error");
  }
});

// ─── INTEGRATIONS ─────────────────────────────────────────
app.get("/api/admin/integrations", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    // Get social media integrations (Facebook, Instagram, WhatsApp)
    const socialIntegrations = await Integration.find().select("-accessToken");
    
    // Get e-commerce connections (Shopify, WooCommerce)
    const ecommerceConnections = await EcommerceConnection.find();
    
    // Format e-commerce connections for frontend
    const shopify = ecommerceConnections.find(c => c.platform === "shopify");
    const woocommerce = ecommerceConnections.find(c => c.platform === "woocommerce");
    
    res.json({
      social: socialIntegrations,
      shopify: shopify ? { connected: true, ...shopify.toObject() } : { connected: false },
      woocommerce: woocommerce ? { connected: true, ...woocommerce.toObject() } : { connected: false }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/integrations/:id", authenticateAdmin, async (req, res) => {
  try {
    await Integration.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── WEBHOOKS ─────────────────────────────────────────────
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

// ─── ADMIN DASHBOARD API ──────────────────────────────────
app.get("/api/admin/conversations", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const users = await User.find().sort({ lastSeen: -1 });
    const convos = await Promise.all(users.map(async (u) => {
      const lastMsg = await Message.findOne({ uid: u.uid }).sort({ createdAt: -1 });
      return { customerId: u.uid, customerName: u.name, customerPhone: u.phone, profilePic: u.profilePic, platform: u.platform, lastMessage: lastMsg ? lastMsg.content : "No messages yet", lastMessageTime: lastMsg ? lastMsg.createdAt : u.lastSeen, unread: false };
    }));
    res.json(convos);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/admin/messages/:uid", adminLimiter, authenticateAdmin, async (req, res) => {
  try { const messages = await Message.find({ uid: req.params.uid }).sort({ createdAt: 1 }); res.json(messages); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/admin/reply", adminLimiter, authenticateAdmin, async (req, res) => {
  const { uid, message, platform } = req.body;
  try {
    await saveMessage(uid, "model", message);
    if (platform === "messenger") await sendMessage(uid, message);
    else if (platform === "whatsapp") await sendWhatsAppMessage(uid, message);
    else if (platform === "instagram") await sendInstagramMessage(uid, message);
    io.emit("new_message", { uid, role: "model", content: message, timestamp: new Date() });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/admin/orders", adminLimiter, authenticateAdmin, async (req, res) => {
  try { const orders = await Order.find().sort({ createdAt: -1 }); res.json(orders); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/admin/customers", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const users = await User.find().sort({ lastSeen: -1 });
    const customers = await Promise.all(users.map(async (u) => {
      const orderCount = await Order.countDocuments({ uid: u.uid });
      const totalSpent = await Order.aggregate([{ $match: { uid: u.uid } }, { $group: { _id: null, total: { $sum: "$totalAmount" } } }]);
      return { id: u.uid, name: u.name, email: u.email || "N/A", phone: u.phone || "N/A", platform: u.platform, lastActive: u.lastSeen, totalOrders: orderCount, totalSpent: totalSpent.length > 0 ? totalSpent[0].total : 0, tags: u.metadata?.tags || [], notes: u.metadata?.notes || "" };
    }));
    res.json(customers);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/admin/settings", adminLimiter, authenticateAdmin, async (req, res) => {
  try { let settings = await Settings.findOne({ configId: "global" }); if (!settings) settings = await Settings.save({ configId: "global" }); res.json(settings); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/admin/settings", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const update = req.body.updates || req.body;
    const settings = await Settings.findOneAndUpdate({ configId: "global" }, { $set: update }, { new: true, upsert: true });
    res.json(settings);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/admin/stats", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const totalOrders = await Order.countDocuments();
    const totalRevenueResult = await Order.aggregate([{ $group: { _id: null, total: { $sum: "$totalAmount" } } }]);
    const totalCustomers = await User.countDocuments();
    const totalMessages = await Message.countDocuments();
    const conversionRate = totalCustomers > 0 ? ((totalOrders / totalCustomers) * 100).toFixed(2) : 0;
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const dailyVolume = await Message.aggregate([{ $match: { createdAt: { $gte: sevenDaysAgo } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } }, { $sort: { "_id": 1 } }]);
    const platformStats = await User.aggregate([{ $group: { _id: "$platform", count: { $sum: 1 } } }]);
    res.json({
      stats: { orders: { value: totalOrders, change: "+10%", up: true }, revenue: { value: totalRevenueResult.length > 0 ? totalRevenueResult[0].total : 0, change: "+5%", up: true }, customers: { value: totalCustomers, change: "+12%", up: true }, messages: { value: totalMessages, change: "+8%", up: true }, conversionRate: { value: `${conversionRate}%`, change: "+2%", up: true } },
      dailyVolume: dailyVolume.map(d => ({ day: d._id, messages: d.count })),
      platformDistribution: platformStats.map(p => ({ name: p._id, value: p.count }))
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/admin/stats/real", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const totalOrders = await Order.countDocuments();
    const totalRevenueResult = await Order.aggregate([{ $group: { _id: null, total: { $sum: "$totalAmount" } } }]);
    const totalCustomers = await User.countDocuments();
    const totalRevenue = totalRevenueResult.length > 0 ? totalRevenueResult[0].total : 0;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const messagesToday = await Message.countDocuments({ createdAt: { $gte: today } });
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const revenueByDay = await Order.aggregate([{ $match: { createdAt: { $gte: sevenDaysAgo } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, revenue: { $sum: "$totalAmount" }, orders: { $sum: 1 } } }, { $sort: { "_id": 1 } }]);
    const platformBreakdown = await User.aggregate([{ $group: { _id: "$platform", count: { $sum: 1 } } }]).then(r => r.map(x => ({ platform: x._id, count: x.count })));
    // Include queue stats
    const queueStats = await getQueueStats().catch(() => ({}));
    res.json({ totalCustomers, totalOrders, totalRevenue, avgOrderValue, messagesToday, revenueByDay: revenueByDay.map(d => ({ day: d._id, revenue: d.revenue, orders: d.orders })), platformBreakdown, queueStats });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put("/api/admin/orders/:id/status", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ["pending", "confirmed", "shipped", "delivered", "cancelled"];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: "Invalid status" });
    const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json({ success: true, order });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put("/api/admin/customers/:id/notes", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const { notes } = req.body;
    const user = await User.findOneAndUpdate({ uid: req.params.id }, { $set: { "metadata.notes": notes } }, { new: true });
    if (!user) return res.status(404).json({ error: "Customer not found" });
    res.json({ success: true, notes: user.metadata?.notes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put("/api/admin/customers/:id/tags", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const { tags } = req.body;
    const user = await User.findOneAndUpdate({ uid: req.params.id }, { $set: { "metadata.tags": tags } }, { new: true });
    if (!user) return res.status(404).json({ error: "Customer not found" });
    res.json({ success: true, tags: user.metadata?.tags });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GDPR: Delete user messages (right to erasure) ───────────
app.delete("/api/users/:uid/messages", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    const result = await deleteUserMessages(uid);
    res.json({ success: true, deleted: result.deleted });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DATA RETENTION: Manual purge endpoint ────────────────────
app.post("/api/admin/data-retention/purge", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const { days } = req.body;
    const result = await purgeExpiredMessages(days || 30);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put("/api/admin/settings/ai-model", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const { model } = req.body;
    const settings = await Settings.findOneAndUpdate({ configId: "global" }, { $set: { primaryModel: model } }, { new: true, upsert: true });
    res.json({ success: true, model: settings.primaryModel });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/export/customers", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const users = await User.find().sort({ lastSeen: -1 });
    const rows = [["ID", "Name", "Platform", "Email", "Phone", "Tags", "Orders", "Total Spent", "Last Active"]];
    for (const u of users) {
      const orderCount = await Order.countDocuments({ uid: u.uid });
      const totalSpent = await Order.aggregate([{ $match: { uid: u.uid } }, { $group: { _id: null, total: { $sum: "$totalAmount" } } }]);
      rows.push([u.uid, u.name || "", u.platform, u.email || "", u.phone || "", (u.metadata?.tags || []).join("; "), orderCount, totalSpent.length > 0 ? totalSpent[0].total : 0, u.lastSeen ? u.lastSeen.toISOString() : ""]);
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=customers.csv");
    res.send(csv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/export/orders", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    const rows = [["Order ID", "Customer", "Platform", "Items", "Total", "Status", "Date"]];
    for (const o of orders) {
      rows.push([o.id, o.customerName || o.uid, o.platform || "unknown", o.details || "", o.totalAmount, o.status, o.createdAt ? new Date(o.createdAt).toISOString() : ""]);
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=orders.csv");
    res.send(csv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/admin/search", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ customers: [], orders: [], messages: [] });
    const regex = new RegExp(q, "i");
    const customers = await User.find({ $or: [{ name: regex }, { uid: regex }, { email: regex }, { phone: regex }] }).limit(10);
    const orders = await Order.find({ $or: [{ customerName: regex }, { uid: regex }, { details: regex }] }).limit(10);
    const messages = await Message.find({ content: regex }).limit(20);
    res.json({ customers: customers.map(c => ({ id: c.uid, name: c.name, platform: c.platform })), orders: orders.map(o => ({ id: o.id, customer: o.customerName, status: o.status })), messages: messages.map(m => ({ uid: m.uid, content: m.content, role: m.role })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/admin/notifications", adminLimiter, authenticateAdmin, async (req, res) => { try { res.json([]); } catch (err) { res.status(500).json({ error: err.message }); } });
app.put("/api/admin/notifications/:id/read", adminLimiter, authenticateAdmin, async (req, res) => { try { res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.get("/api/admin/audit-logs", adminLimiter, authenticateAdmin, async (req, res) => { try { res.json([]); } catch (err) { res.status(500).json({ error: err.message }); } });

app.get("/api/admin/team", adminLimiter, authenticateAdmin, async (req, res) => {
  try { const admins = await Admin.find({}).select("-password"); res.json(admins); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/admin/team/invite", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const admin = await Admin.save({ username, password: hashedPassword, role: role || "agent" });
    res.json({ success: true, admin: { username: admin.username, role: admin.role } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/admin/team/:id", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
  try { await Admin.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── FEEDBACK & AI LEARNING ENDPOINTS ────────────────────────────────
app.post("/api/admin/feedback", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const { messageId, uid, platform, rating, userMessage, aiResponse, correctedResponse, feedback, tags } = req.body;
    const entry = await Feedback.save({ messageId, uid, platform, rating, userMessage, aiResponse, correctedResponse, feedback, tags });
    res.json({ success: true, feedback: entry });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/admin/feedback", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const { uid, rating, limit = 50 } = req.query;
    const filter = {};
    if (uid) filter.uid = uid;
    if (rating) filter.rating = parseInt(rating);
    const feedback = await Feedback.find(filter).sort({ createdAt: -1 }).limit(parseInt(limit));
    res.json(feedback);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/admin/feedback/stats", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const stats = await Feedback.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $group: {
          _id: null,
          count: { $sum: 1 },
          avgRating: { $avg: "$rating" },
          byRating: {
            1: { $sum: { $cond: [{ $eq: ["$rating", 1] }, 1, 0] } },
            2: { $sum: { $cond: [{ $eq: ["$rating", 2] }, 1, 0] } },
            3: { $sum: { $cond: [{ $eq: ["$rating", 3] }, 1, 0] } },
            4: { $sum: { $cond: [{ $eq: ["$rating", 4] }, 1, 0] } },
            5: { $sum: { $cond: [{ $eq: ["$rating", 5] }, 1, 0] } }
          }
        }
      }
    ]);

    const failurePatterns = await identifyFailurePatterns(parseInt(days));
    const suggestions = await suggestKnowledgeAdditions(parseInt(days));

    res.json({
      count: stats[0]?.count || 0,
      avgRating: stats[0]?.avgRating?.toFixed(2) || 0,
      distribution: stats[0]?.byRating || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      failurePatterns,
      suggestions
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/admin/analytics", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const daysNum = parseInt(days);
    const since = new Date();
    since.setDate(since.getDate() - daysNum);

    const totalMessages = await Message.countDocuments({ createdAt: { $gte: since } });
    const uniqueCustomers = await User.countDocuments({ createdAt: { $gte: since } });

    const messagesByDay = await Message.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);

    const platformBreakdown = await User.aggregate([
      { $group: { _id: "$platform", count: { $sum: 1 } } },
    ]).then((r) => r.reduce((acc, x) => { acc[x._id || "unknown"] = x.count; return acc; }, {}));

    res.json({
      totalMessages,
      uniqueCustomers,
      avgResponseTime: "< 1s",
      messagesByDay: messagesByDay.map((d) => ({ date: d._id, count: d.count })),
      platformBreakdown,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/admin/analytics/conversations", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const analysis = await analyzeConversations(startDate, endDate);
    res.json(analysis);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/admin/fine-tuning/export", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const { days = 90, minRating = 4, format = "json" } = req.query;
    const result = await exportFineTuningData(parseInt(days), parseInt(minRating));

    if (format === "jsonl") {
      res.setHeader("Content-Type", "application/x-jsonlines");
      res.setHeader("Content-Disposition", "attachment; filename=fine-tuning-data.jsonl");
      res.send(result.jsonl);
    } else {
      res.json({ count: result.count, data: result.data });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/admin/ai-performance", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    let totalConversations = 0;
    try { totalConversations = await Message.distinct("uid", { createdAt: { $gte: startDate } }).then(r => r.length); } catch(e) { console.warn("ai-perf distinct:", e.message); }

    let feedbackStats = [];
    try { feedbackStats = await Feedback.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $group: { _id: null, count: { $sum: 1 }, avgRating: { $avg: "$rating" } } }
    ]); } catch(e) { console.warn("ai-perf feedback agg:", e.message); }

    let handoffs = 0;
    try {
      const handoffUsers = await User.find({ metadata: { $contains: { handoffStatus: "human_requested" } } });
      const assignedUsers = await User.find({ metadata: { $contains: { handoffStatus: "human_assigned" } } });
      handoffs = handoffUsers.length + assignedUsers.length;
    } catch(e) { console.warn("ai-perf handoffs:", e.message); }

    let complaints = 0;
    try { complaints = await Feedback.countDocuments({ tags: { $contains: ["complaint"] }, createdAt: { $gte: startDate } }); } catch(e) { console.warn("ai-perf complaints:", e.message); }

    let orders = 0;
    try { orders = await Order.countDocuments({ createdAt: { $gte: startDate } }); } catch(e) { console.warn("ai-perf orders:", e.message); }

    let revenue = 0;
    try {
      const revenueResult = await Order.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } }
      ]);
      revenue = revenueResult[0]?.total || 0;
    } catch(e) { console.warn("ai-perf revenue:", e.message); }

    const automationRate = totalConversations > 0 ? (((totalConversations - handoffs) / totalConversations) * 100).toFixed(1) : 0;

    res.json({
      totalConversations,
      automationRate: parseFloat(automationRate),
      avgRating: feedbackStats[0]?.avgRating?.toFixed(2) || 0,
      feedbackCount: feedbackStats[0]?.count || 0,
      handoffs,
      complaints,
      orders,
      revenue
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── AD SYSTEM ENDPOINTS ────────────────────────────────
app.get("/api/admin/ads", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const performance = await getAdPerformance(parseInt(days));
    res.json(performance);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/admin/ads/clicks", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const clicks = await getRecentClicks(parseInt(limit));
    res.json(clicks);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/admin/ads", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const { adId, campaignId, campaignName, adSetName, adName, platform, creative, targeting, costPerClick, status } = req.body;
    const ad = await Ad.findOneAndUpdate(
      { adId },
      { adId, campaignId, campaignName, adSetName, adName, platform, creative, targeting, costPerClick, status, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    res.json({ success: true, ad });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch("/api/admin/ads/:adId/status", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const ad = await Ad.findOneAndUpdate(
      { adId: req.params.adId },
      { status, updatedAt: new Date() },
      { new: true }
    );
    if (!ad) return res.status(404).json({ error: "Ad not found" });
    res.json({ success: true, ad });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/admin/ads/stats", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const totalAds = await Ad.countDocuments({ status: { $in: ["active", "paused"] } });
    const totalClicks = await AdClick.countDocuments({ clickedAt: { $gte: startDate } });
    const totalConversions = await AdClick.countDocuments({ conversationStarted: true, clickedAt: { $gte: startDate } });
    const conversionRate = totalClicks > 0 ? ((totalConversions / totalClicks) * 100).toFixed(1) : 0;

    const revenueClicks = await AdClick.find({ orderPlaced: true, clickedAt: { $gte: startDate } });
    const totalRevenue = revenueClicks.reduce((sum, c) => sum + (parseFloat(c.revenue) || 0), 0);

    const topAds = await Ad.find({ status: { $in: ["active", "paused"] } })
      .sort({ totalConversations: -1 })
      .limit(5);

    res.json({
      totalAds,
      totalClicks,
      totalConversions,
      conversionRate: parseFloat(conversionRate),
      totalRevenue,
      topAds
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/admin/ads/:adId", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    await Ad.deleteOne({ adId: req.params.adId });
    await AdClick.deleteMany({ adId: req.params.adId });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PUBLIC API ROUTES ─────────────────────────────────────
// Products API
async function withPublicTenant(req, res, next) {
  const tenantInfo = await resolveTenantFromRequest(req);
  if (!tenantInfo || !tenantInfo.tenant_id) {
    return res.status(400).json({ error: "tenant required: pass ?tenant= or X-Tenant-ID header" });
  }
  return runWithTenantContext({ tenant_id: tenantInfo.tenant_id, role: "admin" }, next);
}

app.get("/api/products", withPublicTenant, async (req, res) => {
  try {
    const products = await Product.find({ isActive: true }).sort({ category: 1, createdAt: -1 });
    res.json(products);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/products/category/:category", withPublicTenant, async (req, res) => {
  try {
    const products = await Product.find({ category: req.params.category, isActive: true });
    res.json(products);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ADMIN PRODUCT CRUD ──────────────────────────────────────
app.get("/api/admin/products", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const { category, isActive, search } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (isActive !== undefined) filter.isActive = isActive === "true";
    const products = await Product.find(filter).sort({ category: 1, createdAt: -1 });
    if (search) {
      const q = search.toLowerCase();
      return res.json(products.filter(p =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.description && p.description.toLowerCase().includes(q))
      ));
    }
    res.json(products);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/admin/products/:id", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const product = await Product.findOne({ id: req.params.id });
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json(product);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/admin/products", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const { name, description, price, category, image, imageUrl, keywords, inStock, isActive } = req.body;
    if (!name || price === undefined) {
      return res.status(400).json({ error: "name and price are required" });
    }
    const product = await Product.create({
      name,
      description: description || "",
      price: Number(price),
      category: category || "products",
      image: image || "",
      imageUrl: imageUrl || "",
      keywords: keywords || [],
      inStock: inStock !== false,
      isActive: isActive !== false
    });
    console.log(`[Admin] Product created: ${product.name} (ID: ${product.id})`);
    res.status(201).json({ success: true, product });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put("/api/admin/products/:id", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const existing = await Product.findOne({ id: req.params.id });
    if (!existing) return res.status(404).json({ error: "Product not found" });

    const updates = {};
    const allowed = ["name", "description", "price", "category", "image", "imageUrl", "keywords", "inStock", "isActive"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.price !== undefined) updates.price = Number(updates.price);

    await Product.findOneAndUpdate({ id: req.params.id }, { $set: updates });
    const updated = await Product.findOne({ id: req.params.id });
    console.log(`[Admin] Product updated: ${updated.name} (ID: ${updated.id})`);
    res.json({ success: true, product: updated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/admin/products/:id", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const product = await Product.findOne({ id: req.params.id });
    if (!product) return res.status(404).json({ error: "Product not found" });

    await Product.findOneAndUpdate({ id: req.params.id }, { $set: { isActive: false } });
    console.log(`[Admin] Product soft-deleted: ${product.name} (ID: ${product.id})`);
    res.json({ success: true, message: "Product deactivated" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put("/api/admin/products/:id/restore", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const product = await Product.findOne({ id: req.params.id });
    if (!product) return res.status(404).json({ error: "Product not found" });

    await Product.findOneAndUpdate({ id: req.params.id }, { $set: { isActive: true } });
    console.log(`[Admin] Product restored: ${product.name} (ID: ${product.id})`);
    res.json({ success: true, product: await Product.findOne({ id: req.params.id }) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── KNOWLEDGE BASE API ────────────────────────────────────
// GET entries (optional ?type=business_info|rag filter)
app.get("/api/admin/knowledge", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const filter = {};
    if (req.query.type) filter.type = req.query.type;
    const entries = await KnowledgeBase.find(filter).sort({ createdAt: -1 });
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET business_info entries only (for AI system prompt)
app.get("/api/admin/knowledge/business-info", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const entries = await KnowledgeBase.find({ type: "business_info", isActive: true }).sort({ createdAt: -1 });
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create entry (supports type: "business_info" | "rag")
app.post("/api/admin/knowledge", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const { title, content, category, tags, type } = req.body;
    if (!title || !content) return res.status(400).json({ error: "Title and content are required" });
    const entry = await KnowledgeBase.save({
      title,
      content,
      category: category || "general",
      tags: tags || [],
      type: type || "rag",
      isActive: true
    });
    res.json({ success: true, entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update entry
app.put("/api/admin/knowledge/:id", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const { title, content, category, tags, type, isActive } = req.body;
    const update = {};
    if (title !== undefined) update.title = title;
    if (content !== undefined) update.content = content;
    if (category !== undefined) update.category = category;
    if (tags !== undefined) update.tags = tags;
    if (type !== undefined) update.type = type;
    if (isActive !== undefined) update.isActive = isActive;
    update.updatedAt = new Date().toISOString();
    const entry = await KnowledgeBase.findByIdAndUpdate(req.params.id, { $set: update });
    res.json({ success: true, entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE entry
app.delete("/api/admin/knowledge/:id", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    await KnowledgeBase.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST upload file as knowledge entry (txt, md, csv)
app.post("/api/admin/knowledge/upload", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", async () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");

        // Parse multipart form data manually
        const contentType = req.headers["content-type"] || "";
        if (!contentType.includes("multipart/form-data")) {
          return res.status(400).json({ error: "Expected multipart/form-data" });
        }

        const boundary = contentType.split("boundary=")[1];
        if (!boundary) return res.status(400).json({ error: "Missing boundary" });

        const parts = raw.split("--" + boundary);
        let fileContent = "";
        let fileName = "uploaded-file.txt";
        let fileType = "rag";

        for (const part of parts) {
          if (!part.includes("Content-Disposition")) continue;
          const [headerSection, ...bodyParts] = part.split("\r\n\r\n");
          const body = bodyParts.join("\r\n\r\n").replace(/\r\n--$/, "").trim();

          if (headerSection.includes('name="file"')) {
            const nameMatch = headerSection.match(/filename="(.+?)"/);
            if (nameMatch) fileName = nameMatch[1];
            fileContent = body;
          } else if (headerSection.includes('name="type"')) {
            fileType = body.trim();
          }
        }

        if (!fileContent) {
          return res.status(400).json({ error: "No file content provided" });
        }

        // Split large files into chunks of ~4000 chars for knowledge entries
        const MAX_CHUNK = 4000;
        const entries = [];
        if (fileContent.length <= MAX_CHUNK) {
          const entry = await KnowledgeBase.save({
            title: fileName,
            content: fileContent,
            category: "uploaded",
            tags: [],
            type: fileType,
            isActive: true
          });
          entries.push(entry);
        } else {
          // Split into chunks
          const lines = fileContent.split("\n");
          let chunk = "";
          let chunkIndex = 1;
          for (const line of lines) {
            if ((chunk + "\n" + line).length > MAX_CHUNK && chunk) {
              const entry = await KnowledgeBase.save({
                title: `${fileName} (part ${chunkIndex})`,
                content: chunk.trim(),
                category: "uploaded",
                tags: [],
                type: fileType,
                isActive: true
              });
              entries.push(entry);
              chunkIndex++;
              chunk = line;
            } else {
              chunk += "\n" + line;
            }
          }
          if (chunk.trim()) {
            const entry = await KnowledgeBase.save({
              title: `${fileName} (part ${chunkIndex})`,
              content: chunk.trim(),
              category: "uploaded",
              tags: [],
              type: fileType,
              isActive: true
            });
            entries.push(entry);
          }
        }

        res.json({ success: true, entries, count: entries.length });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/knowledge/reindex", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    await indexAllKnowledge();
    res.json({ success: true, message: "Knowledge base reindexed" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── INTEGRATIONS API (Shopify/WooCommerce) ─────────────────
app.post("/api/admin/integrations/shopify", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const { storeUrl, accessToken } = req.body;
    if (!storeUrl || !accessToken) return res.status(400).json({ error: "Store URL and access token are required" });
    
    const connection = await EcommerceConnection.findOneAndUpdate(
      { platform: "shopify" },
      { 
        platform: "shopify", 
        storeUrl, 
        accessToken,
        isActive: true,
        syncStatus: "never",
        connectedAt: new Date() 
      },
      { upsert: true, new: true }
    );
    res.json({ success: true, connection });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/integrations/woocommerce", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
  try {
    const { storeUrl, consumerKey, consumerSecret } = req.body;
    if (!storeUrl || !consumerKey || !consumerSecret) return res.status(400).json({ error: "Store URL, consumer key, and secret are required" });
    
    const connection = await EcommerceConnection.findOneAndUpdate(
      { platform: "woocommerce" },
      { 
        platform: "woocommerce", 
        storeUrl, 
        consumerKey, 
        consumerSecret,
        isActive: true,
        syncStatus: "never",
        connectedAt: new Date() 
      },
      { upsert: true, new: true }
    );
    res.json({ success: true, connection });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API 404 ────────────────────────────────────────
app.use('/api', (req, res) => { res.status(404).json({ error: "Route not found", path: req.url }); });
app.use('/webhook', (req, res) => { res.status(404).json({ error: "Route not found", path: req.url }); });

// ─── NEXT.JS DASHBOARD ─────────────────────────────────

// ─── CATCH-ALL: SERVE DASHBOARD PAGES ──────────────────
app.all("*", (req, res) => {
  return nextHandle(req, res);
});

// ─── INITIALIZE ADMIN ─────────────────────────────────────
async function initAdmin() {
  const existing = await Admin.findOne({ username: "admin" });
  if (!existing) {
    const bootstrap = process.env.BOOTSTRAP_ADMIN === "true" || process.env.NODE_ENV !== "production";
    if (bootstrap) {
      const password = process.env.ADMIN_PASSWORD;
      if (!password && process.env.NODE_ENV === "production") {
        console.error("❌ ERROR: ADMIN_PASSWORD must be configured in production when bootstrapping an admin!");
        process.exit(1);
      }
      const finalPassword = password || "admin123";
      const hashed = await bcrypt.hash(finalPassword, 10);
      await Admin.save({ username: "admin", password: hashed, role: "admin" });
      console.log(` Default admin created (admin/${password ? "******" : "admin123"})`);
    } else {
      console.log(" Skipping admin auto-bootstrap in production because BOOTSTRAP_ADMIN is not true.");
    }
  }
}

async function initSettings() {
  const existing = await Settings.findOne({ configId: "global" });
  if (!existing) {
    await Settings.save({ configId: "global" });
    console.log(" Default settings initialized");
  }
}

async function seedProducts() {
  const count = await Product.countDocuments();
  if (count === 0) {
    const { seedProducts } = require("./utils/seedProducts");
    await seedProducts();
    console.log(" Products seeded");
  } else {
    console.log(` Products already exist (${count} found). Skipping seed.`);
  }
}

async function initTemplates() {
  await seedTemplates();
}

async function initRAG() {
  try {
    await initPinecone();
    const stats = await getIndexStats();
    console.log(` [RAG] Vector DB: ${stats.totalVectors || 0} vectors indexed`);
  } catch (err) {
    console.log(" [RAG] Vector DB not available (set PINECONE_API_KEY to enable)");
  }
}

// ─── START SERVER ─────────────────────────────────────────
async function startServer() {
  await nextApp.prepare();
  console.log(" Dashboard (Next.js) ready");
  await connectDB();
  await withSuperadmin(async () => {
    await initAdmin();
    await initSettings();
    await seedProducts();
    await initTemplates();
  });
  await initRAG();
  startAutoPurgeCron();
  console.log(`\n${"─".repeat(50)}`);
  console.log(` Cyberbot AI Server`);
  console.log(` Dashboard + API on Port ${PORT}`);
  console.log(` FB_APP_ID: ${process.env.FB_APP_ID ? "Configured " : "MISSING "}`);
  console.log(` FB_APP_SECRET: ${process.env.FB_APP_SECRET ? "Configured " : "MISSING "}`);
  console.log(` VERIFY_TOKEN:  ${process.env.MESSENGER_VERIFY_TOKEN || process.env.VERIFY_TOKEN}`);
  console.log(` Redis: ${process.env.REDIS_URL || "redis://127.0.0.1:6379"}`);
  console.log(` Data Retention: auto-purge enabled (daily 3 AM)`);
  console.log(`${"─".repeat(50)}\n`);
}

async function shutdown() {
  console.log("\n [Server] Shutting down gracefully...");
  await closeRedis().catch(() => {});
  await closeQueues().catch(() => {});
  await closeWorkers().catch(() => {});
  console.log(" [Server] Cleanup complete.");
}

io.on("connection", (socket) => {
  socket.on("disconnect", (reason) => {
    if (reason === "transport close" || reason === "ping timeout") {}
  });
});

process.on("unhandledRejection", (reason, promise) => {
  console.error(" Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error(" Uncaught Exception:", err.message);
  console.error(err.stack);
  shutdown();
  process.exit(1);
});

process.on("SIGINT", async () => { await shutdown(); process.exit(0); });
process.on("SIGTERM", async () => { await shutdown(); process.exit(0); });

if (require.main === module) {
  server.listen(PORT, async () => {
    try {
      await startServer();
    } catch (err) {
      console.error(" Failed to initialize server:", err.message);
      console.error(err.stack);
      process.exit(1);
    }
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(` Port ${PORT} is already in use. Please stop the other process or use a different port.`);
    } else {
      console.error(" Server error:", err.message);
    }
    process.exit(1);
  });

  process.stdin.resume();
}

module.exports = { app, server, io, PORT, startServer, shutdown };
