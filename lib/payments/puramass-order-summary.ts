/**
 * The "here's the order we're asking about" summary.
 *
 * Built once and used twice: by the missing-address email and by the page the
 * customer lands on. Sharing it is the point — the buyer must see the same
 * invoice number, the same line items and the same totals in both places, or
 * the ask looks like a phishing attempt.
 *
 * SERVER ONLY (service-role reads). Everything is best-effort: an order with no
 * invoice yet, no line items, or an unmapped SKU still produces a usable
 * summary rather than an error.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { toShippingAddress, type ShippingAddressLike } from './puramass-address';
import type { LedgerRow } from './puramass-address-request';

export interface SummaryItem {
  name: string;
  sku: string | null;
  quantity: number;
  /** Per-unit and line price in the order's currency; null when unknown. */
  unit_price: number | null;
  line_total: number | null;
}

export interface OrderSummary {
  reference: string;
  transaction_id: string | null;
  /** PuraMass's hosted page for this transaction, when we captured it. */
  transaction_link: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  status: string;
  placed_at: string;
  paid_at: string | null;
  currency: string;
  customer_email: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  items: SummaryItem[];
  subtotal: number | null;
  shipping: number | null;
  total: number | null;
  /** Whatever address is on file right now (usually none — that's the point). */
  shipping_address: ShippingAddressLike | null;
}

function money(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? +Number(n).toFixed(2) : null;
}

/**
 * Human names for the SKUs on the ledger. PuraMass SKUs map to products via
 * `products.puramass_sku` (10-pack) or `products.puramass_sku_vial` (single
 * vial); anything unmapped falls back to the SKU itself.
 */
async function skuNames(
  db: SupabaseClient,
  skus: string[],
): Promise<Record<string, string>> {
  const wanted = [...new Set(skus.filter(Boolean))];
  if (wanted.length === 0) return {};
  const list = wanted.map((s) => `"${s.replace(/"/g, '')}"`).join(',');
  try {
    const { data } = await db
      .from('products')
      .select('name, puramass_sku, puramass_sku_vial')
      .or(`puramass_sku.in.(${list}),puramass_sku_vial.in.(${list})`);
    const out: Record<string, string> = {};
    for (const p of data ?? []) {
      const row = p as { name?: string; puramass_sku?: string; puramass_sku_vial?: string };
      if (!row.name) continue;
      if (row.puramass_sku) out[row.puramass_sku] = row.name;
      // Distinguish the single-vial SKU from the 10-pack of the same product.
      if (row.puramass_sku_vial) out[row.puramass_sku_vial] = `${row.name} (single vial)`;
    }
    return out;
  } catch (err) {
    console.error('[puramass] sku name lookup failed:', err);
    return {};
  }
}

/**
 * Assemble the summary for one hand-off.
 *
 * Line items come from the materialised invoice when there is one (it carries
 * names and prices), and from the ledger's sku/quantity list otherwise.
 */
export async function buildOrderSummary(
  db: SupabaseClient,
  order: LedgerRow,
): Promise<OrderSummary> {
  const currency = (order.currency || 'USD').toUpperCase();

  let invoice_number: string | null = null;
  let subtotal: number | null =
    typeof order.subtotal_cents === 'number' ? +(order.subtotal_cents / 100).toFixed(2) : null;
  let shipping: number | null = null;
  let total: number | null = null;
  let items: SummaryItem[] = [];

  if (order.invoice_id) {
    const { data: invoice } = await db
      .from('invoices')
      .select('invoice_number, currency, subtotal, shipping_cost, total')
      .eq('id', order.invoice_id)
      .maybeSingle();
    if (invoice) {
      const inv = invoice as Record<string, unknown>;
      invoice_number = (inv.invoice_number as string) ?? null;
      subtotal = money(inv.subtotal) ?? subtotal;
      shipping = money(inv.shipping_cost);
      total = money(inv.total);
    }

    const { data: lines } = await db
      .from('invoice_line_items')
      .select('description, qty, unit_price, line_total')
      .eq('invoice_id', order.invoice_id);
    items = (lines ?? []).map((l) => {
      const row = l as Record<string, unknown>;
      return {
        name: String(row.description ?? 'Item'),
        sku: null,
        quantity: Number(row.qty ?? 1) || 1,
        unit_price: money(row.unit_price),
        line_total: money(row.line_total),
      };
    });
  }

  if (items.length === 0) {
    const ledgerItems = order.items ?? [];
    const names = await skuNames(db, ledgerItems.map((i) => i.sku ?? ''));
    items = ledgerItems.map((i) => ({
      name: (i.sku && names[i.sku]) || i.sku || 'Item',
      sku: i.sku ?? null,
      quantity: Number(i.quantity ?? 1) || 1,
      unit_price: null,
      line_total: null,
    }));
  }

  if (total == null && subtotal != null) {
    total = shipping != null ? +(subtotal + shipping).toFixed(2) : subtotal;
  }

  return {
    reference: order.partner_reference,
    transaction_id: order.transaction_id,
    transaction_link: order.payment_link,
    invoice_id: order.invoice_id,
    invoice_number,
    status: order.status,
    placed_at: order.created_at,
    paid_at: order.paid_at,
    currency,
    customer_email: order.customer_email,
    customer_name: order.customer_name,
    customer_phone: order.customer_phone,
    items,
    subtotal,
    shipping,
    total,
    shipping_address: toShippingAddress(order.shipping_address),
  };
}

/** `$1,234.00 USD`, or an em dash when the figure is unknown. */
export function formatSummaryMoney(value: number | null, currency: string): string {
  if (value == null) return '—';
  return `$${value.toFixed(2)} ${currency}`;
}
