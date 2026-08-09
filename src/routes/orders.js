/**
 * src/routes/orders.js
 * Protected HTTP order creation endpoint used by internal services / AI path.
 *
 * Auth (either is accepted):
 * 1. X-Internal-Order-Secret header matching INTERNAL_ORDER_SECRET
 * 2. Authenticated admin JWT (authenticateAdmin / authenticateTenant)
 *
 * Tenant isolation:
 * - Prefer tenant_id from ALS (JWT path)
 * - Else accept tenant_id from body only when internal secret is used
 * - createOrderSafe still enforces production tenant_id requirement
 */
const { createOrderSafe } = require("../../utils/createOrderSafe");
const { runWithTenantContext, getTenantContext } = require("../../utils/tenantContext");

function requireOrderApiAuth(req, res, next) {
  const internalSecret = process.env.INTERNAL_ORDER_SECRET;
  const provided =
    req.headers["x-internal-order-secret"] ||
    req.headers["X-Internal-Order-Secret"];

  if (internalSecret && provided && provided === internalSecret) {
    req.orderAuth = { type: "internal" };
    return next();
  }

  // Fall back to admin JWT auth (same middleware used by dashboard)
  let authenticateAdmin;
  try {
    const auth = require("../middleware/auth");
    authenticateAdmin = auth.authenticateTenant || auth.authenticateAdmin;
  } catch (_) {
    authenticateAdmin = null;
  }

  if (typeof authenticateAdmin === "function") {
    return authenticateAdmin(req, res, () => {
      req.orderAuth = { type: "jwt", tenant_id: req.tenant_id || null };
      next();
    });
  }

  return res.status(401).json({
    error:
      "Unauthorized: provide X-Internal-Order-Secret or a valid admin JWT",
  });
}

function registerOrderRoutes(app) {
  if (!app || typeof app.post !== "function") {
    throw new Error("registerOrderRoutes requires an Express app");
  }

  // Avoid double-registration
  if (app.__orderRoutesRegistered) return;
  app.__orderRoutesRegistered = true;

  app.post("/api/orders/from-ai", requireOrderApiAuth, async (req, res) => {
    try {
      const {
        uid,
        customerName,
        customerPhone,
        items,
        deliveryAddress,
        notes,
        tenant_id: bodyTenantId,
      } = req.body || {};

      if (!uid || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Prefer ALS tenant from JWT; for internal secret allow body tenant_id
      const ctx = getTenantContext();
      let tenant_id =
        (ctx && ctx.tenant_id) ||
        req.tenant_id ||
        (req.orderAuth && req.orderAuth.type === "internal"
          ? bodyTenantId
          : null) ||
        null;

      const runCreate = async () => {
        const result = await createOrderSafe(uid, {
          customerName,
          customerPhone,
          items,
          deliveryAddress,
          notes,
          tenant_id: tenant_id || undefined,
        });

        if (!result.success) {
          const status =
            result.error &&
            String(result.error).includes("tenant_id required")
              ? 400
              : 500;
          return res.status(status).json({
            error: result.error || "Order creation failed",
          });
        }

        if (result.duplicate) {
          return res.status(409).json({
            success: true,
            duplicate: true,
            orderId: result.orderId,
            order: result.order,
          });
        }

        return res.json({
          success: true,
          orderId: result.orderId,
          order: result.order,
        });
      };

      // Ensure ALS is set when we have a tenant (JWT path already sets it)
      if (tenant_id && !(ctx && ctx.tenant_id)) {
        return runWithTenantContext(
          { tenant_id, role: "admin", isSuperAdmin: false },
          runCreate
        );
      }

      return await runCreate();
    } catch (err) {
      console.error(" [Orders API] Error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  });
}

module.exports = {
  registerOrderRoutes,
  requireOrderApiAuth,
};
