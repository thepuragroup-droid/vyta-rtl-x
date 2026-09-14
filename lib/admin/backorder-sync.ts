/**
 * Recompute the OPEN backorder for an existing invoice from its current line
 * items. Called when a (non-backorder) invoice is edited.
 *
 * Best-effort contract: this must NEVER fail the surrounding invoice
 * operation — callers wrap it in `.catch()` and it logs errors rather than
 * throwing upward.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface BackorderLineInput {
  product_id?: string | null;
  description: string;
  qty: number;
  unit_price?: number;
}

export async function syncInvoiceBackorder(
  db: SupabaseClient,
  invoiceId: string,
  lineItems: BackorderLineInput[],
): Promise<void> {
  try {
    // Replace any existing OPEN backorder for this invoice (cascades to items).
    // Already-fulfilled backorders are left untouched as history.
    await db
      .from('backorders')
      .delete()
      .eq('invoice_id', invoiceId)
      .eq('status', 'open');

    // Only product-bearing lines can be backordered.
    const productLines = lineItems.filter((li) => li.product_id);
    if (productLines.length === 0) return;

    const productIds = Array.from(new Set(productLines.map((li) => li.product_id as string)));
    const { data: products } = await db
      .from('products')
      .select('id, stock_quantity')
      .in('id', productIds);

    const stock = new Map<string, number>();
    for (const p of products ?? []) {
      stock.set(p.id, Math.max(0, Number(p.stock_quantity) || 0));
    }

    const items = productLines
      .map((li) => {
        const qty = Number(li.qty) || 0;
        const available = stock.get(li.product_id as string) ?? 0;
        const backordered = qty - available;
        if (backordered <= 0) return null;
        return {
          product_id: li.product_id as string,
          description: li.description,
          qty_ordered: qty,
          qty_available: available,
          qty_backordered: backordered,
          unit_price: Number(li.unit_price) || 0,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (items.length === 0) return;

    const { data: bo, error: boErr } = await db
      .from('backorders')
      .insert({ invoice_id: invoiceId, status: 'open' })
      .select('id')
      .single();
    if (boErr || !bo) {
      console.error('syncInvoiceBackorder: failed to create backorder', boErr);
      return;
    }

    const { error: itemsErr } = await db
      .from('backorder_items')
      .insert(items.map((it) => ({ ...it, backorder_id: bo.id })));
    if (itemsErr) console.error('syncInvoiceBackorder: failed to insert items', itemsErr);
  } catch (e) {
    console.error('syncInvoiceBackorder error:', e);
  }
}
