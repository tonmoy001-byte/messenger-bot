/**
 * src/routes/auth.js
 * Admin auth: signup, login, refresh, logout, Meta OAuth URL + callback.
 */
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const axios = require("axios");
const { encrypt } = require("../utils/security");
const { Admin, Integration } = require("../config/db");
const { signRefreshToken, verifyRefreshToken } = require("../../utils/refreshToken");
const { requireEnv } = require("../config/env");
const { withSuperadmin } = require("../config/superadmin");

const JWT_SECRET = requireEnv("JWT_SECRET", {
  minLength: 16,
  forbid: ["cyberbot-admin-secret-key-change-in-production", "your_jwt_secret_key"]
});

/**
 * Upsert Meta page integrations from the OAuth callback.
 * Runs inside a superadmin tenant context because this callback is invoked by
 * Meta (no admin session) and "integrations" is in MULTI_TENANT_TABLES — the
 * tenant-scope guard would otherwise throw in production.
 */
async function upsertMetaIntegrations(pages, longToken) {
  return withSuperadmin(async () => {
    for (const page of pages || []) {
      await Integration.findOneAndUpdate(
        { type: "facebook", externalId: page.id },
        { $set: { name: page.name, accessToken: encrypt(longToken), isActive: true, metadata: { longLivedToken: encrypt(longToken) } } },
        { upsert: true }
      );
    }
  });
}

function registerAuthRoutes(app, { authLimiter, authenticateAdmin, requireAdmin }) {
  if (!app || typeof app.post !== "function") {
    throw new Error("registerAuthRoutes requires an Express app");
  }
  if (app.__authRoutesRegistered) return;
  app.__authRoutesRegistered = true;

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
      const pagesRes = await axios.get(`https://graph.facebook.com/v19.0/me/accounts?access_token=${longToken}`);
      await upsertMetaIntegrations(pagesRes.data.data || [], longToken);
      res.redirect("/?auth=success");
    } catch (err) {
      console.error("Meta OAuth Error:", err.message);
      res.redirect("/?auth=error");
    }
  });
}

module.exports = { registerAuthRoutes, upsertMetaIntegrations };