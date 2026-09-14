import { supabase } from '@/lib/supabase';
import { apiFetch } from '@/lib/api-fetch';
import type { SalesPerson, SalesCommission } from '@/lib/types/ecommerce';

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function authHeaders(token: string | null) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ---- LIST ----
export async function getSalesPersons(): Promise<SalesPerson[]> {
  const { data, error } = await supabase
    .from('sales_persons')
    .select('*')
    .order('first_name');
  if (error) { console.error(error); return []; }
  return data ?? [];
}

export async function searchSalesPersons(query: string): Promise<SalesPerson[]> {
  if (!query.trim()) return [];
  const q = query.trim();
  const { data } = await supabase
    .from('sales_persons')
    .select('*')
    .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`)
    .eq('active', true)
    .limit(8);
  return data ?? [];
}

// ---- CREATE ----
export interface CreateSalesPersonPayload {
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  commission_rate?: number;
  notes?: string;
}

export async function createSalesPerson(
  payload: CreateSalesPersonPayload
): Promise<{ success: boolean; sales_person?: SalesPerson; error?: string }> {
  const token = await getToken();
  try {
    const result = await apiFetch<{ sales_person: SalesPerson }>(
      '/api/admin/sales-persons',
      {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify(payload),
      },
    );
    return { success: true, sales_person: result.sales_person };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ---- UPDATE ----
export async function updateSalesPerson(
  id: string,
  updates: Partial<CreateSalesPersonPayload & { active: boolean }>,
): Promise<{ success: boolean; error?: string }> {
  const token = await getToken();
  try {
    await apiFetch(`/api/admin/sales-persons/${id}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify(updates),
    });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ---- DELETE ----
export async function deleteSalesPerson(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const token = await getToken();
  try {
    await apiFetch(`/api/admin/sales-persons/${id}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ---- SALES COMMISSIONS ----
export type EnrichedSalesCommission = SalesCommission & {
  sales_person_name?: string;
  sales_person_email?: string;
  invoice_number?: string;
};

export async function getSalesCommissions(): Promise<EnrichedSalesCommission[]> {
  const { data, error } = await supabase
    .from('sales_commissions')
    .select(`
      *,
      sales_persons (first_name, last_name, email),
      invoices (invoice_number)
    `)
    .order('created_at', { ascending: false });
  if (error) { console.error(error); return []; }
  return (data ?? []).map((c: any) => ({
    ...c,
    sales_person_name: c.sales_persons
      ? `${c.sales_persons.first_name} ${c.sales_persons.last_name}`
      : null,
    sales_person_email: c.sales_persons?.email ?? null,
    invoice_number: c.invoices?.invoice_number ?? null,
  }));
}

export async function markSalesCommissionPaid(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('sales_commissions')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { success: false, error: error.message };
  return { success: true };
}
