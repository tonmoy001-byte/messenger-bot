-- Phase 2: durable tenant-scoped human handoff state and history
-- Run after migration.sql and migration-phase1-tenant-columns.sql.
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS conversation_handoffs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_uid VARCHAR(255) NOT NULL,
    platform VARCHAR(50) NOT NULL CHECK (platform IN ('messenger', 'whatsapp', 'instagram')),
    status VARCHAR(50) NOT NULL DEFAULT 'ai_active'
        CHECK (status IN ('ai_active', 'human_requested', 'human_active')),
    reason VARCHAR(100),
    assigned_admin_id UUID REFERENCES admins(id) ON DELETE SET NULL,
    requested_at TIMESTAMP WITH TIME ZONE,
    assigned_at TIMESTAMP WITH TIME ZONE,
    ai_paused_at TIMESTAMP WITH TIME ZONE,
    resumed_at TIMESTAMP WITH TIME ZONE,
    last_customer_message_at TIMESTAMP WITH TIME ZONE,
    last_staff_message_at TIMESTAMP WITH TIME ZONE,
    last_transition_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT conversation_handoffs_tenant_customer_platform_key
        UNIQUE (tenant_id, customer_uid, platform)
);

CREATE INDEX IF NOT EXISTS idx_conversation_handoffs_tenant_status_updated
    ON conversation_handoffs (tenant_id, status, updated_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_handoffs_tenant_customer
    ON conversation_handoffs (tenant_id, customer_uid, platform)
    WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS conversation_handoff_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    handoff_id UUID NOT NULL REFERENCES conversation_handoffs(id) ON DELETE CASCADE,
    customer_uid VARCHAR(255) NOT NULL,
    platform VARCHAR(50) NOT NULL CHECK (platform IN ('messenger', 'whatsapp', 'instagram')),
    from_status VARCHAR(50) CHECK (from_status IS NULL OR from_status IN ('ai_active', 'human_requested', 'human_active')),
    to_status VARCHAR(50) NOT NULL CHECK (to_status IN ('ai_active', 'human_requested', 'human_active')),
    actor_type VARCHAR(50) NOT NULL CHECK (actor_type IN ('customer', 'admin', 'system')),
    actor_admin_id UUID REFERENCES admins(id) ON DELETE SET NULL,
    reason VARCHAR(100),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conversation_handoff_events_tenant_created
    ON conversation_handoff_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_handoff_events_handoff_created
    ON conversation_handoff_events (handoff_id, created_at DESC);
