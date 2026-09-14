/**
 * Tolerance for the PuraMass address columns not being queryable yet.
 *
 * `shipping_address` / `customer_name` / `customer_phone` arrive with
 * puramass-shipping-address-migration.sql; the provenance and
 * "when did we last ask the customer" columns arrive with
 * puramass-missing-address-migration.sql. Between a deploy and that migration
 * — and for the window after it while PostgREST is still serving a stale schema
 * cache — every read and write naming those columns fails outright. That must
 * not take down the admin orders page or, worse, make the payment webhook
 * return 500 and retry forever.
 *
 * So each call site names the columns optimistically and retries without them
 * when the database says it doesn't know them. Once the migration is visible
 * the fallback simply never fires.
 */

/** Columns added by the two PuraMass address migrations. */
export const PURAMASS_ADDRESS_COLUMNS = [
  // puramass-shipping-address-migration.sql
  'shipping_address',
  'customer_name',
  'customer_phone',
  // puramass-missing-address-migration.sql
  'shipping_address_source',
  'shipping_address_updated_at',
  'address_requested_at',
];

/** Columns added by puramass-order-details-migration.sql. */
export const PURAMASS_ORDER_DETAIL_COLUMNS = [
  'expires_at',
  'refunded_total_cents',
  'refunds',
  'paid_items',
];

/** Columns added by puramass-hosted-shipping-migration.sql. */
export const PURAMASS_SHIPPING_COLUMNS = [
  'shipping_total_cents',
  'shipping_courier',
  'shipping_courier_id',
];

/** Columns added by abandoned-checkout-recovery-migration.sql. */
export const PURAMASS_RECOVERY_COLUMNS = [
  'recovery_email_sent_at',
  'recovery_email_count',
  'recovery_promo_code',
  'recovery_discount_type',
  'recovery_discount_value',
];

/** Every column a migration may not have applied yet. */
export const PURAMASS_OPTIONAL_COLUMNS = [
  ...PURAMASS_ADDRESS_COLUMNS,
  ...PURAMASS_ORDER_DETAIL_COLUMNS,
  ...PURAMASS_SHIPPING_COLUMNS,
  ...PURAMASS_RECOVERY_COLUMNS,
];

// 42703 = undefined_column (Postgres, on reads).
// PGRST204 = column not in PostgREST's schema cache (on writes).
const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST204']);

/** True when an error means "that column isn't there", not "the query failed". */
export function isMissingColumnError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  if (e.code && MISSING_COLUMN_CODES.has(e.code)) return true;
  const msg = typeof e.message === 'string' ? e.message : '';
  // Postgres: "column puramass_orders.shipping_address does not exist".
  // PostgREST: "Could not find the 'x' column of 'y' in the schema cache".
  return (
    (/\bcolumn\b/i.test(msg) && /does not exist/i.test(msg)) ||
    /in the schema cache/i.test(msg)
  );
}

/** Drop every not-necessarily-migrated column from an update payload. */
export function stripUnmigratedFields(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!PURAMASS_OPTIONAL_COLUMNS.includes(k)) out[k] = v;
  }
  return out;
}
