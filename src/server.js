require("dotenv").config();
const path = require("path");
const bcrypt = require("bcryptjs");
const next = require("next");

const { createApp } = require("./app");
const { validateEnv } = require("./config/env");
const { connectDB, Admin, Settings, Product } = require("./config/db");
const { withSuperadmin } = require("./config/superadmin");
const { seedTemplates } = require("../utils/whatsappTemplates");
const { initPinecone, getIndexStats } = require("../utils/vectorDB");
const { startAutoPurgeCron } = require("../utils/dataRetention");
const { closeRedis } = require("../utils/dedup");
const { closeQueues } = require("../utils/queue");
const { closeWorkers } = require("../utils/worker");

validateEnv();

const dev = process.env.NODE_ENV !== "production";
const PORT = process.env.PORT || 3000;
const dashboardDir = path.join(__dirname, "..", "dashboard");
const nextApp = next({ dev, dir: dashboardDir });
const nextHandle = nextApp.getRequestHandler();

const { app, server, io } = createApp({ nextHandle });

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
    const { seedProducts } = require("../utils/seedProducts");
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
  await new Promise((resolve) => server.close(resolve));
  io.close();
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

const isMainEntry = require.main === module || (process.argv[1] && /(index|server)\.js$/.test(process.argv[1]));

if (isMainEntry) {
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
