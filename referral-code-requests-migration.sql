-- ============================================================================
-- Affiliate referral codes: vanity codes, change requests, admin review queue
-- ============================================================================
-- Ship this BEFORE the application code. Until it runs, any code longer than
-- 8 characters is rejected by the column and the request queue reads as
-- permanently empty.
-- ============================================================================

-- 1. Room for a vanity code.
--    AMC + a 15-char surname + 10 is 20 characters; 32 leaves headroom for the
--    collision variants (AMCSMITH102) without another migration.
ALTER TABLE referral_codes ALTER COLUMN code TYPE VARCHAR(32);

-- 2. The request / history table. This is both the review queue AND the audit
--    history of every code a partner has ever held.
CREATE TABLE IF NOT EXISTS referral_code_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id    UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  requested_code  VARCHAR(32) NOT NULL,
  -- The code that was live when the request was raised, for the audit trail.
  previous_code   VARCHAR(32),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','withdrawn')),
  -- 'affiliate' = raised from the portal (needs review).
  -- 'admin'     = an admin set the code outright; recorded already approved.
  source          VARCHAR(20) NOT NULL DEFAULT 'affiliate'
                    CHECK (source IN ('affiliate','admin')),
  decided_by      UUID,
  decided_by_name VARCHAR(255),
  decided_at      TIMESTAMPTZ,
  -- Optional rejection reason. ADMIN-VISIBLE ONLY — never selected by the
  -- affiliate-facing route. See app/api/affiliate/referral-code/route.ts.
  decision_notes  TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- One open request per affiliate: the portal offers "withdraw", not a queue.
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_code_requests_one_pending
  ON referral_code_requests(affiliate_id) WHERE status = 'pending';

-- Two affiliates cannot both be waiting on the same code. First asker keeps
-- the claim until it is decided. This index is the backstop behind every
-- availability check (23505 -> 409).
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_code_requests_pending_code
  ON referral_code_requests(requested_code) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_referral_code_requests_affiliate
  ON referral_code_requests(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_referral_code_requests_status
  ON referral_code_requests(status, created_at DESC);

-- 3. RLS: service role only. ENABLED WITH ZERO POLICIES, deliberately.
--
--    Every read and write goes through an API route holding a service-role
--    client; the route authenticates the caller AND CHOOSES THE COLUMNS. That
--    column choice is the only thing keeping `decision_notes` and
--    `decided_by_name` off an affiliate's screen. A row-level policy of the
--    obvious shape (affiliate_id = auth.uid()) would hand the affiliate the
--    whole row, rejection note included. Do not "simplify" this into a policy.
ALTER TABLE referral_code_requests ENABLE ROW LEVEL SECURITY;

-- 4. An applicant's code choice, held on the application until it is decided.
--
--    An affiliates row only exists once an application has been approved, so a
--    pending applicant has nothing for referral_code_requests.affiliate_id to
--    reference. Their choice rides on the application instead and is issued —
--    as exactly that code, if it is still free — the moment an admin approves
--    them. No live referral_codes row is ever created for someone an admin has
--    not approved.
ALTER TABLE affiliate_requests ADD COLUMN IF NOT EXISTS requested_code VARCHAR(32);
