/**
 * scripts/backfill-tenant-settings.js
 * One-time backfill: copy the global settings row into a per-tenant row
 * for every existing tenant. Idempotent (upsert keyed on tenant_id + configId).
 *
 * Run: node scripts/backfill-tenant-settings.js
 * Requires: working SUPABASE_URL / SUPABASE_ANON_KEY in .env
 */
const { Tenant, Settings } = require("../src/config/db");
const { runWithTenantContext } = require("../utils/tenantContext");

const COPY_KEYS = (row) => Object.fromEntries(
  Object.entries(row).filter(([k]) => !["id", "tenant_id", "deleted_at", "_doc"].includes(k))
);

async function backfill() {
  const globalRow = await Settings.findOne({ configId: "global" });
  const tenants = await Tenant.find({ deleted_at: null });
  console.log(`[Backfill] ${tenants.length} tenants, global settings ${globalRow ? "present" : "missing"}`);

  let updated = 0;
  for (const tenant of tenants) {
    const existing = await runWithTenantContext({ tenant_id: String(tenant.id), role: "admin" }, () =>
      Settings.findOne({ configId: "global" })
    );
    if (existing) continue;
    await runWithTenantContext({ tenant_id: String(tenant.id), role: "admin" }, async () => {
      await Settings.findOneAndUpdate(
        { configId: "global" },
        { $set: globalRow ? COPY_KEYS(globalRow) : { autoReply: true } },
        { new: true, upsert: true }
      );
    });
    updated++;
  }
  console.log(`[Backfill] Done. Created settings rows for ${updated} tenants.`);
  process.exit(0);
}

backfill().catch((err) => {
  console.error("[Backfill] Failed:", err.message);
  process.exit(1);
});