import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logAuditServer } from '@/lib/admin/audit';
import { applyAffiliatePricelist } from '@/lib/admin/affiliate-pricelist';

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
  const ok = data?.role === 'admin' || data?.role === 'assistant';
  return { ok, userId: user.id, actor_email: data?.email ?? user.email ?? null };
}

// GET /api/admin/customers/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { ok } = await verifyAdmin(req);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { data, error } = await db
    .from('customers')
    .select(
      'id, first_name, last_name, email, phone, shipping_address, shipping_city, shipping_state, shipping_postal_code, shipping_country, affiliate_id, allow_pickup, allow_shipping, preferred_currency, role, active, created_at, last_login_at',
    )
    .eq('id', params.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ customer: data });
}

// PATCH /api/admin/customers/[id]
// Updates editable customer fields. If affiliate_id changes (or is set for
// the first time), re-applies the affiliate's price overrides onto this
// customer. Does NOT update email/role/active — use /api/admin/users/[id]
// for those (so auth.users stays in sync).
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { ok, userId, actor_email } = await verifyAdmin(req);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const { data: existing } = await db
    .from('customers')
    .select('id, affiliate_id')
    .eq('id', params.id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const EDITABLE = [
    'first_name',
    'last_name',
    'phone',
    'shipping_address',
    'shipping_city',
    'shipping_state',
    'shipping_postal_code',
    'shipping_country',
    'affiliate_id',
    'allow_pickup',
    'allow_shipping',
    'preferred_currency',
  ] as const;
  for (const key of EDITABLE) {
    if (body[key] !== undefined) {
      patch[key] = body[key] === '' ? null : body[key];
    }
  }
  // affiliate_id explicit null means "unbind"
  if (body.affiliate_id === null) patch.affiliate_id = null;

  const { error: upErr } = await db
    .from('customers')
    .update(patch)
    .eq('id', params.id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // If affiliate_id changed and is now set, copy the affiliate's pricelist.
  let priced: { copied: number; source_count: number } | null = null;
  const newAffiliateId = patch.affiliate_id as string | null | undefined;
  const affiliateChanged = newAffiliateId !== undefined && newAffiliateId !== existing.affiliate_id;
  if (affiliateChanged && newAffiliateId) {
    try {
      const r = await applyAffiliatePricelist(db, params.id, newAffiliateId);
      priced = { copied: r.copied, source_count: r.source_count };
      await logAuditServer(db, { actor_id: userId, actor_email }, {
        action: 'customer.affiliate_pricelist_applied',
        entity_type: 'customer',
        entity_id: params.id,
      });
    } catch (e: any) {
      console.error('applyAffiliatePricelist failed at update:', e?.message ?? e);
    }
  }

  await logAuditServer(db, { actor_id: userId, actor_email }, {
    action: 'customer.update',
    entity_type: 'customer',
    entity_id: params.id,
  });

  return NextResponse.json({ ok: true, priced });
}

// DELETE /api/admin/customers/[id]
// Soft cascade: FKs from orders/invoices/etc. are ON DELETE SET NULL, so a
// straight delete is safe. We don't touch auth.users — use /api/admin/users/[id]
// DELETE for that (which also unwinds affiliate/sales-person rows).
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { ok, userId, actor_email } = await verifyAdmin(req);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  // Clean up the customer's overrides + stock notifications first.
  await db.from('customer_price_overrides').delete().eq('customer_id', params.id);
  await db.from('stock_notifications').delete().eq('customer_id', params.id);

  const { error } = await db.from('customers').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAuditServer(db, { actor_id: userId, actor_email }, {
    action: 'customer.delete',
    entity_type: 'customer',
    entity_id: params.id,
  });

  return NextResponse.json({ ok: true });
}
