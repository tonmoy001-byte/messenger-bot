/**
 * src/routes/health.js
 * Shared public health / readiness routes.
 * Safe to register from both index.js and src/server.js (idempotent).
 */
function registerHealthRoutes(app) {
  if (app.__cyberbotHealthRegistered) return;
  app.__cyberbotHealthRegistered = true;

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
      const { supabase } = require("../config/db");
      const { error } = await supabase.from("users").select("id").limit(1);
      checks.db = !error;
    } catch {
      checks.db = false;
    }

    try {
      const { redis } = require("../../utils/dedup");
      if (redis && redis.status === "ready") {
        const pong = await redis.ping();
        checks.redis = pong === "PONG";
      }
    } catch {
      checks.redis = false;
    }

    const ready = checks.db;
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      checks,
      timestamp: new Date().toISOString(),
    });
  });
}

module.exports = { registerHealthRoutes };
