import { supabase } from '@/lib/supabase';
import type { SupplierPriceRow, CheapestSupplierPrice } from '@/lib/types/ecommerce';

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function authHeaders(token: string | null): Record<string, string> {
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

// ---- Pricelist editor rows for one supplier ----
export async function getSupplierPrices(supplierId: string): Promise<SupplierPriceRow[]> {
  const token = await getToken();
  const res = await fetch(`/api/admin/suppliers/${supplierId}/prices`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load pricelist');
  const data = await res.json();
  return data.prices ?? [];
}

// ---- Batch upsert a supplier's pricelist ----
export async function saveSupplierPrices(
  supplierId: string,
  items: Array<{ product_id: string; price: number }>
): Promise<{ success: boolean; error?: string }> {
  const token = await getToken();
  try {
    const res = await fetch(`/api/admin/suppliers/${supplierId}/prices`, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify({ items }),
    });
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error ?? 'Failed to save pricelist' };
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ---- Cheapest supplier per product, keyed by product_id ----
export async function getCheapestSupplierPrices(): Promise<Record<string, CheapestSupplierPrice>> {
  const token = await getToken();
  const res = await fetch('/api/admin/supplier-prices/cheapest', {
    headers: authHeaders(token),
  });
  if (!res.ok) return {};
  const data = await res.json();
  return data.cheapest ?? {};
}
