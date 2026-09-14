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

// GET /api/admin/pricelists/[id] — pricelist + items joined with product
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { ok } = await verifyAdmin(req, false);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { data: pricelist, error } = await db
    .from('pricelists')
    .select(`
      *,
      creator:customers!pricelists_created_by_fkey (id, first_name, last_name, email)
    `)
    .eq('id', params.id)
    .single();
  if (error || !pricelist) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: items } = await db
    .from('pricelist_items')
    .select(`*, product:products (id, name, slug, strength, price)`)
    .eq('pricelist_id', params.id);

  const sorted = (items ?? []).sort((a: any, b: any) =>
    (a.product?.name ?? '').localeCompare(b.product?.name ?? '')
  );

  return NextResponse.json({ pricelist, items: sorted });
}

// PATCH /api/admin/pricelists/[id] — header (name/is_active) + item upserts
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { ok, userId, actor_email } = await verifyAdmin(req, true);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const body = await req.json();
  const { items, ...header } = body;

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof header.name === 'string') updates.name = header.name.trim();
  if (typeof header.description === 'string') {
    updates.description = header.description.trim() || null;
  }

  // Single-active invariant: clear the current active before activating this one.
  if (header.is_active === true) {
    await db.from('pricelists').update({ is_active: false }).eq('is_active', true);
    updates.is_active = true;
  } else if (header.is_active === false) {
    updates.is_active = false;
  }

  const { error: updErr } = await db.from('pricelists').update(updates).eq('id', params.id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Upsert per-product prices on (pricelist_id, product_id).
  if (Array.isArray(items) && items.length) {
    const rows = items
      .filter((i: any) => i.product_id)
      .map((i: any) => ({
        pricelist_id: params.id,
        product_id: i.product_id,
        price: Math.max(0, Number(i.price) || 0),
      }));
    if (rows.length) {
      const { error: itemErr } = await db
        .from('pricelist_items')
        .upsert(rows, { onConflict: 'pricelist_id,product_id' });
      if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 });
    }
  }

  await logAuditServer(db, { actor_id: userId, actor_email }, {
    action: 'pricelist.update',
    entity_type: 'pricelist',
    entity_id: params.id,
  });

  return NextResponse.json({ success: true });
}

// DELETE /api/admin/pricelists/[id]
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { ok, userId, actor_email } = await verifyAdmin(req, true);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { error } = await db.from('pricelists').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAuditServer(db, { actor_id: userId, actor_email }, {
    action: 'pricelist.delete',
    entity_type: 'pricelist',
    entity_id: params.id,
  });

  return NextResponse.json({ success: true });
}
