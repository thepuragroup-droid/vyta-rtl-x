import { supabase } from '@/lib/supabase';
import { apiFetch } from '@/lib/api-fetch';
import { adjustInventory } from './inventory';
import type {
  AdminOrder,
  AdminOrderStatus,
  AdminOrderItem,
  RefundRequest,
  ShippingAddress,
  EasyshipRateRequest,
  EasyshipRate,
} from '@/lib/types/ecommerce';

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function authHeaders(token: string | null) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ---- LIST ORDERS ----

export interface OrderFilters {
  status?: AdminOrderStatus;
  search?: string;
  date_from?: string;
  date_to?: string;
  customer_id?: string;
}

export async function getAdminOrders(
  filters?: OrderFilters
): Promise<(AdminOrder & { customer_name?: string; customer_email?: string })[]> {
  const token = await getToken();
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.date_from) params.set('date_from', filters.date_from);
  if (filters?.date_to) params.set('date_to', filters.date_to);
  if (filters?.customer_id) params.set('customer_id', filters.customer_id);

  try {
    const result = await apiFetch<{ orders: any[] }>(
      `/api/admin/orders?${params.toString()}`,
      { headers: authHeaders(token) }
    );
    return result.orders ?? [];
  } catch (e) {
    console.error(e);
    return [];
  }
}

// ---- SINGLE ORDER ----

export async function getAdminOrder(id: string): Promise<{
  order: AdminOrder & { customer_name?: string; customer_email?: string; customer_phone?: string };
  items: AdminOrderItem[];
} | null> {
  const token = await getToken();
  try {
    return await apiFetch(`/api/admin/orders/${id}`, {
      headers: authHeaders(token),
    });
  } catch {
    return null;
  }
}

// ---- CREATE ORDER ----

export interface CreateOrderPayload {
  customer_id?: string;
  billing_address?: ShippingAddress;
  shipping_address: ShippingAddress;
  shipping_method?: string;
  notes?: string;
  staff_notes?: string;
  items: Array<{
    product_variant_id?: string;
    sku_snapshot?: string;
    name_snapshot: string;
    qty: number;
    unit_price: number;
    discount_pct?: number;
  }>;
}

export async function createAdminOrder(
  payload: CreateOrderPayload
): Promise<{ success: boolean; order?: AdminOrder; error?: string }> {
  const token = await getToken();
  try {
    const result = await apiFetch<{ order: AdminOrder }>('/api/admin/orders', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    return { success: true, order: result.order };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ---- UPDATE ORDER ----

export async function updateAdminOrder(
  id: string,
  updates: Partial<Pick<AdminOrder, 'billing_address' | 'shipping_address' | 'notes' | 'staff_notes' | 'shipping_method' | 'shipping_carrier' | 'tracking_number'>>
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('orders')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ---- STATUS CHANGE (with inventory side-effects) ----

export async function changeOrderStatus(
  orderId: string,
  newStatus: AdminOrderStatus,
  adminUserId?: string
): Promise<{ success: boolean; error?: string }> {
  const token = await getToken();
  try {
    await apiFetch(`/api/admin/orders/${orderId}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ status: newStatus, admin_user_id: adminUserId }),
    });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ---- REFUND ----

export async function processRefund(
  request: RefundRequest
): Promise<{ success: boolean; error?: string }> {
  const token = await getToken();
  try {
    await apiFetch(`/api/admin/orders/${request.order_id}/refund`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(request),
    });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ---- EASYSHIP RATES ----

export async function getShippingRates(
  orderId: string,
  payload: EasyshipRateRequest
): Promise<EasyshipRate[]> {
  const token = await getToken();
  try {
    const result = await apiFetch<{ rates: EasyshipRate[] }>(
      '/api/admin/easyship/rates',
      {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ order_id: orderId, ...payload }),
      }
    );
    return result.rates ?? [];
  } catch {
    return [];
  }
}

// ---- CREATE SHIPMENT ----

export async function createShipment(
  orderId: string,
  courierId: string
): Promise<{ success: boolean; tracking_number?: string; label_url?: string; error?: string }> {
  const token = await getToken();
  try {
    const result = await apiFetch<{ tracking_number: string; label_url: string }>(
      '/api/admin/easyship/shipments',
      {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ order_id: orderId, courier_id: courierId }),
      }
    );
    return { success: true, ...result };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
