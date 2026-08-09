require("dotenv").config();
const { app, server, io, startServer } = require("../index");
const next = require("next");
const { parse } = require("url");

const dev = process.env.NODE_ENV !== "production";
const port = process.env.PORT || 3000;
const hostname = "localhost";

const nextApp = next({ dev, hostname, port, dir: "./dashboard" });
const handle = nextApp.getRequestHandler();

// ─── Public health endpoints (registered before Next.js catch-all) ───
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "cyberbot",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get("/ready", async (req, res) => {
  const checks = { db: false, redis: false };
  try {
    const { supabase } = require("./config/db");
    const { error } = await supabase.from("users").select("id").limit(1);
    checks.db = !error;
  } catch {
    checks.db = false;
  }

  try {
    const { redis } = require("../utils/dedup");
    if (redis && redis.status === "ready") {
      const pong = await redis.ping();
      checks.redis = pong === "PONG";
    }
  } catch {
    checks.redis = false;
  }

  // DB is required; Redis is preferred but optional
  const ready = checks.db;
  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    checks,
    timestamp: new Date().toISOString(),
  });
});

async function main() {
  await nextApp.prepare();

  // Next.js handles remaining routes (must be last)
  app.use((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  await startServer();

  server.listen(port, () => {
    console.log(`\n Server running at http://localhost:${port}`);
    console.log(` Dashboard: http://localhost:${port}/dashboard`);
    console.log(` Health:    http://localhost:${port}/health`);
    console.log(` API:       http://localhost:${port}/api/admin/stats\n`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
