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

// GET /api/admin/customers — list customers (admin/assistant)
export async function GET(req: NextRequest) {
  const { ok } = await verifyAdmin(req);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { data, error } = await db
    .from('customers')
    .select('id, first_name, last_name, email, phone, affiliate_id, preferred_currency')
    .order('first_name', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ customers: data ?? [] });
}

// POST /api/admin/customers — create lightweight customer record (no auth user)
export async function POST(req: NextRequest) {
  const { ok, userId, actor_email } = await verifyAdmin(req);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const body = await req.json();
  const {
    first_name,
    last_name,
    email,
    phone,
    shipping_address,
    shipping_city,
    shipping_state,
    shipping_postal_code,
    shipping_country,
    affiliate_id,
    allow_pickup,
    allow_shipping,
    preferred_currency,
  } = body;

  if (!first_name || !last_name || !email) {
    return NextResponse.json(
      { error: 'first_name, last_name and email are required' },
      { status: 400 },
    );
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  const { data: existing } = await db
    .from('customers')
    .select('id, first_name, last_name, email, phone')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: 'A customer with this email already exists', customer: existing },
      { status: 409 },
    );
  }

  const { data: customer, error } = await db
    .from('customers')
    .insert({
      first_name,
      last_name,
      email: normalizedEmail,
      phone: phone || null,
      shipping_address: shipping_address || null,
      shipping_city: shipping_city || null,
      shipping_state: shipping_state || null,
      shipping_postal_code: shipping_postal_code || null,
      shipping_country: shipping_country || null,
      affiliate_id: affiliate_id || null,
      allow_pickup: allow_pickup ?? true,
      allow_shipping: allow_shipping ?? true,
      preferred_currency: preferred_currency === 'USD' ? 'USD' : 'CAD',
      role: 'customer',
      is_admin: false,
      active: true,
      email_verified: false,
      password_hash: null,
    })
    .select('id, first_name, last_name, email, phone, affiliate_id, preferred_currency')
    .single();

  if (error || !customer) {
    return NextResponse.json(
      { error: error?.message ?? 'Failed to create customer' },
      { status: 500 },
    );
  }

  // If the customer was bound to an affiliate at create-time, copy the
  // affiliate's price overrides onto the new customer. Best-effort.
  let priced: { copied: number; source_count: number } | null = null;
  if (customer.affiliate_id) {
    try {
      const r = await applyAffiliatePricelist(db, customer.id, customer.affiliate_id);
      priced = { copied: r.copied, source_count: r.source_count };
      await logAuditServer(db, { actor_id: userId, actor_email }, {
        action: 'customer.affiliate_pricelist_applied',
        entity_type: 'customer',
        entity_id: customer.id,
      });
    } catch (e: any) {
      console.error('applyAffiliatePricelist failed at create:', e?.message ?? e);
    }
  }

  await logAuditServer(db, { actor_id: userId, actor_email }, {
    action: 'customer.create',
    entity_type: 'customer',
    entity_id: customer.id,
  });

  return NextResponse.json({ customer, priced }, { status: 201 });
}
