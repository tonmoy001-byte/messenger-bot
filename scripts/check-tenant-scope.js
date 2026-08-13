#!/usr/bin/env node
/**
 * scripts/check-tenant-scope.js
 * Tenant-isolation lint: fails when @supabase/supabase-js is imported or
 * createClient() is called anywhere except src/config/supabaseClient.js.
 * The Model wrappers in supabaseClient.js are the single tenant-scoping layer;
 * direct client creation elsewhere bypasses runWithTenantContext.
 *
 *   node scripts/check-tenant-scope.js   # scan repo root, exit 1 on offenders
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ALLOWED_FILE = "src/config/supabaseClient.js";

const BAD_REQUIRE_RE = /require\(["']@supabase\/supabase-js["']\)/;
const BAD_CREATE_RE = /createClient\s*\(/;

function walk(dir, root, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).split(path.sep).join("/");
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dashboard") continue;
      walk(full, root, out);
    } else if (entry.name.endsWith(".js")) {
      if (rel === ALLOWED_FILE) continue;
      const content = fs.readFileSync(full, "utf8");
      if (BAD_REQUIRE_RE.test(content) || BAD_CREATE_RE.test(content)) {
        out.push(rel);
      }
    }
  }
}

function scanForDirectSupabase(rootDir) {
  const offenders = [];
  const srcDir = path.join(rootDir, "src");
  const utilsDir = path.join(rootDir, "utils");
  if (fs.existsSync(srcDir)) walk(srcDir, rootDir, offenders);
  if (fs.existsSync(utilsDir)) walk(utilsDir, rootDir, offenders);
  return offenders.sort();
}

if (require.main === module) {
  const offenders = scanForDirectSupabase(ROOT);
  if (offenders.length) {
    console.error("TENANT SCOPE VIOLATION: direct Supabase client usage outside src/config/supabaseClient.js:");
    offenders.forEach((f) => console.error("  - " + f));
    process.exit(1);
  }
  console.log("OK: no direct Supabase client usage outside src/config/supabaseClient.js");
}

module.exports = { scanForDirectSupabase };
