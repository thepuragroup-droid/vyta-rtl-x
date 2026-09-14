import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { canManageCategories, type UserRole } from '@/lib/permissions';
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

// PUT /api/admin/categories/[id] — edit a category (admin / analytics).
// Editable: slug, name, description, icon, sort_order, active, featured.
// Editing the slug renames the product-join key; a DB trigger
// cascades the new slug into every linked product's `category` text column, so
// renaming never orphans products.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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

  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  if ('slug' in body) {
    const slug = String(body.slug ?? '').trim();
    if (!slug) return NextResponse.json({ error: 'slug cannot be empty' }, { status: 400 });
    // Guard the unique constraint against another category's slug.
    const { data: dup } = await db
      .from('store_categories')
      .select('id')
      .eq('slug', slug)
      .neq('id', id)
      .maybeSingle();
    if (dup) {
      return NextResponse.json(
        { error: 'A category with this slug already exists' },
        { status: 409 },
      );
    }
    updates.slug = slug;
  }
  if ('name' in body) {
    const name = String(body.name ?? '').trim();
    if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    updates.name = name;
  }
  if ('description' in body) updates.description = body.description ? String(body.description).trim() : null;
  if ('icon' in body) updates.icon = body.icon ? String(body.icon).trim() : 'Beaker';
  if ('sort_order' in body) {
    const n = Math.floor(Number(body.sort_order));
    if (Number.isFinite(n)) updates.sort_order = n;
  }
  if ('active' in body) updates.active = Boolean(body.active);
  if ('featured' in body) updates.featured = Boolean(body.featured);

  const { data, error } = await db
    .from('store_categories')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAuditServer(db, { actor_id, actor_email }, {
    action: 'category.update',
    entity_type: 'store_category',
    entity_id: id,
  });

  return NextResponse.json({ category: data });
}

// DELETE /api/admin/categories/[id] — remove a category (admin / analytics).
// Products keep their `category` string; the category simply stops appearing
// in the filter / homepage.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { role, actor_id, actor_email } = await resolveActor(req);
  if (!canManageCategories(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { error } = await db.from('store_categories').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAuditServer(db, { actor_id, actor_email }, {
    action: 'category.delete',
    entity_type: 'store_category',
    entity_id: id,
  });

  return NextResponse.json({ success: true });
}
