import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logAuditServer } from '@/lib/admin/audit';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function verifyAdmin(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { ok: false, userId: null as string | null, actor_email: null as string | null };
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return { ok: false, userId: null, actor_email: null };
  const { data } = await db.from('customers').select('id, email, role').eq('id', user.id).single();
  const role = data?.role ?? 'customer';
  return { ok: role === 'admin', userId: user.id, actor_email: data?.email ?? user.email ?? null };
}

/**
 * POST /api/admin/pricelists/[id]/apply-to-customer
 *
 * Copy a pricelist's prices onto a customer's `customer_price_overrides`.
 *
 * Body: { customer_id, mode? }
 *   mode = 'override'      (default) — every list item wins.
 *   mode = 'keep_existing' — only seed products the customer has no
 *                            override for; leaves existing overrides intact.
 *
 * Also stamps `customers.applied_pricelist_id` so the UI can show
 * "Price list: X" and warn when a subsequent apply would overwrite.
 *
 * Returns { applied, skipped, mode }.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const caller = await verifyAdmin(req);
  if (!caller.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const customerId = String(body.customer_id ?? '').trim();
  const mode: 'override' | 'keep_existing' = body.mode === 'keep_existing' ? 'keep_existing' : 'override';
  if (!customerId) {
    return NextResponse.json({ error: 'customer_id is required' }, { status: 400 });
  }

  const { data: pl, error: plErr } = await db
    .from('pricelists')
    .select('id, name')
    .eq('id', params.id)
    .maybeSingle();
  if (plErr) return NextResponse.json({ error: plErr.message }, { status: 500 });
  if (!pl) return NextResponse.json({ error: 'Pricelist not found' }, { status: 404 });

  const { data: cust } = await db
    .from('customers')
    .select('id')
    .eq('id', customerId)
    .maybeSingle();
  if (!cust) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });

  const { data: items, error: itemsErr } = await db
    .from('pricelist_items')
    .select('product_id, price')
    .eq('pricelist_id', params.id);
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });

  const source = (items ?? []) as Array<{ product_id: string; price: number }>;
  if (source.length === 0) {
    return NextResponse.json({ applied: 0, skipped: 0, mode });
  }

  let toApply = source;
  let skipped = 0;

  if (mode === 'keep_existing') {
    // Only touch products the customer doesn't already have an override for.
    const { data: existing } = await db
      .from('customer_price_overrides')
      .select('product_id')
      .eq('customer_id', customerId);
    const existingSet = new Set((existing ?? []).map((r: any) => r.product_id as string));
    const filtered = source.filter((s) => !existingSet.has(s.product_id));
    skipped = source.length - filtered.length;
    toApply = filtered;
  }

  if (toApply.length > 0) {
    const rows = toApply.map((s) => ({
      customer_id: customerId,
      product_id: s.product_id,
      override_price: Math.max(0, Number(s.price) || 0),
    }));
    const { error: upErr } = await db
      .from('customer_price_overrides')
      .upsert(rows, { onConflict: 'customer_id,product_id' });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // Remember which list was applied so the UI can label + warn on next apply.
  await db
    .from('customers')
    .update({ applied_pricelist_id: params.id })
    .eq('id', customerId);

  await logAuditServer(
    db,
    { actor_id: caller.userId, actor_email: caller.actor_email },
    {
      action: 'pricelist.apply_to_customer',
      entity_type: 'pricelist',
      entity_id: params.id,
    },
  );

  return NextResponse.json({
    applied: toApply.length,
    skipped,
    mode,
    pricelist_id: params.id,
    pricelist_name: pl.name,
    customer_id: customerId,
  });
}
