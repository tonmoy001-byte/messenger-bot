/**
 * utils/tenantContext.js
 * ─────────────────────────────────────────────────────────────
 * AsyncLocalStorage for propagating tenant context down async chains.
 * Ensures strict multi-tenant schema isolation without refactoring
 * every individual database model method call.
 * ─────────────────────────────────────────────────────────────
 */

const { AsyncLocalStorage } = require("async_hooks");

const tenantStorage = new AsyncLocalStorage();

/**
 * Run a function with a specific tenant context.
 * @param {Object} context - { tenant_id, role, isSuperAdmin }
 * @param {Function} callback - The function to run
 */
function runWithTenantContext(context, callback) {
  return tenantStorage.run(context, callback);
}

/**
 * Get the current tenant context.
 * @returns {Object|null}
 */
function getTenantContext() {
  return tenantStorage.getStore() || null;
}

module.exports = {
  tenantStorage,
  runWithTenantContext,
  getTenantContext,
};
