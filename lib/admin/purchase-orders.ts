import { supabase } from '@/lib/supabase';
import type {
  PurchaseOrder,
  PurchaseOrderStatus,
  PurchaseOrderWithSupplier,
  Supplier,
  TaxType,
  DiscountType,
} from '@/lib/types/ecommerce';

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function authHeaders(token: string | null): Record<string, string> {
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

// ============================================================
// Types
// ============================================================

export interface PurchaseOrderItemInput {
  product_id?: string | null;
  description: string;
  sku_snapshot?: string | null;
  qty: number;
  unit_price: number;
}

export interface PurchaseOrderInput {
  supplier_id: string;
  status?: PurchaseOrderStatus;
  shipping_fee?: number;
  discount_type?: DiscountType;
  discount_value?: number;
  tax_type: TaxType;
  tax_value: number;
  notes?: string;
  order_date?: string;
  expected_date?: string;
  backorder_id?: string;
  items: PurchaseOrderItemInput[];
}

export type PurchaseOrderPatch = Partial<Omit<PurchaseOrderInput, 'backorder_id'>>;

export interface ReceiptItemInput {
  po_item_id: string;
  qty: number;
}

export type PurchaseOrderListItem = PurchaseOrder & {
  supplier: Pick<Supplier, 'id' | 'name'> | null;
  item_count: number;
};

export interface SupplierInput {
  name: string;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  lead_time_days?: number;
  notes?: string | null;
}

// ============================================================
// Purchase orders
// ============================================================

export async function getPurchaseOrders(filters?: {
  status?: PurchaseOrderStatus;
  supplier_id?: string;
  search?: string;
}): Promise<PurchaseOrderListItem[]> {
  const token = await getToken();
  const qs = new URLSearchParams();
  if (filters?.status) qs.set('status', filters.status);
  if (filters?.supplier_id) qs.set('supplier_id', filters.supplier_id);

  const res = await fetch(`/api/admin/purchase-orders?${qs.toString()}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) return [];
  const data = await res.json();
  let rows: PurchaseOrderListItem[] = data.purchase_orders ?? [];

  // Client-side search over po_number / supplier name.
  if (filters?.search?.trim()) {
    const q = filters.search.toLowerCase();
    rows = rows.filter(
      (po) =>
        po.po_number.toLowerCase().includes(q) ||
        (po.supplier?.name ?? '').toLowerCase().includes(q)
    );
  }
  return rows;
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrderWithSupplier | null> {
  const token = await getToken();
  const res = await fetch(`/api/admin/purchase-orders/${id}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.purchase_order ?? null;
}

export async function createPurchaseOrder(
  input: PurchaseOrderInput
): Promise<{ success: boolean; purchase_order?: PurchaseOrder; error?: string }> {
  const token = await getToken();
  try {
    const res = await fetch('/api/admin/purchase-orders', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error ?? 'Failed to create' };
    return { success: true, purchase_order: data.purchase_order };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function updatePurchaseOrder(
  id: string,
  patch: PurchaseOrderPatch & { status?: PurchaseOrderStatus }
): Promise<{ success: boolean; purchase_order?: PurchaseOrderWithSupplier; error?: string }> {
  const token = await getToken();
  try {
    const res = await fetch(`/api/admin/purchase-orders/${id}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error ?? 'Failed to update' };
    return { success: true, purchase_order: data.purchase_order };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function receivePurchaseOrderItems(
  id: string,
  payload: { note?: string; items: ReceiptItemInput[] }
): Promise<{ success: boolean; purchase_order?: PurchaseOrderWithSupplier; error?: string }> {
  const token = await getToken();
  try {
    const res = await fetch(`/api/admin/purchase-orders/${id}/receipts`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error ?? 'Failed to receive' };
    return { success: true, purchase_order: data.purchase_order };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ============================================================
// Suppliers (service-role API)
// ============================================================

export async function getAllSuppliers(): Promise<Supplier[]> {
  const token = await getToken();
  const res = await fetch('/api/admin/suppliers', { headers: authHeaders(token) });
  if (!res.ok) return [];
  const data = await res.json();
  return data.suppliers ?? [];
}

export async function searchSuppliers(query: string): Promise<Supplier[]> {
  if (!query.trim()) return [];
  const all = await getAllSuppliers();
  const q = query.toLowerCase();
  return all
    .filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.email ?? '').toLowerCase().includes(q)
    )
    .slice(0, 8);
}

export async function createSupplier(
  input: SupplierInput
): Promise<{ success: boolean; supplier?: Supplier; error?: string }> {
  const token = await getToken();
  try {
    const res = await fetch('/api/admin/suppliers', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error ?? 'Failed to create supplier' };
    return { success: true, supplier: data.supplier };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function updateSupplier(
  id: string,
  patch: Partial<SupplierInput>
): Promise<{ success: boolean; supplier?: Supplier; error?: string }> {
  const token = await getToken();
  try {
    const res = await fetch(`/api/admin/suppliers/${id}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error ?? 'Failed to update supplier' };
    return { success: true, supplier: data.supplier };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function deleteSupplier(id: string): Promise<{ success: boolean; error?: string }> {
  const token = await getToken();
  try {
    const res = await fetch(`/api/admin/suppliers/${id}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, error: data.error ?? 'Failed to delete supplier' };
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
