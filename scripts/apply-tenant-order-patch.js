#!/usr/bin/env node
/**
 * Applies remaining tenant-isolation patches to orderFlow.js and index.js.
 * Run from repo root after pulling fix/order-tenant-isolation:
 *   node scripts/apply-tenant-order-patch.js
 */
const fs = require("fs");
const path = require("path");

function patchOrderFlow() {
  const p = path.join(__dirname, "..", "utils", "orderFlow.js");
  let t = fs.readFileSync(p, "utf8");
  if (t.includes("tenant_id: tenant_id || undefined")) {
    console.log("orderFlow.js already patched");
    return;
  }
  const old = `        deliveryAddress: data.deliveryAddress,
        notes: \`Ordered via \${selectedProduct.category}\`
      });`;
  const neu = `        deliveryAddress: data.deliveryAddress,
        notes: \`Ordered via \${selectedProduct.category}\`,
        tenant_id: tenant_id || undefined,
      });`;
  if (!t.includes(old)) {
    console.error("orderFlow.js: could not find createOrder payload block");
    process.exit(1);
  }
  fs.writeFileSync(p, t.replace(old, neu));
  console.log("Patched utils/orderFlow.js");
}

function patchIndex() {
  const p = path.join(__dirname, "..", "index.js");
  let t = fs.readFileSync(p, "utf8");
  if (t.includes("requireOrderApiAuth")) {
    console.log("index.js already patched");
    return;
  }
  const start = t.indexOf("// Orders API (for AI order flow)");
  const end = t.indexOf("// \u2500\u2500\u2500 KNOWLEDGE BASE API");
  if (start === -1 || end === -1) {
    // try alternate marker
    const end2 = t.indexOf("// \u2500\u2500\u2500 KNOWLEDGE BASE API");
  }
  const endMarker = "// \u2500\u2500\u2500 KNOWLEDGE BASE API";
  // Use the actual unicode dashes from the file
  const endIdx = t.indexOf("// \u2500\u2500\u2500 KNOWLEDGE BASE API") !== -1
    ? t.indexOf("// \u2500\u2500\u2500 KNOWLEDGE BASE API")
    : t.indexOf("// \u2500\u2500\u2500 KNOWLEDGE BASE API");
  let realEnd = t.indexOf("// \u2500\u2500\u2500 KNOWLEDGE BASE API");
  if (realEnd === -1) {
    // Fallback: search without relying on exact dashes
    realEnd = t.search(/\/\/ .{1,10} KNOWLEDGE BASE API/);
  }
  if (start === -1 || realEnd === -1) {
    console.error("index.js: could not locate order endpoint markers");
    process.exit(1);
  }
  const neu = `// Orders API \u2014 protected; prefer createOrderSafe() in-process for AI flow.
// Auth: admin JWT (sets tenant context) OR X-Internal-Order-Secret header.
function requireOrderApiAuth(req, res, next) {
  const internalSecret = process.env.INTERNAL_ORDER_SECRET;
  const provided = req.headers["x-internal-order-secret"];
  if (internalSecret && provided && provided === internalSecret) {
    const tenantFromBody = req.body && req.body.tenant_id;
    const tenantFromHeader = req.headers["x-tenant-id"];
    const tenant_id = tenantFromBody || tenantFromHeader || null;
    if (tenant_id) {
      const { runWithTenantContext } = require("./utils/tenantContext");
      return runWithTenantContext({ tenant_id, role: "system", isSuperAdmin: false }, () => next());
    }
    return next();
  }
  // Fall back to admin JWT (authenticateTenant also sets tenant ALS context)
  return authenticateAdmin(req, res, next);
}

app.post("/api/orders/from-ai", requireOrderApiAuth, async (req, res) => {
  try {
    const { uid, customerName, customerPhone, items, deliveryAddress, notes, tenant_id: bodyTenantId } = req.body;
    if (!uid || !items || items.length === 0) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const tenant_id = bodyTenantId || req.tenant_id || null;
    const { createOrderSafe } = require("./utils/createOrderSafe");
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

`;
  fs.writeFileSync(p, t.slice(0, start) + neu + t.slice(realEnd));
  console.log("Patched index.js");
}

patchOrderFlow();
patchIndex();
console.log('Done. Commit: git add utils/orderFlow.js index.js && git commit -m "feat: wire tenant_id into orderFlow + protect order HTTP API"');
