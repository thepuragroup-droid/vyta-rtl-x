import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  allocateLandedCost,
  resolveDiscountAmount,
  resolveTaxAmount,
  round2,
} from '@/lib/admin/po-landed-cost';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verifyAdminRole(req: NextRequest, requireMutation: boolean) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { ok: false, userId: null as string | null, role: 'customer' };
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return { ok: false, userId: null, role: 'customer' };
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  const role = data?.role ?? 'customer';
  const ok = requireMutation
    ? role === 'admin'
    : role === 'admin' || role === 'assistant';
  return { ok, userId: user.id, role };
}

const r2 = round2;

/** Same rules as POST /api/admin/purchase-orders — kept in this file for
 *  self-containment; if it drifts, tests here will diverge from create-side. */
function computeSummary(opts: {
  items: { qty: number; unit_price: number }[];
  shipping_fee: number;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  tax_type: 'percentage' | 'fixed';
  tax_value: number;
}) {
  const subtotal = r2(opts.items.reduce((s, i) => s + Number(i.qty) * Number(i.unit_price), 0));
  const shipping = r2(Math.max(0, Number(opts.shipping_fee) || 0));
  const discountRaw = resolveDiscountAmount(opts.discount_type, opts.discount_value, subtotal);
  const discount = opts.discount_type === 'fixed'
    ? r2(Math.min(discountRaw, subtotal + shipping))
    : r2(discountRaw);
  const taxBase = r2(subtotal + shipping - discount);
  const tax_total = resolveTaxAmount(opts.tax_type, opts.tax_value, taxBase);
  const total = r2(taxBase + tax_total);
  return { subtotal, shipping_fee: shipping, discount, tax_total, total };
}

// Joined PO with supplier, items, and receipts (receipts tolerated-missing).
async function fetchFullPO(id: string) {
  const { data: po, error } = await db
    .from('purchase_orders')
    .select(`*, supplier:suppliers (*), items:purchase_order_items (*)`)
    .eq('id', id)
    .single();
  if (error || !po) return null;

  let receipts: any[] = [];
  const { data: rcpts } = await db
    .from('purchase_order_receipts')
    .select(`*, items:purchase_order_receipt_items (*)`)
    .eq('purchase_order_id', id)
    .order('created_at', { ascending: false });
  if (rcpts) receipts = rcpts;

  return { ...po, receipts };
}

// GET /api/admin/purchase-orders/[id]
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { ok } = await verifyAdminRole(req, false);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const po = await fetchFullPO(params.id);
  if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ purchase_order: po });
}

// PATCH /api/admin/purchase-orders/[id]
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { ok } = await verifyAdminRole(req, true);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { data: current } = await db
    .from('purchase_orders')
    .select('status, shipping_fee, discount_type, discount_value, tax_type, tax_value')
    .eq('id', params.id)
    .single();
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { items, override_receiving_lock, ...fields } = body;

  const LOCKED = ['paid', 'cancelled'];
  const changingNonStatus = Object.keys(fields).some((k) => k !== 'status') || items !== undefined;

  // Locked POs only allow a status change.
  if (LOCKED.includes(current.status) && changingNonStatus) {
    return NextResponse.json(
      { error: `Purchase order is ${current.status} and cannot be edited` },
      { status: 422 }
    );
  }

  // Fulfilment statuses are derived from receiving — never set by hand.
  if (fields.status === 'fulfilled' || fields.status === 'partially_fulfilled') {
    return NextResponse.json(
      { error: 'Fulfilment status is derived from receiving, not set manually' },
      { status: 422 }
    );
  }

  // Items freeze once anything has been received — unless an admin has
  // explicitly overridden the receiving lock. In override mode we
  // reconcile lines in place (by id) instead of the normal
  // delete-and-replace, so `purchase_order_receipt_items` never lose
  // their FK target.
  let existingItems: Array<{ id: string; product_id: string | null; qty_received: number }> = [];
  const receivingInProgress = await (async () => {
    const { data } = await db
      .from('purchase_order_items')
      .select('id, product_id, qty_received')
      .eq('purchase_order_id', params.id)
      .gt('qty_received', 0)
      .limit(1);
    return !!(data && data.length > 0);
  })();

  if (items !== undefined) {
    if (receivingInProgress) {
      if (!override_receiving_lock) {
        return NextResponse.json(
          { error: 'Items are frozen once stock has been received against this order. Pass override_receiving_lock:true to reconcile in place.' },
          { status: 422 }
        );
      }
      // Load current items so we can reconcile by id.
      const { data } = await db
        .from('purchase_order_items')
        .select('id, product_id, qty_received')
        .eq('purchase_order_id', params.id);
      existingItems = (data ?? []) as any;
    }
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const SCALAR = ['supplier_id', 'status', 'notes', 'order_date', 'expected_date',
    'shipping_fee', 'discount_type', 'discount_value', 'tax_type', 'tax_value'];
  for (const key of SCALAR) {
    if (key in fields) updates[key] = fields[key];
  }

  // Recompute money whenever items or any money input changes.
  const moneyTouched = ['shipping_fee', 'discount_type', 'discount_value', 'tax_type', 'tax_value']
    .some((k) => k in fields);

  let cleanItems: any[] | null = null;
  if (items !== undefined) {
    cleanItems = (items as any[]).map((i) => {
      const qty = Math.max(1, parseInt(i.qty) || 1);
      const unit_price = Math.max(0, Number(i.unit_price) || 0);
      return {
        // Preserve line id when the client sent one so override-mode can
        // reconcile in place. Missing id => a brand-new line.
        id: typeof i.id === 'string' ? i.id : null,
        product_id: i.product_id ?? null,
        description: String(i.description ?? '').trim(),
        sku_snapshot: i.sku_snapshot ?? null,
        qty,
        unit_price,
        price_type: (i.price_type === 'vial' ? 'vial' : 'box') as 'box' | 'vial',
        line_total: r2(qty * unit_price),
      };
    });

    // Override-mode invariants: can't remove a line that has receipts;
    // can't reduce a line's qty below what's already been received.
    if (receivingInProgress) {
      const submittedIds = new Set(cleanItems.filter((i) => i.id).map((i) => i.id));
      const receivedGone = existingItems.filter(
        (e) => e.qty_received > 0 && !submittedIds.has(e.id),
      );
      if (receivedGone.length > 0) {
        return NextResponse.json(
          { error: `Cannot remove ${receivedGone.length} line(s) with recorded receipts.` },
          { status: 422 },
        );
      }
      for (const item of cleanItems) {
        if (!item.id) continue;
        const existing = existingItems.find((e) => e.id === item.id);
        if (existing && item.qty < existing.qty_received) {
          return NextResponse.json(
            { error: `Line qty (${item.qty}) is below already-received (${existing.qty_received}).` },
            { status: 422 },
          );
        }
      }
    }
  }

  if (cleanItems !== null || moneyTouched) {
    const sumItems = cleanItems ?? (
      (await db.from('purchase_order_items').select('qty, unit_price').eq('purchase_order_id', params.id)).data ?? []
    );
    const summary = computeSummary({
      items: sumItems as any,
      shipping_fee: (fields.shipping_fee ?? current.shipping_fee) as number,
      discount_type: (fields.discount_type ?? current.discount_type) as any,
      discount_value: (fields.discount_value ?? current.discount_value) as number,
      tax_type: (fields.tax_type ?? current.tax_type) as any,
      tax_value: (fields.tax_value ?? current.tax_value) as number,
    });
    Object.assign(updates, summary);
  }

  const { error: updateErr } = await db
    .from('purchase_orders')
    .update(updates)
    .eq('id', params.id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Replace line items. Two paths:
  //   1. No receiving yet (or none in override mode): safe to delete + reinsert.
  //   2. Receiving in progress with override: reconcile in place by id so
  //      purchase_order_receipt_items keep valid FKs. Existing lines get
  //      UPDATEd (qty_received untouched); new lines INSERTed; only lines
  //      with zero received may be DELETEd.
  if (cleanItems !== null) {
    // Compute landed cost once, sharing shipping/discount across the final
    // set of lines (whether they're being inserted fresh or reconciled).
    const finalShipping = Number(updates.shipping_fee ?? current.shipping_fee) || 0;
    const finalDiscount = Number((updates as any).discount ?? 0) || 0;
    const landed = allocateLandedCost(cleanItems, {
      shipping: finalShipping,
      discount: finalDiscount,
    });

    if (receivingInProgress) {
      const submittedIds = new Set(cleanItems.filter((i) => i.id).map((i) => i.id));
      const toDelete = existingItems
        .filter((e) => e.qty_received === 0 && !submittedIds.has(e.id))
        .map((e) => e.id);
      if (toDelete.length > 0) {
        await db.from('purchase_order_items').delete().in('id', toDelete);
      }
      for (let idx = 0; idx < cleanItems.length; idx++) {
        const i = cleanItems[idx];
        const alloc = landed[idx];
        if (i.id) {
          const { error: upErr } = await db
            .from('purchase_order_items')
            .update({
              product_id: i.product_id,
              description: i.description,
              sku_snapshot: i.sku_snapshot,
              qty: i.qty,
              unit_price: i.unit_price,
              price_type: i.price_type,
              line_total: i.line_total,
              landed_unit_cost: alloc.landed_unit_cost,
              landed_line_total: alloc.landed_line_total,
            })
            .eq('id', i.id);
          if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
        } else {
          const { error: insErr } = await db.from('purchase_order_items').insert({
            purchase_order_id: params.id,
            product_id: i.product_id,
            description: i.description,
            sku_snapshot: i.sku_snapshot,
            qty: i.qty,
            qty_received: 0,
            unit_price: i.unit_price,
            price_type: i.price_type,
            line_total: i.line_total,
            landed_unit_cost: alloc.landed_unit_cost,
            landed_line_total: alloc.landed_line_total,
          });
          if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
        }
      }
    } else {
      await db.from('purchase_order_items').delete().eq('purchase_order_id', params.id);
      const rows = cleanItems.map((i, idx) => ({
        purchase_order_id: params.id,
        product_id: i.product_id,
        description: i.description,
        sku_snapshot: i.sku_snapshot,
        qty: i.qty,
        qty_received: 0,
        unit_price: i.unit_price,
        price_type: i.price_type,
        line_total: i.line_total,
        landed_unit_cost: landed[idx].landed_unit_cost,
        landed_line_total: landed[idx].landed_line_total,
      }));
      const { error: itemErr } = await db.from('purchase_order_items').insert(rows);
      if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 });
    }
  } else if (Object.prototype.hasOwnProperty.call(updates, 'shipping_fee')
    || Object.prototype.hasOwnProperty.call(updates, 'discount')
    || Object.prototype.hasOwnProperty.call(updates, 'discount_value')
    || Object.prototype.hasOwnProperty.call(updates, 'discount_type')) {
    // Shipping/discount changed but items untouched — re-allocate landed
    // cost across existing lines so the numbers stay in sync.
    const { data: cur } = await db
      .from('purchase_order_items')
      .select('id, qty, unit_price')
      .eq('purchase_order_id', params.id);
    if (cur && cur.length > 0) {
      const landed = allocateLandedCost(
        (cur as any[]).map((r: any) => ({ qty: r.qty, unit_price: r.unit_price })),
        {
          shipping: Number(updates.shipping_fee ?? current.shipping_fee) || 0,
          discount: Number((updates as any).discount ?? 0) || 0,
        },
      );
      for (let i = 0; i < cur.length; i++) {
        await db
          .from('purchase_order_items')
          .update({
            landed_unit_cost: landed[i].landed_unit_cost,
            landed_line_total: landed[i].landed_line_total,
          })
          .eq('id', (cur as any)[i].id);
      }
    }
  }

  const po = await fetchFullPO(params.id);
  return NextResponse.json({ purchase_order: po });
}

// DELETE /api/admin/purchase-orders/[id]
//
// Admin-only. Cascades to purchase_order_items + purchase_order_receipts
// via the FKs. Does NOT reverse any inventory already added by receipts —
// the inventory_log restock rows stay as an audit trail. If reversing
// stock is what you need, adjust product stock manually before deleting.
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { ok, role } = await verifyAdminRole(req, true);
  if (!ok || role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  const { data: existing } = await db
    .from('purchase_orders')
    .select('id')
    .eq('id', params.id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const { error } = await db.from('purchase_orders').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
