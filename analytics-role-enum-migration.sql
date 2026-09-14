-- ============================================================
-- ANALYTICS ROLE — add the `analytics` value to the user_role enum
-- ============================================================
--
-- MUST run on its own: Postgres forbids `ALTER TYPE ... ADD VALUE` from
-- sharing a transaction with later statements that USE the new value. Run
-- this file first (autocommit), then run store-categories-migration.sql and
-- marketing-branding-migration.sql.
--
-- `analytics` is an external marketing/analytics partner role:
--   * read the sales/traffic analytics dashboard — PAID ADS ONLY: every sales
--     figure served to this role counts only orders won by a paid ad channel,
--     filtered server-side (lib/analytics/paid-scope.ts)
--   * edit product descriptors (copy + images only — no price/stock/visibility)
--   * manage the storefront category taxonomy
--   * edit branding + tracking (GA4 / Meta Pixel + consent)
-- All gates are code functions (lib/permissions.ts); the enum add is the only
-- thing that makes the role assignable.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'analytics';
