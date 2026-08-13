# Tenancy

## Per-Tenant Settings

Settings rows are tenant-owned. `settings` is in `MULTI_TENANT_TABLES`
(`src/config/supabaseClient.js`), so the Model adapter injects `tenant_id`
on every read filter and write payload when tenant context is active.

### Invariant

`configId` is a *per-tenant* singleton key (default `"global"`). The unique
index `(tenant_id, configId)` enforces one settings row per tenant. Never
query settings without a tenant context in production — `requireTenantScope`
rejects it.

### Migration (not yet applied — requires DB credentials)

Run against the live database:

```sql
-- from migration-phase1-tenant-columns.sql
ALTER TABLE settings ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_settings_tenant_id ON settings(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_tenant_config ON settings(tenant_id, configId);
```

Verify:

```sql
SELECT column_name FROM information_schema.columns WHERE table_name = 'settings' AND column_name IN ('tenant_id','deleted_at');
-- expect 2 rows
SELECT indexname FROM pg_indexes WHERE tablename = 'settings' AND indexname IN ('idx_settings_tenant_id','idx_settings_tenant_config');
-- expect 2 rows
```
