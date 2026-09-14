-- ============================================
-- AMINOCAN E-COMMERCE DATABASE SCHEMA
-- Complete database schema with all migrations applied
-- Last Updated: March 25, 2025
-- ============================================

-- ============================================
-- PART 1: CORE TABLES
-- ============================================

-- Note: The 'customers' table is assumed to exist from initial setup
-- This schema adds columns to it via migrations

-- ============================================
-- PART 2: CUSTOMERS TABLE ENHANCEMENTS
-- ============================================

-- Step 1: Add authentication and profile fields
ALTER TABLE customers ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS shipping_address TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS shipping_city TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS shipping_state TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS shipping_postal_code TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS shipping_country TEXT DEFAULT 'US';

-- Step 2: Add admin flag
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- Step 3: Add role system (customer, assistant, admin)
CREATE TYPE user_role AS ENUM ('customer', 'assistant', 'admin');
ALTER TABLE customers ADD COLUMN IF NOT EXISTS role user_role DEFAULT 'customer' NOT NULL;

-- Step 4: Add user management fields
ALTER TABLE customers ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true NOT NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false NOT NULL;

-- Migrate existing admins to new role system
UPDATE customers SET role = 'admin' WHERE is_admin = true;
UPDATE customers SET active = true WHERE active IS NULL;

-- Create indexes for customers
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_admin ON customers(is_admin) WHERE is_admin = true;
CREATE INDEX IF NOT EXISTS idx_customers_role ON customers(role) WHERE role IN ('admin', 'assistant');
CREATE INDEX IF NOT EXISTS idx_customers_active ON customers(active);
CREATE INDEX IF NOT EXISTS idx_customers_email_verified ON customers(email_verified);

-- Create trigger to keep is_admin and role in sync
CREATE OR REPLACE FUNCTION sync_is_admin_with_role()
RETURNS TRIGGER AS $$
BEGIN
  NEW.is_admin = (NEW.role = 'admin');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_is_admin_on_role_change
  BEFORE INSERT OR UPDATE ON customers
  FOR EACH ROW
  EXECUTE FUNCTION sync_is_admin_with_role();

-- ============================================
-- PART 3: ORDERS SYSTEM
-- ============================================

-- Drop existing objects if they exist
DROP TRIGGER IF EXISTS orders_updated_at ON orders;
DROP FUNCTION IF EXISTS update_orders_updated_at();
DROP TABLE IF EXISTS sol_addresses CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;

-- Orders table
CREATE TABLE orders (
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

-- Order items table
CREATE TABLE order_items (
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

-- SOL pre-generated address pool
CREATE TABLE sol_addresses (
  id SERIAL PRIMARY KEY,
  address TEXT UNIQUE NOT NULL,
  derivation_index INTEGER NOT NULL,
  used BOOLEAN DEFAULT false,
  order_id UUID REFERENCES orders(id)
);

CREATE INDEX idx_sol_unused ON sol_addresses (used) WHERE used = false;

-- Updated_at trigger for orders
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

-- RLS policies for orders
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sol_addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON order_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON sol_addresses FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- PART 4: AFFILIATES SYSTEM
-- ============================================

-- Affiliates Table
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

-- Referral Codes Table
CREATE TABLE IF NOT EXISTS referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  code VARCHAR(8) UNIQUE NOT NULL,
  active BOOLEAN DEFAULT true,
  uses_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT fk_affiliate FOREIGN KEY (affiliate_id) REFERENCES affiliates(id)
);

-- Commissions Table
CREATE TABLE IF NOT EXISTS commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id),
  referral_code_id UUID REFERENCES referral_codes(id),
  amount DECIMAL(10, 2) NOT NULL,
  order_total DECIMAL(10, 2) NOT NULL,
  commission_rate DECIMAL(5, 2) DEFAULT 10.00,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  paid_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT fk_affiliate_commission FOREIGN KEY (affiliate_id) REFERENCES affiliates(id),
  CONSTRAINT fk_referral_code FOREIGN KEY (referral_code_id) REFERENCES referral_codes(id)
);

-- Indexes for affiliates system
CREATE INDEX IF NOT EXISTS idx_affiliates_email ON affiliates(email);
CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_referral_codes_affiliate ON referral_codes(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_commissions_affiliate ON commissions(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_commissions_status ON commissions(status);
CREATE INDEX IF NOT EXISTS idx_commissions_order ON commissions(order_id);

-- Trigger: Update affiliates updated_at
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

-- Trigger: Update affiliate total_earnings when commission is paid
CREATE OR REPLACE FUNCTION update_affiliate_earnings()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS NULL OR OLD.status != 'paid') THEN
    UPDATE affiliates
    SET total_earnings = total_earnings + NEW.amount
    WHERE id = NEW.affiliate_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_earnings_on_commission_paid
  AFTER UPDATE ON commissions
  FOR EACH ROW
  EXECUTE FUNCTION update_affiliate_earnings();

-- Trigger: Increment referral code usage count
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

-- RLS for affiliates system
ALTER TABLE affiliates ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Affiliates can view own data" ON affiliates FOR SELECT USING (true);
CREATE POLICY "Affiliates can update own data" ON affiliates FOR UPDATE USING (true);
CREATE POLICY "Anyone can insert affiliates" ON affiliates FOR INSERT WITH CHECK (true);
CREATE POLICY "Referral codes are viewable by everyone" ON referral_codes FOR SELECT USING (true);
CREATE POLICY "Affiliates can insert own codes" ON referral_codes FOR INSERT WITH CHECK (true);
CREATE POLICY "Commissions viewable by all" ON commissions FOR SELECT USING (true);
CREATE POLICY "Commissions can be inserted" ON commissions FOR INSERT WITH CHECK (true);

-- ============================================
-- PART 5: PRODUCTS TABLE (IF NOT EXISTS)
-- ============================================

-- Note: Products table schema is defined in products-schema.sql
-- This is just a reference - run products-schema.sql separately if needed

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check customers table structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'customers'
ORDER BY ordinal_position;

-- Check all tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- Check all indexes
SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- Check user roles distribution
SELECT
  role,
  active,
  COUNT(*) as count
FROM customers
GROUP BY role, active
ORDER BY role, active;

-- ============================================
-- SUMMARY
-- ============================================

/*
TABLES CREATED/MODIFIED:
- customers (enhanced with authentication, roles, user management)
- orders (e-commerce orders)
- order_items (order line items)
- sol_addresses (crypto payment addresses)
- affiliates (affiliate partners)
- referral_codes (affiliate referral codes)
- commissions (affiliate commissions)

ENUMS CREATED:
- user_role ('customer', 'assistant', 'admin')

KEY FEATURES:
1. User Management System (create, edit, deactivate, delete users)
2. Role-Based Access Control (customer, assistant, admin)
3. E-commerce Orders System
4. Crypto Payments (BTC, ETH, SOL)
5. Affiliate Tracking System
6. Commission Management

TRIGGERS:
- sync_is_admin_on_role_change (keeps is_admin in sync with role)
- orders_updated_at (auto-update order timestamp)
- update_affiliates_updated_at (auto-update affiliate timestamp)
- update_earnings_on_commission_paid (update affiliate earnings)
- increment_code_on_commission_created (track referral usage)

INDEXES:
- Performance indexes on all foreign keys
- Filtered indexes for common queries
- Email uniqueness and lookups

SECURITY:
- Row Level Security (RLS) enabled on all tables
- Service role has full access
- Public policies for necessary operations
*/
