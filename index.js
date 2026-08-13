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
const { registerAuthRoutes } = require("./src/routes/auth");
registerAuthRoutes(app, { authLimiter, authenticateAdmin, requireAdmin });

// ─── INTEGRATIONS ─────────────────────────────────────────
const { registerIntegrationsRoutes } = require("./src/routes/integrations");
registerIntegrationsRoutes(app, { adminLimiter, authenticateAdmin, requireAdmin });

const { registerWebhookRoutes } = require("./src/routes/webhooks");
registerWebhookRoutes(app, { io, handleMessengerEvent, handleWhatsAppEvent, handleInstagramEvent });

const { registerAdminRoutes } = require("./src/routes/admin");
registerAdminRoutes(app, { io, adminLimiter, authenticateAdmin, requireAdmin });

const { registerAdsRoutes } = require("./src/routes/ads");
registerAdsRoutes(app, { adminLimiter, authenticateAdmin, requireAdmin });

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
