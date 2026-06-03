require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const http = require("http");
const socketIo = require("socket.io");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const axios = require("axios");
const rateLimit = require("express-rate-limit");
const path = require("path");
const { encrypt, decrypt } = require("./security");
const { connectDB, User, Message, Admin, Order, Product, Settings, Integration, OrderSession, Payment, Broadcast, Template, EcommerceConnection, KnowledgeBase, Feedback, ConversationAnalytics, Ad, AdClick } = require("./db");

const { generateReply } = require("./gemini");
const { sendMessage, sendTyping, getUserProfile, downloadExternalMedia } = require("./messenger");
const { sendWhatsAppMessage, markWhatsAppAsRead, downloadWhatsAppMedia, isWithin24HourWindow } = require("./whatsapp");
const { sendInstagramMessage, sendInstagramTyping, downloadInstagramMedia, getInstagramUserProfile } = require("./instagram");
const { createBkashPayment, executeBkashPayment, createNagadPayment, markCOD } = require("./utils/payments");
const { matchProducts, buildMatchResponse } = require("./utils/imageMatcher");
const { detectComplaint } = require("./utils/complaintDetector");
const { sendTemplateMessage, getTemplates, deleteTemplate, createWhatsAppTemplate, seedTemplates } = require("./utils/whatsappTemplates");
const { testShopifyConnection, syncShopifyProducts, createShopifyOrder, getShopifyOrders, verifyShopifyWebhook } = require("./utils/shopify");
const { testWooConnection, syncWooProducts, createWooOrder, getWooOrders, verifyWooWebhook } = require("./utils/woocommerce");
const { retrieveContext, indexKnowledgeEntry, indexProduct, indexAllProducts, indexAllKnowledge, unindexEntry, buildRAGPrompt } = require("./utils/rag");
const { initPinecone, getIndexStats } = require("./utils/vectorDB");
const { analyzeConversations, identifyFailurePatterns, suggestKnowledgeAdditions, exportFineTuningData } = require("./utils/conversationAnalyzer");
const { extractAdContext, trackAdClick, markAdConversion, getUserAdContext, getAdPerformance, getRecentClicks } = require("./utils/adTracking");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ["websocket", "polling"]
});
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "cyberbot-secret";

const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { error: "Too many requests" }, standardHeaders: true, legacyHeaders: false });
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: "Rate limit exceeded" } });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: "Too many auth attempts" } });

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "dashboard", "dist")));
app.use(express.static(path.join(__dirname, "landing")));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  next();
});

// ─── AUTH MIDDLEWARE ──────────────────────────────────────
function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "No token provided" });
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
}

// ─── HELPER FUNCTIONS ─────────────────────────────────────
async function upsertUser(uid, platform, name = null, profilePic = null) {
  await User.findOneAndUpdate(
    { uid },
    { $set: { platform, name: name || null, profilePic: profilePic || null, lastSeen: new Date() } },
    { upsert: true, new: true }
  );
}

async function saveMessage(uid, role, content, mediaUrl = null) {
  await new Message({ uid, role, content, mediaUrl, timestamp: new Date() }).save();
}

// ─── AUTH ROUTES ──────────────────────────────────────────
app.post("/api/auth/login", authLimiter, async (req, res) => {
  const { username, password } = req.body;
  try {
    const admin = await Admin.findOne({ username });
    if (!admin) return res.status(401).json({ error: "Invalid credentials" });
    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });
    await Admin.findByIdAndUpdate(admin._id, { lastLoginAt: new Date() });
    const token = jwt.sign({ id: admin._id, username: admin.username, role: admin.role }, JWT_SECRET, { expiresIn: "24h" });
    res.json({ token, username: admin.username, role: admin.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/auth/meta/url", authenticateAdmin, async (req, res) => {
  try {
    const type = req.query.type || "facebook";
    const redirectUri = process.env.META_REDIRECT_URI || `${process.env.BASE_URL || "http://localhost:3000"}/api/auth/meta/callback`;
    const scopes = type === "whatsapp"
      ? "whatsapp_business_management,whatsapp_business_messaging"
      : "pages_show_list,pages_manage_metadata,pages_messaging,instagram_basic,instagram_manage_messages";
    const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${process.env.FB_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&response_type=code`;
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/auth/meta/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.status(400).send("No code provided");
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
app.get("/webhook/messenger", (req, res) => {
   const mode = req.query["hub.mode"];
   const token = req.query["hub.verify_token"];
   const challenge = req.query["hub.challenge"];
   const expectedToken = process.env.MESSENGER_VERIFY_TOKEN || process.env.VERIFY_TOKEN;
   if (mode === "subscribe" && token === expectedToken) {
     console.log(" Messenger Webhook verified!");
     res.status(200).send(challenge);
   } else { res.sendStatus(403); }
 });

app.post("/webhook/messenger", async (req, res) => {
  const body = req.body;
  if (body.object !== "page") return res.sendStatus(404);
  res.status(200).send("EVENT_RECEIVED");
  for (const entry of body.entry || []) {
    const pageId = entry.id;
    for (const event of entry.messaging || []) {
      try { await handleMessengerEvent(event, pageId); } catch (err) { console.error(" Messenger Error:", err.message); }
    }
  }
});

app.get("/webhook/whatsapp", (req, res) => {
   const mode = req.query["hub.mode"];
   const token = req.query["hub.verify_token"];
   const challenge = req.query["hub.challenge"];
   const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN || process.env.VERIFY_TOKEN;
   if (mode === "subscribe" && token === expectedToken) {
     console.log(" WhatsApp Webhook verified!");
     res.status(200).send(challenge);
   } else { res.sendStatus(403); }
 });

app.post("/webhook/whatsapp", async (req, res) => {
  const body = req.body;
  if (body.object === "whatsapp_business_account") {
    res.status(200).send("EVENT_RECEIVED");
    for (const entry of body.entry || []) {
      const wabaId = entry.id;
      for (const change of entry.changes || []) {
        if (change.value && change.value.messages) {
          const contact = (change.value.contacts && change.value.contacts[0]) ? change.value.contacts[0] : null;
          for (const message of change.value.messages) {
            try { await handleWhatsAppEvent(message, contact, wabaId); } catch (err) { console.error(" WhatsApp Error:", err.message); }
          }
        }
      }
    }
  } else { res.sendStatus(404); }
});

app.get("/webhook/instagram", (req, res) => {
   const mode = req.query["hub.mode"];
   const token = req.query["hub.verify_token"];
   const challenge = req.query["hub.challenge"];
   const expectedToken = process.env.INSTAGRAM_VERIFY_TOKEN || process.env.VERIFY_TOKEN;
   if (mode === "subscribe" && token === expectedToken) {
     console.log(" Instagram Webhook verified!");
     res.status(200).send(challenge);
   } else { res.sendStatus(403); }
 });

app.post("/webhook/instagram", async (req, res) => {
  const body = req.body;
  if (body.object !== "instagram") return res.sendStatus(404);
  res.status(200).send("EVENT_RECEIVED");
  for (const entry of body.entry || []) {
    const pageId = entry.id;
    for (const event of entry.messaging || []) {
      try { await handleInstagramEvent(event, pageId); } catch (err) { console.error(" Instagram Error:", err.message); }
    }
  }
});

// ─── ADMIN DASHBOARD API ──────────────────────────────────
app.get("/api/admin/conversations", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const users = await User.find().sort({ lastSeen: -1 });
    const convos = await Promise.all(users.map(async (u) => {
      const lastMsg = await Message.findOne({ uid: u.uid }).sort({ timestamp: -1 });
      return { customerId: u.uid, customerName: u.name, profilePic: u.profilePic, platform: u.platform, lastMessage: lastMsg ? lastMsg.content : "No messages yet", lastMessageTime: lastMsg ? lastMsg.timestamp : u.lastSeen, unread: false };
    }));
    res.json(convos);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/admin/messages/:uid", adminLimiter, authenticateAdmin, async (req, res) => {
  try { const messages = await Message.find({ uid: req.params.uid }).sort({ timestamp: 1 }); res.json(messages); }
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
  try { const orders = await Order.find().sort({ timestamp: -1 }); res.json(orders); }
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
  try { let settings = await Settings.findOne({ configId: "global" }); if (!settings) settings = await new Settings().save(); res.json(settings); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/admin/settings", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const update = req.body;
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
    const dailyVolume = await Message.aggregate([{ $match: { timestamp: { $gte: sevenDaysAgo } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } }, count: { $sum: 1 } } }, { $sort: { "_id": 1 } }]);
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
    const messagesToday = await Message.countDocuments({ timestamp: { $gte: today } });
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const revenueByDay = await Order.aggregate([{ $match: { timestamp: { $gte: sevenDaysAgo } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } }, revenue: { $sum: "$totalAmount" }, orders: { $sum: 1 } } }, { $sort: { "_id": 1 } }]);
    const platformBreakdown = await User.aggregate([{ $group: { _id: "$platform", count: { $sum: 1 } } }]).then(r => r.map(x => ({ platform: x._id, count: x.count })));
    res.json({ totalCustomers, totalOrders, totalRevenue, avgOrderValue, messagesToday, revenueByDay: revenueByDay.map(d => ({ day: d._id, revenue: d.revenue, orders: d.orders })), platformBreakdown });
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
    const orders = await Order.find().sort({ timestamp: -1 });
    const rows = [["Order ID", "Customer", "Platform", "Items", "Total", "Status", "Date"]];
    for (const o of orders) {
      rows.push([o._id.toString(), o.customerName || o.uid, o.platform || "unknown", o.details || "", o.totalAmount, o.status, o.timestamp ? o.timestamp.toISOString() : ""]);
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
    res.json({ customers: customers.map(c => ({ id: c.uid, name: c.name, platform: c.platform })), orders: orders.map(o => ({ id: o._id, customer: o.customerName, status: o.status })), messages: messages.map(m => ({ uid: m.uid, content: m.content, role: m.role })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/admin/notifications", adminLimiter, authenticateAdmin, async (req, res) => { try { res.json([]); } catch (err) { res.status(500).json({ error: err.message }); } });
app.put("/api/admin/notifications/:id/read", adminLimiter, authenticateAdmin, async (req, res) => { try { res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.get("/api/admin/audit-logs", adminLimiter, authenticateAdmin, async (req, res) => { try { res.json([]); } catch (err) { res.status(500).json({ error: err.message }); } });

app.get("/api/admin/team", adminLimiter, authenticateAdmin, async (req, res) => {
  try { const admins = await Admin.find({}, { username: 1, role: 1, lastLoginAt: 1, isActive: 1 }); res.json(admins); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/admin/team/invite", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const admin = await new Admin({ username, password: hashedPassword, role: role || "agent" }).save();
    res.json({ success: true, admin: { username: admin.username, role: admin.role } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/admin/team/:id", adminLimiter, authenticateAdmin, async (req, res) => {
  try { await Admin.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── WEBSITE CHAT ENDPOINT ────────────────────────────────
app.post("/api/chat", chatLimiter, async (req, res) => {
  const { message, userId, mediaData, referral } = req.body;
  if (!message && !mediaData) return res.status(400).json({ error: "Message or image is required" });
  const senderId = userId || "web-user-" + Math.random().toString(36).substring(7);
  console.log(` [Web Chat] ${senderId}: "${message || "[Image]"}"`);
  try {
    await upsertUser(senderId, "web");
    await saveMessage(senderId, "user", message || "[Image]");
    io.emit("new_message", { uid: senderId, role: "user", content: message || "[Image]", timestamp: new Date() });
    
    // Ad tracking for web chat
    const adContext = extractAdContext(referral);
    if (adContext) {
      await trackAdClick(senderId, "web", adContext, message);
    }
    
    let settings = await Settings.findOne({ configId: "global" });
    if (!settings) settings = { autoReply: true };
    if (!settings.autoReply) return res.json({ reply: "Auto-reply is off.", userId: senderId });
    const reply = await generateReply(senderId, message, mediaData, "Web User", adContext);
    await saveMessage(senderId, "model", reply);
    io.emit("new_message", { uid: senderId, role: "model", content: reply, timestamp: new Date() });
    res.json({ reply, userId: senderId });
  } catch (err) { console.error(" Web Chat Error:", err.message); res.status(500).json({ error: "Internal Server Error" }); }
});

// ─── MESSENGER HANDLER ────────────────────────────────────
async function handleMessengerEvent(event, pageId) {
  try {
    const senderId = event.sender?.id;
    if (!senderId || event.message?.is_echo) return;
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
    } catch (profileErr) {}
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
    try { reply = await generateReply(senderId, text, mediaData, displayName, adContext); }
    catch (aiErr) { console.error(" AI Error:", aiErr.message); reply = "Thank you for your message! We'll get back to you shortly."; }
    await saveMessage(senderId, "model", reply);
    await sendMessage(senderId, reply, pageId);
    io.emit("new_message", { uid: senderId, role: "model", content: reply, timestamp: new Date() });
  } catch (err) { console.error(" Messenger Handler Error:", err.message); }
}

// ─── WHATSAPP HANDLER ─────────────────────────────────────
async function handleWhatsAppEvent(message, contact, wabaId) {
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
    await saveMessage(from, "user", text || "[Image]");
    io.emit("new_message", { uid: from, role: "user", content: text || "[Image]", timestamp: new Date(), customerName: displayName });
    const complaint = text ? detectComplaint(text) : { isComplaint: false, isHandoffRequest: false, sentiment: "neutral" };
    if (complaint.isComplaint || complaint.isHandoffRequest) {
      io.emit("complaint_detected", { uid: from, customerName: displayName, complaint, message: text });
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

    const reply = await generateReply(from, text, mediaData, displayName);
    await saveMessage(from, "model", reply);
    await sendWhatsAppMessage(from, reply, wabaId);
    io.emit("new_message", { uid: from, role: "model", content: reply, timestamp: new Date() });
  } catch (err) { console.error(" WhatsApp Handler Error:", err.message); }
}

// ─── INSTAGRAM HANDLER ────────────────────────────────────
async function handleInstagramEvent(event, pageId) {
  try {
    const senderId = event.sender?.id;
    if (!senderId || event.message?.is_echo) return;
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
    } catch (profileErr) {}
    displayName = displayName || "IG User " + senderId.slice(-8);
    console.log(' [Instagram] %s (%s): "%s"', senderId, displayName, text || "[Image]");
    await upsertUser(senderId, "instagram", displayName, profilePic);
    await saveMessage(senderId, "user", text || "[Image]");
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
    try { reply = await generateReply(senderId, text, mediaData, displayName, adContext); }
    catch (aiErr) { console.error(" AI Error:", aiErr.message); reply = "Thank you for your message! We'll get back to you shortly."; }
    await saveMessage(senderId, "model", reply);
    await sendInstagramMessage(senderId, reply, pageId);
    io.emit("new_message", { uid: senderId, role: "model", content: reply, timestamp: new Date() });
  } catch (err) { console.error(" Instagram Handler Error:", err.message); }
}

// ── FEEDBACK & AI LEARNING ENDPOINTS ────────────────────────────────
app.post("/api/admin/feedback", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const { messageId, uid, platform, rating, userMessage, aiResponse, correctedResponse, feedback, tags } = req.body;
    const entry = await new Feedback({ messageId, uid, platform, rating, userMessage, aiResponse, correctedResponse, feedback, tags }).save();
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

    const totalConversations = await Message.distinct("uid", { timestamp: { $gte: startDate } }).then(r => r.length);
    const feedbackStats = await Feedback.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $group: { _id: null, count: { $sum: 1 }, avgRating: { $avg: "$rating" } } }
    ]);

    const handoffs = await User.countDocuments({ "metadata.handoffStatus": { $in: ["human_requested", "human_assigned"] } });
    const complaints = await Feedback.countDocuments({ tags: "complaint", createdAt: { $gte: startDate } });
    const orders = await Order.countDocuments({ timestamp: { $gte: startDate } });

    const revenueResult = await Order.aggregate([
      { $match: { timestamp: { $gte: startDate } } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } }
    ]);

    const automationRate = totalConversations > 0 ? (((totalConversations - handoffs) / totalConversations) * 100).toFixed(1) : 0;

    res.json({
      totalConversations,
      automationRate: parseFloat(automationRate),
      avgRating: feedbackStats[0]?.avgRating?.toFixed(2) || 0,
      feedbackCount: feedbackStats[0]?.count || 0,
      handoffs,
      complaints,
      orders,
      revenue: revenueResult[0]?.total || 0
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

app.post("/api/admin/ads", adminLimiter, authenticateAdmin, async (req, res) => {
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

app.patch("/api/admin/ads/:adId/status", adminLimiter, authenticateAdmin, async (req, res) => {
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
    const totalConversions = await AdClick.countDocuments({ converted: true, clickedAt: { $gte: startDate } });
    const conversionRate = totalClicks > 0 ? ((totalConversions / totalClicks) * 100).toFixed(1) : 0;

    const revenueResult = await AdClick.aggregate([
      { $match: { converted: true, clickedAt: { $gte: startDate } } },
      { $lookup: { from: "orders", localField: "orderId", foreignField: "_id", as: "order" } },
      { $unwind: { path: "$order", preserveNullAndEmptyArrays: true } },
      { $group: { _id: null, totalRevenue: { $sum: "$order.totalAmount" } } }
    ]);

    const topAds = await Ad.find({ status: { $in: ["active", "paused"] } })
      .sort({ totalConversations: -1 })
      .limit(5)
      .select("adId campaignName adName totalClicks totalConversations totalOrders totalRevenue");

    res.json({
      totalAds,
      totalClicks,
      totalConversions,
      conversionRate: parseFloat(conversionRate),
      totalRevenue: revenueResult[0]?.totalRevenue || 0,
      topAds
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/admin/ads/:adId", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    await Ad.deleteOne({ adId: req.params.adId });
    await AdClick.deleteMany({ adId: req.params.adId });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PUBLIC API ROUTES ─────────────────────────────────────
// Products API
app.get("/api/products", async (req, res) => {
  try {
    const products = await Product.find({ isActive: true }).sort({ category: 1, createdAt: -1 });
    res.json(products);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/products/category/:category", async (req, res) => {
  try {
    const products = await Product.find({ category: req.params.category, isActive: true });
    res.json(products);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Orders API (for AI order flow)
app.post("/api/orders/from-ai", async (req, res) => {
  try {
    const { uid, customerName, customerPhone, items, deliveryAddress, notes } = req.body;
    if (!uid || !items || items.length === 0) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    
    const totalAmount = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    const order = await Order.create({
      uid,
      customerName: customerName || "AI Customer",
      customerPhone: customerPhone || "",
      items,
      totalAmount,
      deliveryAddress: deliveryAddress || "",
      notes: notes || "",
      status: "pending"
    });
    
    res.json({ success: true, order });
  } catch (err) {
    console.error(" [Orders API] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── KNOWLEDGE BASE API ────────────────────────────────────
app.get("/api/admin/knowledge", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const entries = await KnowledgeBase.find().sort({ createdAt: -1 });
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/knowledge", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const { title, content, category, tags } = req.body;
    if (!title || !content) return res.status(400).json({ error: "Title and content are required" });
    const entry = await new KnowledgeBase({ title, content, category: category || "general", tags: tags || [] }).save();
    res.json({ success: true, entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/knowledge/:id", adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    await KnowledgeBase.findByIdAndDelete(req.params.id);
    res.json({ success: true });
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
app.post("/api/admin/integrations/shopify", adminLimiter, authenticateAdmin, async (req, res) => {
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

app.post("/api/admin/integrations/woocommerce", adminLimiter, authenticateAdmin, async (req, res) => {
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

// ─── SPA FALLBACK ────────────────────────────────────────
app.get('*', (req, res, next) => {
  if (!req.path.startsWith('/api/') && !req.path.startsWith('/webhook/')) {
    res.sendFile(path.join(__dirname, "dashboard", "dist", "index.html"));
  } else {
    next();
  }
});

// ─── CATCH-ALL 404 ────────────────────────────────────────
app.use((req, res) => { res.status(404).json({ error: "Route not found", path: req.url }); });

// ─── INITIALIZE ADMIN ─────────────────────────────────────
async function initAdmin() {
  const existing = await Admin.findOne({ username: "admin" });
  if (!existing) {
    const hashed = await bcrypt.hash(process.env.ADMIN_PASSWORD || "admin123", 10);
    await new Admin({ username: "admin", password: hashed, role: "admin" }).save();
    console.log(" Default admin created (admin/admin123)");
  }
}

async function initSettings() {
  const existing = await Settings.findOne({ configId: "global" });
  if (!existing) {
    await new Settings({ configId: "global" }).save();
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
server.listen(PORT, async () => {
  try {
    await connectDB();
    await initAdmin();
    await initSettings();
    await seedProducts();
    await initTemplates();
    await initRAG();
    console.log(`\n${"─".repeat(50)}`);
    console.log(` Cyberbot AI Server`);
    console.log(` WebSocket enabled on Port ${PORT}`);
    console.log(` FB_APP_ID: ${process.env.FB_APP_ID ? "Configured " : "MISSING "}`);
    console.log(` FB_APP_SECRET: ${process.env.FB_APP_SECRET ? "Configured " : "MISSING "}`);
    console.log(`${"─".repeat(50)}\n`);
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

io.on("connection", (socket) => {
  socket.on("disconnect", (reason) => {
    if (reason === "transport close" || reason === "ping timeout") {}
  });
});

process.on("unhandledRejection", (reason, promise) => {
  console.error(" Unhandled Rejection at:", promise, "reason:", reason);
  // Don't exit on unhandled rejections during runtime
});

process.on("uncaughtException", (err) => {
  console.error(" Uncaught Exception:", err.message);
  console.error(err.stack);
  // Graceful shutdown
  process.exit(1);
});

// Keep process alive
process.stdin.resume();
