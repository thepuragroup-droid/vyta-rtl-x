-- =========================================================================
--  AMINOCAN — LIVE SCHEMA SNAPSHOT (PUBLIC schema, tables only)
-- =========================================================================
--
--  This file is generated from `information_schema.columns` against the live
--  Supabase project and is the **source of truth** for the loose root-level
--  `*-migration.sql` files. Those files are historic snapshots — many no
--  longer reflect the live shape (extensions added, columns renamed via the
--  dashboard, etc.). When the MCP server's `list_tables source='current'`
--  parser sees this file at the repo root, it uses it exclusively (see
--  `tools/aminocan-mcp/server.mjs`).
--
--  Last refreshed: 2026-06-23 via mcp__supabase__execute_sql.
--  Refresh procedure:
--    1. Re-run the live `information_schema.columns` dump query.
--    2. Replace the body below.
--    3. Re-run `node tools/aminocan-mcp/server.mjs --smoke` to validate.
--
--  NOT included here (kept in their own migration files):
--    - Indexes (see `pg_indexes` for current truth)
--    - Triggers (see `pg_trigger`)
--    - RLS policies (see `pg_policies`)
--    - Functions / RPCs (see `pg_proc`)
--    - The `user_role` enum (dashboard-managed)
--
--  Tables in private schemas (`auth`, `storage`, ...) are NOT mirrored.
-- =========================================================================

CREATE TABLE IF NOT EXISTS affiliate_price_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL,
  product_id uuid NOT NULL,
  override_price numeric NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS affiliate_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  wallet_address text,
  message text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS affiliates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email varchar NOT NULL,
  first_name varchar NOT NULL,
  last_name varchar NOT NULL,
  wallet_address varchar,
  password_hash text NOT NULL,
  active boolean DEFAULT true,
  total_earnings numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  commission_rate numeric NOT NULL DEFAULT 0.10
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  actor_email text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text
);

CREATE TABLE IF NOT EXISTS backorder_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  backorder_id uuid NOT NULL,
  product_id uuid,
  description text NOT NULL,
  qty_ordered numeric NOT NULL,
  qty_available numeric NOT NULL,
  qty_backordered numeric NOT NULL,
  unit_price numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS backorders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open',
  purchase_order_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  fulfilled_at timestamptz
);

CREATE TABLE IF NOT EXISTS commissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL,
  order_id uuid NOT NULL,
  referral_code_id uuid,
  amount numeric NOT NULL,
  order_total numeric NOT NULL,
  commission_rate numeric DEFAULT 10,
  status varchar DEFAULT 'pending',
  paid_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  name text,
  mode text NOT NULL DEFAULT 'agent',
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crypto_transactions (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  order_id uuid,
  transaction_hash varchar,
  wallet_address varchar NOT NULL,
  amount numeric NOT NULL,
  currency varchar NOT NULL,
  network varchar,
  status varchar DEFAULT 'pending',
  block_number bigint,
  confirmations integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  confirmed_at timestamptz
);

CREATE TABLE IF NOT EXISTS customer_price_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  product_id uuid NOT NULL,
  override_price numeric NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  email varchar NOT NULL,
  wallet_address varchar,
  first_name varchar,
  last_name varchar,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  password_hash text,
  phone text,
  shipping_address text,
  shipping_city text,
  shipping_state text,
  shipping_postal_code text,
  shipping_country text DEFAULT 'US',
  is_admin boolean DEFAULT false,
  role user_role NOT NULL DEFAULT 'customer',
  active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  email_verified boolean NOT NULL DEFAULT false,
  has_completed_first_order boolean NOT NULL DEFAULT false,
  website_accessed text,
  allow_pickup boolean DEFAULT true,
  allow_shipping boolean DEFAULT true,
  affiliate_id uuid,
  can_send_fulfillment_emails boolean NOT NULL DEFAULT false,
  preferred_currency text NOT NULL DEFAULT 'CAD'
);

CREATE TABLE IF NOT EXISTS fulfillment_email_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_id uuid,
  order_id uuid,
  -- kind ∈ {packed, shipped, etransfer_ack, etransfer_instructions, etransfer_admin_notice}
  kind text NOT NULL,
  to_email text NOT NULL,
  subject text,
  message_id text,
  success boolean NOT NULL DEFAULT false,
  error text,
  sent_by uuid,
  sent_by_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  variant_id uuid,
  change_qty integer NOT NULL,
  reason text NOT NULL,
  reference_id text,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  product_id uuid,
  delta integer,
  reference_type text
);

CREATE TABLE IF NOT EXISTS invoice_email_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL,
  sent_by uuid,
  sent_by_email text,
  to_email text NOT NULL,
  bcc_emails jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject text NOT NULL,
  message_id text,
  success boolean NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL,
  product_variant_id uuid,
  description text NOT NULL,
  qty integer NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL,
  discount_pct numeric NOT NULL DEFAULT 0,
  line_total numeric NOT NULL,
  product_id uuid,
  qty_fulfilled integer NOT NULL DEFAULT 0,
  qty_backordered integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL,
  order_id uuid,
  customer_id uuid,
  issue_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date NOT NULL,
  subtotal numeric NOT NULL DEFAULT 0,
  tax_total numeric NOT NULL DEFAULT 0,
  shipping_cost numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  customer_name text,
  customer_email text,
  customer_phone text,
  sales_person_id uuid,
  sales_person_commission_rate numeric DEFAULT 0,
  sales_person_commission_amount numeric DEFAULT 0,
  tax_rate numeric,
  last_emailed_at timestamptz,
  last_emailed_by uuid,
  last_emailed_by_email text,
  stock_adjusted boolean NOT NULL DEFAULT false,
  is_backorder boolean NOT NULL DEFAULT false,
  parent_invoice_id uuid,
  fulfillment_type text NOT NULL DEFAULT 'shipment',
  fulfillment_status text NOT NULL DEFAULT 'pending',
  packed_at timestamptz,
  packed_by uuid,
  fulfilled_at timestamptz,
  fulfilled_by uuid,
  packed_emailed_at timestamptz,
  shipped_emailed_at timestamptz,
  handling_checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  packed_photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  non_payable boolean NOT NULL DEFAULT false,
  currency text NOT NULL DEFAULT 'CAD'
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  whatsapp_msg_id text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid,
  product_name text NOT NULL,
  product_id text,
  quantity integer NOT NULL,
  price_at_time numeric NOT NULL,
  strength text,
  created_at timestamptz DEFAULT now(),
  product_variant_id uuid,
  sku_snapshot text,
  name_snapshot text,
  discount_pct numeric DEFAULT 0,
  line_total numeric,
  restocked boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_id uuid,
  order_number text NOT NULL,
  items jsonb NOT NULL,
  total numeric NOT NULL,
  email text,
  shipping_address jsonb,
  crypto text,
  status text NOT NULL DEFAULT 'pending',
  payment_address text,
  payment_amount_expected text,
  payment_amount_received text,
  payment_tx_hash text,
  payment_derivation_index integer,
  payment_confirmed_at timestamptz,
  payment_expires_at timestamptz,
  referral_code text,
  tracking_number text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  payment_confirmations integer DEFAULT 0,
  billing_address jsonb,
  shipping_method text,
  shipping_carrier text,
  shipping_cost numeric,
  discount_total numeric DEFAULT 0,
  tax_total numeric DEFAULT 0,
  subtotal numeric,
  staff_notes text,
  easyship_shipment_id text,
  packed_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  refunded_at timestamptz,
  stock_adjusted boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'website',
  tracking_status text,
  tracking_url text,
  carrier text,
  label_state text,
  label_url text,
  discount_amount numeric NOT NULL DEFAULT 0,
  fulfillment_type text,
  auto_shipment_status text,
  auto_shipment_stage text,
  auto_shipment_error text,
  auto_shipment_attempted_at timestamptz
);

CREATE TABLE IF NOT EXISTS payments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL,
  amount numeric NOT NULL,
  method text NOT NULL,
  reference_note text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid
);

CREATE TABLE IF NOT EXISTS pricelist_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pricelist_id uuid NOT NULL,
  product_id uuid NOT NULL,
  price numeric NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pricelists (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- product_variants is LEGACY (do not use). Listed here only for completeness.
CREATE TABLE IF NOT EXISTS product_variants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  sku text NOT NULL,
  option_name text NOT NULL,
  option_value text NOT NULL,
  qty_on_hand integer NOT NULL DEFAULT 0,
  reorder_threshold integer NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name varchar NOT NULL,
  description text,
  price numeric NOT NULL,
  stock_quantity integer NOT NULL DEFAULT 0,
  category varchar,
  image_url text,
  strength varchar,
  purity varchar,
  form varchar,
  featured boolean DEFAULT false,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  slug varchar,
  description_short text,
  benefits text,
  mechanism text,
  coa_url text,
  sku text,
  cost_price numeric,
  sale_price numeric,
  weight_grams integer,
  length_cm numeric,
  width_cm numeric,
  height_cm numeric,
  supplier_id uuid,
  warehouse_location text,
  is_active boolean NOT NULL DEFAULT true,
  low_stock_threshold integer,
  low_stock_alerted boolean NOT NULL DEFAULT false,
  box_image_url text
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL,
  product_id uuid,
  product_variant_id uuid,
  description text NOT NULL,
  sku_snapshot text,
  qty integer NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL,
  line_total numeric NOT NULL,
  qty_received integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchase_order_receipt_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL,
  po_item_id uuid NOT NULL,
  product_id uuid,
  qty integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_order_receipts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  po_number text NOT NULL,
  supplier_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  subtotal numeric NOT NULL DEFAULT 0,
  tax_type text NOT NULL DEFAULT 'percentage',
  tax_value numeric NOT NULL DEFAULT 0,
  tax_total numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  notes text,
  expected_date date,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  inventory_applied boolean NOT NULL DEFAULT false,
  inventory_applied_at timestamptz,
  discount numeric NOT NULL DEFAULT 0,
  shipping_fee numeric NOT NULL DEFAULT 0,
  order_date date,
  discount_type text NOT NULL DEFAULT 'percentage',
  discount_value numeric NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS referral_codes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL,
  code varchar NOT NULL,
  active boolean DEFAULT true,
  uses_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_commissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sales_person_id uuid NOT NULL,
  invoice_id uuid,
  amount numeric NOT NULL,
  invoice_total numeric NOT NULL,
  commission_rate numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_persons (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text,
  phone text,
  commission_rate numeric NOT NULL DEFAULT 5,
  notes text,
  active boolean NOT NULL DEFAULT true,
  total_earnings numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid
);

CREATE TABLE IF NOT EXISTS shipment_auto_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid,
  order_number text,
  stage text NOT NULL,
  ok boolean NOT NULL,
  courier text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS site_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  checkout_type text NOT NULL DEFAULT 'crypto',
  admin_emails jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  pickup_address text DEFAULT '',
  guest_checkout_enabled boolean DEFAULT true,
  invoice_cc_emails jsonb NOT NULL DEFAULT '[]'::jsonb,
  invoice_customer_email_subject text,
  invoice_customer_email_body text,
  invoice_admin_email_subject text,
  invoice_admin_email_body text,
  easyship_enabled boolean DEFAULT false,
  easyship_api_key text DEFAULT '',
  shipping_origin jsonb DEFAULT '{}'::jsonb,
  shipping_box jsonb DEFAULT '{}'::jsonb,
  shipping_item_weight_kg numeric DEFAULT 0.05,
  shipping_flat_rate numeric DEFAULT 20,
  shipping_handling_fee_type text DEFAULT 'flat',
  shipping_handling_fee_value numeric DEFAULT 0,
  easyship_auto_create_shipment boolean DEFAULT false,
  easyship_auto_courier_preference text DEFAULT 'cheapest',
  easyship_auto_buy_label boolean DEFAULT false,
  etransfer_enabled boolean DEFAULT true,
  etransfer_recipient_email text,
  etransfer_security_question text,
  etransfer_security_answer_hint text,
  etransfer_ack_subject text,
  etransfer_ack_body text,
  etransfer_instructions_subject text,
  etransfer_instructions_body text
);

CREATE TABLE IF NOT EXISTS sol_addresses (
  id integer NOT NULL,
  address text NOT NULL,
  derivation_index integer NOT NULL,
  used boolean DEFAULT false,
  order_id uuid
);

CREATE TABLE IF NOT EXISTS stock_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  customer_id uuid,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  notified_at timestamptz
);

CREATE TABLE IF NOT EXISTS supplier_prices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL,
  product_id uuid NOT NULL,
  price numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_person text,
  email text,
  phone text,
  lead_time_days integer DEFAULT 7,
  created_at timestamptz NOT NULL DEFAULT now(),
  notes text
);
