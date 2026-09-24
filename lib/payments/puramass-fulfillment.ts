/**
 * Materialise a fulfillment invoice from a paid Stealth Health
 * hand-off, so the order surfaces in the warehouse fulfillment queue.
 *
 * Stealth Health owns payment, shipping, and taxes — this invoice exists purely for
 * the store's fulfillment/reconciliation visibility. It is marked
 * `source = 'stealth_health'` and carries no shipping address (Stealth Health collects
 * it), which the queue UI explains with a tooltip. The address Stealth Health reports
 * back lives on the hand-off ledger (`puramass_orders.shipping_address`) and is
 * surfaced on /admin/stealth-health (Orders tab).
 *
 * Also credits the affiliate, if the buyer arrived through a referral code or
 * is bound to one. That runs on every call rather than only when the invoice is
 * first created, so a commission that failed to record on one pass is retried
 * by the next webhook delivery or poll instead of being lost — it is guarded by
 * a unique index on `commissions.invoice_id`, not by this function's control
 * flow. See `recordAffiliateCommission`.
 *
 * Idempotent: keyed on `puramass_orders.invoice_id`, so the webhook and the
 * polling refresh can both call it without creating duplicates. Never throws —
 * a failure here must not break webhook ACK / refresh.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAffiliateCommission } from '@/lib/affiliate/commission';
import { isMissingColumnError } from '@/lib/payments/puramass-columns';

export interface StealthHealthLedgerRow {
  id: string;
  customer_id?: string | null;
  customer_email?: string | null;
  /** Buyer name from the Stealth Health customer block, when it reported one. */
  customer_name?: string | null;
  items?: { sku?: string; quantity?: number }[] | null;
  subtotal_cents?: number | null;
  invoice_id?: string | null;
  /** Referral code captured at hand-off, if the buyer arrived through one. */
  referral_code?: string | null;
  /** Lower-case currency the hand-off was priced in, e.g. 'cad'. */
  currency?: string | null;
  /**
   * Shipping we charged at hand-off, in cents of `currency`. Set once the
   * buyer picks a courier on our own checkout screen; null on hand-offs that
   * predate that (and on flat-fee ones made before the column existed).
   */
  shipping_total_cents?: number | null;
  /**
   * Easyship `courier_service_id` the buyer chose and paid for. Null on a
   * flat-fee hand-off, where no service was picked.
   */
  shipping_courier_id?: string | null;
}

export interface StealthHealthPaidItem {
  sku?: string;
  name?: string;
  quantity?: number;
  unit_price_cents?: number;
}

/**
 * Which pricing unit a Stealth Health line was sold in.
 *
 * Stealth Health encodes the unit in the SKU suffix — `…-vial` is the single-vial
 * listing, everything else (`…-case`, `…-10-pack`, plain) is a full box. That
 * suffix is the only authoritative signal we get: the partner's product *name*
 * is free text and the invoice line carries no product_id to join against.
 *
 * Without this, the line insert below omitted `price_type` entirely and
 * Postgres applied its `NOT NULL DEFAULT 'box'`, so a single vial printed a
 * "Box" chip on the admin invoice, the customer's invoice PDF and the
 * warehouse packing list alike.
 */
export function puramassPriceType(
  item: { sku?: string | null; name?: string | null },
): 'box' | 'vial' {
  const sku = (item.sku ?? '').trim().toLowerCase();
  if (sku) return sku.endsWith('-vial') ? 'vial' : 'box';
  // Pre-`paid_items` ledger rows have no SKU on the line — fall back to the
  // name Stealth Health ships, which suffixes the vial listing with "(Single Vial)".
  return /\(\s*single\s+vial\s*\)$/i.test((item.name ?? '').trim()) ? 'vial' : 'box';
}

const STEALTH_HEALTH_NOTE =
  'Placed via Stealth Health hosted checkout. Payment, shipping, and taxes are handled by Stealth Health.';

/**
 * The shipping fee stamped on a hand-off we have no figure for.
 *
 * Every hand-off made since the checkout started quoting couriers carries its
 * own `shipping_total_cents`, so this only ever applies to orders placed before
 * that — which were all priced by Stealth Health in USD at a flat $35. It is a
 * historical constant, deliberately not the configurable
 * `site_settings.puramass_flat_shipping`: changing today's flat fee must not
 * retroactively restate what an old order was recorded as costing.
 */
export const PURAMASS_LEGACY_SHIPPING = 35;

/** Currency a local invoice is denominated in. */
type InvoiceCurrency = 'CAD' | 'USD';

/**
 * The shipment fee to stamp on the local invoice, and the currency it is in.
 *
 * The currency is always the order's own — never hardcoded. A hand-off priced
 * by our own checkout is in CAD and knows exactly what shipping cost, so the
 * invoice is wholly CAD, goods and shipping alike, and reads like every other
 * invoice in the system. An older hand-off has no currency recorded and no
 * shipping figure, so it resolves to USD and the historical flat fee — exactly
 * what it was recorded as before, which is the mixed-currency case
 * `puramassMoneySplit` exists to render.
 *
 * Invoices already written are never revisited, so nothing here restates one.
 */
export function resolveFulfillmentShipping(
  ledger: Pick<StealthHealthLedgerRow, 'currency' | 'shipping_total_cents'>,
): { shipping: number; currency: InvoiceCurrency } {
  const currency: InvoiceCurrency =
    String(ledger.currency ?? '').toUpperCase() === 'CAD' ? 'CAD' : 'USD';
  const cents = ledger.shipping_total_cents;
  if (typeof cents === 'number' && Number.isFinite(cents) && cents >= 0) {
    return { shipping: +(cents / 100).toFixed(2), currency };
  }
  return { shipping: PURAMASS_LEGACY_SHIPPING, currency };
}

function trimOrNull(v: unknown): string | null {
  const t = typeof v === 'string' ? v.trim() : '';
  return t ? t : null;
}

/**
 * Book the Easyship shipment for a paid hand-off.
 *
 * A buyer who chose a courier on our checkout has already paid for that exact
 * service, so booking it is the rest of a transaction they completed — not a
 * discretionary automation. That is why it passes `force`: it goes ahead
 * whether or not the site-wide auto-create toggle is on, and books
 * `courierId` rather than re-picking by the site preference. A flat-fee
 * hand-off picked no service, so it defers to that toggle exactly as before.
 *
 * The shipment is a DRAFT — `createEasyshipShipment` sends `buy_label: false`,
 * so nothing is charged. Buying the label stays governed by
 * `easyship_auto_buy_label`.
 *
 * Never throws, and safe to call again: `autoCreateShipmentForInvoice` skips an
 * invoice that already carries a shipment, and records its own skip/failure
 * reasons against the invoice.
 *
 * Imported lazily on purpose. The Easyship client behind it builds a Supabase
 * client at module scope, so a static import would make merely loading this
 * module require the server's environment — enough to break importing the
 * pure helpers here (`puramassPriceType`) anywhere that env isn't set.
 */
async function bookShipment(
  db: SupabaseClient,
  invoiceId: string,
  courierId: string | null,
): Promise<void> {
  try {
    const { autoCreateShipmentForInvoice } = await import('@/lib/shipping/auto-shipment');
    await autoCreateShipmentForInvoice(db, invoiceId, !!courierId, {
      ...(courierId ? { courierIdOverride: courierId } : {}),
    });
  } catch (err) {
    // autoCreateShipmentForInvoice swallows its own errors; this is belt and
    // braces so a shipment problem can never fail a payment webhook.
    console.error('[puramass] shipment booking failed:', err);
  }
}

export async function materializeStealthHealthFulfillment(
  db: SupabaseClient,
  ledger: StealthHealthLedgerRow,
  paidItems: StealthHealthPaidItem[] | null | undefined,
): Promise<{ created: boolean; invoiceId?: string }> {
  // Already materialised — skip straight to crediting, which has its own
  // idempotency and must still run in case an earlier pass failed to record it.
  if (ledger.invoice_id) {
    await creditAffiliate(db, ledger, ledger.invoice_id);
    // Same reasoning as the affiliate credit: retried on every pass so a
    // shipment that failed to book once is picked up by the next webhook or
    // poll. Booking is a no-op once the invoice already carries one.
    await bookShipment(db, ledger.invoice_id, trimOrNull(ledger.shipping_courier_id));
    return { created: false, invoiceId: ledger.invoice_id };
  }

  try {
    // Prefer the actually-paid items (they carry name + unit price); fall back
    // to the ledger's sku/quantity lines (no price).
    const source: StealthHealthPaidItem[] =
      Array.isArray(paidItems) && paidItems.length > 0
        ? paidItems
        : (ledger.items ?? []).map((i) => ({ sku: i.sku, quantity: i.quantity }));

    const lines = source.map((it) => {
      const qty = Math.max(1, Math.round(Number(it.quantity ?? 1)) || 1);
      const unitPrice =
        typeof it.unit_price_cents === 'number' ? it.unit_price_cents / 100 : 0;
      return {
        description: (it.name || it.sku || 'Stealth Health item').toString(),
        qty,
        unit_price: unitPrice,
        line_total: +(qty * unitPrice).toFixed(2),
        discount_pct: 0,
        price_type: puramassPriceType(it),
        qty_fulfilled: 0,
        qty_backordered: 0,
      };
    });

    // Invoice total: the Stealth Health subtotal when known, else the line sum.
    const lineSum = lines.reduce((s, l) => s + l.line_total, 0);
    const subtotal =
      typeof ledger.subtotal_cents === 'number'
        ? +(ledger.subtotal_cents / 100).toFixed(2)
        : +lineSum.toFixed(2);

    // Shipping the buyer paid, so the total in their account reflects
    // goods + shipping. Falls back to the flat USD fee on a hand-off that
    // predates our own courier picker.
    const { shipping, currency } = resolveFulfillmentShipping(ledger);
    const total = +(subtotal + shipping).toFixed(2);

    // The service the buyer paid for, carried onto the invoice so the admin
    // sees the right courier and any shipment booked off this invoice — by the
    // call below or by hand later — uses it instead of re-picking.
    const courierId = trimOrNull(ledger.shipping_courier_id);

    const invoiceRow: Record<string, unknown> = {
        source: 'stealth_health',
        customer_id: ledger.customer_id ?? null,
        customer_email: ledger.customer_email ?? null,
        customer_name: ledger.customer_name ?? null,
        fulfillment_type: 'shipment',
        fulfillment_status: 'pending',
        // Paid on the Stealth Health hosted page — counts as a paid sale here.
        status: 'paid',
        currency,
        subtotal,
        tax_total: 0,
        shipping_cost: shipping,
        total,
        is_backorder: false,
        non_payable: false,
        notes: STEALTH_HEALTH_NOTE,
    };

    // `easyship_courier_id` arrives with easyship-invoice-shipment-migration.sql.
    // Naming it before that migration has run would fail the whole insert, and a
    // paid order must be recorded whether or not a shipment can be booked — so
    // it is added optimistically and dropped on the retry.
    let { data: invoice, error: invErr } = await db
      .from('invoices')
      .insert(courierId ? { ...invoiceRow, easyship_courier_id: courierId } : invoiceRow)
      .select('id')
      .single();
    if (invErr && courierId && isMissingColumnError(invErr)) {
      ({ data: invoice, error: invErr } = await db
        .from('invoices')
        .insert(invoiceRow)
        .select('id')
        .single());
    }

    if (invErr || !invoice) {
      console.error('[puramass] fulfillment invoice insert failed:', invErr);
      return { created: false };
    }

    if (lines.length > 0) {
      const { error: liErr } = await db
        .from('invoice_line_items')
        .insert(lines.map((l) => ({ invoice_id: invoice.id, ...l })));
      if (liErr) {
        console.error('[puramass] fulfillment line items insert failed:', liErr);
      }
    }

    // Link back + dedupe. Conditional on invoice_id still being null so a
    // concurrent caller can't double-link (best-effort).
    await db
      .from('puramass_orders')
      .update({ invoice_id: invoice.id })
      .eq('id', ledger.id)
      .is('invoice_id', null);

    await creditAffiliate(db, ledger, invoice.id);
    await bookShipment(db, invoice.id, courierId);

    return { created: true, invoiceId: invoice.id };
  } catch (err) {
    console.error('[puramass] materializeStealthHealthFulfillment threw:', err);
    return { created: false };
  }
}

/**
 * Credit the affiliate for this sale. Separated so both the freshly-created and
 * already-materialised paths run it, and kept best-effort: an uncredited
 * commission is a bookkeeping problem, while a thrown error here would break a
 * webhook ACK and make Stealth Health retry a payment we have already recorded.
 */
async function creditAffiliate(
  db: SupabaseClient,
  ledger: StealthHealthLedgerRow,
  invoiceId: string,
): Promise<void> {
  try {
    await recordAffiliateCommission(db, {
      invoiceId,
      subtotalCents: ledger.subtotal_cents ?? null,
      customerId: ledger.customer_id ?? null,
      referralCode: ledger.referral_code ?? null,
      discountCodeId: await readDiscountCodeId(db, ledger.id),
    });
  } catch (err) {
    console.error('[puramass] affiliate commission failed:', err);
  }
}

/**
 * The discount code this hand-off used, if any. Read here rather than threaded
 * through every caller's select: the webhook, poller and admin refresh each
 * shed columns for unmigrated databases, and a missing column here simply
 * means no code — the commission then falls back to referral attribution.
 */
async function readDiscountCodeId(db: SupabaseClient, ledgerId: string): Promise<string | null> {
  try {
    const { data, error } = await db
      .from('puramass_orders')
      .select('discount_code_id')
      .eq('id', ledgerId)
      .maybeSingle();
    if (error) return null;
    return (data?.discount_code_id as string | null) ?? null;
  } catch {
    return null;
  }
}
