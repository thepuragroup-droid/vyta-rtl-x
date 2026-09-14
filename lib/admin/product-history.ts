import type { SupabaseClient } from '@supabase/supabase-js';

export type ProductChangeType = 'price' | 'stock' | 'general';

export interface ProductHistoryActor {
  actor_id: string | null;
  actor_email: string | null;
}

export interface ProductHistoryRow {
  id: string;
  created_at: string;
  product_id: string;
  change_type: ProductChangeType;
  field: string;
  old_value: string | null;
  new_value: string | null;
  source: string;
  reference_type: string | null;
  reference_id: string | null;
  note: string | null;
  actor_id: string | null;
  actor_email: string | null;
}

/**
 * Fields we track for product history, mapped to the tab bucket they
 * belong to and a human-readable label for the UI. Anything not listed
 * here is ignored by the diff.
 */
const TRACKED_FIELDS: Record<string, { type: ProductChangeType; label: string }> = {
  price: { type: 'price', label: 'Price' },
  price_usd: { type: 'price', label: 'USD price' },
  vial_price: { type: 'price', label: 'Vial price' },
  stock_quantity: { type: 'stock', label: 'Stock quantity' },
  vials_per_box: { type: 'stock', label: 'Vials per box' },
  low_stock_threshold: { type: 'stock', label: 'Low-stock threshold' },
  name: { type: 'general', label: 'Name' },
  slug: { type: 'general', label: 'Slug' },
  sku: { type: 'general', label: 'SKU' },
  category: { type: 'general', label: 'Category' },
  strength: { type: 'general', label: 'Strength' },
  purity: { type: 'general', label: 'Purity' },
  form: { type: 'general', label: 'Form' },
  active: { type: 'general', label: 'Status (active)' },
  featured: { type: 'general', label: 'Featured' },
  description_short: { type: 'general', label: 'Short description' },
  description: { type: 'general', label: 'Full description' },
  benefits: { type: 'general', label: 'Benefits' },
  mechanism: { type: 'general', label: 'Mechanism' },
  image_url: { type: 'general', label: 'Image' },
  coa_url: { type: 'general', label: 'Certificates (COA)' },
};

export const PRODUCT_HISTORY_FIELDS = TRACKED_FIELDS;

/** Normalise a value to a comparable, storable string (null-safe). */
function toComparable(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/**
 * Diff `before` against `after` for the tracked fields and append a
 * product_history row for each change. Uses the service-role `db`.
 * Never throws — history logging must never fail a product mutation.
 */
export async function recordProductChanges(
  db: SupabaseClient,
  actor: ProductHistoryActor,
  productId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  opts: { source?: string; reference_type?: string | null; reference_id?: string | null } = {},
): Promise<void> {
  try {
    const source = opts.source ?? 'admin_edit';
    const rows: Array<Record<string, unknown>> = [];

    for (const [field, meta] of Object.entries(TRACKED_FIELDS)) {
      // Only diff fields present in the `after` payload (partial updates
      // shouldn't log untouched fields as "changed to null").
      if (!(field in after)) continue;

      const oldVal = toComparable(before[field]);
      const newVal = toComparable(after[field]);
      if (oldVal === newVal) continue;

      rows.push({
        product_id: productId,
        change_type: meta.type,
        field,
        old_value: oldVal,
        new_value: newVal,
        source,
        reference_type: opts.reference_type ?? null,
        reference_id: opts.reference_id ?? null,
        actor_id: actor.actor_id,
        actor_email: actor.actor_email,
      });
    }

    if (rows.length === 0) return;

    const { error } = await db.from('product_history').insert(rows);
    if (error) console.error('recordProductChanges insert failed:', error);
  } catch (err) {
    console.error('recordProductChanges threw:', err);
  }
}

/** Server-only read helper for a single product's history, newest first. */
export async function getProductHistory(
  db: SupabaseClient,
  productId: string,
  limit = 500,
): Promise<ProductHistoryRow[]> {
  const clamped = Math.min(Math.max(limit, 1), 1000);
  const { data, error } = await db
    .from('product_history')
    .select('*')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(clamped);
  if (error) {
    console.error('getProductHistory failed:', error);
    return [];
  }
  return (data ?? []) as ProductHistoryRow[];
}
