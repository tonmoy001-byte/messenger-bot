#!/usr/bin/env node
/**
 * One-shot local patcher for index.js:
 * 1) Wire /api/orders/from-ai to createOrderSafe (Redis idempotency)
 * 2) Register shared health routes when starting via index.js
 *
 * Usage (from repo root):
 *   git checkout master -- index.js   # if index.js is corrupted
 *   node scripts/apply-order-and-health-patch.js
 *   git add index.js && git commit -m "feat: HTTP order endpoint uses createOrderSafe + shared health"
 */
const fs = require("fs");
const path = require("path");

const indexPath = path.join(__dirname, "..", "index.js");
let text = fs.readFileSync(indexPath, "utf8");

if (text.includes("createOrderSafe") && text.includes("registerHealthRoutes")) {
  console.log("Already patched. Nothing to do.");
  process.exit(0);
}

if (text.trim() === "PLACEHOLDER_WILL_FAIL" || text.length < 1000) {
  console.error("index.js looks corrupted. Restore first:");
  console.error("  git checkout master -- index.js");
  console.error("Then re-run this script.");
  process.exit(1);
}

const oldImport =
  'const { buildOrderKey } = require("./utils/orderIdempotency");\n\nconst recentOrders = new Map(); // key -> { createdAt, orderId }\n';

const newImport =
  'const { registerHealthRoutes } = require("./src/routes/health");\n';

if (!text.includes("buildOrderKey") || !text.includes("recentOrders")) {
  console.error("Could not find recentOrders / buildOrderKey block. Manual patch required.");
  process.exit(1);
}

text = text.replace(oldImport, newImport);

if (!text.includes("registerHealthRoutes(app)")) {
  const marker = "const app = express();\nconst server = http.createServer(app);\n";
  if (!text.includes(marker)) {
    console.error("Could not find app/server creation marker.");
    process.exit(1);
  }
  text = text.replace(
    marker,
    marker +
      "\n// Public health endpoints (available whether started via index.js or src/server.js)\nregisterHealthRoutes(app);\n"
  );
}

const newEndpoint = `// Orders API (for AI order flow) — Redis-backed idempotency via createOrderSafe
app.post("/api/orders/from-ai", async (req, res) => {
  try {
    const { uid, customerName, customerPhone, items, deliveryAddress, notes } = req.body;
    if (!uid || !items || items.length === 0) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const { createOrderSafe } = require("./utils/createOrderSafe");
    const result = await createOrderSafe(uid, {
      customerName,
      customerPhone,
      items,
      deliveryAddress,
      notes,
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
});`;

const start = text.indexOf("// Orders API (for AI order flow)");
const end = text.indexOf("// ─── KNOWLEDGE BASE API");
if (start === -1 || end === -1) {
  console.error("Could not locate order endpoint markers.");
  process.exit(1);
}
text = text.slice(0, start) + newEndpoint + "\n\n" + text.slice(end);

fs.writeFileSync(indexPath, text);
console.log("Patched index.js successfully.");
console.log('Next: git add index.js && git commit -m "feat: HTTP order endpoint uses createOrderSafe + shared health"');
