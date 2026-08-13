/**
 * src/app.js
 * Composition root: builds Express app + HTTP server + Socket.IO, wires body
 * parsers/static/CORS/limiters, registers every register*Routes in the current
 * order, and serves the Next.js dashboard via the passed-in nextHandle (last).
 */
const express = require("express");
const http = require("http");
const path = require("path");
const socketIo = require("socket.io");
const rateLimit = require("express-rate-limit");

const { registerHealthRoutes } = require("./routes/health");
const { registerOrderRoutes } = require("./routes/orders");
const { registerChatRoutes } = require("./routes/chat");
const { registerAuthRoutes } = require("./routes/auth");
const { registerWebhookRoutes } = require("./routes/webhooks");
const { registerIntegrationsRoutes } = require("./routes/integrations");
const { registerAdminRoutes } = require("./routes/admin");
const { registerAdsRoutes } = require("./routes/ads");
const { registerProductsRoutes } = require("./routes/products");
const { registerKnowledgeRoutes } = require("./routes/knowledge");

const { createMessageHandlers } = require("./services/channels/messageHandlers");
const { upsertUser, saveMessage } = require("./utils/messageHelpers");
const { generateReply } = require("./services/ai/gemini");
const { extractAdContext, trackAdClick } = require("../utils/adTracking");
const { makeRequireRole } = require("../utils/rbac");
const { authenticateTenant } = require("./middleware/auth");
const { Settings } = require("./config/db");

function createApp({ nextHandle }) {
  const app = express();
  const server = http.createServer(app);

  // Public health endpoints (registered before Next.js catch-all)
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

  const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { error: "Too many requests" }, standardHeaders: true, legacyHeaders: false });
  const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: "Rate limit exceeded" } });
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: "Too many auth attempts" } });

  app.use(express.json({
    limit: "10mb",
    verify: (req, _res, buf) => { req.rawBody = buf.toString(); }
  }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, "..", "landing")));

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

  const authenticateAdmin = authenticateTenant;
  const requireAdmin = makeRequireRole("admin");

  registerAuthRoutes(app, { authLimiter, authenticateAdmin, requireAdmin });
  registerIntegrationsRoutes(app, { adminLimiter, authenticateAdmin, requireAdmin });

  const { handleMessengerEvent, handleWhatsAppEvent, handleInstagramEvent } =
    createMessageHandlers({ io, upsertUser, saveMessage });
  registerWebhookRoutes(app, { io, handleMessengerEvent, handleWhatsAppEvent, handleInstagramEvent });

  registerAdminRoutes(app, { io, adminLimiter, authenticateAdmin, requireAdmin });
  registerAdsRoutes(app, { adminLimiter, authenticateAdmin, requireAdmin });
  registerProductsRoutes(app, { adminLimiter, authenticateAdmin, requireAdmin });
  registerKnowledgeRoutes(app, { adminLimiter, authenticateAdmin, requireAdmin });

  // ─── API 404 ────────────────────────────────────────
  app.use('/api', (req, res) => { res.status(404).json({ error: "Route not found", path: req.url }); });
  app.use('/webhook', (req, res) => { res.status(404).json({ error: "Route not found", path: req.url }); });

  // ─── NEXT.JS DASHBOARD (catch-all, last) ────────────
  if (nextHandle) {
    app.all("*", (req, res) => {
      return nextHandle(req, res);
    });
  }

  io.on("connection", (socket) => {
    socket.on("disconnect", (reason) => {
      if (reason === "transport close" || reason === "ping timeout") {}
    });
  });

  return { app, server, io };
}

module.exports = { createApp };