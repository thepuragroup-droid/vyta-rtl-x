-- Admin audit log: append-only record of mutations performed under /admin.
-- See docs/admin-audit-log.md for the full reference.

CREATE TABLE IF NOT EXISTS audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
  actor_email  TEXT,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor      ON audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity     ON audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action     ON audit_logs (action);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_service_only" ON audit_logs;
CREATE POLICY "audit_logs_service_only" ON audit_logs
  FOR ALL TO public USING (false) WITH CHECK (false);
