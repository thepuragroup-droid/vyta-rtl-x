import { supabase } from '@/lib/supabase';
import { apiFetch } from '@/lib/api-fetch';

export interface CreateCustomerPayload {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  shipping_address?: string;
  shipping_city?: string;
  shipping_state?: string;
  shipping_postal_code?: string;
  shipping_country?: string;
}

export interface CreatedCustomer {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
}

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export async function createCustomerRecord(
  payload: CreateCustomerPayload,
): Promise<{ success: boolean; customer?: CreatedCustomer; error?: string }> {
  const token = await getToken();
  try {
    const result = await apiFetch<{ customer: CreatedCustomer }>(
      '/api/admin/customers',
      {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: JSON.stringify(payload),
      },
    );
    return { success: true, customer: result.customer };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export interface UpdateCustomerPayload {
  first_name?: string;
  last_name?: string;
  phone?: string | null;
  shipping_address?: string | null;
  shipping_city?: string | null;
  shipping_state?: string | null;
  shipping_postal_code?: string | null;
  shipping_country?: string | null;
}

// Patch a customer's profile fields (contact + shipping address). Backs the
// invoice form's "Save to profile" action. The admin customer PATCH route
// allow-lists exactly these keys.
export async function updateCustomerRecord(
  id: string,
  patch: UpdateCustomerPayload,
): Promise<{ success: boolean; error?: string }> {
  const token = await getToken();
  try {
    await apiFetch(`/api/admin/customers/${id}`, {
      method: 'PATCH',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: JSON.stringify(patch),
    });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
