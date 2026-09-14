import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { autoCreateShipmentForOrder } from '@/lib/shipping/auto-shipment';
import { createInvoiceForOrder } from '@/lib/admin/order-invoice-server';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verifyAdmin(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { ok: false, userId: null as string | null, role: 'customer' };
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return { ok: false, userId: null, role: 'customer' };
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  const role = data?.role ?? 'customer';
  return { ok: role === 'admin' || role === 'assistant', userId: user.id, role };
}

function generateOrderNumber(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 99999)).padStart(5, '0');
  return `ORD-${yy}${mm}-${rand}`;
}

// GET /api/admin/orders
export async function GET(req: NextRequest) {
  const { ok } = await verifyAdmin(req);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const status = sp.get('status');
  const search = sp.get('search');
  const dateFrom = sp.get('date_from');
  const dateTo = sp.get('date_to');
  const customerId = sp.get('customer_id');

  let query = db
    .from('orders')
    .select(`
      *,
      customers (first_name, last_name, email, phone)
    `)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);
  if (customerId) query = query.eq('customer_id', customerId);
  if (dateFrom) query = query.gte('created_at', dateFrom);
  if (dateTo) query = query.lte('created_at', dateTo);

  if (search) {
    query = query.or(
      `order_number.ilike.%${search}%,email.ilike.%${search}%`
    );
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const orders = (data ?? []).map((o: any) => ({
    ...o,
    customer_name: o.customers
      ? `${o.customers.first_name} ${o.customers.last_name}`
      : null,
    customer_email: o.customers?.email ?? o.email ?? null,
    customer_phone: o.customers?.phone ?? null,
  }));

  return NextResponse.json({ orders });
}

// POST /api/admin/orders — manual order creation
export async function POST(req: NextRequest) {
  const { ok, userId, role } = await verifyAdmin(req);
  if (!ok || role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json();
  const {
    customer_id,
    billing_address,
    shipping_address,
    shipping_method,
    notes,
    staff_notes,
    items,
  } = body;

  if (!items?.length) {
    return NextResponse.json({ error: 'At least one order item is required' }, { status: 400 });
  }

  // Calculate totals
  const lineItems = (items as any[]).map((item) => ({
    ...item,
    discount_pct: item.discount_pct ?? 0,
    line_total:
      item.line_total ??
      item.unit_price * item.qty * (1 - (item.discount_pct ?? 0) / 100),
  }));

  const subtotal = lineItems.reduce((s: number, i: any) => s + i.line_total, 0);
  const tax_total = body.tax_total ?? 0;
  const shipping_cost = body.shipping_cost ?? 0;
  const discount_total = body.discount_total ?? 0;
  const total = subtotal + tax_total + shipping_cost - discount_total;

  const { data: order, error: orderErr } = await db
    .from('orders')
    .insert({
      order_number: generateOrderNumber(),
      customer_id: customer_id ?? null,
      status: 'pending',
      billing_address: billing_address ?? null,
      shipping_address: shipping_address ?? null,
      shipping_method: shipping_method ?? null,
      notes: notes ?? null,
      staff_notes: staff_notes ?? null,
      subtotal,
      tax_total,
      shipping_cost,
      discount_total,
      total,
      // Legacy fields for compatibility
      email: null,
      crypto: 'other' as any,
    })
    .select()
    .single();

  if (orderErr || !order) {
    return NextResponse.json({ error: orderErr?.message ?? 'Failed to create order' }, { status: 500 });
  }

  const itemRows = lineItems.map((item: any) => ({
    order_id: order.id,
    product_variant_id: item.product_variant_id ?? null,
    sku_snapshot: item.sku_snapshot ?? null,
    name_snapshot: item.name_snapshot,
    // Legacy fields
    product_name: item.name_snapshot,
    quantity: item.qty,
    qty: item.qty,
    unit_price: item.unit_price,
    price_at_time: item.unit_price,
    discount_pct: item.discount_pct,
    line_total: item.line_total,
  }));

  await db.from('order_items').insert(itemRows);

  // Every order gets a complete draft invoice at creation (best-effort;
  // idempotent, so confirmation later won't duplicate it).
  try {
    const invRes = await createInvoiceForOrder(db, order.id);
    if (!invRes.ok) console.error('order invoice creation failed:', invRes.error);
  } catch (e) {
    console.error('order invoice creation threw:', e);
  }

  // Manually-created orders also generate an Easyship shipment record
  // (best-effort; force=true bypasses the auto-create toggle, pickup is
  // skipped inside the helper).
  await autoCreateShipmentForOrder(
    db,
    {
      id: order.id,
      easyship_shipment_id: order.easyship_shipment_id ?? null,
      fulfillment_type: order.fulfillment_type ?? null,
      shipping_address: order.shipping_address,
      email: order.email ?? null,
      total: order.total,
    },
    true,
  );

  return NextResponse.json({ order }, { status: 201 });
}
