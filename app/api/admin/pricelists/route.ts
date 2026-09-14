import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logAuditServer } from '@/lib/admin/audit';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verifyAdmin(req: NextRequest, requireMutation: boolean) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { ok: false, userId: null as string | null, actor_email: null as string | null };
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return { ok: false, userId: null, actor_email: null };
  const { data } = await db.from('customers').select('id, email, role').eq('id', user.id).single();
  const role = data?.role ?? 'customer';
  const ok = requireMutation ? role === 'admin' : role === 'admin' || role === 'assistant';
  return { ok, userId: user.id, actor_email: data?.email ?? user.email ?? null };
}

// GET /api/admin/pricelists — list with item_count + creator, oldest-first
export async function GET(req: NextRequest) {
  const { ok } = await verifyAdmin(req, false);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  // Explicit FK spelling on the join keeps this stable if any other FK
  // from pricelists to customers is added later.
  const { data, error } = await db
    .from('pricelists')
    .select(`
      *,
      pricelist_items (count),
      creator:customers!pricelists_created_by_fkey (id, first_name, last_name, email)
    `)
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const pricelists = (data ?? []).map((pl: any) => {
    const { pricelist_items, ...rest } = pl;
    return { ...rest, item_count: pricelist_items?.[0]?.count ?? 0 };
  });
  return NextResponse.json({ pricelists });
}

// POST /api/admin/pricelists — create { name, source_pricelist_id? } + seed items
export async function POST(req: NextRequest) {
  const { ok, userId, actor_email } = await verifyAdmin(req, true);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const body = await req.json();
  const name = String(body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'Pricelist name is required' }, { status: 400 });
  const description = typeof body.description === 'string' && body.description.trim()
    ? body.description.trim()
    : null;

  const { data: pricelist, error } = await db
    .from('pricelists')
    .insert({ name, description, created_by: userId })
    .select()
    .single();
  if (error || !pricelist) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create pricelist' }, { status: 500 });
  }

  // Seed items: clone a source pricelist, else snapshot active product prices.
  let seedRows: { pricelist_id: string; product_id: string; price: number }[] = [];
  if (body.source_pricelist_id) {
    const { data: src } = await db
      .from('pricelist_items')
      .select('product_id, price')
      .eq('pricelist_id', body.source_pricelist_id);
    seedRows = (src ?? []).map((r: any) => ({
      pricelist_id: pricelist.id, product_id: r.product_id, price: Number(r.price) || 0,
    }));
  } else {
    const { data: products } = await db
      .from('products')
      .select('id, price')
      .eq('active', true);
    seedRows = (products ?? []).map((p: any) => ({
      pricelist_id: pricelist.id, product_id: p.id, price: Number(p.price) || 0,
    }));
  }

  if (seedRows.length) {
    const { error: seedErr } = await db.from('pricelist_items').insert(seedRows);
    if (seedErr) {
      // Roll back the header so we never strand an empty/partial pricelist.
      await db.from('pricelists').delete().eq('id', pricelist.id);
      return NextResponse.json({ error: seedErr.message }, { status: 500 });
    }
  }

  await logAuditServer(db, { actor_id: userId, actor_email }, {
    action: 'pricelist.create',
    entity_type: 'pricelist',
    entity_id: pricelist.id,
  });

  // Include the seed count so the list view can render without a second fetch.
  return NextResponse.json(
    { pricelist: { ...pricelist, item_count: seedRows.length } },
    { status: 201 },
  );
}
