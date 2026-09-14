# Aminocan E-Commerce Database Documentation

**Last Updated:** March 25, 2025
**Database:** PostgreSQL (Supabase)
**Version:** 1.0

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Tables](#tables)
3. [Enums](#enums)
4. [Triggers](#triggers)
5. [Indexes](#indexes)
6. [Migration Files](#migration-files)
7. [Setup Instructions](#setup-instructions)

---

## 🎯 Overview

The Aminocan database supports a complete e-commerce platform with:
- **User Management** (customers, assistants, admins)
- **Orders & Payments** (crypto payments: BTC, ETH, SOL)
- **Affiliate System** (referral tracking & commissions)
- **Product Catalog** (peptides products)

---

## 📊 Tables

### 1. `customers`

**Purpose:** Store customer accounts with authentication and role-based access control

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | gen_random_uuid() | Primary key |
| `email` | TEXT | NO | - | Unique email address |
| `first_name` | TEXT | NO | - | First name |
| `last_name` | TEXT | NO | - | Last name |
| `password_hash` | TEXT | YES | - | Hashed password |
| `wallet_address` | TEXT | YES | NULL | Crypto wallet address |
| `phone` | TEXT | YES | NULL | Phone number |
| `shipping_address` | TEXT | YES | NULL | Street address |
| `shipping_city` | TEXT | YES | NULL | City |
| `shipping_state` | TEXT | YES | NULL | State/Province |
| `shipping_postal_code` | TEXT | YES | NULL | Postal/ZIP code |
| `shipping_country` | TEXT | YES | 'US' | Country code |
| `is_admin` | BOOLEAN | NO | false | Legacy admin flag (kept for compatibility) |
| `role` | user_role | NO | 'customer' | User role (customer/assistant/admin) |
| `active` | BOOLEAN | NO | true | Account active status |
| `last_login_at` | TIMESTAMPTZ | YES | NULL | Last login timestamp |
| `email_verified` | BOOLEAN | NO | false | Email verification status |
| `created_at` | TIMESTAMPTZ | NO | now() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NO | now() | Last update timestamp |

**Indexes:**
- `idx_customers_email` - Fast email lookups
- `idx_customers_admin` - Filter admins (is_admin = true)
- `idx_customers_role` - Filter by role (admin/assistant)
- `idx_customers_active` - Filter active users
- `idx_customers_email_verified` - Filter verified emails

**Triggers:**
- `sync_is_admin_on_role_change` - Automatically syncs `is_admin` with `role`

---

### 2. `orders`

**Purpose:** Store e-commerce orders with crypto payment tracking

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | gen_random_uuid() | Primary key |
| `customer_id` | UUID | YES | NULL | FK to customers (optional for guest checkout) |
| `order_number` | TEXT | NO | - | Unique order number |
| `items` | JSONB | NO | - | Order items as JSON |
| `total` | NUMERIC | NO | - | Total order amount |
| `email` | TEXT | YES | NULL | Customer email |
| `shipping_address` | JSONB | YES | NULL | Shipping address as JSON |
| `crypto` | TEXT | NO | - | Cryptocurrency (btc/eth/sol) |
| `status` | TEXT | NO | 'pending' | Order status |
| `payment_address` | TEXT | YES | NULL | Crypto payment address |
| `payment_amount_expected` | TEXT | YES | NULL | Expected payment amount |
| `payment_amount_received` | TEXT | YES | NULL | Actual payment received |
| `payment_tx_hash` | TEXT | YES | NULL | Payment transaction hash |
| `payment_derivation_index` | INTEGER | YES | NULL | HD wallet derivation index |
| `payment_confirmed_at` | TIMESTAMPTZ | YES | NULL | Payment confirmation time |
| `payment_expires_at` | TIMESTAMPTZ | YES | NULL | Payment expiration time |
| `referral_code` | TEXT | YES | NULL | Affiliate referral code |
| `tracking_number` | TEXT | YES | NULL | Shipping tracking number |
| `notes` | TEXT | YES | NULL | Internal notes |
| `created_at` | TIMESTAMPTZ | NO | now() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NO | now() | Last update timestamp |

**Indexes:**
- `idx_orders_status_payment` - Fast pending payment lookups
- `idx_orders_customer` - Customer's orders
- `idx_orders_order_number` - Order number lookups

**Triggers:**
- `orders_updated_at` - Auto-update `updated_at` timestamp

---

### 3. `order_items`

**Purpose:** Individual line items for each order

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | gen_random_uuid() | Primary key |
| `order_id` | UUID | NO | - | FK to orders |
| `product_name` | TEXT | NO | - | Product name at time of purchase |
| `product_id` | TEXT | YES | NULL | Product ID reference |
| `quantity` | INTEGER | NO | - | Quantity ordered |
| `price_at_time` | NUMERIC | NO | - | Price at time of purchase |
| `strength` | TEXT | YES | NULL | Product strength/variant |
| `created_at` | TIMESTAMPTZ | NO | now() | Creation timestamp |

**Indexes:**
- `idx_order_items_order` - Fast order line items lookup

---

### 4. `sol_addresses`

**Purpose:** Pre-generated Solana addresses pool for payments

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | SERIAL | NO | - | Primary key |
| `address` | TEXT | NO | - | Solana wallet address |
| `derivation_index` | INTEGER | NO | - | HD wallet derivation index |
| `used` | BOOLEAN | NO | false | Address used status |
| `order_id` | UUID | YES | NULL | FK to orders (when used) |

**Indexes:**
- `idx_sol_unused` - Fast unused address lookups

---

### 5. `affiliates`

**Purpose:** Affiliate partners who refer customers

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | gen_random_uuid() | Primary key |
| `email` | VARCHAR(255) | NO | - | Unique email |
| `first_name` | VARCHAR(100) | NO | - | First name |
| `last_name` | VARCHAR(100) | NO | - | Last name |
| `wallet_address` | VARCHAR(42) | YES | NULL | Crypto wallet for payouts |
| `password_hash` | TEXT | NO | - | Hashed password |
| `active` | BOOLEAN | NO | true | Affiliate active status |
| `total_earnings` | DECIMAL(10,2) | NO | 0.00 | Total earnings |
| `created_at` | TIMESTAMPTZ | NO | now() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NO | now() | Last update timestamp |

**Indexes:**
- `idx_affiliates_email` - Fast email lookups

**Triggers:**
- `update_affiliates_updated_at` - Auto-update `updated_at`

---

### 6. `referral_codes`

**Purpose:** Unique referral codes for each affiliate

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | gen_random_uuid() | Primary key |
| `affiliate_id` | UUID | NO | - | FK to affiliates |
| `code` | VARCHAR(8) | NO | - | Unique referral code |
| `active` | BOOLEAN | NO | true | Code active status |
| `uses_count` | INTEGER | NO | 0 | Number of times used |
| `created_at` | TIMESTAMPTZ | NO | now() | Creation timestamp |

**Indexes:**
- `idx_referral_codes_code` - Fast code lookups
- `idx_referral_codes_affiliate` - Affiliate's codes

**Triggers:**
- `increment_code_on_commission_created` - Auto-increment uses_count

---

### 7. `commissions`

**Purpose:** Track affiliate commissions from orders

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | NO | gen_random_uuid() | Primary key |
| `affiliate_id` | UUID | NO | - | FK to affiliates |
| `order_id` | UUID | YES | NULL | FK to orders |
| `referral_code_id` | UUID | YES | NULL | FK to referral_codes |
| `amount` | DECIMAL(10,2) | NO | - | Commission amount |
| `order_total` | DECIMAL(10,2) | NO | - | Original order total |
| `commission_rate` | DECIMAL(5,2) | NO | 10.00 | Commission percentage |
| `status` | VARCHAR(20) | NO | 'pending' | Status (pending/paid/cancelled) |
| `paid_at` | TIMESTAMPTZ | YES | NULL | Payment timestamp |
| `created_at` | TIMESTAMPTZ | NO | now() | Creation timestamp |

**Indexes:**
- `idx_commissions_affiliate` - Affiliate's commissions
- `idx_commissions_status` - Filter by status
- `idx_commissions_order` - Order's commissions

**Triggers:**
- `update_earnings_on_commission_paid` - Update affiliate total_earnings when paid

---

## 🏷️ Enums

### `user_role`

User role for role-based access control

**Values:**
- `'customer'` - Regular customer
- `'assistant'` - Read-only admin access
- `'admin'` - Full admin access

**Usage:**
```sql
-- Set user role
UPDATE customers SET role = 'assistant' WHERE email = 'user@example.com';

-- Query by role
SELECT * FROM customers WHERE role = 'admin';
```

---

## ⚡ Triggers

### 1. `sync_is_admin_on_role_change`

**Table:** `customers`
**When:** BEFORE INSERT OR UPDATE
**Purpose:** Keeps `is_admin` boolean in sync with `role` enum for backward compatibility

**Logic:**
```sql
NEW.is_admin = (NEW.role = 'admin')
```

### 2. `orders_updated_at`

**Table:** `orders`
**When:** BEFORE UPDATE
**Purpose:** Automatically update `updated_at` timestamp

### 3. `update_affiliates_updated_at`

**Table:** `affiliates`
**When:** BEFORE UPDATE
**Purpose:** Automatically update `updated_at` timestamp

### 4. `update_earnings_on_commission_paid`

**Table:** `commissions`
**When:** AFTER UPDATE
**Purpose:** When commission status changes to 'paid', add amount to affiliate's total_earnings

### 5. `increment_code_on_commission_created`

**Table:** `commissions`
**When:** AFTER INSERT
**Purpose:** Increment referral_code uses_count when new commission created

---

## 🔍 Indexes

### Performance Indexes

**customers:**
- `idx_customers_email` - Email lookups (login)
- `idx_customers_admin` - WHERE is_admin = true
- `idx_customers_role` - WHERE role IN ('admin', 'assistant')
- `idx_customers_active` - WHERE active = true/false
- `idx_customers_email_verified` - WHERE email_verified = true/false

**orders:**
- `idx_orders_status_payment` - WHERE status = 'pending' AND payment_address IS NOT NULL
- `idx_orders_customer` - WHERE customer_id IS NOT NULL
- `idx_orders_order_number` - Unique order number lookups

**order_items:**
- `idx_order_items_order` - Fast join with orders

**sol_addresses:**
- `idx_sol_unused` - WHERE used = false (find available addresses)

**affiliates:**
- `idx_affiliates_email` - Email lookups (login)

**referral_codes:**
- `idx_referral_codes_code` - Code validation
- `idx_referral_codes_affiliate` - Affiliate's codes

**commissions:**
- `idx_commissions_affiliate` - Affiliate's commissions
- `idx_commissions_status` - Filter by status
- `idx_commissions_order` - Order's commissions

---

## 📄 Migration Files

### Execution Order

Run these SQL files in order to set up the complete database:

1. **`database-schema-complete.sql`** (RECOMMENDED)
   - Complete schema with all migrations
   - Run this once for fresh setup
   - **OR** run individual migration files below

2. **Individual Migrations** (if not using complete schema):
   - `supabase-schema.sql` - Affiliates system
   - `customer-auth-migration.sql` - Customer authentication fields
   - `admin-migration.sql` - Admin flag
   - `migration-orders-clean.sql` - Orders system
   - `assistant-role-migration.sql` - Assistant role system (from March 25, 2025)
   - `user-management-migration.sql` - User management features (from March 25, 2025)

3. **Optional:**
   - `products-schema.sql` - Product catalog (large file, ~39KB)
   - `update-products.sql` - Product updates (if needed)

### Migration History

| Date | File | Description |
|------|------|-------------|
| Initial | `supabase-schema.sql` | Affiliates system |
| Initial | `customer-auth-migration.sql` | Customer auth fields |
| Initial | `admin-migration.sql` | Admin flag |
| Initial | `migration-orders-clean.sql` | Orders system |
| Initial | `products-schema.sql` | Product catalog |
| 2025-03-25 | `assistant-role-migration.sql` | Added assistant role and role enum |
| 2025-03-25 | `user-management-migration.sql` | Added user management fields (active, last_login_at, email_verified) |

---

## 🚀 Setup Instructions

### Option 1: Complete Setup (Recommended)

Run the complete schema file in Supabase SQL Editor:

```sql
-- File: database-schema-complete.sql
-- This includes all migrations in correct order
```

### Option 2: Individual Migrations

If you already have some tables, run only the needed migrations:

```sql
-- Step 1: Affiliates system
-- File: supabase-schema.sql

-- Step 2: Customer enhancements
-- File: customer-auth-migration.sql

-- Step 3: Admin flag
-- File: admin-migration.sql

-- Step 4: Orders system
-- File: migration-orders-clean.sql

-- Step 5: Role system (March 25, 2025)
-- File: assistant-role-migration.sql

-- Step 6: User management (March 25, 2025)
-- File: user-management-migration.sql
```

### Verification

After running migrations, verify with:

```sql
-- Check all tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- Check customers table structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'customers'
ORDER BY ordinal_position;

-- Check user roles distribution
SELECT role, active, COUNT(*) as count
FROM customers
GROUP BY role, active;
```

---

## 🔐 Row Level Security (RLS)

All tables have RLS enabled with service role having full access:

```sql
-- Pattern used across tables
ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON {table_name}
  FOR ALL USING (true) WITH CHECK (true);
```

**Note:** Application-level access control is implemented via API middleware, not RLS policies.

---

## 📊 Entity Relationships

```
customers
  ├─> orders (customer_id)
  └─> (role-based access control)

orders
  ├─> order_items (order_id)
  ├─> commissions (order_id)
  └─> sol_addresses (order_id - for SOL payments)

affiliates
  ├─> referral_codes (affiliate_id)
  └─> commissions (affiliate_id)

referral_codes
  └─> commissions (referral_code_id)
```

---

## 🛠️ Common Queries

### User Management

```sql
-- Get all admins
SELECT * FROM customers WHERE role = 'admin';

-- Get all assistants
SELECT * FROM customers WHERE role = 'assistant';

-- Get active users
SELECT * FROM customers WHERE active = true;

-- Create admin user
INSERT INTO customers (email, first_name, last_name, role, password_hash)
VALUES ('admin@example.com', 'Admin', 'User', 'admin', 'hashed_password');

-- Create assistant user
INSERT INTO customers (email, first_name, last_name, role, password_hash)
VALUES ('assistant@example.com', 'Assistant', 'User', 'assistant', 'hashed_password');

-- Deactivate user
UPDATE customers SET active = false WHERE email = 'user@example.com';
```

### Orders

```sql
-- Get pending orders
SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at DESC;

-- Get user's orders
SELECT * FROM orders WHERE customer_id = 'user-uuid' ORDER BY created_at DESC;

-- Get order with items
SELECT o.*, jsonb_agg(oi.*) as items
FROM orders o
LEFT JOIN order_items oi ON oi.order_id = o.id
WHERE o.id = 'order-uuid'
GROUP BY o.id;
```

### Affiliates

```sql
-- Get affiliate commissions
SELECT
  a.email,
  a.first_name,
  a.last_name,
  a.total_earnings,
  COUNT(c.id) as total_commissions,
  SUM(CASE WHEN c.status = 'pending' THEN c.amount ELSE 0 END) as pending_amount
FROM affiliates a
LEFT JOIN commissions c ON c.affiliate_id = a.id
GROUP BY a.id;

-- Get top referrers
SELECT
  rc.code,
  rc.uses_count,
  a.first_name || ' ' || a.last_name as affiliate_name
FROM referral_codes rc
JOIN affiliates a ON a.id = rc.affiliate_id
WHERE rc.active = true
ORDER BY rc.uses_count DESC
LIMIT 10;
```

---

## 📞 Support

For database-related issues:
1. Check this documentation
2. Verify migration was applied: run verification queries
3. Check Supabase logs for errors
4. Review triggers and functions are created

---

## 📝 Notes

- **Password Hashing:** Currently using placeholder hashes. Implement proper bcrypt hashing in production.
- **RLS Policies:** Service role has full access. Implement stricter policies for production.
- **Backup:** Always backup database before running migrations.
- **Testing:** Test migrations on development/staging before production.

---

**Last Updated:** March 25, 2025
**Maintained by:** Development Team
**Database Version:** PostgreSQL 14+ (Supabase)
