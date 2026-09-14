# 2026-07-06 — Registration Alerts, Customer Claiming & Activity Insights

## Summary
Added a registration-alert lifecycle and an admin **customer insights** dashboard. Admins are now notified by email when a customer registers, and again if that customer never checks out after a configurable delay (default 12 hours). Both emails link to a new per-customer insights page that shows what the customer searched for, viewed, and added to cart, and lets one admin "claim" the customer as their point of contact. A consent checkbox on the registration page records whether the customer agrees to be contacted.

---

## Database Migration

**Run in Supabase SQL Editor before deploying code changes.** File: `registration-alerts-migration.sql` (additive / idempotent — safe to run more than once).

```sql
-- 1. customers: consent, claim ownership, alert de-dup stamps
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS contact_consent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS claimed_by_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_by_email TEXT,
  ADD COLUMN IF NOT EXISTS claimed_by_name TEXT,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS registration_alert_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS abandoned_alert_sent_at TIMESTAMPTZ;

-- 2. site_settings: registration-alert configuration
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS registration_alert_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS abandoned_registration_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS abandoned_registration_hours INTEGER NOT NULL DEFAULT 12;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_settings_abandoned_hours_chk') THEN
    ALTER TABLE site_settings
      ADD CONSTRAINT site_settings_abandoned_hours_chk CHECK (abandoned_registration_hours >= 1);
  END IF;
END $$;

-- 3. customer_activity: search / view / cart event log
CREATE TABLE IF NOT EXISTS customer_activity (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('search', 'view', 'cart')),
  search_query  TEXT,
  product_id    UUID,
  product_name  TEXT,
  quantity      INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_activity_customer
  ON customer_activity (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_activity_type
  ON customer_activity (customer_id, activity_type, created_at DESC);

ALTER TABLE customer_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customer_activity_service_only" ON customer_activity;
CREATE POLICY "customer_activity_service_only" ON customer_activity
  FOR ALL TO public USING (false) WITH CHECK (false);
```

---

## How It Works

### 1. New-registration alert
- When a customer signs up, `POST /api/customer/register-alert` emails the admin recipients configured in **Admin → Settings → Admin Email Notifications**.
- Idempotent and at-most-once: it stamps `registration_alert_sent_at` before sending and only fires for a genuinely fresh signup (created in the last 10 minutes).
- Can be turned off in **Admin → Settings → Registration Alerts**.

### 2. Abandoned-registration alert
- An hourly cron (`GET /api/cron/abandoned-registrations`, authenticated with `CRON_SECRET`, scheduled via **Supabase Cron** — `pg_cron` + `pg_net` — see `supabase-cron-abandoned-registrations.sql`) finds active customers who registered more than the configured delay ago but within the last 7 days and have never placed an order, then emails the admins.
- Stamps `abandoned_alert_sent_at` for at-most-once delivery.
- Delay (hours) and enable/disable are configurable in Settings; default 12 hours.

### 3. Customer insights + claiming
- Both alert emails include a styled button linking to `/admin/customers/[id]`.
- The page shows the customer's general info, "checked out" and "contact consent" badges, and three columns: **Searched for**, **Viewed products**, **Added to cart**.
- Data comes from a new `customer_activity` log written by `POST /api/customer/activity` and the client helper `lib/customer/activity.ts`, wired into product search (debounced), product-detail views, and cart adds. Tracking is fire-and-forget and only records signed-in customers.
- A **claim** panel lets one admin become the customer's point of contact via `POST/DELETE /api/admin/customers/[id]/claim`. The page shows who claimed the customer and when; a claim can only be released by the admin who made it, and a customer already claimed by someone else returns a conflict.
- The registration page gained an optional **consent checkbox** stored on `customers.contact_consent`.

### Access control
- `GET /api/admin/customers/[id]/insights`, the claim/release endpoints, and the settings updates all verify the caller is an authenticated admin/assistant server-side. The insights page also sits behind the existing admin-layout auth gate.

---

## Deploy Notes
- Run `registration-alerts-migration.sql` before deploying.
- Ensure `CRON_SECRET` is set as an app env var so the abandoned-registration endpoint is protected.
- Schedule the cron in Supabase: run `supabase-cron-abandoned-registrations.sql` in the SQL Editor (enables `pg_cron` + `pg_net`, stores the app URL + `CRON_SECRET` in Vault, and schedules the hourly job that calls the endpoint). Set the two Vault values to match your deployment first.

---

## Files Touched
- **Migration:** `registration-alerts-migration.sql`
- **Emails:** `lib/email.ts` (`sendRegistrationAlert`, `sendAbandonedRegistrationAlert`), `lib/admin/alert-recipients.ts`
- **Registration:** `app/(customer)/signup/page.tsx`, `lib/customer/api.ts`, `app/api/customer/register-alert/route.ts`
- **Activity tracking:** `app/api/customer/activity/route.ts`, `lib/customer/activity.ts`, `app/products/page.tsx`, `app/products/[slug]/page.tsx`, `contexts/CartContext.tsx`
- **Insights + claiming:** `app/(admin)/admin/customers/[id]/page.tsx`, `app/(admin)/admin/customers/page.tsx`, `app/api/admin/customers/[id]/insights/route.ts`, `app/api/admin/customers/[id]/claim/route.ts`
- **Settings:** `app/(admin)/admin/settings/page.tsx`, `app/api/admin/settings/route.ts`
- **Cron:** `app/api/cron/abandoned-registrations/route.ts`, `supabase-cron-abandoned-registrations.sql`
- **Types:** `lib/supabase.ts`
