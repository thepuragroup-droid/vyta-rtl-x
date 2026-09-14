-- ============================================================
-- AFFILIATE CRM: SEPARATE THE AFFILIATE DESK FROM THE CUSTOMER DESK
-- ============================================================
--
-- Run AFTER customer-crm-migration.sql. Idempotent: safe to re-run.
-- Run this in the Supabase SQL editor (same as every other *-migration.sql).
--
-- WHY
-- ---
-- customer-crm-migration.sql keyed `customer_leads` on email alone, which meant
-- one relationship record per human — claim someone on the affiliates page and
-- they read as claimed on the customers page too.
--
-- That conflates two genuinely different relationships. "Hot" on the customer
-- desk means ready to buy; "hot" on the affiliate desk means ready to sell.
-- The same person can be a cold customer and a hot affiliate at once, and the
-- notes an admin keeps about each are not interchangeable.
--
-- So leads and outreach emails now carry a `scope`, and the unique key becomes
-- (email, scope). The two desks keep separate claims, separate statuses,
-- separate notes and separate email histories for the same person.
--
-- Existing rows are stamped 'customer', which is what they are: everything
-- written before this migration came from the customers page.

-- ------------------------------------------------------------
-- 1. customer_leads.scope
-- ------------------------------------------------------------
ALTER TABLE customer_leads
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'customer';

ALTER TABLE customer_leads DROP CONSTRAINT IF EXISTS customer_leads_scope_chk;
ALTER TABLE customer_leads
  ADD CONSTRAINT customer_leads_scope_chk
  CHECK (scope IN ('customer', 'affiliate'));

COMMENT ON COLUMN customer_leads.scope IS
  'Which desk owns this relationship: ''customer'' (the customers page) or ''affiliate'' (the affiliates page). The same email can hold one of each.';

-- Replace the email-only unique key with (email, scope). The original was
-- created inline by `email TEXT NOT NULL UNIQUE`, so Postgres named it
-- customer_leads_email_key; the DO block also catches any other unique
-- constraint on email alone, in case the table was built by an older run.
DO $$
DECLARE
  con RECORD;
BEGIN
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'customer_leads'
      AND c.contype = 'u'
      AND (
        SELECT array_agg(a.attname ORDER BY a.attname)
        FROM unnest(c.conkey) AS k(attnum)
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      ) = ARRAY['email']
  LOOP
    EXECUTE format('ALTER TABLE customer_leads DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

-- The composite key the upserts now target.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_leads_email_scope_key'
  ) THEN
    ALTER TABLE customer_leads
      ADD CONSTRAINT customer_leads_email_scope_key UNIQUE (email, scope);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customer_leads_scope
  ON customer_leads (scope, status);

-- Anything written before this migration came from the customers page.
UPDATE customer_leads SET scope = 'customer' WHERE scope IS NULL;

-- ------------------------------------------------------------
-- 2. customer_emails.scope
-- ------------------------------------------------------------
-- Outreach is split the same way: a promo pushed to an affiliate is not part
-- of that person's customer correspondence, and shouldn't appear there.
ALTER TABLE customer_emails
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'customer';

ALTER TABLE customer_emails DROP CONSTRAINT IF EXISTS customer_emails_scope_chk;
ALTER TABLE customer_emails
  ADD CONSTRAINT customer_emails_scope_chk
  CHECK (scope IN ('customer', 'affiliate'));

COMMENT ON COLUMN customer_emails.scope IS
  'Which desk sent it: ''customer'' or ''affiliate''. Each desk shows only its own history.';

CREATE INDEX IF NOT EXISTS idx_customer_emails_scope
  ON customer_emails (scope, lower(to_email), created_at DESC);

-- An email already logged against an affiliate_id was sent from the affiliate
-- desk; label it so it lands in the right history. (No-op on a fresh install.)
UPDATE customer_emails
SET scope = 'affiliate'
WHERE affiliate_id IS NOT NULL AND scope = 'customer';

-- Make PostgREST pick the new columns up immediately instead of waiting out a
-- stale schema cache.
NOTIFY pgrst, 'reload schema';

-- Verification:
-- SELECT scope, count(*) FROM customer_leads GROUP BY 1;
-- SELECT scope, count(*) FROM customer_emails GROUP BY 1;
-- SELECT conname FROM pg_constraint WHERE conrelid = 'customer_leads'::regclass AND contype = 'u';
