import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { canManageCategories, canViewAnalytics, type UserRole } from '@/lib/permissions';
import { logAuditServer } from '@/lib/admin/audit';

const db = getSupabase();

async function resolveActor(
  req: NextRequest,
): Promise<{ role: UserRole; actor_id: string | null; actor_email: string | null }> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { role: 'customer', actor_id: null, actor_email: null };
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return { role: 'customer', actor_id: null, actor_email: null };
  const { data } = await db.from('customers').select('id, email, role').eq('id', user.id).single();
  return {
    role: (data?.role ?? 'customer') as UserRole,
    actor_id: data?.id ?? user.id,
    actor_email: data?.email ?? user.email ?? null,
  };
}

// GET /api/admin/categories — full list including inactive.
// Readable by admin / assistant (read-only) / analytics.
export async function GET(req: NextRequest) {
  const { role } = await resolveActor(req);
  if (!canViewAnalytics(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data, error } = await db
    .from('store_categories')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ categories: data ?? [] });
}

// POST /api/admin/categories — create a category (admin / analytics).
export async function POST(req: NextRequest) {
  const { role, actor_id, actor_email } = await resolveActor(req);
  if (!canManageCategories(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const slug = String(body.slug ?? '').trim();
  const name = String(body.name ?? '').trim();
  if (!slug || !name) {
    return NextResponse.json({ error: 'slug and name are required' }, { status: 400 });
  }

  // Duplicate slug guard.
  const { data: existing } = await db
    .from('store_categories')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: 'A category with this slug already exists' },
      { status: 409 },
    );
  }

  // Append to the end of the list.
  const { data: last } = await db
    .from('store_categories')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = (last?.sort_order ?? 0) + 1;

  const insert = {
    slug,
    name,
    description: body.description ? String(body.description).trim() : null,
    icon: body.icon ? String(body.icon).trim() : 'Beaker',
    sort_order: sortOrder,
    active: body.active !== undefined ? Boolean(body.active) : true,
    featured: body.featured !== undefined ? Boolean(body.featured) : false,
  };

  const { data, error } = await db
    .from('store_categories')
    .insert(insert)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAuditServer(db, { actor_id, actor_email }, {
    action: 'category.create',
    entity_type: 'store_category',
    entity_id: data?.id ?? null,
  });

  return NextResponse.json({ category: data }, { status: 201 });
}

// PUT /api/admin/categories — reorder. Body { order: string[] } → each id's
// sort_order is rewritten to its index + 1.
export async function PUT(req: NextRequest) {
  const { role, actor_id, actor_email } = await resolveActor(req);
  if (!canManageCategories(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const order = body.order;
  if (!Array.isArray(order) || order.some((id) => typeof id !== 'string')) {
    return NextResponse.json({ error: 'order must be an array of category ids' }, { status: 400 });
  }

  for (let i = 0; i < order.length; i++) {
    const { error } = await db
      .from('store_categories')
      .update({ sort_order: i + 1 })
      .eq('id', order[i]);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  await logAuditServer(db, { actor_id, actor_email }, {
    action: 'category.reorder',
    entity_type: 'store_category',
    entity_id: null,
  });

  const { data } = await db
    .from('store_categories')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  return NextResponse.json({ categories: data ?? [] });
}
