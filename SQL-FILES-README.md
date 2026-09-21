# SQL Files Guide

This directory contains all database migration and schema files for the Aminocan e-commerce platform.

---

## 📁 File Overview

### **1. MASTER SCHEMA (Use This for Fresh Setup)**

#### `database-schema-complete.sql` ⭐ **RECOMMENDED**
**Purpose:** Complete database schema with all migrations applied
**When to use:** Fresh database setup or complete rebuild
**Contains:**
- All table definitions
- All migrations in correct order
- Indexes, triggers, and functions
- Verification queries

**Usage:**
```bash
Run this file once in Supabase SQL Editor for complete setup
```

---

### **2. MIGRATION FILES (Individual Changes)**

Use these only if you already have a partially set up database and need specific migrations.

#### `supabase-schema.sql`
**Purpose:** Affiliate system tables
**Tables:** `affiliates`, `referral_codes`, `commissions`
**Dependencies:** None
**Required:** Yes

#### `customer-auth-migration.sql`
**Purpose:** Add authentication fields to customers table
**Columns Added:** `password_hash`, `phone`, `shipping_address`, `shipping_city`, `shipping_state`, `shipping_postal_code`, `shipping_country`
**Dependencies:** `customers` table must exist
**Required:** Yes

#### `admin-migration.sql`
**Purpose:** Add admin flag to customers
**Columns Added:** `is_admin`
**Dependencies:** `customers` table must exist
**Required:** Yes

#### `migration-orders-clean.sql` ⭐
**Purpose:** Complete orders system
**Tables:** `orders`, `order_items`, `sol_addresses`
**Dependencies:** `customers` table must exist
**Required:** Yes
**Note:** Use this instead of `migration-orders.sql`

#### `assistant-role-migration.sql` 🆕
**Date:** March 25, 2025
**Purpose:** Add role-based access control (customer/assistant/admin)
**Changes:**
- Adds `user_role` enum
- Adds `role` column to customers
- Creates trigger to sync `is_admin` with `role`
- Migrates existing admins to new system

**Dependencies:** `admin-migration.sql` must be run first
**Required:** Yes for role-based access

#### `user-management-migration.sql` 🆕
**Date:** March 25, 2025
**Purpose:** Add user management features
**Columns Added:** `active`, `last_login_at`, `email_verified`
**Dependencies:** `customers` table must exist
**Required:** Yes for user management features

---

### **3. PRODUCT CATALOG (Optional, Large Files)**

#### `marketing-attribution-migration.sql` 🆕
**Purpose:** Tell paid traffic apart from organic in our own data, and record the
storefront journey of visitors who are not signed in
**Tables:** `visitor_attribution` (new)
**Columns Added:**
- `customer_activity`: `anonymous_id`, `session_id`, `metadata`; `customer_id` becomes
  nullable, and the activity-type check widens to include `click`, `lab_result`,
  `checkout_start`, `signup`, `purchase`
- `customers`, `orders`, `puramass_orders`: `attribution_channel`,
  `attribution_campaign`, `attribution` (JSONB)
- `customers`: `anonymous_id`

**Dependencies:** `customers`, `orders`, `puramass_orders` must exist. Runs standalone if
`registration-alerts-migration.sql` / `customer-crm-migration.sql` have not been applied.
**Required:** Yes, to use Admin → Analytics → Acquisition. Without it the app degrades
cleanly — orders and signups still work, the Acquisition tab says it is not collecting.
**Idempotent:** Yes, safe to re-run.

**Related code:** `lib/analytics/attribution.ts` (channel taxonomy), `middleware.ts`
(capture), `app/api/customer/activity` (ingest + identity stitching).

#### `affiliate-commission-hosted-checkout-migration.sql` 🆕
**Purpose:** Let an affiliate commission be recorded for a hosted (Stealth Health)
sale. Referral codes were captured at checkout but never turned into money — both
writers to `commissions` were dead code, and a hosted sale materialises as an
**invoice**, not an `orders` row, so `commissions.order_id NOT NULL` left it
nowhere to hang.
**Columns Added:** `commissions`: `invoice_id` (FK → `invoices`); `order_id` becomes
nullable
**Constraints:** `commissions_one_source` — exactly one of `order_id` / `invoice_id`;
unique partial indexes on each, which are the idempotency guarantee the recording
code relies on (webhooks retry, and the poller re-reads the same order)
**Dependencies:** `commissions` and `invoices` must exist
**Required:** Yes, to pay affiliates for storefront sales. Without it the commission
insert fails and is logged — payment, fulfillment and attribution are unaffected.
**Idempotent:** Yes, safe to re-run.

**Related code:** `lib/affiliate/commission.ts` (attribution + recording, with unit
tests in `commission.test.ts`), `lib/payments/puramass-fulfillment.ts` (calls it on
the paid transition, from the webhook, the cron poller and the admin refresh alike).

#### `pack-options-content-migration.sql` 🆕
**Purpose:** Pack options (1 / 3 / 5 / 10) on products, plus the three storefront
content surfaces — the sticky announcement bar, editable pages (About Us) and the
article builder. One file, four independent pieces; each is additive, so running it
on a live database changes nothing visible until an admin opts something in.
**Columns Added:** `products`: `pack_sizes` (`integer[]`, NULL = the historical
single-vial + full-case pair)
**Tables:** `announcements`, `site_pages` (seeded with `about`), `articles`
**Constraints:** `products_pack_sizes_positive_chk` (every pack size ≥ 1);
`articles_status_chk` (`draft` | `published`)
**RLS:** public `SELECT` on the three new tables; all writes go through service-role
API routes, which do their own role checks (`canManageContent`)
**Dependencies:** `products` must exist
**Required:** Yes, for pack options and the content surfaces. Without it the admin
screens report the missing table by name and the storefront simply shows no banner,
falls back to the shipped About copy, and lists no articles.
**Idempotent:** Yes, safe to re-run — the About seed is `ON CONFLICT DO NOTHING`, so
a re-run never overwrites edited copy.

**Related code:** `lib/pricing.ts` (`packSizesFor` / `packPriceFor` — a pack of N
costs the vial price × N, no pack discount), `lib/content/*` (block document,
announcements, pages, articles), `app/(admin)/admin/{announcements,pages,articles}`,
and the storefront at `/about`, `/p/[slug]` and `/articles`.

#### `reviews-testimonials-migration.sql` 🆕
**Purpose:** The two things that put a star rating on the storefront, kept apart on
purpose. `product_reviews` are written by customers about one product they bought;
`testimonials` are marketing copy written by staff in Admin → Testimonials about the
shop. Neither can become the other.
**Tables:** `product_reviews`, `testimonials`
**Views:** `product_review_stats` (`security_invoker`) — the `(count, average)` rollup
every product card reads, so a card is one row rather than N
**Constraints:** `product_reviews_one_per_customer` (one review per customer per
product — a second submission updates the first); `rating BETWEEN 1 AND 5` on both
tables
**RLS:** public `SELECT` on published reviews and on testimonials; **no insert policy
at all** on `product_reviews`. That is deliberate: proving a purchase means reading
`orders` / `order_items`, which a customer's own token cannot do, so the only way a
review row appears is through `/api/reviews`, which resolves the buyer from their
bearer token and refuses a product they never ordered.
**Dependencies:** `products`, `customers`, `orders` must exist
**Required:** Yes, for reviews and testimonials. Without it the product page's review
section and the home page's testimonial carousel leave themselves out, product cards
show no stars, and the admin screen reports the missing table by name.
**Idempotent:** Yes, safe to re-run.

**Related code:** `lib/reviews.ts` (shape + the statuses that count as "they bought
it"), `lib/content/testimonials.ts`, `app/api/reviews`, `app/api/{admin/,}testimonials`,
`components/reviews/StarRating.tsx`, `components/product/ProductReviews.tsx`,
`components/home/Testimonials.tsx`, `app/(admin)/admin/testimonials`.

#### `products-schema.sql`
**Purpose:** Complete product catalog with all peptides
**Size:** ~39KB
**Tables:** `products` (if not exists)
**Dependencies:** None
**Required:** Only if you need the product catalog

#### `update-products.sql`
**Purpose:** Product updates (if needed)
**Size:** ~38KB
**Dependencies:** `products` table must exist
**Required:** Only if updating products

---

### **4. DEPRECATED/OLD FILES**

#### `migration-orders.sql` ⚠️
**Status:** DEPRECATED
**Use Instead:** `migration-orders-clean.sql`

#### `migration-confirmations.sql`
**Status:** May be deprecated (check if needed)
**Size:** 84 bytes

---

## 🚀 Setup Instructions

### Option 1: Fresh Setup (Recommended)

**Use this if starting from scratch:**

1. **Run the master schema:**
   ```sql
   -- File: database-schema-complete.sql
   -- Execute in Supabase SQL Editor
   ```

2. **(Optional) Add product catalog:**
   ```sql
   -- File: products-schema.sql
   -- Only if you need the full product catalog
   ```

3. **Verify setup:**
   ```sql
   -- Check tables
   SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

   -- Check customers structure
   SELECT column_name, data_type
   FROM information_schema.columns
   WHERE table_name = 'customers';
   ```

---

### Option 2: Incremental Migrations

**Use this if you have an existing database:**

#### Step-by-Step Migration Order:

```bash
# 1. Base Systems
supabase-schema.sql              # Affiliates system
customer-auth-migration.sql      # Customer auth fields
admin-migration.sql              # Admin flag

# 2. Orders System
migration-orders-clean.sql       # Orders, order_items, sol_addresses

# 3. Role-Based Access Control (March 25, 2025)
assistant-role-migration.sql     # Role enum and assistant role

# 4. User Management (March 25, 2025)
user-management-migration.sql    # Active, last_login_at, email_verified

# 5. Products (Optional)
products-schema.sql              # Product catalog
```

---

## 📊 What Each Migration Adds

| Migration | customers | orders | affiliates | Other Tables |
|-----------|-----------|--------|------------|--------------|
| `customer-auth-migration.sql` | ✅ (adds fields) | - | - | - |
| `admin-migration.sql` | ✅ (adds is_admin) | - | - | - |
| `assistant-role-migration.sql` | ✅ (adds role enum) | - | - | - |
| `user-management-migration.sql` | ✅ (adds active, etc.) | - | - | - |
| `migration-orders-clean.sql` | - | ✅ Creates | - | ✅ order_items, sol_addresses |
| `supabase-schema.sql` | - | - | ✅ Creates | ✅ referral_codes, commissions |
| `products-schema.sql` | - | - | - | ✅ products |

---

## 🔍 Quick Reference

### Find What You Need:

**Setting up users & authentication?**
→ `customer-auth-migration.sql` + `admin-migration.sql`

**Need role-based access (admin/assistant)?**
→ `assistant-role-migration.sql`

**Need user management (activate/deactivate users)?**
→ `user-management-migration.sql`

**Setting up orders/checkout?**
→ `migration-orders-clean.sql`

**Setting up affiliate program?**
→ `supabase-schema.sql`

**Need product catalog?**
→ `products-schema.sql`

**Starting from scratch?**
→ `database-schema-complete.sql` (includes everything except products)

---

## ✅ Verification Queries

After running migrations, verify with these queries:

```sql
-- 1. Check all required tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_type = 'BASE TABLE'
ORDER BY table_name;
-- Expected: affiliates, commissions, customers, order_items, orders,
--           referral_codes, sol_addresses (+ products if added)

-- 2. Check customers table has all fields
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'customers'
ORDER BY ordinal_position;
-- Expected: id, email, first_name, last_name, password_hash, wallet_address,
--           phone, shipping_*, is_admin, role, active, last_login_at,
--           email_verified, created_at, updated_at

-- 3. Check role enum exists
SELECT enumlabel FROM pg_enum
WHERE enumtypid = 'user_role'::regtype;
-- Expected: customer, assistant, admin

-- 4. Check indexes exist
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY indexname;
-- Expected: Multiple indexes (see DATABASE-DOCUMENTATION.md for full list)

-- 5. Check triggers exist
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY trigger_name;
-- Expected: sync_is_admin_on_role_change, orders_updated_at, etc.
```

---

## 🐛 Troubleshooting

### Error: "role already exists"
**Solution:** You already have the role-based system. Skip `assistant-role-migration.sql`

### Error: "column already exists"
**Solution:** You already have that column. Skip that specific migration or use `IF NOT EXISTS`

### Error: "table does not exist"
**Solution:** Run migrations in the correct order (see Option 2 above)

### Want to start fresh?
```sql
-- WARNING: This deletes all data!
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
-- Then run: database-schema-complete.sql
```

---

## 📚 Documentation

For detailed database documentation, see:
**`DATABASE-DOCUMENTATION.md`**

Includes:
- Complete table schemas
- Column descriptions
- Relationships
- Triggers & functions
- Common queries
- Performance tips

---

## 📝 Changelog

| Date | File | Changes |
|------|------|---------|
| Initial | `supabase-schema.sql` | Affiliates system |
| Initial | `customer-auth-migration.sql` | Customer authentication |
| Initial | `admin-migration.sql` | Admin flag |
| Initial | `migration-orders-clean.sql` | Orders system |
| 2025-03-25 | `assistant-role-migration.sql` | Role-based access control |
| 2025-03-25 | `user-management-migration.sql` | User management features |
| 2025-03-25 | `database-schema-complete.sql` | Master schema file (all-in-one) |

---

## 🔒 Security Notes

- All tables have Row Level Security (RLS) enabled
- Service role has full access
- Password hashes should use bcrypt in production (currently placeholder)
- Always backup before running migrations
- Test on staging before production

---

## 💡 Tips

1. **Fresh Setup:** Use `database-schema-complete.sql` - saves time
2. **Existing Database:** Run only needed migrations in order
3. **Products:** Only add if you need the full catalog (large file)
4. **Backup First:** Always backup before migrations
5. **Verify:** Run verification queries after each migration
6. **Documentation:** Read `DATABASE-DOCUMENTATION.md` for details

---

## 📞 Need Help?

1. Check `DATABASE-DOCUMENTATION.md` for table schemas
2. Check `changelog/` folder for feature documentation
3. Verify migrations were applied (see Verification Queries above)
4. Check Supabase logs for errors

---

**Last Updated:** March 25, 2025
**Total SQL Files:** 9 migration files + 1 master schema
