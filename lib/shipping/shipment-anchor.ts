import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingColumnError } from '@/lib/payments/puramass-columns';
import { clearedShipmentPatch } from '@/lib/shipping/shipment-record';
import type { ShipmentAnchor } from '@/lib/shipping/auto-shipment';

/**
 * Where an invoice's Easyship shipment lives, and every invoice that mirrors
 * it. The shipment hangs off the invoice's order when it has one, off the
 * invoice itself otherwise (a Stealth Health hand-off has no order row).
 */
export interface ResolvedShipmentAnchor {
  anchor: ShipmentAnchor;
  /** Every invoice carrying a copy of the anchor's record. */
  invoiceIds: string[];
  easyship_shipment_id: string | null;
  label_state: string | null;
}

export async function resolveInvoiceShipmentAnchor(
  db: SupabaseClient,
  invoiceId: string,
): Promise<ResolvedShipmentAnchor | null> {
  const { data: inv } = await db
    .from('invoices')
    .select('id, order_id')
    .eq('id', invoiceId)
    .maybeSingle();
  if (!inv) return null;

  if (inv.order_id) {
    const { data: order } = await db
      .from('orders')
      .select('id, easyship_shipment_id, label_state')
      .eq('id', inv.order_id)
      .maybeSingle();
    if (order) {
      const { data: invs } = await db.from('invoices').select('id').eq('order_id', order.id);
      const ids = new Set<string>([inv.id, ...(invs ?? []).map((i: any) => i.id)]);
      return {
        anchor: { kind: 'order', id: order.id },
        invoiceIds: Array.from(ids),
        easyship_shipment_id: order.easyship_shipment_id ?? null,
        label_state: order.label_state ?? null,
      };
    }
  }

  // The invoice-side columns arrive with easyship-invoice-shipment-migration.sql.
  const { data: self, error } = await db
    .from('invoices')
    .select('easyship_shipment_id, label_state')
    .eq('id', inv.id)
    .maybeSingle();
  return {
    anchor: { kind: 'invoice', id: inv.id },
    invoiceIds: [inv.id],
    easyship_shipment_id: error ? null : ((self as any)?.easyship_shipment_id ?? null),
    label_state: error ? null : ((self as any)?.label_state ?? null),
  };
}

/** Update `ids`, dropping any column this database doesn't have yet. */
export async function updateTolerant(
  db: SupabaseClient,
  table: 'orders' | 'invoices',
  ids: string[],
  patch: Record<string, unknown>,
): Promise<string | null> {
  if (ids.length === 0 || Object.keys(patch).length === 0) return null;
  const { error } = await db.from(table).update(patch).in('id', ids);
  if (!error) return null;
  if (!isMissingColumnError(error)) return error.message;
  for (const [col, value] of Object.entries(patch)) {
    const res = await db.from(table).update({ [col]: value }).in('id', ids);
    if (res.error && !isMissingColumnError(res.error)) return res.error.message;
  }
  return null;
}

/**
 * Blank the shipment record on the anchor and every invoice mirroring it.
 * Returns an error message only when the anchor's own record couldn't be
 * cleared; the invoice mirror of an order is best-effort.
 */
export async function clearShipmentRecord(
  db: SupabaseClient,
  resolved: ResolvedShipmentAnchor,
): Promise<string | null> {
  const { anchor, invoiceIds } = resolved;
  const table = anchor.kind === 'order' ? 'orders' : 'invoices';
  const cleared = clearedShipmentPatch();
  const targets: Array<['orders' | 'invoices', string[]]> = [[table, [anchor.id]]];
  if (anchor.kind === 'order') targets.push(['invoices', invoiceIds]);
  for (const [t, ids] of targets) {
    const err = await updateTolerant(db, t, ids, cleared.core);
    // The core block on `invoices` only exists after
    // easyship-invoice-shipment-migration.sql; for an order anchor the
    // mirror is optional, for an invoice anchor it is the record itself.
    if (err && t === table) return err;
    await updateTolerant(db, t, ids, cleared.extended);
  }
  return null;
}
