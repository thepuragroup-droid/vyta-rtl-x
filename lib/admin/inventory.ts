/**
 * @deprecated Variant-based inventory helpers (product_variants).
 * Stock now lives on products.stock_quantity (see simplify-product-stock-migration.sql)
 * and low-stock alerts run through lib/admin/low-stock.ts. Retained for the legacy
 * /admin/inventory page only; slated for removal.
 */
import { supabase } from '@/lib/supabase';
import { apiFetch } from '@/lib/api-fetch';
import type {
  Supplier,
  ProductVariant,
  InventoryLog,
  LowStockAlert,
  ValuationResult,
} from '@/lib/types/ecommerce';

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

// ---- SUPPLIERS ----

export async function getSuppliers(): Promise<Supplier[]> {
  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .order('name');
  if (error) { console.error(error); return []; }
  return data ?? [];
}

export async function createSupplier(
  payload: Omit<Supplier, 'id' | 'created_at'>
): Promise<{ success: boolean; supplier?: Supplier; error?: string }> {
  const { data, error } = await supabase
    .from('suppliers')
    .insert(payload)
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  return { success: true, supplier: data };
}

export async function updateSupplier(
  id: string,
  updates: Partial<Omit<Supplier, 'id' | 'created_at'>>
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('suppliers').update(updates).eq('id', id);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ---- PRODUCT VARIANTS ----

export async function getVariantsByProduct(productId: string): Promise<ProductVariant[]> {
  const { data, error } = await supabase
    .from('product_variants')
    .select('*')
    .eq('product_id', productId)
    .order('option_name');
  if (error) { console.error(error); return []; }
  return data ?? [];
}

export async function createVariant(
  payload: Omit<ProductVariant, 'id' | 'created_at' | 'updated_at'>
): Promise<{ success: boolean; variant?: ProductVariant; error?: string }> {
  const { data, error } = await supabase
    .from('product_variants')
    .insert(payload)
    .select()
    .single();
  if (error) return { success: false, error: error.message };
  return { success: true, variant: data };
}

export async function updateVariant(
  id: string,
  updates: Partial<Omit<ProductVariant, 'id' | 'created_at' | 'updated_at'>>
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('product_variants')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function deleteVariant(id: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('product_variants').delete().eq('id', id);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ---- INVENTORY ADJUSTMENTS ----

export async function adjustInventory(
  variantId: string,
  changeQty: number,
  reason: InventoryLog['reason'],
  opts?: { referenceId?: string; note?: string; createdBy?: string }
): Promise<{ success: boolean; error?: string }> {
  // Fetch current qty
  const { data: variant, error: fetchErr } = await supabase
    .from('product_variants')
    .select('qty_on_hand')
    .eq('id', variantId)
    .single();

  if (fetchErr || !variant) return { success: false, error: 'Variant not found' };

  const newQty = variant.qty_on_hand + changeQty;
  if (newQty < 0) return { success: false, error: 'Insufficient stock' };

  const { error: updateErr } = await supabase
    .from('product_variants')
    .update({ qty_on_hand: newQty, updated_at: new Date().toISOString() })
    .eq('id', variantId);

  if (updateErr) return { success: false, error: updateErr.message };

  const { error: logErr } = await supabase.from('inventory_log').insert({
    variant_id: variantId,
    change_qty: changeQty,
    reason,
    reference_id: opts?.referenceId ?? null,
    note: opts?.note ?? null,
    created_by: opts?.createdBy ?? null,
  });

  if (logErr) console.error('inventory_log insert failed:', logErr);

  return { success: true };
}

// ---- INVENTORY LOG ----

export async function getInventoryLog(
  variantId?: string,
  limit = 50
): Promise<InventoryLog[]> {
  let query = supabase
    .from('inventory_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (variantId) query = query.eq('variant_id', variantId);
  const { data, error } = await query;
  if (error) { console.error(error); return []; }
  return data ?? [];
}

// ---- LOW STOCK ----

export async function getLowStockAlerts(): Promise<LowStockAlert[]> {
  const { data, error } = await supabase.rpc('get_low_stock_variants');
  if (error) { console.error(error); return []; }
  return (data ?? []).map((r: any): LowStockAlert => ({
    variant_id: r.variant_id,
    product_id: r.product_id,
    product_name: r.product_name,
    sku: r.sku,
    option_name: r.option_name,
    option_value: r.option_value,
    qty_on_hand: r.qty_on_hand,
    reorder_threshold: r.reorder_threshold,
  }));
}

// ---- VALUATION (via API route) ----

export async function getInventoryValuation(): Promise<ValuationResult | null> {
  const token = await getToken();
  try {
    return await apiFetch<ValuationResult>('/api/admin/inventory/valuation', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch (e) {
    console.error(e);
    return null;
  }
}
