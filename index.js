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

const { createApp } = require("./src/app");
const { app, server, io } = createApp({ nextHandle });

const PORT = process.env.PORT || 3000;

const { validateEnv } = require("./src/config/env");

// Run global environment variable validation on startup
validateEnv();

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
