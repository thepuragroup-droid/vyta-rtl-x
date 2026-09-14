-- ============================================
-- DATABASE UPDATE SCRIPT
-- Date: March 25, 2025
-- Purpose: Apply all changes made today (Assistant Role + User Management)
-- ============================================
-- Run this script in your Supabase SQL Editor to update existing database
-- This script is SAFE to run multiple times (uses IF NOT EXISTS)
-- ============================================

-- ============================================
-- PART 1: ASSISTANT ROLE SYSTEM
-- ============================================

-- Step 1: Create the role enum type (if not exists)
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('customer', 'assistant', 'admin');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Step 2: Add role column to customers (if not exists)
DO $$ BEGIN
    ALTER TABLE customers ADD COLUMN role user_role DEFAULT 'customer' NOT NULL;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Step 3: Migrate existing is_admin values to role column
UPDATE customers
SET role = 'admin'
WHERE is_admin = true AND role = 'customer';

-- Step 4: Create function to keep is_admin and role in sync
CREATE OR REPLACE FUNCTION sync_is_admin_with_role()
RETURNS TRIGGER AS $$
BEGIN
  -- Automatically set is_admin based on role
  NEW.is_admin = (NEW.role = 'admin');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 5: Create trigger (drop first if exists to avoid errors)
DROP TRIGGER IF EXISTS sync_is_admin_on_role_change ON customers;
CREATE TRIGGER sync_is_admin_on_role_change
  BEFORE INSERT OR UPDATE ON customers
  FOR EACH ROW
  EXECUTE FUNCTION sync_is_admin_with_role();

-- Step 6: Create index for role column (if not exists)
CREATE INDEX IF NOT EXISTS idx_customers_role ON customers(role)
WHERE role IN ('admin', 'assistant');

-- ============================================
-- PART 2: USER MANAGEMENT FEATURES
-- ============================================

-- Step 1: Add active column for deactivating users
DO $$ BEGIN
    ALTER TABLE customers ADD COLUMN active BOOLEAN DEFAULT true NOT NULL;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Step 2: Add last login tracking
DO $$ BEGIN
    ALTER TABLE customers ADD COLUMN last_login_at TIMESTAMPTZ;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Step 3: Add email verification status
DO $$ BEGIN
    ALTER TABLE customers ADD COLUMN email_verified BOOLEAN DEFAULT false NOT NULL;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Step 4: Create index for active users (if not exists)
CREATE INDEX IF NOT EXISTS idx_customers_active ON customers(active);

-- Step 5: Create index for email verification (if not exists)
CREATE INDEX IF NOT EXISTS idx_customers_email_verified ON customers(email_verified);

-- Step 6: Update existing users to be active by default
UPDATE customers
SET active = true
WHERE active IS NULL;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Show updated customers table structure
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'customers'
ORDER BY ordinal_position;

-- Show role enum values
SELECT enumlabel
FROM pg_enum
WHERE enumtypid = 'user_role'::regtype
ORDER BY enumlabel;

-- Show user distribution by role and status
SELECT
  role,
  active,
  COUNT(*) as user_count
FROM customers
GROUP BY role, active
ORDER BY role, active;

-- Show sample of updated data
SELECT
  id,
  email,
  first_name,
  last_name,
  is_admin,
  role,
  active,
  email_verified,
  created_at
FROM customers
ORDER BY created_at DESC
LIMIT 10;

-- ============================================
-- SUCCESS MESSAGE
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '✅ Database update completed successfully!';
  RAISE NOTICE '📊 New columns added: role, active, last_login_at, email_verified';
  RAISE NOTICE '🔧 New trigger: sync_is_admin_on_role_change';
  RAISE NOTICE '📈 New indexes: idx_customers_role, idx_customers_active, idx_customers_email_verified';
  RAISE NOTICE '✨ You can now use the User Management page at /admin/users';
END $$;
