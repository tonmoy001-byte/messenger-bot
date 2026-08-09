/**
 * src/routes/orders.js
 * Protected order HTTP API (admin JWT or internal secret).
 */
function requireOrderApiAuth(authenticateAdmin) {
  return function (req, res, next) {
    const internalSecret = process.env.INTERNAL_ORDER_SECRET;
    const provided = req.headers["x-internal-order-secret"];
    if (internalSecret && provided && provided === internalSecret) {
      const tenant_id = (req.body && req.body.tenant_id) || req.headers["x-tenant-id"] || null;
      if (tenant_id) {
        const { runWithTenantContext } = require("../../utils/tenantContext");
        return runWithTenantContext({ tenant_id, role: "system", isSuperAdmin: false }, () => next());
      }
      return next();
    }
    return authenticateAdmin(req, res, next);
  };
}

function registerOrderRoutes(app, authenticateAdmin) {
  if (!app || app.__orderRoutesRegistered) return;
  app.__orderRoutesRegistered = true;

  app.post("/api/orders/from-ai", requireOrderApiAuth(authenticateAdmin), async (req, res) => {
    try {
      const { uid, customerName, customerPhone, items, deliveryAddress, notes, tenant_id: bodyTenantId } = req.body;
      if (!uid || !items || items.length === 0) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const tenant_id = bodyTenantId || req.tenant_id || null;
      const { createOrderSafe } = require("../../utils/createOrderSafe");
      const result = await createOrderSafe(uid, {
        customerName,
        customerPhone,
        items,
        deliveryAddress,
        notes,
        tenant_id: tenant_id || undefined,
      });

      if (!result.success) {
        return res.status(500).json({ error: result.error || "Order creation failed" });
      }

      if (result.duplicate) {
        return res.status(409).json({
          success: true,
          duplicate: true,
          orderId: result.orderId,
          order: result.order,
        });
      }

      res.json({ success: true, orderId: result.orderId, order: result.order });
    } catch (err) {
      console.error(" [Orders API] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerOrderRoutes };
