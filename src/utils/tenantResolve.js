/**
 * src/utils/tenantResolve.js
 * Shared tenant resolver (web chat widget + public products API).
 * Resolution order: body tenant_id/tenantId, X-Tenant-ID header,
 * body tenant/tenantSlug/slug/siteKey, X-Tenant-Slug / X-Site-Key headers,
 * query.tenant; non-production DEFAULT_TENANT_ID / DEFAULT_TENANT_SLUG fallback.
 */
const { Tenant } = require("../config/db");

async function resolveTenantFromRequest(req) {
  const body = req.body || {};
  const headers = req.headers || {};
  const query = req.query || {};

  const tenantId =
    body.tenant_id ||
    body.tenantId ||
    headers["x-tenant-id"] ||
    headers["X-Tenant-ID"] ||
    null;

  const tenantSlug =
    body.tenant ||
    body.tenantSlug ||
    body.slug ||
    body.siteKey ||
    body.site_key ||
    headers["x-tenant-slug"] ||
    headers["X-Tenant-Slug"] ||
    headers["x-site-key"] ||
    headers["X-Site-Key"] ||
    query.tenant ||
    null;

  if (tenantId) {
    const row = await Tenant.findOne({ id: String(tenantId) });
    if (row && !row.deleted_at && row.status !== "suspended") {
      return {
        tenant_id: String(row.id || row.tenant_id || tenantId),
        slug: row.slug || null,
      };
    }
    return null;
  }

  if (tenantSlug) {
    const row = await Tenant.findOne({
      slug: String(tenantSlug).trim().toLowerCase(),
    });
    if (row && !row.deleted_at && row.status !== "suspended") {
      return { tenant_id: String(row.id), slug: row.slug || String(tenantSlug) };
    }
    return null;
  }

  if (process.env.NODE_ENV !== "production") {
    const fallbackId = process.env.DEFAULT_TENANT_ID;
    const fallbackSlug = process.env.DEFAULT_TENANT_SLUG;
    if (fallbackId) {
      const row = await Tenant.findOne({ id: String(fallbackId) });
      if (row) return { tenant_id: String(row.id), slug: row.slug || null };
      return { tenant_id: String(fallbackId), slug: null };
    }
    if (fallbackSlug) {
      const row = await Tenant.findOne({
        slug: String(fallbackSlug).trim().toLowerCase(),
      });
      if (row) return { tenant_id: String(row.id), slug: row.slug || fallbackSlug };
    }
  }

  return null;
}

module.exports = { resolveTenantFromRequest };