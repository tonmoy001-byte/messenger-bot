/**
 * src/config/superadmin.js
 * Superadmin tenant-context bypass helper (single definition).
 */
const { runWithTenantContext } = require("../../utils/tenantContext");

const SUPERADMIN_CONTEXT = { role: "superadmin", isSuperAdmin: true, tenant_id: null };

function withSuperadmin(fn) {
  return runWithTenantContext(SUPERADMIN_CONTEXT, fn);
}

module.exports = { SUPERADMIN_CONTEXT, withSuperadmin };