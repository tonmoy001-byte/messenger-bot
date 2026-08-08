/**
 * middleware/auth.js
 * ─────────────────────────────────────────────────────────────
 * Multi-Tenant JWT Authentication & Tenant Context Middleware.
 * Extract tenant details and set active tenant context for the request.
 * ─────────────────────────────────────────────────────────────
 */

const jwt = require("jsonwebtoken");
const { runWithTenantContext } = require("../../utils/tenantContext");

const JWT_SECRET = process.env.JWT_SECRET || "cyberbot-admin-secret-key-change-in-production";

/**
 * authenticateTenant Middleware
 * Extracts tenant context from the verified JWT payload and enforces access control.
 */
function authenticateTenant(req, res, next) {
  let token;
  const authHeader = req.headers.authorization;
  if (authHeader) {
    token = authHeader.split(" ")[1];
  } else {
    // Fallback: read JWT from httpOnly cookie
    const cookies = req.headers.cookie || "";
    const match = cookies.match(/admin_token=([^;]+)/);
    if (match) token = match[1];
  }

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Attach to both req.user and req.admin for compatibility
    req.user = decoded;
    req.admin = decoded;

    // Extract tenant_id
    let tenant_id = decoded.tenant_id || null;

    const isSuperAdmin = decoded.role === "superadmin";

    // Superadmin bypass / impersonation via header
    if (isSuperAdmin) {
      const headerTenantId = req.headers["x-tenant-id"] || req.headers["X-Tenant-ID"] || req.headers["x-tenant-id".toLowerCase()];
      if (headerTenantId) {
        tenant_id = headerTenantId;
      }
    } else {
      // Enforce access control for non-superadmins: tenant_id must be present and valid
      if (!tenant_id) {
        return res.status(401).json({ error: "Unauthorized: tenant context missing" });
      }
    }

    req.tenant_id = tenant_id;

    // Run the rest of the request chain with AsyncLocalStorage tenant context
    const context = {
      tenant_id,
      role: decoded.role,
      isSuperAdmin,
    };

    runWithTenantContext(context, () => {
      next();
    });
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

module.exports = {
  authenticateTenant,
};
