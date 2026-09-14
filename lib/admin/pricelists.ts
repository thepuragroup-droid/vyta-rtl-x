import { supabase } from '@/lib/supabase';
import type { Pricelist, PricelistItem } from '@/lib/supabase';

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function authHeaders(token: string | null): Record<string, string> {
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

export type PricelistListItem = Pricelist & { item_count: number };

export interface PricelistItemWithProduct extends PricelistItem {
  product: { id: string; name: string; slug: string | null; strength: string | null; price: number } | null;
}

// ---- List ----
export async function getPricelists(): Promise<PricelistListItem[]> {
  const token = await getToken();
  const res = await fetch('/api/admin/pricelists', { headers: authHeaders(token) });
  if (!res.ok) return [];
  const data = await res.json();
  return data.pricelists ?? [];
}

// ---- Single (with items + product) ----
export async function getPricelist(
  id: string
): Promise<{ pricelist: Pricelist; items: PricelistItemWithProduct[] } | null> {
  const token = await getToken();
  const res = await fetch(`/api/admin/pricelists/${id}`, { headers: authHeaders(token) });
  if (!res.ok) return null;
  return res.json();
}

// ---- Create (optionally cloning a source list) ----
export async function createPricelist(
  input: { name: string; description?: string; source_pricelist_id?: string } | string,
  sourceIdLegacy?: string,
): Promise<{ success: boolean; pricelist?: Pricelist; error?: string }> {
  const token = await getToken();
  // Back-compat with old (name, sourceId) callsites.
  const body = typeof input === 'string'
    ? { name: input, source_pricelist_id: sourceIdLegacy }
    : input;
  try {
    const res = await fetch('/api/admin/pricelists', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error ?? 'Failed to create pricelist' };
    return { success: true, pricelist: data.pricelist };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ---- Update header + items ----
export async function updatePricelist(
  id: string,
  patch: {
    name?: string;
    description?: string;
    is_active?: boolean;
    items?: Array<{ product_id: string; price: number }>;
  },
): Promise<{ success: boolean; error?: string }> {
  const token = await getToken();
  try {
    const res = await fetch(`/api/admin/pricelists/${id}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, error: data.error ?? 'Failed to update pricelist' };
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function setActivePricelist(id: string) {
  return updatePricelist(id, { is_active: true });
}

export async function deletePricelist(id: string): Promise<{ success: boolean; error?: string }> {
  const token = await getToken();
  try {
    const res = await fetch(`/api/admin/pricelists/${id}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, error: data.error ?? 'Failed to delete pricelist' };
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ---- Apply a pricelist to a customer's overrides ----
export interface ApplyPricelistResult {
  success: boolean;
  applied?: number;
  skipped?: number;
  error?: string;
}

/**
 * Copy every price from a pricelist onto a customer's overrides.
 *   'override'      (default) — the list wins for every product.
 *   'keep_existing' — only seed products the customer has no override for.
 * Stamps customers.applied_pricelist_id so the UI can show "Price list: X".
 */
export async function applyPricelistToCustomer(
  pricelistId: string,
  customerId: string,
  mode: 'override' | 'keep_existing' = 'override',
): Promise<ApplyPricelistResult> {
  const token = await getToken();
  try {
    const res = await fetch(`/api/admin/pricelists/${pricelistId}/apply-to-customer`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ customer_id: customerId, mode }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, error: data.error ?? 'Failed to apply pricelist' };
    return { success: true, applied: data.applied, skipped: data.skipped };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ---- Active pricelist + price map (consumed by the invoice form) ----
// Pass `customerId` to apply the Hybrid H chain (customer override >
// active pricelist). Without a customer, returns raw pricelist prices.
export async function getActivePricelist(customerId?: string | null): Promise<{
  pricelist: Pricelist | null;
  prices: Record<string, number>;
}> {
  const token = await getToken();
  const qs = customerId ? `?customer_id=${encodeURIComponent(customerId)}` : '';
  const res = await fetch(`/api/admin/pricelists/active${qs}`, { headers: authHeaders(token) });
  if (!res.ok) return { pricelist: null, prices: {} };
  const data = await res.json();
  return { pricelist: data.pricelist ?? null, prices: data.prices ?? {} };
}
