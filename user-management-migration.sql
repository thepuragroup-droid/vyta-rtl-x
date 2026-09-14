-- ============================================
-- USER MANAGEMENT MIGRATION
-- Adds fields needed for user management features
-- ============================================

-- Step 1: Add active column for deactivating users
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true NOT NULL;

-- Step 2: Add last login tracking (optional but useful)
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- Step 3: Add email verification status (optional)
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false NOT NULL;

-- Step 4: Create index for active users (improves query performance)
CREATE INDEX IF NOT EXISTS idx_customers_active ON customers(active);

-- Step 5: Create index for email verification
CREATE INDEX IF NOT EXISTS idx_customers_email_verified ON customers(email_verified);

-- Step 6: Update existing users to be active by default
UPDATE customers
SET active = true
WHERE active IS NULL;

-- Step 7: Verify the changes
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'customers'
AND column_name IN ('active', 'last_login_at', 'email_verified')
ORDER BY column_name;

-- Step 8: Show sample data
SELECT
  id,
  email,
  first_name,
  last_name,
  role,
  active,
  email_verified,
  created_at
FROM customers
ORDER BY created_at DESC
LIMIT 5;
