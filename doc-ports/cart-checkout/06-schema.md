# 06 — Database schema for cart, checkout, Puramass payment, orders, promos and commissions

Source repo: `thepuragroup-droid/vyta-rtl-x` at `main` `817e7cf` (2026-10-12). All SQL below is copied from the root-level `*.sql` migrations named in each block. Nothing has been rewritten. Where several migrations touch one object, the blocks appear in the order they must run, and the **final shape** is given as a table after them.

Conventions used in this section:

* **"Hosted checkout"** is the only live checkout. `POST /api/checkout/puramass` hands the cart to Puramass (shown in the UI as "Stealth Health"). It writes one `puramass_orders` row and one `invoices` row in status `pending_payment`, plus `invoice_line_items`.
* **"Legacy orders"** means the `orders` / `order_items` / `sol_addresses` tables from the retired crypto and e-Transfer checkout. `POST /api/orders` now returns **410 Gone**. The tables are still **read** by the first-order check, the tracking lookup (`GET /api/orders`), the order confirmation and recommendations, and the stock RPCs still target them. **A paid hosted sale never creates an `orders` row.** It appears as an `invoices` row with `source = 'stealth_health'`.
* All app access goes through the **service-role** client, which bypasses RLS. The browser never touches these tables directly.
* Every hosted-checkout writer tolerates missing columns: it retries without them on Postgres `42703` or PostgREST `PGRST204` (`lib/payments/puramass-columns.ts`). A missing column therefore loses data silently instead of throwing an error. Run every migration listed here.

---

## Schema — tables

### 1. `puramass_orders` — hand-off ledger (one row per hosted-checkout hand-off) — **CORE**

Base table (`puramass-hosted-checkout-migration.sql`):

```sql
-- 1. Per-product PuraMass SKU mapping
ALTER TABLE products ADD COLUMN IF NOT EXISTS puramass_sku      VARCHAR(80);  -- 10-pack SKU
ALTER TABLE products ADD COLUMN IF NOT EXISTS puramass_sku_vial VARCHAR(80);  -- single-vial SKU
CREATE INDEX IF NOT EXISTS idx_products_puramass_sku
  ON products (puramass_sku) WHERE puramass_sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_puramass_sku_vial
  ON products (puramass_sku_vial) WHERE puramass_sku_vial IS NOT NULL;

-- 1b. Checkout add-on flag
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_checkout_addon BOOLEAN NOT NULL DEFAULT false;

-- 2. Admin toggle on the singleton site_settings row
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS puramass_checkout_enabled BOOLEAN NOT NULL DEFAULT false;

-- 3. Hand-off ledger
CREATE TABLE IF NOT EXISTS puramass_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_reference TEXT NOT NULL UNIQUE,       -- our id, echoed back; unique => safe retry
  transaction_id    TEXT,                       -- PuraMass id
  payment_link      TEXT,
  status            TEXT NOT NULL DEFAULT 'payment_pending',
  subtotal_cents    INTEGER,
  customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_email    TEXT,
  items             JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ sku, quantity }, …] sent to PuraMass
  referral_code     TEXT,                       -- captured for manual reconciliation
  paid_at           TIMESTAMPTZ,                -- set when status → paid
  currency          TEXT,                       -- e.g. 'usd'
  last_event_id     TEXT,                       -- last processed webhook event_id (dedupe)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS paid_at       TIMESTAMPTZ;
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS currency      TEXT;
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS last_event_id TEXT;

CREATE INDEX IF NOT EXISTS idx_puramass_orders_transaction
  ON puramass_orders (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_customer
  ON puramass_orders (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_created
  ON puramass_orders (created_at DESC);

CREATE OR REPLACE FUNCTION update_puramass_orders_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS puramass_orders_updated_at ON puramass_orders;
CREATE TRIGGER puramass_orders_updated_at
  BEFORE UPDATE ON puramass_orders
  FOR EACH ROW EXECUTE FUNCTION update_puramass_orders_updated_at();

ALTER TABLE puramass_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON puramass_orders;
CREATE POLICY "Service role full access" ON puramass_orders FOR ALL USING (true) WITH CHECK (true);

-- 4. Fulfillment-queue surfacing
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS invoice_id UUID;   -- NOTE: no FK
```

Later additive columns, in the order they should be applied:

```sql
-- puramass-shipping-address-migration.sql
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS shipping_address JSONB,
  ADD COLUMN IF NOT EXISTS customer_name    TEXT,
  ADD COLUMN IF NOT EXISTS customer_phone   TEXT;
NOTIFY pgrst, 'reload schema';

-- puramass-missing-address-migration.sql (part 1 — ledger columns)
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS shipping_address_source     TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS address_requested_at        TIMESTAMPTZ;
UPDATE puramass_orders
SET shipping_address_source = 'puramass'
WHERE shipping_address IS NOT NULL
  AND shipping_address_source IS NULL;

-- puramass-order-details-migration.sql
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS expires_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_total_cents  INTEGER,
  ADD COLUMN IF NOT EXISTS refunds               JSONB,
  ADD COLUMN IF NOT EXISTS paid_items            JSONB;
NOTIFY pgrst, 'reload schema';

-- puramass-hosted-shipping-migration.sql (ledger part; site_settings part is in §site_settings)
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS shipping_total_cents INTEGER;
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS shipping_courier TEXT;
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS shipping_courier_id TEXT;

-- marketing-attribution-migration.sql (puramass_orders part)
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS attribution_channel  TEXT,
  ADD COLUMN IF NOT EXISTS attribution_campaign TEXT,
  ADD COLUMN IF NOT EXISTS attribution          JSONB;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_attribution_channel
  ON puramass_orders (attribution_channel, created_at DESC)
  WHERE attribution_channel IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_email
  ON puramass_orders (lower(customer_email)) WHERE customer_email IS NOT NULL;

-- ad-discount-promo-migration.sql (puramass_orders part)
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS ad_discount_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS ad_discount_cents INTEGER;

-- cart-upsells-migration.sql (puramass_orders part)
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS cart_offer_percent   numeric(5,2),
  ADD COLUMN IF NOT EXISTS cart_offer_min_items integer;

-- affiliate-discount-codes-payouts-migration.sql (puramass_orders part; needs discount_codes)
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS discount_code_id UUID REFERENCES discount_codes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_code VARCHAR(32),
  ADD COLUMN IF NOT EXISTS discount_code_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS discount_code_cents INTEGER;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_discount_code
  ON puramass_orders (discount_code_id) WHERE discount_code_id IS NOT NULL;

-- landing-pages-migration.sql (puramass_orders part)
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS landing_page TEXT;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_landing_page
  ON puramass_orders (landing_page, created_at DESC) WHERE landing_page IS NOT NULL;

-- abandoned-checkout-recovery-migration.sql (puramass_orders part)
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS recovery_email_sent_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recovery_email_count    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recovery_promo_code     TEXT,
  ADD COLUMN IF NOT EXISTS recovery_discount_type  TEXT,
  ADD COLUMN IF NOT EXISTS recovery_discount_value NUMERIC(10,2);
CREATE INDEX IF NOT EXISTS idx_puramass_orders_recovery_sent
  ON puramass_orders (recovery_email_sent_at DESC)
  WHERE recovery_email_sent_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_status_created
  ON puramass_orders (status, created_at DESC);

-- order-confirmation-email-migration.sql (puramass_orders part)
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS confirmation_email_sent_at TIMESTAMPTZ;

-- stealth-health-admin-paid-alert-migration.sql
ALTER TABLE puramass_orders ADD COLUMN IF NOT EXISTS admin_paid_alert_sent_at TIMESTAMPTZ;

-- stealth-health-settlement-migration.sql (partner settlement; needs stealth_health_invoices)
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS settlement_invoice_id UUID
    REFERENCES stealth_health_invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS settlement_excluded BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_settlement
  ON puramass_orders (settlement_invoice_id) WHERE settlement_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_unbilled
  ON puramass_orders (status, paid_at) WHERE settlement_invoice_id IS NULL;
```

The backfill `UPDATE`s in `order-confirmation-email-migration.sql` and `stealth-health-admin-paid-alert-migration.sql` (they stamp already-paid rows) are reproduced in the functions section.

**Final column list for `puramass_orders`, and who writes each column:**

| column | type / null / default | migration | written by |
|---|---|---|---|
| id | uuid PK default gen_random_uuid() | hosted-checkout | DB |
| partner_reference | text NOT NULL UNIQUE | hosted-checkout | checkout: `amc_${crypto.randomUUID()}` |
| transaction_id | text | hosted-checkout | checkout (from Puramass response); webhook fills it if missing |
| payment_link | text | hosted-checkout | checkout |
| status | text NOT NULL default 'payment_pending' (no CHECK) | hosted-checkout | checkout (`order.status \|\| 'payment_pending'`); webhook/poll mirror the remote status; poll sweep sets `'expired'` |
| subtotal_cents | integer | hosted-checkout | checkout (`order.subtotal_cents ?? null`, the Puramass figure); poll overwrites with remote `subtotal_cents` on flip |
| customer_id | uuid FK customers ON DELETE SET NULL | hosted-checkout | checkout (bearer token user id, else null) |
| customer_email | text | hosted-checkout | checkout; webhook/poll fill only if null |
| items | jsonb NOT NULL default '[]' | hosted-checkout | checkout (ledger line shape, see jsonb section) |
| referral_code | text | hosted-checkout | checkout (`body.referralCode`) |
| paid_at | timestamptz | hosted-checkout | webhook (`occurred_at` or now) / poll (`remote.paid_at` or now) |
| currency | text | hosted-checkout | checkout (`order.currency ?? 'cad'`), webhook/poll |
| last_event_id | text | hosted-checkout | webhook (dedupe key) |
| created_at / updated_at | timestamptz NOT NULL default now() | hosted-checkout | DB / trigger |
| invoice_id | uuid (**no FK**) | hosted-checkout | `createPendingStealthHealthInvoice` / `createPaidInvoice` (`.is('invoice_id', null)` guard) |
| shipping_address | jsonb | shipping-address | checkout (when an address was collected) / webhook / poll / address-request form |
| customer_name | text | shipping-address | checkout / webhook / poll |
| customer_phone | text | shipping-address | checkout / webhook / poll |
| shipping_address_source | text ('puramass'\|'customer') | missing-address | checkout writes `'customer'`; partner patches write `'puramass'` and never overwrite `'customer'` |
| shipping_address_updated_at | timestamptz | missing-address | same as above |
| address_requested_at | timestamptz | missing-address | admin address-request flow |
| expires_at | timestamptz | order-details | webhook / poll |
| refunded_total_cents | integer | order-details | webhook / poll |
| refunds | jsonb | order-details | webhook / poll (verbatim) |
| paid_items | jsonb | order-details | webhook / poll (priced lines) |
| shipping_total_cents | integer | hosted-shipping | checkout (`Math.round(rate.total_charge*100)`; 0 = free shipping) |
| shipping_courier | text | hosted-shipping | checkout (`"<courier_name> · <service_name>"` + `" (free shipping)"`), null for the flat fee |
| shipping_courier_id | text | hosted-shipping | checkout (Easyship courier_service_id), null for the flat fee |
| attribution_channel | text | marketing-attribution | checkout (first touch, else last); `attributeHostedPurchase` fills it on payment if null |
| attribution_campaign | text | marketing-attribution | same |
| attribution | jsonb | marketing-attribution | checkout |
| ad_discount_percent | numeric | ad-discount | checkout (only when a discount split landed: `usedAd ? percent : 0`) |
| ad_discount_cents | integer | ad-discount | checkout (`discount.discountCents` = the **whole** saving from all promos) |
| cart_offer_percent | numeric(5,2) | cart-upsells | checkout (null if the offer was not earned) |
| cart_offer_min_items | integer | cart-upsells | checkout |
| discount_code_id | uuid FK discount_codes ON DELETE SET NULL | affiliate-discount-codes-payouts | checkout (whenever a code was accepted, even if the split did not land) |
| discount_code | varchar(32) | same | checkout |
| discount_code_percent | numeric | same | checkout (`codeBeatsAd && discount ? percent : 0`) |
| discount_code_cents | integer | same | checkout (the code's own share) |
| landing_page | text | landing-pages | checkout (`landingPageOf(visitor)`) |
| recovery_email_sent_at / _count / _promo_code / _discount_type / _discount_value | see DDL | abandoned-checkout-recovery | admin recovery composer |
| confirmation_email_sent_at | timestamptz | order-confirmation-email | claim-then-send (NULL→now(), cleared on failure) |
| admin_paid_alert_sent_at | timestamptz | stealth-health-admin-paid-alert | claim-then-send |
| settlement_invoice_id / settlement_excluded | see DDL | stealth-health-settlement | partner-settlement admin (out of scope for checkout) |

How the checkout insert falls back (`app/api/checkout/puramass/route.ts`, step 12): it tries progressively smaller rows and drops a column group only on a missing-column error. The order is `base+attribution+address+shipping+discount+code+landing`, then without landing, then without code, then without discount, then without shipping, then without address, then without attribution, then `base`. Here `base` = `partner_reference, transaction_id, payment_link, status, currency, subtotal_cents, customer_id, customer_email, items, referral_code`.

Status values the code uses: `payment_pending` (default), `paid`, `expired`, `cancelled`. The terminal set is `['paid','expired','cancelled']`. There is no CHECK constraint, and any remote status string is mirrored as-is.

---

### 2. `puramass_webhook_events` — webhook delivery log (`puramass-webhook-events-migration.sql`)

```sql
CREATE TABLE IF NOT EXISTS puramass_webhook_events (
  id                 BIGSERIAL PRIMARY KEY,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Copied out of the payload for filtering (NULL when absent/unparseable).
  event_id           TEXT,
  event_type         TEXT,
  partner_reference  TEXT,
  transaction_id     TEXT,
  status             TEXT,
  currency           TEXT,
  customer_email     TEXT,
  occurred_at        TIMESTAMPTZ,

  -- What arrived.
  signature_valid    BOOLEAN NOT NULL DEFAULT false,
  payload            JSONB,          -- parsed body; NULL if it did not parse
  raw_body           TEXT,           -- only kept when the body did not parse as JSON

  -- What we did with it.
  puramass_order_id  UUID REFERENCES puramass_orders(id) ON DELETE SET NULL,
  outcome            TEXT,           -- matched | unmatched | deduped | bad_signature | not_configured | unparseable | update_failed | error
  response_status    INTEGER,
  response_body      JSONB,
  error              TEXT
);

CREATE INDEX IF NOT EXISTS idx_puramass_webhook_events_received
  ON puramass_webhook_events (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_puramass_webhook_events_event
  ON puramass_webhook_events (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_webhook_events_partner_ref
  ON puramass_webhook_events (partner_reference) WHERE partner_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_webhook_events_transaction
  ON puramass_webhook_events (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_webhook_events_order
  ON puramass_webhook_events (puramass_order_id) WHERE puramass_order_id IS NOT NULL;

ALTER TABLE puramass_webhook_events ENABLE ROW LEVEL SECURITY;   -- zero policies = service role only

COMMENT ON TABLE puramass_webhook_events IS
  'One row per delivery to /api/webhooks/stealth-health: the payload PuraMass sent, whether its signature checked out, and the response we returned.';

NOTIFY pgrst, 'reload schema';
```

Purpose: every POST to `/api/webhooks/stealth-health` is logged here, including bad signatures and unparseable bodies. `buildWebhookEventRow` (`lib/payments/puramass-webhook-log.ts`) caps `raw_body` at 64 KiB and stores it only when the body did not parse. Retries of the same `event_id` each get their own row. The idempotency check is `puramass_orders.last_event_id`, not this table.

---

### 3. `puramass_address_requests` — "we didn't catch your shipping address" tokens (`puramass-missing-address-migration.sql`, part 2)

```sql
CREATE TABLE IF NOT EXISTS puramass_address_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  puramass_order_id UUID NOT NULL REFERENCES puramass_orders(id) ON DELETE CASCADE,
  token_hash        TEXT NOT NULL UNIQUE,
  email             TEXT NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  sent_at           TIMESTAMPTZ,
  sent_count        INTEGER NOT NULL DEFAULT 0,
  sent_by           UUID,
  sent_by_email     TEXT,
  submitted_at      TIMESTAMPTZ,
  submitted_ip      TEXT,
  submitted_address JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_puramass_address_requests_order
  ON puramass_address_requests (puramass_order_id);
CREATE INDEX IF NOT EXISTS idx_puramass_address_requests_open
  ON puramass_address_requests (expires_at) WHERE submitted_at IS NULL;

CREATE OR REPLACE FUNCTION update_puramass_address_requests_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS puramass_address_requests_updated_at ON puramass_address_requests;
CREATE TRIGGER puramass_address_requests_updated_at
  BEFORE UPDATE ON puramass_address_requests
  FOR EACH ROW EXECUTE FUNCTION update_puramass_address_requests_updated_at();

ALTER TABLE puramass_address_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON puramass_address_requests;
CREATE POLICY "Service role full access" ON puramass_address_requests
  FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
```

Purpose: after payment. Only the SHA-256 hex of the emailed token is stored. The `/shipping-address/<token>` form writes `submitted_address` and copies it onto `puramass_orders.shipping_address` with `shipping_address_source='customer'`.

---

### 4. `discount_codes` — checkout discount codes, optionally owned by an affiliate

`affiliate-discount-codes-payouts-migration.sql`, section 1:

```sql
CREATE TABLE IF NOT EXISTS discount_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stored normalised: uppercase A-Z / 0-9 only (normalizeDiscountCode).
  code            VARCHAR(32) NOT NULL UNIQUE,
  -- Who earns on it. NULL = a store promo with no affiliate.
  affiliate_id    UUID REFERENCES affiliates(id) ON DELETE SET NULL,
  discount_type   VARCHAR(10) NOT NULL DEFAULT 'percent'
                    CHECK (discount_type IN ('percent', 'fixed')),
  -- Percent (0-99) when discount_type = 'percent', CAD when 'fixed'.
  discount_value  NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
  -- Commission on orders using this code, as a percentage. NULL = the
  -- affiliate's own rate (affiliates.commission_rate, else the 10% default).
  commission_rate NUMERIC(5,2) CHECK (commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 100)),
  -- Goods subtotal (CAD, list price) the cart must reach. NULL/0 = none.
  min_subtotal    NUMERIC(10,2),
  -- Total paid orders allowed. NULL = unlimited.
  max_uses        INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  starts_at       TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  active          BOOLEAN NOT NULL DEFAULT true,
  notes           TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discount_codes_affiliate ON discount_codes (affiliate_id);

COMMENT ON TABLE discount_codes IS
  'Checkout discount codes. Optionally assigned to an affiliate, who then earns commission on every paid order that uses the code.';

ALTER TABLE discount_codes ENABLE ROW LEVEL SECURITY;   -- zero policies = service role only
```

`landing-pages-migration.sql`, section 1 (restrictions):

```sql
ALTER TABLE discount_codes
  ADD COLUMN IF NOT EXISTS first_order_only BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS excluded_product_ids UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN discount_codes.first_order_only IS
  'Refuse the code to a buyer who already has a paid or pending order (by customer id or email).';
COMMENT ON COLUMN discount_codes.excluded_product_ids IS
  'Products the code takes nothing off, e.g. bacteriostatic water. Empty = applies to the whole cart.';
```

How the code uses it (`lib/affiliate/discount-codes.ts`):

* Lookup is `select('*').eq('code', normalizeDiscountCode(input))`. Normalisation is `toUpperCase().replace(/[^A-Z0-9]/g,'')`, and the admin form accepts 3–32 characters.
* If the code has an `affiliate_id`, the code is refused when `affiliates.active === false`.
* Use count = `count(puramass_orders where discount_code_id = code.id and status in ['paid'])`. There is no `uses_count` column.
* `first_order_only` goes through `firstOrderStatus()`, which reads `customers.has_completed_first_order` (by id and by email), `puramass_orders` with status `paid` (by `customer_id` and by `customer_email` ilike), and `orders` (`status, payment_confirmed_at` by `email` ilike). Legacy completed statuses are `['confirmed','paid','processing','shipped','delivered','completed']`.
* A lookup that fails because the table is missing **fails closed**: no discount is applied.

---

### 5. `landing_pages` + `landing_page_daily` (offer delivery to checkout)

`landing-pages-migration.sql`, section 2:

```sql
CREATE TABLE IF NOT EXISTS landing_pages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              VARCHAR(40) NOT NULL UNIQUE
                      CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name              TEXT NOT NULL,
  domain            TEXT,
  destination_path  TEXT NOT NULL DEFAULT '/products',
  discount_code_id  UUID REFERENCES discount_codes(id) ON DELETE SET NULL,
  active            BOOLEAN NOT NULL DEFAULT true,
  notes             TEXT,
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_landing_pages_code ON landing_pages (discount_code_id);

ALTER TABLE landing_pages ENABLE ROW LEVEL SECURITY;   -- zero policies = service role only

-- 3. visitor_attribution landing columns
ALTER TABLE visitor_attribution
  ADD COLUMN IF NOT EXISTS first_landing_page TEXT,
  ADD COLUMN IF NOT EXISTS last_landing_page  TEXT;
CREATE INDEX IF NOT EXISTS idx_visitor_attr_first_lp
  ON visitor_attribution (first_landing_page) WHERE first_landing_page IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_visitor_attr_last_lp
  ON visitor_attribution (last_landing_page) WHERE last_landing_page IS NOT NULL;

-- 4. customers
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS attribution_landing_page TEXT;

-- 5. puramass_orders.landing_page  (shown in §1)
```

`landing-page-counters-migration.sql`:

```sql
CREATE TABLE IF NOT EXISTS landing_page_daily (
  slug      TEXT NOT NULL,
  day       DATE NOT NULL,
  views     INTEGER NOT NULL DEFAULT 0,
  arrivals  INTEGER NOT NULL DEFAULT 0,
  visitors  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, day)
);
ALTER TABLE landing_page_daily ENABLE ROW LEVEL SECURITY;
-- + landing_page_bump() (functions section)
CREATE INDEX IF NOT EXISTS idx_customers_attribution_landing_page
  ON customers (attribution_landing_page, created_at DESC)
  WHERE attribution_landing_page IS NOT NULL;
```

Purpose at checkout: when the buyer sends no code and has not declined the offer, `resolveLandingOffer(db, visitor.landingPage)` reads the landing page (`select('*')`) and then its `discount_codes` row. That code is applied server-side as a backstop.

---

### 6. `commissions` — affiliate earnings per sale (final shape)

Original table (`supabase-schema.sql`; `database-schema-complete.sql` has the same table but with `order_id UUID REFERENCES orders(id)` and nullable):

```sql
CREATE TABLE IF NOT EXISTS commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id),                  -- database-schema-complete.sql form
  -- supabase-schema.sql form: order_id VARCHAR(255) NOT NULL
  referral_code_id UUID REFERENCES referral_codes(id),
  amount DECIMAL(10, 2) NOT NULL,
  order_total DECIMAL(10, 2) NOT NULL,
  commission_rate DECIMAL(5, 2) DEFAULT 10.00, -- 10% commission rate
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  paid_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT fk_affiliate_commission FOREIGN KEY (affiliate_id) REFERENCES affiliates(id),
  CONSTRAINT fk_referral_code FOREIGN KEY (referral_code_id) REFERENCES referral_codes(id)
);
CREATE INDEX IF NOT EXISTS idx_commissions_affiliate ON commissions(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_commissions_status ON commissions(status);
CREATE INDEX IF NOT EXISTS idx_commissions_order ON commissions(order_id);
```

`affiliate-commission-hosted-checkout-migration.sql`:

```sql
ALTER TABLE commissions
  ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE;

ALTER TABLE commissions
  ALTER COLUMN order_id DROP NOT NULL;

ALTER TABLE commissions
  DROP CONSTRAINT IF EXISTS commissions_one_source;
ALTER TABLE commissions
  ADD CONSTRAINT commissions_one_source
  CHECK (num_nonnulls(order_id, invoice_id) = 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_commissions_order_unique
  ON commissions (order_id) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_commissions_invoice_unique
  ON commissions (invoice_id) WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_commissions_affiliate
  ON commissions (affiliate_id);

COMMENT ON COLUMN commissions.invoice_id IS
  'The invoice this commission was earned on. Set for hosted (Stealth Health) checkout, where the sale materialises as an invoice and never as an orders row. Mutually exclusive with order_id.';
COMMENT ON COLUMN commissions.order_id IS
  'The order this commission was earned on. Set for storefront/legacy orders. Mutually exclusive with invoice_id.';
COMMENT ON COLUMN commissions.order_total IS
  'The base the commission was calculated from — the goods subtotal, excluding shipping and tax. Named order_total for backwards compatibility.';
```

`affiliate-discount-codes-payouts-migration.sql`, sections 3 and 5:

```sql
ALTER TABLE commissions
  ADD COLUMN IF NOT EXISTS discount_code_id UUID REFERENCES discount_codes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payout_id UUID REFERENCES affiliate_payouts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_commissions_discount_code
  ON commissions (discount_code_id) WHERE discount_code_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commissions_payout
  ON commissions (payout_id) WHERE payout_id IS NOT NULL;
-- + replaced update_affiliate_earnings() (functions section)
```

Row written on payment (`recordAffiliateCommission`, `lib/affiliate/commission.ts`):

```
{ affiliate_id, invoice_id, referral_code_id (null when credited via discount code),
  amount = round2(base * rate), order_total = base (= subtotal_cents/100, goods only),
  commission_rate = round2(rate*100)   -- stored as PERCENT,
  status: 'pending', discount_code_id? }
```

Idempotency works in three layers. A pre-check `select id where invoice_id = ?` runs first. The unique index `idx_commissions_invoice_unique` backs it, and a `23505` error is treated as success. A base of 0 or less (no `subtotal_cents`) skips the insert, so a zero row never blocks the real one.

Rate precedence: the discount code's `commission_rate` (a percent) wins. Otherwise `affiliates.commission_rate` is passed through `normalizeCommissionRate`, which reads ≤1 as a fraction and >1 as a percent. The default is 0.10.

Attribution precedence: an affiliate-owned discount code wins, then the customer's bound `customers.affiliate_id`, then `referral_code`. Self-referral is ignored.

---

### 7. `affiliate_payouts` (`affiliate-discount-codes-payouts-migration.sql`, section 2)

```sql
CREATE TABLE IF NOT EXISTS affiliate_payouts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id     UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  amount           NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  -- e_transfer | crypto | paypal | bank | cheque | store_credit | other
  method           VARCHAR(30) NOT NULL DEFAULT 'e_transfer',
  reference        VARCHAR(255),
  notes            TEXT,
  paid_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by      UUID,
  recorded_by_name VARCHAR(255),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_payouts_affiliate
  ON affiliate_payouts (affiliate_id, paid_at DESC);

ALTER TABLE affiliate_payouts ENABLE ROW LEVEL SECURITY;   -- zero policies
```

Not touched by checkout. It must exist before `commissions.payout_id` is added.

---

### 8. Affiliate referral codes: `affiliates`, `referral_codes`, `referral_code_requests`, `affiliate_requests`

`affiliates` and `referral_codes` originals (`supabase-schema.sql`):

```sql
CREATE TABLE IF NOT EXISTS affiliates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  wallet_address VARCHAR(42),
  password_hash TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  total_earnings DECIMAL(10, 2) DEFAULT 0.00,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  code VARCHAR(8) UNIQUE NOT NULL,
  active BOOLEAN DEFAULT true,
  uses_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT fk_affiliate FOREIGN KEY (affiliate_id) REFERENCES affiliates(id)
);
CREATE INDEX IF NOT EXISTS idx_affiliates_email ON affiliates(email);
CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_referral_codes_affiliate ON referral_codes(affiliate_id);
```

`migration-affiliate-commission-rate.sql`:

```sql
ALTER TABLE public.affiliates
  ADD COLUMN IF NOT EXISTS commission_rate numeric(5, 4) NOT NULL DEFAULT 0.10;
UPDATE public.affiliates
  SET commission_rate = 0.10
  WHERE commission_rate IS NULL;
ALTER TABLE public.affiliates
  ADD CONSTRAINT affiliates_commission_rate_check
    CHECK (commission_rate >= 0 AND commission_rate <= 1);
-- (file ends with a verification SELECT)
```

`referral-code-requests-migration.sql`:

```sql
ALTER TABLE referral_codes ALTER COLUMN code TYPE VARCHAR(32);

CREATE TABLE IF NOT EXISTS referral_code_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id    UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  requested_code  VARCHAR(32) NOT NULL,
  previous_code   VARCHAR(32),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','withdrawn')),
  source          VARCHAR(20) NOT NULL DEFAULT 'affiliate'
                    CHECK (source IN ('affiliate','admin')),
  decided_by      UUID,
  decided_by_name VARCHAR(255),
  decided_at      TIMESTAMPTZ,
  decision_notes  TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_code_requests_one_pending
  ON referral_code_requests(affiliate_id) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_code_requests_pending_code
  ON referral_code_requests(requested_code) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_referral_code_requests_affiliate
  ON referral_code_requests(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_referral_code_requests_status
  ON referral_code_requests(status, created_at DESC);

ALTER TABLE referral_code_requests ENABLE ROW LEVEL SECURITY;   -- ZERO policies, deliberately

ALTER TABLE affiliate_requests ADD COLUMN IF NOT EXISTS requested_code VARCHAR(32);
```

`affiliate_requests` (`affiliate-program-migration.sql`): the sibling already has the table. Only `requested_code` is new. This migration also adds `customers.affiliate_id`, which the sibling already has.

Checkout use: `POST /api/checkout/referral-code` and payment-time attribution call `resolveReferralCodeOwner`. It reads `referral_codes (id, code, affiliate_id, active)` with `eq code, eq active=true`. If that misses, it falls back to `discount_codes (id, code, affiliate_id, commission_rate, active)` by code. It then checks `affiliates.active`. Referral codes are stored uppercase.

---

### 9. `invoices` + `invoice_line_items` — what the hosted checkout writes (dependency; the invoicing cluster owns the full DDL)

Base table (`ecommerce-backend-migration.sql`):

```sql
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1000;

CREATE TABLE IF NOT EXISTS invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE DEFAULT ('VYTA-' || nextval('invoice_number_seq')),
  order_id       uuid REFERENCES orders(id) ON DELETE SET NULL,
  customer_id    uuid REFERENCES customers(id) ON DELETE SET NULL,
  issue_date     date NOT NULL DEFAULT CURRENT_DATE,
  due_date       date NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '30 days'),
  subtotal       numeric(10,2) NOT NULL DEFAULT 0,
  tax_total      numeric(10,2) NOT NULL DEFAULT 0,
  shipping_cost  numeric(10,2) NOT NULL DEFAULT 0,
  total          numeric(10,2) NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','sent','paid','partial','overdue')),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id          uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_variant_id  uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  description         text NOT NULL,
  qty                 integer NOT NULL DEFAULT 1,
  unit_price          numeric(10,2) NOT NULL,
  discount_pct        numeric(5,2) NOT NULL DEFAULT 0,
  line_total          numeric(10,2) NOT NULL
);
```

Additions the hosted checkout depends on:

```sql
-- puramass-hosted-checkout-migration.sql
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source TEXT;                 -- 'stealth_health'

-- stock-decrement-migration.sql (sibling already has it)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stock_adjusted boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_invoices_stock_adjusted ON invoices(stock_adjusted);

-- currency-support-migration.sql (sibling already has invoices.currency, customers.preferred_currency)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'CAD';
-- + CHECK invoices_currency_check (currency IN ('CAD','USD')), idx_invoices_currency

-- easyship-invoice-shipment-migration.sql
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS easyship_courier_id  TEXT;   -- checkout sheds it if missing
-- (also easyship_shipment_id, tracking_number, tracking_status, tracking_url, carrier,
--  label_state, label_url, tracking_checkpoints JSONB, auto_shipment_* — used by post-payment shipment booking)

-- puramass-account-orders-migration.sql
CREATE INDEX IF NOT EXISTS idx_invoices_source ON invoices (source);

-- stock-ledger-migration.sql (supersedes stealth-health-pending-invoice-migration.sql §1-2)
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status = ANY (ARRAY[
    'draft'::text, 'sent'::text, 'partial'::text, 'paid'::text,
    'overdue'::text, 'cancelled'::text, 'pending_payment'::text, 'expired'::text
  ]));
ALTER TABLE invoice_line_items
  ADD COLUMN IF NOT EXISTS vials_per_unit integer NOT NULL DEFAULT 1;
DO $$ BEGIN
  ALTER TABLE invoice_line_items
    ADD CONSTRAINT invoice_line_items_vials_per_unit_positive CHECK (vials_per_unit >= 1);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- invoice-spec-integration-migration.sql §7
ALTER TABLE invoice_line_items
  ADD COLUMN IF NOT EXISTS price_type text NOT NULL DEFAULT 'box';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_line_items_price_type_check'
  ) THEN
    ALTER TABLE invoice_line_items
      ADD CONSTRAINT invoice_line_items_price_type_check
      CHECK (price_type = ANY (ARRAY['box'::text, 'vial'::text]));
  END IF;
END $$;
```

Invoice header written at hand-off by `createPendingStealthHealthInvoice` (`lib/payments/puramass-fulfillment.ts`):

```
{ issue_date: todayInAppTz() /* America/New_York day */, source: 'stealth_health',
  customer_id, customer_email, customer_name, customer_phone,
  fulfillment_type: 'shipment', fulfillment_status: 'pending', status: 'pending_payment',
  currency: 'CAD', subtotal (charged, post-discount), tax_total: 0, shipping_cost,
  total: subtotal + shipping, is_backorder: false, non_payable: false,
  notes: 'Placed via the Stealth Health checkout. Payment and taxes are handled by Stealth Health.'
         + '\n' + optional discount note,
  easyship_courier_id? }
```

Lines:

```
{ invoice_id, product_id, description: '<name> — Pack of N' | '<name> — Single vial',
  qty, unit_price (CAD, discounted), line_total: round2(qty*unit_price), discount_pct: 0,
  price_type: 'box'|'vial', vials_per_unit: N, qty_fulfilled: 0, qty_backordered: 0 }
```

If insertion fails on a missing column, the retry drops `vials_per_unit`, and it also drops `product_id` from lines with `vials_per_unit ≠ 1`. **`price_type` is never dropped.** A database without `invoice_line_items.price_type` therefore loses every line.

Status lifecycle: `pending_payment` becomes `paid` (via `markInvoicePaid`, guarded `.in('status',['pending_payment','expired'])`), or becomes `expired` (via `expireStealthHealthInvoices`, guarded `.eq('status','pending_payment')`). A hand-off that has no invoice is created directly as `paid` on payment.

RLS: `ALTER TABLE invoices/invoice_line_items ENABLE ROW LEVEL SECURITY` plus `CREATE POLICY service_role_all ON <tbl> USING (true) WITH CHECK (true)` (`ecommerce-backend-migration.sql`).

The columns `fulfillment_type`, `fulfillment_status`, `is_backorder`, `non_payable`, `customer_name`, `customer_email` and `customer_phone` come from invoicing-cluster migrations. The sibling snapshot already has all of them.

---

### 10. `fulfillment_email_log` — confirmation, admin-alert and commission email history

Original (`doc-ports/migrations-ref/warehouse-emails-orders-migration.sql`):

```sql
CREATE TABLE IF NOT EXISTS fulfillment_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid REFERENCES invoices (id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders (id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('packed', 'shipped')),
  to_email text NOT NULL,
  subject text,
  message_id text,
  success boolean NOT NULL DEFAULT false,
  error text,
  sent_by uuid REFERENCES customers (id) ON DELETE SET NULL,
  sent_by_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fulfillment_email_log_invoice
  ON fulfillment_email_log (invoice_id, created_at DESC);
ALTER TABLE fulfillment_email_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fulfillment_email_log_staff_read ON fulfillment_email_log;
CREATE POLICY fulfillment_email_log_staff_read ON fulfillment_email_log
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role IN ('admin', 'assistant', 'warehouse')
    )
  );
```

`order-confirmation-email-migration.sql` and `stealth-health-admin-paid-alert-migration.sql` both run the same block, which **drops every CHECK naming `kind`**:

```sql
DO $$
DECLARE c record;
BEGIN
  IF to_regclass('public.fulfillment_email_log') IS NULL THEN
    RETURN;
  END IF;
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.fulfillment_email_log'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE public.fulfillment_email_log DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

-- order-confirmation-email-migration.sql only:
CREATE INDEX IF NOT EXISTS idx_fulfillment_email_log_kind_order
  ON fulfillment_email_log (kind, order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fulfillment_email_log_kind_invoice
  ON fulfillment_email_log (kind, invoice_id) WHERE invoice_id IS NOT NULL;
```

`kind` values written by this cluster: `'order_confirmation'` (`lib/order-confirmation.ts`), `'admin_paid_alert'` (`lib/admin/stealth-health-paid-alert.ts`) and `'affiliate_commission'` (`lib/affiliate/commission-email.ts`). The confirmation log row is `{order_id, invoice_id, to_email, subject, message_id, success, error, sent_by, sent_by_email, kind}`.

---

### 11. `product_history` — stock ledger written by every stock RPC (`stock-ledger-migration.sql` §1; identical in `product-history-migration.sql`)

```sql
CREATE TABLE IF NOT EXISTS product_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  change_type    TEXT NOT NULL CHECK (change_type IN ('price', 'stock', 'general')),
  field          TEXT NOT NULL,
  old_value      TEXT,
  new_value      TEXT,
  source         TEXT NOT NULL DEFAULT 'admin_edit',
  reference_type TEXT,
  reference_id   TEXT,
  note           TEXT,
  actor_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
  actor_email    TEXT
);

CREATE INDEX IF NOT EXISTS idx_product_history_product
  ON product_history (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_history_change_type
  ON product_history (change_type);
CREATE INDEX IF NOT EXISTS idx_product_history_created_at
  ON product_history (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_history_reference
  ON product_history (reference_type, reference_id);

ALTER TABLE product_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "product_history_service_only" ON product_history;
CREATE POLICY "product_history_service_only" ON product_history
  FOR ALL TO public USING (false) WITH CHECK (false);
```

`source` values written by the order lifecycle: `invoice_paid`, `invoice_cancel`, `order_confirmed`, `order_cancelled`, `untracked`, and `admin_edit` (the default). `reference_type` is `'invoice'` or `'order'`. The Stealth Health actor email is the literal `'stealth-health'` (`STOCK_ACTOR`).

---

### 12. `product_recommendations` — "Frequently bought together" (`cart-upsells-migration.sql` §2)

```sql
CREATE TABLE IF NOT EXISTS product_recommendations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id             uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  recommended_product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort_order             integer NOT NULL DEFAULT 0,
  badge                  text,
  enabled                boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_recommendations_not_self CHECK (product_id <> recommended_product_id),
  CONSTRAINT product_recommendations_unique UNIQUE (product_id, recommended_product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_recommendations_product
  ON product_recommendations (product_id, sort_order);

CREATE OR REPLACE FUNCTION update_product_recommendations_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS product_recommendations_updated_at ON product_recommendations;
CREATE TRIGGER product_recommendations_updated_at
  BEFORE UPDATE ON product_recommendations
  FOR EACH ROW EXECUTE FUNCTION update_product_recommendations_updated_at();

ALTER TABLE product_recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Product recommendations are viewable by everyone" ON product_recommendations;
CREATE POLICY "Product recommendations are viewable by everyone" ON product_recommendations
  FOR SELECT USING (true);
```

Read by `GET /api/products/recommendations` with `select('recommended_product_id, sort_order, badge, enabled').in('product_id', cartIds).eq('enabled', true).order('sort_order')`, which is directional. "You may also like" has no table of its own. It is computed from `order_items(order_id, product_id, quantity)` plus paid `puramass_orders.items`, whose SKUs are mapped back through `products.puramass_sku` and `puramass_sku_vial`.

---

### 13. `products` — columns the cart and checkout depend on

```sql
-- puramass-hosted-checkout-migration.sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS puramass_sku      VARCHAR(80);  -- case / pack SKU (every pack > 1)
ALTER TABLE products ADD COLUMN IF NOT EXISTS puramass_sku_vial VARCHAR(80);  -- single-vial SKU
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_checkout_addon BOOLEAN NOT NULL DEFAULT false;
-- + two partial indexes (see §1)

-- invoice-spec-integration-migration.sql §6
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS vials_per_box integer NOT NULL DEFAULT 10;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_vials_per_box_check'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_vials_per_box_check CHECK (vials_per_box > 0);
  END IF;
END $$;
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_usd  numeric;
ALTER TABLE products ADD COLUMN IF NOT EXISTS vial_price numeric;
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS usd_exchange_rate numeric NOT NULL DEFAULT 1;

-- pack-options-content-migration.sql §1
ALTER TABLE products ADD COLUMN IF NOT EXISTS pack_sizes integer[];
-- + CHECK products_pack_sizes_positive_chk (pack_sizes IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(pack_sizes) AS s WHERE s < 1))

-- pack-option-pricing-migration.sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS pack_options jsonb;
-- + CHECK products_pack_options_shape_chk (array of objects, integer size 1..1000, price/compare_at >= 0)
```

Exact checkout reads (`app/api/checkout/puramass/route.ts` §7):

* `select('id, name, price, vial_price, vials_per_box, pack_options, puramass_sku, puramass_sku_vial')`.
* Fallback: `select('id, name, price, vial_price, vials_per_box, puramass_sku')`.
* If both fail, the route returns 500 "Could not load your cart."
* Stock is `products.stock_quantity` (integer NOT NULL default 0, **counted in vials**). Low-stock checks after decrement read `low_stock_threshold` and `low_stock_alerted`; the sibling has both.

---

### 14. `customers` — columns the checkout and promos read or write

| column | source migration | use |
|---|---|---|
| id, email | base | `customer_id` on the ledger is the Supabase auth user id (`db.auth.getUser(token)`) |
| has_completed_first_order boolean NOT NULL default false | catch-up-schema | first-order checks (welcome discount, `first_order_only` codes) |
| affiliate_id uuid FK affiliates ON DELETE SET NULL | affiliate-program | bound-affiliate commission attribution |
| attribution_channel, attribution_campaign text, attribution jsonb, anonymous_id text | marketing-attribution | paid-ad welcome discount reads `attribution_channel` |
| attribution_landing_page text | landing-pages | reporting |
| preferred_currency text NOT NULL default 'CAD' CHECK in ('CAD','USD') | currency-support | not used by the hosted hand-off (always CAD) |
| allow_pickup, allow_shipping boolean default true | migration-checkout-config | legacy checkout only |

`security-hardening-migration.sql` adds the `trg_prevent_client_privilege_escalation` trigger on `customers` (see functions).

`marketing-attribution-migration.sql` (customers part):

```sql
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS attribution_channel  TEXT,
  ADD COLUMN IF NOT EXISTS attribution_campaign TEXT,
  ADD COLUMN IF NOT EXISTS attribution          JSONB,
  ADD COLUMN IF NOT EXISTS anonymous_id         TEXT;
CREATE INDEX IF NOT EXISTS idx_customers_attribution_channel
  ON customers (attribution_channel, created_at DESC)
  WHERE attribution_channel IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_anonymous
  ON customers (anonymous_id) WHERE anonymous_id IS NOT NULL;
```

---

### 15. `visitor_attribution` + `customer_activity` — attribution captured around checkout (`marketing-attribution-migration.sql`)

```sql
CREATE TABLE IF NOT EXISTS visitor_attribution (
  anonymous_id      TEXT PRIMARY KEY,
  first_channel     TEXT,
  first_source      TEXT,
  first_medium      TEXT,
  first_campaign    TEXT,
  first_term        TEXT,
  first_content     TEXT,
  first_click_id    TEXT,
  first_click_param TEXT,          -- 'gclid' | 'fbclid' | 'msclkid' | …
  first_referrer    TEXT,          -- referring host only, no path
  first_landing     TEXT,          -- landing path, no query string
  first_ref_code    TEXT,          -- affiliate ?ref= riding on the same URL
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_channel      TEXT,
  last_source       TEXT,
  last_medium       TEXT,
  last_campaign     TEXT,
  last_click_id     TEXT,
  last_click_param  TEXT,
  last_referrer     TEXT,
  last_landing      TEXT,
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_email    TEXT,
  signed_up_at      TIMESTAMPTZ,
  checkout_at       TIMESTAMPTZ,   -- reached a checkout, paid or not
  purchased_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_visitor_attr_customer
  ON visitor_attribution (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_visitor_attr_email
  ON visitor_attribution (lower(customer_email)) WHERE customer_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_visitor_attr_first_seen
  ON visitor_attribution (first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_attr_channel
  ON visitor_attribution (first_channel, first_seen_at DESC);
ALTER TABLE visitor_attribution ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "visitor_attribution_service_only" ON visitor_attribution;
CREATE POLICY "visitor_attribution_service_only" ON visitor_attribution
  FOR ALL TO public USING (false) WITH CHECK (false);

CREATE TABLE IF NOT EXISTS customer_activity (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID REFERENCES customers(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  search_query  TEXT,
  product_id    UUID,
  product_name  TEXT,
  quantity      INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE customer_activity
  ADD COLUMN IF NOT EXISTS page_path    TEXT,
  ADD COLUMN IF NOT EXISTS page_title   TEXT,
  ADD COLUMN IF NOT EXISTS referrer     TEXT,
  ADD COLUMN IF NOT EXISTS anonymous_id TEXT,
  ADD COLUMN IF NOT EXISTS session_id   TEXT,
  ADD COLUMN IF NOT EXISTS metadata     JSONB;
-- customer_id DROP NOT NULL (guarded DO block)
ALTER TABLE customer_activity DROP CONSTRAINT IF EXISTS customer_activity_actor_chk;
ALTER TABLE customer_activity
  ADD CONSTRAINT customer_activity_actor_chk
  CHECK (customer_id IS NOT NULL OR anonymous_id IS NOT NULL);
ALTER TABLE customer_activity DROP CONSTRAINT IF EXISTS customer_activity_activity_type_check;
ALTER TABLE customer_activity DROP CONSTRAINT IF EXISTS customer_activity_type_chk;
ALTER TABLE customer_activity
  ADD CONSTRAINT customer_activity_type_chk
  CHECK (activity_type IN (
    'search', 'view', 'cart', 'page', 'click', 'lab_result',
    'checkout_start', 'signup', 'purchase'
  ));
CREATE INDEX IF NOT EXISTS idx_customer_activity_customer
  ON customer_activity (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_activity_type
  ON customer_activity (customer_id, activity_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_activity_anonymous
  ON customer_activity (anonymous_id, created_at DESC) WHERE anonymous_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_activity_created
  ON customer_activity (created_at DESC);
ALTER TABLE customer_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customer_activity_service_only" ON customer_activity;
CREATE POLICY "customer_activity_service_only" ON customer_activity
  FOR ALL TO public USING (false) WITH CHECK (false);
```

Checkout touchpoints:

* After a hand-off, `linkVisitorIdentity` sets `visitor_attribution.customer_email` (lower-cased) and `customer_id`.
* `stampVisitorMilestone(..., 'checkout_at')` stamps the checkout time.
* On payment, `attributeEmailPurchase` stamps `purchased_at` for rows matched by email, and `attributeHostedPurchase` copies the channel and campaign onto `puramass_orders` if it has none.
* The checkout page posts `customer_activity` with `activity_type 'checkout_start'` and `metadata {kind:'puramass', items, value}`.
* Visitor writes are gated by `site_settings.tracking_consent_required` together with the consent cookie.

---

### 16. Price overrides read while pricing the cart (`customer-pricing-migration.sql`; `pricelist-migration.sql`)

```sql
CREATE TABLE IF NOT EXISTS customer_price_overrides (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    uuid          NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id     uuid          NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  override_price numeric(10,2) NOT NULL DEFAULT 0 CHECK (override_price >= 0),
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (customer_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_cpo_customer ON customer_price_overrides(customer_id);
CREATE INDEX IF NOT EXISTS idx_cpo_product  ON customer_price_overrides(product_id);
CREATE INDEX IF NOT EXISTS idx_cpo_pair     ON customer_price_overrides(customer_id, product_id);
DROP TRIGGER IF EXISTS customer_price_overrides_updated_at ON customer_price_overrides;
CREATE TRIGGER customer_price_overrides_updated_at
  BEFORE UPDATE ON customer_price_overrides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE customer_price_overrides ENABLE ROW LEVEL SECURITY;
-- policies: see RLS section
```

Resolution chain (`lib/pricing/resolve.ts` → `resolvePriceMap`):

1. `customer_price_overrides (product_id, override_price)` for this customer.
2. The active pricelist: `pricelists.is_active = true` (a unique partial index keeps it to one), then `pricelist_items (product_id, price)`.
3. `products.price`.

When an override or pricelist price applies, the checkout restates the per-vial price as `price / vials_per_box` and **ignores `pack_options`**. The sibling already has `pricelists`, `pricelist_items` and `customer_price_overrides`. On the sibling the override has no `numeric(10,2)` precision and no CHECK is shown, which is unverified.

---

### 17. `orders` / `order_items` / `sol_addresses` — legacy storefront orders (final shape)

`migration-orders.sql` (identical to `migration-orders-clean.sql`, which DROPs and recreates — **do not run the clean variant on a live DB**):

```sql
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  order_number TEXT UNIQUE NOT NULL,
  items JSONB NOT NULL,
  total NUMERIC NOT NULL,
  email TEXT,
  shipping_address JSONB,
  crypto TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_address TEXT,
  payment_amount_expected TEXT,
  payment_amount_received TEXT,
  payment_tx_hash TEXT,
  payment_derivation_index INTEGER,
  payment_confirmed_at TIMESTAMPTZ,
  payment_expires_at TIMESTAMPTZ,
  referral_code TEXT,
  tracking_number TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_orders_status_payment ON orders (status, payment_address) WHERE status = 'pending' AND payment_address IS NOT NULL;
CREATE INDEX idx_orders_customer ON orders (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_orders_order_number ON orders (order_number);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  product_id TEXT,
  quantity INTEGER NOT NULL,
  price_at_time NUMERIC NOT NULL,
  strength TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_order_items_order ON order_items (order_id);

CREATE TABLE IF NOT EXISTS sol_addresses (
  id SERIAL PRIMARY KEY,
  address TEXT UNIQUE NOT NULL,
  derivation_index INTEGER NOT NULL,
  used BOOLEAN DEFAULT false,
  order_id UUID REFERENCES orders(id)
);
CREATE INDEX idx_sol_unused ON sol_addresses (used) WHERE used = false;

CREATE OR REPLACE FUNCTION update_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_orders_updated_at();

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sol_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON order_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON sol_addresses FOR ALL USING (true) WITH CHECK (true);
```

`migration-confirmations.sql`. The file is one line with no trailing newline (`wc -l` reports 0):

```sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_confirmations INTEGER DEFAULT 0;
```

`ecommerce-backend-migration.sql` (Module 3):

```sql
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS billing_address     jsonb,
  ADD COLUMN IF NOT EXISTS shipping_method     text,
  ADD COLUMN IF NOT EXISTS shipping_carrier    text,
  ADD COLUMN IF NOT EXISTS shipping_cost       numeric(10,2),
  ADD COLUMN IF NOT EXISTS discount_total      numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_total           numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subtotal            numeric(10,2),
  ADD COLUMN IF NOT EXISTS staff_notes         text,
  ADD COLUMN IF NOT EXISTS easyship_shipment_id text,
  ADD COLUMN IF NOT EXISTS packed_at           timestamptz,
  ADD COLUMN IF NOT EXISTS shipped_at          timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at        timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_at         timestamptz;
```

`affiliate-discount-commission-migration.sql`:

```sql
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS discount_amount numeric(10,2) NOT NULL DEFAULT 0;
```

`orders-fulfillment-columns-migration.sql`, superseded by and identical in effect to `catch-up-schema-migration.sql` (orders part). The catch-up version also adds `payment_confirmations integer DEFAULT 0` and `easyship_courier_id text`:

```sql
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS subtotal numeric,
  ADD COLUMN IF NOT EXISTS shipping_cost numeric,
  ADD COLUMN IF NOT EXISTS shipping_method text,
  ADD COLUMN IF NOT EXISTS shipping_carrier text,
  ADD COLUMN IF NOT EXISTS discount_total numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_total numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'website',
  ADD COLUMN IF NOT EXISTS fulfillment_type text,
  ADD COLUMN IF NOT EXISTS billing_address jsonb,
  ADD COLUMN IF NOT EXISTS staff_notes text,
  ADD COLUMN IF NOT EXISTS stock_adjusted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS easyship_shipment_id text,
  ADD COLUMN IF NOT EXISTS tracking_status text,
  ADD COLUMN IF NOT EXISTS tracking_url text,
  ADD COLUMN IF NOT EXISTS carrier text,
  ADD COLUMN IF NOT EXISTS label_state text,
  ADD COLUMN IF NOT EXISTS label_url text,
  ADD COLUMN IF NOT EXISTS packed_at timestamptz,
  ADD COLUMN IF NOT EXISTS shipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_shipment_status text,
  ADD COLUMN IF NOT EXISTS auto_shipment_stage text,
  ADD COLUMN IF NOT EXISTS auto_shipment_error text,
  ADD COLUMN IF NOT EXISTS auto_shipment_attempted_at timestamptz;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'crypto'
  ) THEN
    ALTER TABLE orders ALTER COLUMN crypto DROP NOT NULL;
  END IF;
END $$;

UPDATE orders SET fulfillment_type = 'shipment' WHERE fulfillment_type IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_fulfillment_type_chk'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_fulfillment_type_chk
      CHECK (fulfillment_type IN ('shipment', 'pickup'));
  END IF;
END $$;
```

Further `orders` columns:

```sql
-- stock-decrement-migration.sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_adjusted boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_orders_stock_adjusted ON orders(stock_adjusted);

-- fulfillment-ux-audit-migration.sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_key_uidx
  ON orders (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- easyship-courier-id-migration.sql (also in catch-up)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS easyship_courier_id TEXT;

-- order-confirmation-email-migration.sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmation_email_sent_at TIMESTAMPTZ;

-- marketing-attribution-migration.sql
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS attribution_channel  TEXT,
  ADD COLUMN IF NOT EXISTS attribution_campaign TEXT,
  ADD COLUMN IF NOT EXISTS attribution          JSONB;
CREATE INDEX IF NOT EXISTS idx_orders_attribution_channel
  ON orders (attribution_channel, created_at DESC)
  WHERE attribution_channel IS NOT NULL;
```

Purpose and current use. Nothing on the live checkout path writes `orders`. The table is still read by:

* `GET /api/orders` (public tracking lookup). It selects `order_number, email, status, items, total, subtotal, shipping_cost, discount_total, shipping_address, shipping_carrier, shipping_method, fulfillment_type, tracking_number, tracking_url, tracking_status, created_at, shipped_at, delivered_at` and requires the email to match.
* `GET /api/orders/my-orders` (`order_number, status, total, crypto, payment_tx_hash, tracking_number, created_at`).
* `firstOrderStatus` and the order confirmation (`select('*')`).
* `adjust/restore_stock_for_order`, which admin order-status changes and the legacy crypto cron still call.

---

### 18. `backorders` / `backorder_items` (`backorders-migration.sql`) — NOT created by checkout

The hosted checkout writes `invoices.is_backorder = false` and never inserts into `backorders`. Backorders are created only by the admin invoice-split path (`lib/admin/backorder-sync.ts`). The sibling snapshot already has both tables. No port action is needed for checkout.

---

### 19. `site_settings` — the singleton (`migration-site-settings.sql`)

```sql
CREATE TABLE IF NOT EXISTS site_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS checkout_type TEXT NOT NULL DEFAULT 'crypto',
  ADD COLUMN IF NOT EXISTS admin_emails JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'site_settings_checkout_type_chk'
  ) THEN
    ALTER TABLE site_settings
      ADD CONSTRAINT site_settings_checkout_type_chk
      CHECK (checkout_type IN ('email', 'crypto'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS site_settings_singleton ON site_settings ((true));

CREATE OR REPLACE FUNCTION update_site_settings_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS site_settings_updated_at ON site_settings;
CREATE TRIGGER site_settings_updated_at
  BEFORE UPDATE ON site_settings
  FOR EACH ROW EXECUTE FUNCTION update_site_settings_updated_at();

ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON site_settings;
CREATE POLICY "Service role full access" ON site_settings FOR ALL USING (true) WITH CHECK (true);

INSERT INTO site_settings (checkout_type, admin_emails)
VALUES ('email', '["codogmjo@gmail.com"]'::jsonb)
ON CONFLICT DO NOTHING;
```

Every reader uses `select('*').limit(1).maybeSingle()` and shapes the result defensively, so a missing column reads as "off" or as the default. The public storefront reaches settings through `GET /api/admin/settings` (called by `app/cart/page.tsx` and `app/checkout/page.tsx`), which runs `shape()` and redacts secrets. **Change the seed email** before running this on the sibling. The sibling already has a row.

---

## Schema — site_settings columns used by cart/checkout

| column | type | default | migration | purpose |
|---|---|---|---|---|
| id / created_at / updated_at | uuid / timestamptz | gen_random_uuid() / now() | migration-site-settings | singleton row |
| checkout_type | text NOT NULL, CHECK in ('email','crypto') | 'crypto' | migration-site-settings | legacy. Returned by the settings API; the hosted checkout ignores it |
| admin_emails | jsonb NOT NULL (string[]) | '[]' | migration-site-settings | recipients of the admin "new order paid" email |
| pickup_address | text | '' | migration-checkout-config | legacy pickup. Returned by the API; there is no pickup on the hosted checkout |
| guest_checkout_enabled | boolean | true | migration-checkout-config | checkout page: allow checkout without signing in |
| puramass_checkout_enabled | boolean NOT NULL | false | puramass-hosted-checkout | legacy toggle. The settings API always returns `true`; `/api/checkout/puramass` does not consult it |
| puramass_shipping_rates_enabled | boolean NOT NULL | false | puramass-hosted-shipping | on: the buyer picks a live Easyship rate and the address is required. Off: flat fee |
| puramass_flat_shipping | numeric NOT NULL | 35 | puramass-hosted-shipping | flat fee in CAD (also the fallback when no live quote) |
| puramass_free_shipping_enabled | boolean NOT NULL | false | puramass-hosted-shipping | free-shipping promo. Forced off unless rates are enabled and threshold > 0 |
| puramass_free_shipping_threshold | numeric NOT NULL | 0 | puramass-hosted-shipping | goods subtotal (CAD, **list price**, before discounts) that unlocks free shipping |
| shipping_handling_fee_type | text ('flat'\|'pct') | 'flat' | shipping-handling-fee / catch-up-schema | "processing fee" folded into every live rate |
| shipping_handling_fee_value | numeric | 0 | shipping-handling-fee / catch-up-schema | CAD amount, or percentage points |
| easyship_enabled | boolean | false | easyship-settings | live rate quoting on/off (`getShippingConfig`) |
| easyship_api_key | text | '' | easyship-settings | Easyship token (env `EASYSHIP_API_KEY` fallback). Never returned |
| shipping_origin | jsonb `{line_1, city, state, postal_code, country_alpha2, company, phone, email}` | '{}' | easyship-settings | rate origin |
| shipping_box | jsonb `{length, width, height}` (cm) | '{}' | easyship-settings | parcel |
| shipping_item_weight_kg | numeric | 0.05 | easyship-settings | per-vial weight (parcel weight = total vials × this) |
| shipping_flat_rate | numeric | 20 | easyship-settings | Easyship config fallback (separate from `puramass_flat_shipping`) |
| easyship_auto_create_shipment / easyship_auto_courier_preference / easyship_auto_buy_label | boolean / text / boolean | false / 'cheapest' / false | easyship-invoice-shipment (§0) / catch-up-schema (orig. doc-ports/migrations-ref/easyship-auto-shipment) | shipment booking after payment (paid hosted orders are always force-booked as a draft; label purchase follows `easyship_auto_buy_label`) |
| ad_discount_enabled | boolean NOT NULL | **true** | ad-discount-promo | paid-ads welcome discount on/off (code defaults to OFF when the column is absent) |
| ad_discount_percent | numeric NOT NULL | 25 | ad-discount-promo | percent off the goods subtotal. 0 forces it off. Clamped 0–100 |
| cart_offer_enabled | boolean NOT NULL | false | cart-upsells | limited-time cart offer |
| cart_offer_min_items | integer NOT NULL | 2 | cart-upsells | cart **units** (packs, not vials) needed. Clamped 1–99 |
| cart_offer_percent | numeric(5,2) NOT NULL | 10 | cart-upsells | percent off. Capped at `MAX_DISCOUNT_PERCENT` (99). Composes with other discounts |
| cart_offer_ends_at | timestamptz | NULL | cart-upsells | offer end time, enforced at hand-off. NULL = no countdown |
| cart_fbt_enabled | boolean NOT NULL | true | cart-upsells | "Frequently bought together" block |
| cart_similar_enabled | boolean NOT NULL | true | cart-upsells | "You may also like" block |
| checkout_addons_enabled | boolean NOT NULL | true | checkout-addons-toggle | the checkout's "Complete your order" box (add-on products with `is_checkout_addon`) |
| cart_trust_strip_enabled | boolean NOT NULL | true | storefront-section-toggles | three trust badges at the top of the cart |
| checkout_verify_notice_enabled | boolean NOT NULL | true | storefront-section-toggles | the "A few quick questions first" notice under the pay button |
| product_trust_badges_enabled / product_reviews_enabled | boolean NOT NULL | true | storefront-section-toggles | product page only (not cart or checkout) |
| abandoned_checkout_hours | integer NOT NULL | 1 | abandoned-checkout-recovery | hours unpaid before `/admin/puramass-orders` lists a hand-off as abandoned |
| tracking_consent_required | boolean NOT NULL | true | marketing-branding | gates `visitor_attribution` writes (consent cookie) |
| ga4_measurement_id / meta_pixel_id | text | NULL | marketing-branding | `begin_checkout` analytics |
| gtm_container_id | text | NULL | gtm-ga4-tracking | GTM (the migration **seeds Aminocan's** `GTM-M2J3D7SG` / `G-F44F1BB1QV`) |
| usd_exchange_rate | numeric NOT NULL | 1 | invoice-spec-integration | read by `lib/pricing.ts` for USD display. Not used by the CAD hand-off |
| klaviyo_enabled, klaviyo_private_api_key, klaviyo_public_key, klaviyo_list_id, klaviyo_onsite_enabled, klaviyo_server_events_enabled, klaviyo_sync_signups | bool/text | false/''/''/''/true/true/true | klaviyo-integration | "Started Checkout" / "Placed Order" events (best-effort) |

`gtm-ga4-tracking-migration.sql` (verbatim; it depends on `ga4_measurement_id` from marketing-branding):

```sql
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS gtm_container_id text;   -- GTM-XXXXXXX
COMMENT ON COLUMN site_settings.gtm_container_id IS
  'Google Tag Manager container id (GTM-XXXXXXX). Public client-side identifier.';
UPDATE site_settings
   SET gtm_container_id    = COALESCE(NULLIF(TRIM(gtm_container_id), ''), 'GTM-M2J3D7SG'),
       ga4_measurement_id  = COALESCE(NULLIF(TRIM(ga4_measurement_id), ''), 'G-F44F1BB1QV');
INSERT INTO site_settings (checkout_type, gtm_container_id, ga4_measurement_id)
SELECT 'crypto', 'GTM-M2J3D7SG', 'G-F44F1BB1QV'
WHERE NOT EXISTS (SELECT 1 FROM site_settings);
```

The remaining `site_settings` DDL is verbatim in the migrations named in the table. Each is a plain `ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS <col> <type> [NOT NULL] DEFAULT <d>` with the type and default shown, followed by `NOTIFY pgrst, 'reload schema'` in the newer files.

---

## Schema — functions / RPCs / triggers

### Stock: invoice paid and cancelled (the hosted-checkout path). Final versions are from `stock-ledger-migration.sql`.

On a paid hosted sale, `materializeStealthHealthFulfillment` calls `takeStealthHealthStock`. That calls `adjustInvoiceStock` (`lib/admin/stock-ledger.ts`), which runs `rpc('adjust_stock_for_invoice', {p_invoice_id, p_actor_email:'stealth-health'})`. If the function is missing, it retries with only `{p_invoice_id}`. The pass runs on every webhook or poll for an invoice in `paid` status and is a no-op once `stock_adjusted = true`.

```sql
DROP FUNCTION IF EXISTS adjust_stock_for_invoice(uuid);
DROP FUNCTION IF EXISTS restore_stock_for_invoice(uuid);

CREATE OR REPLACE FUNCTION adjust_stock_for_invoice(
  p_invoice_id  uuid,
  p_actor_email text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_already boolean;
BEGIN
  SELECT stock_adjusted INTO v_already
  FROM invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF v_already IS DISTINCT FROM false THEN
    RETURN;  -- not found, or already adjusted
  END IF;

  WITH agg AS (
    SELECT product_id, SUM(qty * COALESCE(vials_per_unit, 1))::int AS qty
    FROM invoice_line_items
    WHERE invoice_id = p_invoice_id
      AND product_id IS NOT NULL
    GROUP BY product_id
  ),
  before AS (
    SELECT p.id, COALESCE(p.stock_quantity, 0) AS old_qty, agg.qty
    FROM products p
    JOIN agg ON p.id = agg.product_id
  ),
  upd AS (
    UPDATE products p
    SET stock_quantity = GREATEST(0, b.old_qty - b.qty)
    FROM before b
    WHERE p.id = b.id
    RETURNING p.id
  )
  INSERT INTO product_history (
    product_id, change_type, field, old_value, new_value,
    source, reference_type, reference_id, note, actor_email
  )
  SELECT
    b.id, 'stock', 'stock_quantity',
    b.old_qty::text,
    GREATEST(0, b.old_qty - b.qty)::text,
    'invoice_paid', 'invoice', p_invoice_id::text,
    'Stock decremented by ' || b.qty || ' when invoice was marked paid',
    p_actor_email
  FROM before b;

  UPDATE invoices SET stock_adjusted = true WHERE id = p_invoice_id;
END;
$$;

CREATE OR REPLACE FUNCTION restore_stock_for_invoice(
  p_invoice_id  uuid,
  p_actor_email text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_adjusted boolean;
BEGIN
  UPDATE invoices
     SET stock_adjusted = false
   WHERE id = p_invoice_id
     AND stock_adjusted = true
  RETURNING stock_adjusted INTO v_adjusted;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  WITH agg AS (
    SELECT product_id, SUM(qty * COALESCE(vials_per_unit, 1))::int AS qty
    FROM invoice_line_items
    WHERE invoice_id = p_invoice_id
      AND product_id IS NOT NULL
    GROUP BY product_id
  ),
  before AS (
    SELECT p.id, COALESCE(p.stock_quantity, 0) AS old_qty, agg.qty
    FROM products p
    JOIN agg ON p.id = agg.product_id
  ),
  upd AS (
    UPDATE products p
    SET stock_quantity = b.old_qty + b.qty
    FROM before b
    WHERE p.id = b.id
    RETURNING p.id
  )
  INSERT INTO product_history (
    product_id, change_type, field, old_value, new_value,
    source, reference_type, reference_id, note, actor_email
  )
  SELECT
    b.id, 'stock', 'stock_quantity',
    b.old_qty::text,
    (b.old_qty + b.qty)::text,
    'invoice_cancel', 'invoice', p_invoice_id::text,
    'Stock restored (+' || b.qty || ') when invoice was cancelled',
    p_actor_email
  FROM before b;
END;
$$;
```

Idempotency guards:

* adjust: `SELECT … FOR UPDATE` on the invoice, then return unless `stock_adjusted = false`. The flag is set true at the end.
* restore: claims the row with `UPDATE … WHERE stock_adjusted = true RETURNING`, so a second cancel finds nothing.

Called from `app/api/admin/invoices/[id]/route.ts` with `{p_invoice_id, p_actor_email}`.

### Stock: lines paid without a product (repair), plus the safety-net trigger (`stock-ledger-migration.sql`)

```sql
CREATE OR REPLACE FUNCTION take_stock_for_invoice_lines(
  p_invoice_id  uuid,
  p_links       jsonb,
  p_actor_id    uuid DEFAULT NULL,
  p_actor_email text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_status   text;
  v_adjusted boolean;
  v_actor    uuid;
  v_count    integer := 0;
  elem       jsonb;
  v_line     uuid;
  v_prod     uuid;
  v_vpu      integer;
  v_qty      integer;
  v_take     integer;
  v_old      integer;
  v_new      integer;
BEGIN
  SELECT status, stock_adjusted INTO v_status, v_adjusted
    FROM invoices
   WHERE id = p_invoice_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id;
  END IF;
  IF v_status <> 'paid' THEN
    RAISE EXCEPTION 'Only a paid invoice takes stock (this one is %)', v_status;
  END IF;

  SELECT id INTO v_actor FROM customers WHERE id = p_actor_id;

  FOR elem IN SELECT * FROM jsonb_array_elements(COALESCE(p_links, '[]'::jsonb))
  LOOP
    v_line := (elem->>'line_id')::uuid;
    v_prod := (elem->>'product_id')::uuid;
    v_vpu  := GREATEST(1, COALESCE((elem->>'vials_per_unit')::integer, 1));

    SELECT qty INTO v_qty
      FROM invoice_line_items
     WHERE id = v_line
       AND invoice_id = p_invoice_id
       AND product_id IS NULL
     FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;  -- already linked (or not this invoice's line)
    END IF;

    SELECT COALESCE(stock_quantity, 0) INTO v_old
      FROM products
     WHERE id = v_prod
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % not found', v_prod;
    END IF;

    UPDATE invoice_line_items
       SET product_id = v_prod,
           vials_per_unit = v_vpu
     WHERE id = v_line;

    IF v_adjusted THEN
      v_take := COALESCE(v_qty, 0) * v_vpu;
      v_new  := GREATEST(0, v_old - v_take);

      UPDATE products SET stock_quantity = v_new WHERE id = v_prod;

      INSERT INTO product_history
        (product_id, change_type, field, old_value, new_value,
         source, reference_type, reference_id, note, actor_id, actor_email)
      VALUES
        (v_prod, 'stock', 'stock_quantity', v_old::text, v_new::text,
         'invoice_paid', 'invoice', p_invoice_id::text,
         'Stock decremented by ' || v_take ||
           ' for an invoice line linked to its product after payment',
         v_actor, p_actor_email);
    END IF;

    v_count := v_count + 1;
  END LOOP;

  IF NOT v_adjusted THEN
    PERFORM adjust_stock_for_invoice(p_invoice_id, p_actor_email);
  END IF;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION log_untracked_stock_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claims jsonb;
  v_actor  uuid;
  v_email  text;
  v_via    text;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM product_history h
     WHERE h.product_id = NEW.id
       AND h.field = 'stock_quantity'
       AND h.created_at = now()
       AND h.new_value IS NOT DISTINCT FROM NEW.stock_quantity::text
  ) THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    v_claims := NULL;
  END;

  v_email := NULLIF(v_claims->>'email', '');
  IF (v_claims->>'sub') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id, COALESCE(v_email, email) INTO v_actor, v_email
      FROM customers
     WHERE id = (v_claims->>'sub')::uuid;
  END IF;
  v_via := COALESCE(NULLIF(v_claims->>'role', ''), session_user::text);

  INSERT INTO product_history
    (product_id, change_type, field, old_value, new_value,
     source, note, actor_id, actor_email)
  VALUES
    (NEW.id, 'stock', 'stock_quantity', OLD.stock_quantity::text, NEW.stock_quantity::text,
     'untracked',
     'Changed outside the admin tools (' || v_via || ')',
     v_actor, COALESCE(v_email, 'database:' || v_via));

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS products_stock_ledger ON products;
CREATE CONSTRAINT TRIGGER products_stock_ledger
  AFTER UPDATE OF stock_quantity ON products
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.stock_quantity IS DISTINCT FROM NEW.stock_quantity)
  EXECUTE FUNCTION log_untracked_stock_change();
```

`stock-ledger-migration.sql` also defines `set_product_stock(p_product_id uuid, p_new_qty integer, p_actor_id uuid DEFAULT NULL, p_actor_email text DEFAULT NULL, p_source text DEFAULT 'admin_edit', p_note text DEFAULT NULL) RETURNS void`. It is used by admin manual edits, not by checkout. The full body is in the file, lines 208–252.

### Stock: legacy `orders` (from the `orders.items` JSONB, vial-aware). Final versions are from `case-vial-stock-decrement-migration.sql`.

Called by `lib/order-stock.ts` → `rpc('adjust_stock_for_order', {p_order_id, p_actor_email})` and `rpc('restore_stock_for_order', {p_order_id, p_actor_email})`. Callers are the legacy crypto cron, `/api/orders/check-payment` and admin order status changes. The hosted checkout does not use these.

```sql
CREATE OR REPLACE FUNCTION adjust_stock_for_order(
  p_order_id    uuid,
  p_actor_email text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_already boolean;
  v_items   jsonb;
BEGIN
  SELECT stock_adjusted, items INTO v_already, v_items
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_already IS DISTINCT FROM false THEN
    RETURN;  -- not found, or already adjusted
  END IF;

  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' THEN
    UPDATE orders SET stock_adjusted = true WHERE id = p_order_id;
    RETURN;
  END IF;

  WITH agg AS (
    SELECT
      (elem->>'id')::uuid AS pid,
      SUM(
        GREATEST(0, COALESCE(NULLIF(elem->>'quantity', ''), '0')::numeric)
        * CASE
            WHEN elem->>'unit' = 'case'
              THEN GREATEST(1, COALESCE(NULLIF(elem->>'vials_per_box', ''), '1')::numeric)
            ELSE 1
          END
      )::int AS qty
    FROM jsonb_array_elements(v_items) AS elem
    WHERE elem->>'id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    GROUP BY elem->>'id'
  ),
  before AS (
    SELECT p.id, COALESCE(p.stock_quantity, 0) AS old_qty, agg.qty
    FROM products p
    JOIN agg ON p.id = agg.pid
    WHERE agg.qty > 0
  ),
  upd AS (
    UPDATE products p
    SET stock_quantity = GREATEST(0, b.old_qty - b.qty)
    FROM before b
    WHERE p.id = b.id
    RETURNING p.id
  )
  INSERT INTO product_history (
    product_id, change_type, field, old_value, new_value,
    source, reference_type, reference_id, note, actor_email
  )
  SELECT
    b.id, 'stock', 'stock_quantity',
    b.old_qty::text,
    GREATEST(0, b.old_qty - b.qty)::text,
    'order_confirmed', 'order', p_order_id::text,
    'Stock decremented by ' || b.qty || ' vials when order was confirmed',
    p_actor_email
  FROM before b;

  UPDATE orders SET stock_adjusted = true WHERE id = p_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION restore_stock_for_order(
  p_order_id    uuid,
  p_actor_email text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_adjusted boolean;
  v_items    jsonb;
BEGIN
  SELECT stock_adjusted, items INTO v_adjusted, v_items
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_adjusted IS DISTINCT FROM true THEN
    RETURN;  -- not found, or never decremented — nothing to give back
  END IF;

  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' THEN
    UPDATE orders SET stock_adjusted = false WHERE id = p_order_id;
    RETURN;
  END IF;

  WITH agg AS (
    SELECT
      (elem->>'id')::uuid AS pid,
      SUM(
        GREATEST(0, COALESCE(NULLIF(elem->>'quantity', ''), '0')::numeric)
        * CASE
            WHEN elem->>'unit' = 'case'
              THEN GREATEST(1, COALESCE(NULLIF(elem->>'vials_per_box', ''), '1')::numeric)
            ELSE 1
          END
      )::int AS qty
    FROM jsonb_array_elements(v_items) AS elem
    WHERE elem->>'id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    GROUP BY elem->>'id'
  ),
  before AS (
    SELECT p.id, COALESCE(p.stock_quantity, 0) AS old_qty, agg.qty
    FROM products p
    JOIN agg ON p.id = agg.pid
    WHERE agg.qty > 0
  ),
  upd AS (
    UPDATE products p
    SET stock_quantity = b.old_qty + b.qty
    FROM before b
    WHERE p.id = b.id
    RETURNING p.id
  )
  INSERT INTO product_history (
    product_id, change_type, field, old_value, new_value,
    source, reference_type, reference_id, note, actor_email
  )
  SELECT
    b.id, 'stock', 'stock_quantity',
    b.old_qty::text,
    (b.old_qty + b.qty)::text,
    'order_cancelled', 'order', p_order_id::text,
    'Stock restored (+' || b.qty || ' vials) when order was cancelled',
    p_actor_email
  FROM before b;

  UPDATE orders SET stock_adjusted = false WHERE id = p_order_id;
END;
$$;
```

Version history. Apply only the final version, after dropping the single-argument overloads:

1. `stock-decrement-migration.sql` creates `adjust_stock_for_invoice(uuid)` and `adjust_stock_for_order(uuid)`, which reads `order_items`.
2. `product-history-migration.sql` runs `DROP FUNCTION IF EXISTS adjust_stock_for_invoice(uuid); DROP FUNCTION IF EXISTS adjust_stock_for_order(uuid);` and recreates both as `(uuid, text DEFAULT NULL)`.
3. `order-stock-decrement-jsonb-migration.sql` switches the order version to read the JSONB.
4. `fulfillment-ux-audit-migration.sql` adds `restore_stock_for_order` (no vial math).
5. `case-vial-stock-decrement-migration.sql` replaces both order functions (shown above).
6. `stealth-health-pending-invoice-migration.sql` makes the invoice functions vial-aware.
7. `stock-ledger-migration.sql` re-ships them, dropping the `(uuid)` overloads first (shown above).

### Affiliate earnings and code usage triggers on `commissions`

Original (`supabase-schema.sql`):

```sql
CREATE TRIGGER update_earnings_on_commission_paid
  AFTER UPDATE ON commissions
  FOR EACH ROW
  EXECUTE FUNCTION update_affiliate_earnings();

CREATE OR REPLACE FUNCTION increment_code_usage()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.referral_code_id IS NOT NULL THEN
    UPDATE referral_codes
    SET uses_count = uses_count + 1
    WHERE id = NEW.referral_code_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER increment_code_on_commission_created
  AFTER INSERT ON commissions
  FOR EACH ROW
  EXECUTE FUNCTION increment_code_usage();

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER update_affiliates_updated_at
  BEFORE UPDATE ON affiliates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

Final `update_affiliate_earnings()` (`affiliate-discount-codes-payouts-migration.sql` §5, which replaces the add-only original):

```sql
CREATE OR REPLACE FUNCTION update_affiliate_earnings()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS NULL OR OLD.status != 'paid') THEN
    UPDATE affiliates
    SET total_earnings = total_earnings + NEW.amount
    WHERE id = NEW.affiliate_id;
  ELSIF OLD.status = 'paid' AND NEW.status != 'paid' THEN
    UPDATE affiliates
    SET total_earnings = GREATEST(0, total_earnings - OLD.amount)
    WHERE id = OLD.affiliate_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

Note that `referral_codes.uses_count` only moves when a commission row has `referral_code_id`. Discount-code-credited commissions write `referral_code_id = null`, and discount-code usage is counted from `puramass_orders` instead.

### `landing_page_bump` (`landing-page-counters-migration.sql`)

```sql
CREATE OR REPLACE FUNCTION landing_page_bump(
  p_slug TEXT,
  p_views INTEGER DEFAULT 0,
  p_arrivals INTEGER DEFAULT 0,
  p_visitors INTEGER DEFAULT 0
) RETURNS VOID
LANGUAGE sql
AS $$
  INSERT INTO landing_page_daily (slug, day, views, arrivals, visitors)
  SELECT
    p_slug,
    (now() AT TIME ZONE 'America/Toronto')::date,
    LEAST(GREATEST(COALESCE(p_views, 0), 0), 1),
    LEAST(GREATEST(COALESCE(p_arrivals, 0), 0), 1),
    LEAST(GREATEST(COALESCE(p_visitors, 0), 0), 1)
  WHERE EXISTS (SELECT 1 FROM landing_pages WHERE slug = p_slug)
  ON CONFLICT (slug, day) DO UPDATE SET
    views    = landing_page_daily.views    + EXCLUDED.views,
    arrivals = landing_page_daily.arrivals + EXCLUDED.arrivals,
    visitors = landing_page_daily.visitors + EXCLUDED.visitors;
$$;
```

Grants follow in the RLS section.

### Numbering

* **Invoice number:** the column default `('VYTA-' || nextval('invoice_number_seq'))`, with sequence `invoice_number_seq START 1000` (`ecommerce-backend-migration.sql`; `invoice-number-vyta-prefix-migration.sql` sets the same default and renames `INV-` to `VYTA-`). The hosted checkout never sends `invoice_number`, so this default is **required**. The sibling should choose its own prefix.
* **Hosted order reference:** generated by the app as `partner_reference = 'amc_' + crypto.randomUUID()`. It is unique in `puramass_orders` and is the Puramass idempotency key.
* **Legacy `orders.order_number`:** generated by the app (`lib/customer/api.ts`: `NP-<base36 ts>-<4 rand>`; admin route has its own). There is no DB function for it.

### Claim-then-send columns (idempotency of emails)

No functions are involved. These are conditional UPDATEs:

* Confirmation: `update {confirmation_email_sent_at: now} where id=? and confirmation_email_sent_at is null returning id`. If a row comes back, this caller won the claim and sends. A failed send sets the column back to NULL.
* Admin alert: the same pattern on `puramass_orders.admin_paid_alert_sent_at`.

The backfills shipped with these migrations:

```sql
-- order-confirmation-email-migration.sql
UPDATE orders SET confirmation_email_sent_at = now()
 WHERE confirmation_email_sent_at IS NULL
   AND status NOT IN ('pending', 'received');
UPDATE orders o SET confirmation_email_sent_at = now()
  FROM invoices i
 WHERE i.order_id = o.id
   AND i.status = 'paid'
   AND o.confirmation_email_sent_at IS NULL;
UPDATE puramass_orders SET confirmation_email_sent_at = now()
 WHERE confirmation_email_sent_at IS NULL
   AND status = 'paid';
UPDATE puramass_orders p SET confirmation_email_sent_at = now()
  FROM invoices i
 WHERE i.id = p.invoice_id
   AND i.status = 'paid'
   AND p.confirmation_email_sent_at IS NULL;

-- stealth-health-admin-paid-alert-migration.sql
UPDATE puramass_orders SET admin_paid_alert_sent_at = now()
 WHERE admin_paid_alert_sent_at IS NULL
   AND status = 'paid';
UPDATE puramass_orders p SET admin_paid_alert_sent_at = now()
  FROM invoices i
 WHERE i.id = p.invoice_id
   AND i.status = 'paid'
   AND p.admin_paid_alert_sent_at IS NULL;
```

### Status-flip guards (app-side; these give exactly-once side effects)

* Poll flip: `update puramass_orders set … where id=? and status=<old status> returning id`. If no row comes back, another run won the race and side effects are skipped.
* Webhook: if `last_event_id = event_id`, it returns `deduped` without writing.
* The invoice paid flip is guarded on status (see §9). Stock, commission, shipment, confirmation and admin alert are retried on **every** paid pass and are idempotent on their own.

### `updated_at` triggers (all present above)

* `update_puramass_orders_updated_at` / `puramass_orders_updated_at`
* `update_puramass_address_requests_updated_at`
* `update_site_settings_updated_at`
* `update_orders_updated_at`
* `update_product_recommendations_updated_at`
* `set_updated_at()` (from `ecommerce-backend-migration.sql`; used by `customer_price_overrides`, `invoices`):

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
```

### `prevent_client_privilege_escalation` (`security-hardening-migration.sql`)

This is the only content of that file. It concerns `customers`, not order tables.

```sql
CREATE OR REPLACE FUNCTION prevent_client_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role
      OR NEW.is_admin IS DISTINCT FROM OLD.is_admin)
     AND current_user IN ('anon', 'authenticated')
  THEN
    RAISE EXCEPTION
      'Role/admin changes must go through the server (service role), not a client write.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_client_privilege_escalation ON customers;
CREATE TRIGGER trg_prevent_client_privilege_escalation
  BEFORE UPDATE ON customers
  FOR EACH ROW
  EXECUTE FUNCTION prevent_client_privilege_escalation();
```

---

## Schema — RLS policies & grants for these tables

| table | RLS | policies (verbatim) | effective access |
|---|---|---|---|
| puramass_orders | enabled | `"Service role full access" FOR ALL USING (true) WITH CHECK (true)` (no `TO` clause) | **No `TO` clause, so it applies to every role, including anon and authenticated** (see porting notes) |
| puramass_address_requests | enabled | same `"Service role full access"` USING(true) | same caveat |
| puramass_webhook_events | enabled | none | service role only |
| site_settings | enabled | `"Service role full access" FOR ALL USING (true) WITH CHECK (true)` | same caveat. Note that `easyship_api_key` and `klaviyo_private_api_key` live in this table |
| orders / order_items / sol_addresses | enabled | `"Service role full access" FOR ALL USING (true) WITH CHECK (true)` (and `database-schema-complete.sql` creates the same on orders) | same caveat |
| invoices / invoice_line_items | enabled | `service_role_all USING (true) WITH CHECK (true)` (`ecommerce-backend-migration.sql`) | same caveat |
| discount_codes | enabled | none | service role only |
| affiliate_payouts | enabled | none | service role only |
| referral_code_requests | enabled | none (deliberate; **never add an `affiliate_id = auth.uid()` policy**) | service role only |
| landing_pages / landing_page_daily | enabled | none | service role only |
| commissions | enabled | `"Commissions viewable by all" FOR SELECT USING (true)`; `"Commissions can be inserted" FOR INSERT WITH CHECK (true)` | public read and insert (legacy) |
| referral_codes | enabled | `"Referral codes are viewable by everyone" FOR SELECT USING (true)`; `"Affiliates can insert own codes" FOR INSERT WITH CHECK (true)` | public |
| affiliates | enabled | `"Affiliates can view own data" FOR SELECT USING (true)`; `"Affiliates can update own data" FOR UPDATE USING (true)`; `"Anyone can insert affiliates" FOR INSERT WITH CHECK (true)` | public (legacy) |
| affiliate_requests | enabled | `"Admins read affiliate_requests" FOR SELECT USING (EXISTS (SELECT 1 FROM customers c WHERE c.id = auth.uid() AND c.role IN ('admin','assistant')))` | admin read |
| product_recommendations | enabled | `"Product recommendations are viewable by everyone" FOR SELECT USING (true)` | public read, service writes |
| product_history | enabled | `"product_history_service_only" FOR ALL TO public USING (false) WITH CHECK (false)` | service role only |
| visitor_attribution | enabled | `"visitor_attribution_service_only" FOR ALL TO public USING (false) WITH CHECK (false)` | service role only |
| customer_activity | enabled | `"customer_activity_service_only" FOR ALL TO public USING (false) WITH CHECK (false)` | service role only |
| fulfillment_email_log | enabled | `fulfillment_email_log_staff_read FOR SELECT TO authenticated USING (EXISTS (… role IN ('admin','assistant','warehouse')))` | staff read |
| customer_price_overrides | enabled | `cpo_admin_read FOR SELECT USING (EXISTS (SELECT 1 FROM customers WHERE customers.id = auth.uid() AND customers.role IN ('admin','assistant')))`; `cpo_admin_write FOR ALL USING (… role = 'admin') WITH CHECK (… role = 'admin')`; `cpo_owner_read FOR SELECT USING (auth.uid() = customer_id)` | admin plus owner |
| backorders / backorder_items | enabled | none | service role only |

Function grants:

```sql
-- stock-ledger-migration.sql
REVOKE EXECUTE ON FUNCTION set_product_stock(uuid, integer, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION take_stock_for_invoice_lines(uuid, jsonb, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_product_stock(uuid, integer, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION take_stock_for_invoice_lines(uuid, jsonb, uuid, text) TO service_role;

-- landing-page-counters-migration.sql
REVOKE ALL ON FUNCTION landing_page_bump(TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION landing_page_bump(TEXT, INTEGER, INTEGER, INTEGER) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION landing_page_bump(TEXT, INTEGER, INTEGER, INTEGER) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION landing_page_bump(TEXT, INTEGER, INTEGER, INTEGER) TO service_role;
  END IF;
END $$;
```

**No REVOKE exists** for `adjust_stock_for_invoice`, `restore_stock_for_invoice`, `adjust_stock_for_order` or `restore_stock_for_order`. Under Supabase defaults they are therefore executable by anon and authenticated through `/rpc`.

The `security-hardening-migration.sql` file contains only the `customers` role trigger. It adds **no** RLS to any order, checkout or settings table.

---

## Schema — cron jobs (pg_cron / Vercel) relevant

1. **`puramass-poll`** — Supabase pg_cron plus pg_net (`supabase-cron-puramass-poll.sql`):

   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_cron;
   CREATE EXTENSION IF NOT EXISTS pg_net;
   -- First time only:
   --   select vault.create_secret('https://aminocan.com', 'app_base_url');   -- no trailing slash
   --   select vault.create_secret('YOUR_CRON_SECRET_HERE', 'cron_secret');   -- = the app's CRON_SECRET
   DO $$
   BEGIN
     IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'puramass-poll') THEN
       PERFORM cron.unschedule('puramass-poll');
     END IF;
   END $$;

   select cron.schedule(
     'puramass-poll',
     '*/2 * * * *',  -- every 2 minutes
     $$
     select net.http_get(
       url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
              || '/api/cron/puramass-poll',
       headers := jsonb_build_object(
         'Authorization',
         'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
       )
     );
     $$
   );
   ```

   **Auth.** `GET /api/cron/puramass-poll` accepts `PURAMASS_CRON_SECRET`, falling back to `CRON_SECRET`. The secret can arrive as header `x-cron-key`, query `?key=`, or `Authorization: Bearer`, checked in that order.

   **What each run does:**
   1. Expiry sweep: `update puramass_orders set status='expired' where status='payment_pending' and created_at < now-7d-6h returning id, invoice_id`, then expire those invoices.
   2. `healStealthHealthPaidOrders` (14-day window, limit 50): re-materialises paid ledger rows whose invoice is still `pending_payment` or `expired`, and takes stock for paid `stealth_health` invoices that have `stock_adjusted=false`.
   3. Polls up to 200 `payment_pending` rows from the last 7 days plus 6 hours that have a `transaction_id`, 8 at a time, and stops on a 429.

   The vault URL in the migration comment is `https://aminocan.com`. The sibling's real values go into the vault.

2. **`abandoned-registrations`** — pg_cron, hourly (`supabase-cron-abandoned-registrations.sql`) → `/api/cron/abandoned-registrations`. This is about registrations, not checkout. It reads `site_settings` and `orders` only to skip customers who have ordered.

3. **Vercel cron** (`vercel.json`): only `{"path":"/api/cron/stock-report","schedule":"0 13 * * *"}` (stock report email). It is not part of the checkout.

4. **`/api/cron/check-payments`** (legacy crypto `orders` poller, `Authorization: Bearer CRON_SECRET`). It is **not scheduled anywhere in the repo** and only matters if legacy crypto orders exist.

Abandoned-checkout recovery has no cron. It is manual from `/admin/puramass-orders`, and "abandoned" means `status in ('payment_pending','expired','cancelled')` and older than `abandoned_checkout_hours`.

---

## Schema — jsonb shapes

**`puramass_orders.items`** — written at hand-off. Only `{sku, quantity, unit_price_cents}` is sent to Puramass; the rest is ledger-only.

```ts
Array<{
  sku: string;                    // products.puramass_sku_vial (pack 1) or products.puramass_sku (any pack > 1), trimmed
  quantity: number;               // UNITS of this pack (1..99, clamped), merged by `${sku}::${packSize}`
  unit_price_cents: number;       // charged per unit, AFTER discount split (integer > 0)
  list_unit_price_cents: number;  // per-unit list price before any discount
  product_id: string;             // products.id (uuid)
  pack_size: number;              // vials per unit (1 = single vial)
}>
```

Older rows may hold only `{sku, quantity}` or `{sku, quantity, unit_price_cents}`. The readers (`linesFromLedger`, recommendations, confirmation `listUnitPrices` keyed by `${product_id.lower}|${pack_size}`) treat every key except `sku` and `quantity` as optional.

**`puramass_orders.paid_items`** — Puramass's priced lines, filtered to entries that carry `unit_price_cents` or `name`:

```ts
Array<{ sku?: string; name?: string; quantity?: number; unit_price_cents?: number }>
```

**`puramass_orders.refunds`** — stored verbatim from Puramass (`unknown[]`). The shape is not defined by this repo.

**`puramass_orders.shipping_address`** (also `puramass_address_requests.submitted_address` minus the extras):

```ts
{ address: string|null; address2: string|null; city: string|null; state: string|null; zip: string|null; country: string|null }
```

* Written at checkout by `validateShippingAddress`: `country` is upper-cased, `address2` is null when blank, and the others are trimmed strings capped at 200/200/100/80/20/40 characters.
* Written from Puramass payloads by `normalizePuramassShipping`, which also accepts the aliases `address1/line1`, `line2`, `province/region` and `postal_code/postcode`.

**`puramass_address_requests.submitted_address`** = `{ ...address (above), full_name: string, phone: string|null }`.

**`puramass_orders.attribution` / `orders.attribution` / `customers.attribution`** (`toAttributionPayload` + `attributionColumns`):

```ts
{
  first: AttributionTouch | null;
  last:  AttributionTouch | null;
  anonymous_id?: string;          // present when a visitor cookie existed
  session_id?: string | null;
}
// AttributionTouch:
{ channel: 'google_ads'|'meta_ads'|'bing_ads'|'tiktok_ads'|'linkedin_ads'|'other_paid'|
           'google_organic'|'meta_organic'|'email'|'affiliate'|'referral'|'direct';
  source: string|null; medium: string|null; campaign: string|null; term: string|null; content: string|null;
  click_id: string|null; click_id_param: 'gclid'|'fbclid'|'msclkid'|…|null;
  referrer_host: string|null; landing_path: string|null; ref_code: string|null;
  landing_page: string|null; at: string /* ISO */ }
```

The whole object is `null` when there is no touch at all.

**`orders.items`** (legacy storefront line, read by `adjust/restore_stock_for_order` and the order confirmation):

```ts
Array<{
  id: string;                 // products.id uuid — lines whose id is not UUID-shaped are skipped by the stock RPC
  name: string;
  price: number;              // per-unit price
  quantity: number;
  strength?: string;
  unit?: 'vial' | 'case';     // 'case' multiplies stock demand by vials_per_box
  vials_per_box?: number;
  product_id?: string;        // confirmation accepts product_id ?? id
}>
```

**`orders.shipping_address` / `billing_address`** (legacy; keys accepted by the confirmation builder): `address|address1|line1`, `address2|line2`, `city`, `state|province`, `zip|postalCode|postal_code`, `country`, `firstName|first_name`, `lastName|last_name`, `name` and `phone`.

**`puramass_webhook_events.payload`** — the full Puramass body:

```
{ event_id, event_type ('store_order.payment_complete', …), referral_id, partner_reference,
  data: { status, occurred_at, transaction_id, order_id, payment_mode, currency,
          customer: {first_name,last_name,email,phone},
          shipping: {address,address2,city,state,zip,country} | null,
          items: [{sku,name,quantity,unit_price_cents}],
          (optionally nested under data.order, plus expires_at, refunded_total_cents, refunds) },
  metadata, created_at, patient_id, appointment_id }
```

`response_body` is the JSON returned, for example `{received:true, matched:true}`, `{received:true, deduped:true}` or `{error:'bad signature'}`.

**`discount_codes.excluded_product_ids`** — `UUID[]` (not jsonb), defaulting to `'{}'`.

**`customer_activity.metadata`** for `checkout_start`: `{ kind: 'puramass', items: number /* cart line count */, value: number /* CAD after ad_discount */ }`.

**`site_settings.admin_emails`** = `string[]`, `shipping_origin` = `{line_1, city, state, postal_code, country_alpha2, company, phone, email}`, `shipping_box` = `{length, width, height}`.

**`products.pack_options`** = `Array<{size:int 1..1000, label:string|null, price:number|null, compare_at:number|null, enabled:boolean}>` or NULL.

**`take_stock_for_invoice_lines.p_links`** = `Array<{line_id: uuid, product_id: uuid, vials_per_unit: int}>`.

---

## Schema — migration order to apply on the sibling

### Diff: this repo vs `_live-schema-snapshot.sql` (Aminocan live, 2026-06-23)

The snapshot covers tables and columns only. It shows no indexes, triggers, policies, functions, CHECK constraints or FKs.

**Missing tables** (none of these are in the snapshot):

| table | needed for |
|---|---|
| `puramass_orders` | **everything** (hand-off ledger) |
| `puramass_webhook_events` | webhook log (the webhook still works without it; logging fails) |
| `puramass_address_requests` | missing-address flow |
| `discount_codes` | codes and landing offers (checkout fails closed without it) |
| `affiliate_payouts` | `commissions.payout_id` FK |
| `referral_code_requests` | vanity code flow (not checkout-critical) |
| `landing_pages`, `landing_page_daily` | landing offers |
| `visitor_attribution`, `customer_activity` | attribution, paid-ad welcome discount, funnel |
| `product_recommendations` | cart FBT block |
| `product_history` | **required**: every stock RPC inserts into it, so the stock decrement fails without it |
| `stealth_health_settings`, `stealth_health_invoices`, `stealth_health_payouts` (+ partner-settlement tables) | only if partner settlement is ported (`puramass_orders.settlement_invoice_id` FK) |

**Missing columns on existing tables:**

| table | missing columns |
|---|---|
| `site_settings` | `puramass_checkout_enabled`, `puramass_shipping_rates_enabled`, `puramass_flat_shipping`, `puramass_free_shipping_enabled`, `puramass_free_shipping_threshold`, `ad_discount_enabled`, `ad_discount_percent`, `cart_offer_enabled`, `cart_offer_min_items`, `cart_offer_percent`, `cart_offer_ends_at`, `cart_fbt_enabled`, `cart_similar_enabled`, `checkout_addons_enabled`, `cart_trust_strip_enabled`, `checkout_verify_notice_enabled`, `product_trust_badges_enabled`, `product_reviews_enabled`, `abandoned_checkout_hours`, `usd_exchange_rate`, `store_name`, `store_tagline`, `logo_url`, `favicon_url`, `ga4_measurement_id`, `meta_pixel_id`, `tracking_consent_required`, `gtm_container_id`, `klaviyo_*` (7) |
| `site_settings` (already present) | `checkout_type`, `admin_emails`, `pickup_address`, `guest_checkout_enabled`, `invoice_*`, `easyship_enabled`, `easyship_api_key`, `shipping_origin`, `shipping_box`, `shipping_item_weight_kg`, `shipping_flat_rate`, `shipping_handling_fee_type/value`, `easyship_auto_*`, `etransfer_*` |
| `products` | `puramass_sku`, `puramass_sku_vial`, `is_checkout_addon`, `vials_per_box`, `vial_price`, `price_usd`, `pack_sizes`, `pack_options`. **Without `vial_price` and `vials_per_box` both product selects in the checkout fail, and every checkout returns 500.** |
| `invoices` | `source`, `easyship_courier_id` (+ the other easyship/tracking/auto-shipment columns from `easyship-invoice-shipment-migration.sql`). Status CHECK must allow `pending_payment`/`expired` (current constraint unknown) |
| `invoice_line_items` | `price_type` (**critical**, see §9), `vials_per_unit` |
| `orders` | `idempotency_key`, `easyship_courier_id`, `confirmation_email_sent_at`, `attribution_channel`, `attribution_campaign`, `attribution` |
| `order_items` | `price_type` (invoice-spec §8; not checkout-critical) |
| `customers` | `attribution_channel`, `attribution_campaign`, `attribution`, `anonymous_id`, `attribution_landing_page` |
| `commissions` | `invoice_id`, `discount_code_id`, `payout_id`. `order_id` is `NOT NULL` in the snapshot and **must be dropped to nullable**. Add the `commissions_one_source` CHECK and the two unique partial indexes |
| `affiliate_requests` | `requested_code` |
| `referral_codes` | `code` must become `VARCHAR(32)` (the snapshot shows `varchar` with no length visible) |
| `fulfillment_email_log` | no column change. The snapshot comment says `kind ∈ {packed, shipped, etransfer_ack, etransfer_instructions, etransfer_admin_notice}`, so a CHECK probably exists and must be dropped |
| `affiliates` | none (`commission_rate` present) |

**Present in the sibling already, no action needed:** `orders.stock_adjusted`, `discount_amount`, `fulfillment_type`, `source`, `auto_shipment_*`, `payment_confirmations`, the nullable `crypto`, `invoices.stock_adjusted`, `currency`, `customer_phone`, `fulfillment_type/status`, `is_backorder`, `non_payable`, `customers.has_completed_first_order`, `affiliate_id`, `preferred_currency`, `backorders`/`backorder_items`, `pricelists`/`pricelist_items`/`customer_price_overrides`, `sales_*`.

### Ordered list of files to run on the sibling

Every file below is idempotent. Run them in this order. Indented notes give dependencies and warnings.

1. `marketing-branding-migration.sql` — adds the tracking columns `ga4_measurement_id` and `tracking_consent_required`. Needed by step 2 and by the attribution consent gate.
2. `gtm-ga4-tracking-migration.sql` — **edit the seeded IDs** to the sibling's own, or note that this repo's seed *is* Aminocan's (`GTM-M2J3D7SG` / `G-F44F1BB1QV`).
3. `invoice-spec-integration-migration.sql` — adds `products.vials_per_box`, `vial_price`, `price_usd`, `site_settings.usd_exchange_rate`, `invoice_line_items.price_type` and `order_items.price_type`. It also adds invoice and customer items from the invoicing cluster (customer_deleted trigger, `uniq_invoices_order_id`, `customers.alternate_email` / `applied_pricelist_id`, `pricelists.description` / `created_by`, `customer_clients`). Review it, or run only §6–§8 if the invoicing cluster is not being ported.
4. `pack-options-content-migration.sql` (§1 `pack_sizes` only, if the rest of that file is not wanted), then `pack-option-pricing-migration.sql` (`pack_options`).
5. `puramass-hosted-checkout-migration.sql` — creates `puramass_orders`, the products SKU columns, `invoices.source` and `puramass_orders.invoice_id`.
6. `puramass-shipping-address-migration.sql`
7. `puramass-missing-address-migration.sql`
8. `puramass-order-details-migration.sql`
9. `shipping-handling-fee-migration.sql` — the sibling already has these columns, so this is a no-op.
10. `puramass-hosted-shipping-migration.sql`
11. `puramass-webhook-events-migration.sql`
12. `puramass-account-orders-migration.sql`
    > This also **backfills** `stealth_health` invoices to a $35 USD shipping fee and `currency='USD'`. On a fresh sibling there are no such rows, so it only links them and creates the index. Do not run it after real CAD hand-offs exist.
13. `easyship-invoice-shipment-migration.sql` — adds `invoices.easyship_courier_id` and related columns. It is part of the shipment cluster; review before running.
14. `easyship-courier-id-migration.sql` — `orders.easyship_courier_id`.
15. `product-history-migration.sql` — creates `product_history`. Its function bodies are superseded by steps 16–17.
16. `stock-ledger-migration.sql` — `product_history` again, the invoice status CHECK, `vials_per_unit`, the final invoice stock RPCs, `set_product_stock`, `take_stock_for_invoice_lines`, the `products_stock_ledger` trigger and the grants.
    > This **supersedes** `stealth-health-pending-invoice-migration.sql`, `restore-stock-for-invoice-migration.sql` and `stock-decrement-migration.sql`'s invoice function. **Do not** run `stock-decrement-migration.sql` afterwards: it would recreate `(uuid)` overloads of `adjust_stock_for_order` and `adjust_stock_for_invoice`.
17. `order-stock-decrement-jsonb-migration.sql`, then `fulfillment-ux-audit-migration.sql` (`orders.idempotency_key` and `restore_stock_for_order`), then `case-vial-stock-decrement-migration.sql` (final order RPCs). These are only needed if legacy `orders` remain in use.
18. `marketing-attribution-migration.sql` — needs `customers`, `orders` and `puramass_orders`. It creates `visitor_attribution` and `customer_activity`.
19. `ad-discount-promo-migration.sql` — needs `puramass_orders`.
20. `cart-upsells-migration.sql` — needs `puramass_orders` and `products`.
21. `checkout-addons-toggle-migration.sql`
22. `storefront-section-toggles-migration.sql`
23. `referral-code-requests-migration.sql` — needs `affiliates`, `referral_codes` and `affiliate_requests`.
24. `affiliate-discount-codes-payouts-migration.sql` — needs `affiliates`, `commissions` and `puramass_orders`. Creates `discount_codes` and `affiliate_payouts`, and replaces `update_affiliate_earnings()`.
25. `affiliate-commission-hosted-checkout-migration.sql` — needs `invoices` and `commissions`. Drops `order_id NOT NULL` and adds the unique indexes.
    > Before running, check for existing duplicate `order_id` rows. They would break `CREATE UNIQUE INDEX`. Rows with both columns NULL would violate `commissions_one_source`.
26. `landing-pages-migration.sql` — needs steps 18 and 24.
27. `landing-page-counters-migration.sql` — needs step 26.
28. `abandoned-checkout-recovery-migration.sql`
29. `order-confirmation-email-migration.sql` — needs `fulfillment_email_log`, `orders`, `puramass_orders` and `invoices`. Drops the `kind` CHECK.
30. `stealth-health-admin-paid-alert-migration.sql`
31. `supabase-cron-puramass-poll.sql` — needs pg_cron, pg_net and vault secrets `app_base_url` and `cron_secret`. Set the env var `PURAMASS_CRON_SECRET` or `CRON_SECRET` to match.
32. Optional:
    * `stealth-health-settlement-migration.sql` and `stealth-health-partner-settlement-migration.sql`, for partner settlement.
    * `security-hardening-migration.sql`. It concerns customers and is recommended if the sibling lacks it.
    * `catch-up-schema-migration.sql`. The sibling already has what it adds.
    * `migration-checkout-config.sql`, `migration-site-settings.sql`, `migration-confirmations.sql`, `orders-fulfillment-columns-migration.sql`, `affiliate-discount-commission-migration.sql` and `migration-affiliate-commission-rate.sql` are already satisfied on the sibling.
    > `migration-affiliate-commission-rate.sql`'s `ADD CONSTRAINT affiliates_commission_rate_check` is **not guarded** and errors if the constraint already exists. It also rejects rows that store a percentage (e.g. 10).
33. **Never run** on a live DB: `migration-orders-clean.sql` (it DROPs `orders`, `order_items` and `sol_addresses` CASCADE) or `migration-orders.sql` (its plain `CREATE INDEX` and `CREATE TRIGGER` without IF NOT EXISTS error on an existing DB).

---

## Schema — unverified / porting notes

**Unverified (not determinable from the repo):**

* The sibling's **constraints, FKs, indexes, triggers, policies and functions** are not in `_live-schema-snapshot.sql`. Specifically unknown:
  * the current `invoices_status_check`;
  * whether `commissions.order_id` has an FK to `orders`;
  * whether `fulfillment_email_log` has a `kind` CHECK;
  * whether `set_updated_at()`, `update_affiliate_earnings()` and `increment_code_usage()` exist on the sibling;
  * which `adjust_stock_for_invoice` overloads exist on the sibling.
* **`invoices.invoice_number` default on the sibling.** The snapshot lists `invoice_number text NOT NULL` with no default. The snapshot generator also drops serial defaults (`sol_addresses.id integer NOT NULL` shows none), so the omission proves nothing either way. The hosted checkout relies on the column default. Confirm `invoice_number_seq` and the default exist, or `createPendingStealthHealthInvoice` fails with a NOT NULL violation. The order is then only invoiced on payment, and that insert fails the same way.
* `referral_codes.code` length on the sibling: the snapshot shows only `varchar`.
* The shape of `puramass_orders.refunds` is whatever Puramass sends. It is undocumented here.
* Whether `lib/pricing.ts`'s `usd_exchange_rate` path is reached anywhere in the cart UI was not traced. The hand-off itself is always CAD.
* Whether the sibling's `customer_price_overrides.override_price` has the `CHECK (override_price >= 0)` constraint and `numeric(10,2)` precision: the snapshot shows plain `numeric`.
* `commissions.order_id`: `supabase-schema.sql` declares `VARCHAR(255) NOT NULL`, while `database-schema-complete.sql` and the live snapshot have `uuid`. The repo's live type is assumed to be uuid.
* (Verified, noted for the API section) `GET /api/admin/settings` has **no auth check**. It is the public path the cart and checkout use to read settings, and it returns `shape(data)`, which replaces `easyship_api_key` and the Klaviyo private key with booleans.

**Porting notes and gotchas:**

1. **RLS caveat, reproduced as written.** `"Service role full access" … FOR ALL USING (true) WITH CHECK (true)` has **no `TO service_role`**. It grants every role, including anon with the public anon key, full read and write on `puramass_orders` (emails, addresses, payment links), `puramass_address_requests`, `site_settings` (including `easyship_api_key` and `klaviyo_private_api_key`), `orders` and `invoices`. The app never uses the anon key on these tables. On the sibling, consider `CREATE POLICY … TO service_role`, or no policy at all (service role bypasses RLS). That is a deliberate deviation and should be recorded as one.
2. **`puramass_orders.invoice_id` has no FK.** The code tolerates a deleted invoice by recreating it for still-paid rows, and the heal sweep deliberately skips rows whose invoice is gone.
3. **Hosted sales never write `orders`.** "Has this customer ordered" must check `puramass_orders` (statuses `paid` and `payment_pending` consume the welcome discount; only `paid` counts for `first_order_only` codes), `customers.has_completed_first_order`, and legacy `orders`.
4. **Money units:**
   * `puramass_orders.*_cents` are integer cents of `currency` (CAD).
   * `invoices.*` are numeric CAD dollars.
   * `discount_codes.discount_value` is a percent or CAD.
   * `discount_codes.commission_rate` is a percent.
   * `affiliates.commission_rate` is a fraction (CHECK 0..1), but the code also accepts >1 as a percent.
   * `commissions.commission_rate` is stored as a percent (`round2(rate*100)`).
   * `cart_offer_percent` and `ad_discount_percent` are percents.
5. **Discount stacking is recorded on the ledger, not computed in SQL.**
   * `ad_discount_cents` is the **total** saving from the single composed split. `ad_discount_percent` is 0 when the ad discount was not the winner.
   * A discount code and the ad discount do not stack. Whichever takes more off wins, compared by effective percentage across eligible lines.
   * The cart offer composes with either one: `1-(1-a)(1-b)`.
   * If any line would price to ≤0 cents, the whole discount is dropped. `discount_code_*` is still recorded (with percent and cents 0) so that the code's usage and the affiliate credit still count.
6. **Stock is counted in vials.**
   * Hosted invoice lines carry `vials_per_unit = pack_size`.
   * Legacy `orders.items` lines use `unit='case'` together with `vials_per_box`.
   * Pre-ledger hand-offs whose lines have no `product_id` or `pack_size` take stock only for single-vial SKUs (`vials_per_unit=1`). Pack lines get `product_id=null` and show up under "Needs attention" for `take_stock_for_invoice_lines`.
7. **PostgREST schema cache.** Several migrations end with `NOTIFY pgrst, 'reload schema';`. Until it reloads, the app's missing-column fallbacks shed optional columns *silently*. Run the NOTIFY after the batch.
8. **`orders.discount_amount` is declared twice:** `numeric(10,2) NOT NULL DEFAULT 0` in `affiliate-discount-commission-migration.sql` and `numeric NOT NULL DEFAULT 0` in `orders-fulfillment-columns-migration.sql` and `catch-up-schema-migration.sql`. Whichever runs first wins the type. The sibling has `numeric`.
9. **`app/api/admin/orders` POST** inserts into `orders` without `items`, which is declared `JSONB NOT NULL` with no default. As written, that insert would violate the constraint. This is outside checkout scope and is noted only because it touches the same table.
10. **`migration-confirmations.sql`** is a single statement with no trailing newline (`wc -l` reports 0 lines). It is not empty.
11. **This repo's migrations already reference Aminocan.** The `aminocan_vid` and `aminocan_consent` cookies, the vault URL `https://aminocan.com`, the seeded Aminocan GTM and GA4 ids, the `amc_` prefix on `partner_reference`, and `tools/aminocan-mcp` in the snapshot header all point to code originally written for Aminocan. Before applying any seed or backfill `UPDATE`, check that it does not clobber Aminocan's own values.
12. **Partner reference prefix `amc_`.** The webhook matches orders by `transaction_id`, then by `partner_reference`. If the sibling shares a Puramass partner account with this site, both sites receive each other's webhooks. Unmatched ones are ACKed and logged as `unmatched`. Keep prefixes distinct per site so the logs are unambiguous.
13. **`site_settings` seed row.** `migration-site-settings.sql` inserts `admin_emails = ["codogmjo@gmail.com"]` if the table is empty. The sibling's row already exists, so `ON CONFLICT DO NOTHING` together with the singleton index makes it a no-op. Do not copy the email anyway.
14. **The `ad_discount_enabled` column defaults to `true`** (the code defaults it OFF when the column is absent). Running `ad-discount-promo-migration.sql` therefore switches the 25% paid-ads welcome discount **on** immediately. Set it to false right after if that is not wanted.
