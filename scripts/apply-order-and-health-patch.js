#!/usr/bin/env node
/**
 * One-shot local patcher for index.js:
 * 1) Wire /api/orders/from-ai to createOrderSafe (Redis idempotency)
 * 2) Register shared health routes when starting via index.js
 *
 * Usage (from repo root):
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

const oldImport = `const { buildOrderKey } = require(\"./utils/orderIdempotency\");\n\nconst recentOrders = new Map(); // key -> { createdAt, orderId }\n`;
const newImport = `const { createOrderSafe } = require(\\./utils/createOrderSafe\");\n`;

// Fix escaping
const oldImportReal =
  'const { buildOrderKey } = require(\"./utils/orderIdempotency\");\n\nconst recentOrders = new Map(); // key -> { createdAt, orderId }\n';

const newImportReal =
  'const { createOrderSafe } = require(\\./utils/createOrderSafe\");\n'.replace(
    "\\./",
    "./"
  );

const oldImportExact =
  'const { buildOrderKey } = require(\"./utils/orderIdempotency\");\n\nconst recentOrders = new Map(); // key -> { createdAt, orderId }\n';

// Use plain strings without over-escaping
const A =
  'const { buildOrderKey } = require(\"./utils/orderIdempotency\");\n\nconst recentOrders = new Map(); // key -> { createdAt, orderId }\n';

console.log("This script needs the exact source text. Prefer applying the unified diff instead.");
console.log("See scripts/order-health.patch");
process.exit(1);
