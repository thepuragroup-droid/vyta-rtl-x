// applyAffiliatePricelist — copy an affiliate's price overrides into a
// bound customer's overrides. Called whenever a customer's affiliate_id
// is set (on create or update).
//
// Idempotent strategy: for each product in the affiliate's list, delete the
// customer's existing row for that product, then insert the affiliate's
// price. Products not in the affiliate's list are untouched. We do not
// rely on a unique constraint on (customer_id, product_id) because there
// is none today.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ApplyResult {
  copied: number;
  source_count: number;
  skipped_reason?: 'no_affiliate' | 'no_customer' | 'no_overrides';
}

export async function applyAffiliatePricelist(
  db: SupabaseClient,
  customerId: string,
  affiliateId: string | null,
): Promise<ApplyResult> {
  if (!customerId) return { copied: 0, source_count: 0, skipped_reason: 'no_customer' };
  if (!affiliateId) return { copied: 0, source_count: 0, skipped_reason: 'no_affiliate' };

  // 1. Load affiliate's overrides.
  const { data: src, error: srcErr } = await db
    .from('affiliate_price_overrides')
    .select('product_id, override_price')
    .eq('affiliate_id', affiliateId);
  if (srcErr) throw new Error(`affiliate overrides read failed: ${srcErr.message}`);
  const rows = (src ?? []).filter(
    (r) => !!r.product_id && r.override_price != null,
  );
  if (rows.length === 0) {
    return { copied: 0, source_count: 0, skipped_reason: 'no_overrides' };
  }

  const productIds = rows.map((r) => r.product_id);

  // 2. Clear the customer's existing overrides for those exact products,
  //    so we can write the affiliate's prices without dup rows.
  const { error: delErr } = await db
    .from('customer_price_overrides')
    .delete()
    .eq('customer_id', customerId)
    .in('product_id', productIds);
  if (delErr) {
    throw new Error(`customer overrides clear failed: ${delErr.message}`);
  }

  // 3. Insert one row per affiliate override.
  const inserts = rows.map((r) => ({
    customer_id: customerId,
    product_id: r.product_id,
    override_price: r.override_price,
  }));
  const { error: insErr } = await db
    .from('customer_price_overrides')
    .insert(inserts);
  if (insErr) {
    throw new Error(`customer overrides insert failed: ${insErr.message}`);
  }

  return { copied: inserts.length, source_count: rows.length };
}
