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

// PUT /api/admin/categories/[id]/products — set exactly which products belong
// to a category (admin / analytics). Body: { product_ids: string[] }.
//
// A product carries one category (products.category, the slug), so picking a
// product here moves it out of whatever category it was in before; products
// that were in this category but are no longer picked are left uncategorised.
// Writing the text column keeps this working with or without the category_id
// FK — its sync trigger resolves the id from the slug.
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
  if (!Array.isArray(body?.product_ids)) {
    return NextResponse.json({ error: 'product_ids must be an array' }, { status: 400 });
  }
  const productIds = Array.from(
    new Set(
      (body.product_ids as unknown[])
        .map((v) => String(v ?? '').trim())
        .filter(Boolean),
    ),
  );

  const { data: category, error: catError } = await db
    .from('store_categories')
    .select('id, slug')
    .eq('id', id)
    .maybeSingle();
  if (catError) return NextResponse.json({ error: catError.message }, { status: 500 });
  if (!category) return NextResponse.json({ error: 'Category not found' }, { status: 404 });

  const now = new Date().toISOString();

  // What is in the category now, so only the actual differences are written.
  const { data: current, error: currentError } = await db
    .from('products')
    .select('id')
    .eq('category', category.slug);
  if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
  const currentIds = new Set((current ?? []).map((p) => p.id as string));
  const pickedIds = new Set(productIds);
  const toRemove = Array.from(currentIds).filter((pid) => !pickedIds.has(pid));
  const toAdd = productIds.filter((pid) => !currentIds.has(pid));

  // 1) Unassign products that were in this category but are no longer picked.
  if (toRemove.length > 0) {
    const { error } = await db
      .from('products')
      .update({ category: null, updated_at: now })
      .in('id', toRemove);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 2) Assign the newly picked products (moving them from any other category).
  if (toAdd.length > 0) {
    const { error } = await db
      .from('products')
      .update({ category: category.slug, updated_at: now })
      .in('id', toAdd);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAuditServer(db, { actor_id, actor_email }, {
    action: 'category.products.update',
    entity_type: 'store_category',
    entity_id: id,
  });

  return NextResponse.json({
    success: true,
    product_ids: productIds,
    added: toAdd.length,
    removed: toRemove.length,
  });
}
