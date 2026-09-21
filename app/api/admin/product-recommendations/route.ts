/**
 * Frequently bought together — the operator's own pairings.
 *
 * One product's list is edited as a whole: /admin/cart-upsells sends the
 * products it should recommend, in order, and this route makes the stored rows
 * match. Editing a list rather than individual rows is what the screen does,
 * and doing it in one request keeps a half-applied reorder off the storefront.
 *
 * Reading is open to admin + assistant (the pair that can reach the page);
 * writing is admin-only, like every other commercial configuration.
 *
 *   GET    /api/admin/product-recommendations
 *            → every pairing, plus the catalogue the picker needs.
 *   PUT    /api/admin/product-recommendations
 *            body { productId, items: [{ recommendedProductId, badge? }] }
 *            → that product's list, replaced.
 *   DELETE /api/admin/product-recommendations?productId=…
 *            → that product's list, cleared.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { canAccessAdminPage, canEdit, type UserRole } from '@/lib/permissions';
import { logAuditServer } from '@/lib/admin/audit';

const db = getSupabase();

/** Most pairings one product may carry — the cart shows three. */
const MAX_PER_PRODUCT = 6;
/** Longest badge text; it has to fit the corner chip on a cart card. */
const MAX_BADGE_LENGTH = 24;

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

const canRead = (role: UserRole) => canAccessAdminPage(role, '/admin/cart-upsells');

/** The table arrives with cart-upsells-migration.sql; say so rather than 500. */
function migrationHint(error: { message?: string } | null) {
  const message = error?.message ?? '';
  return /product_recommendations/i.test(message) && /(does not exist|schema cache)/i.test(message)
    ? 'The product_recommendations table is missing — run cart-upsells-migration.sql.'
    : null;
}

export async function GET(req: NextRequest) {
  const { role } = await resolveActor(req);
  if (!canRead(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data: products, error: productsError } = await db
    .from('products')
    .select('id, name, sku, price, vial_price, vials_per_box, pack_options, pack_sizes, image_url, category, stock_quantity, active')
    .order('name', { ascending: true });
  if (productsError) {
    return NextResponse.json({ error: productsError.message }, { status: 500 });
  }

  const { data: rows, error } = await db
    .from('product_recommendations')
    .select('*')
    .order('product_id', { ascending: true })
    .order('sort_order', { ascending: true });
  if (error) {
    const hint = migrationHint(error);
    if (hint) return NextResponse.json({ recommendations: [], products: products ?? [], warning: hint });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ recommendations: rows ?? [], products: products ?? [] });
}

export async function PUT(req: NextRequest) {
  const { role, actor_id, actor_email } = await resolveActor(req);
  if (!canEdit(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const productId = String(body.productId ?? '').trim();
  if (!productId) {
    return NextResponse.json({ error: 'productId is required' }, { status: 400 });
  }
  if (!Array.isArray(body.items)) {
    return NextResponse.json({ error: 'items must be an array' }, { status: 400 });
  }

  // Clean before writing: a product cannot recommend itself, cannot recommend
  // the same thing twice, and cannot carry an unbounded list.
  const seen = new Set<string>();
  const items: { recommended_product_id: string; badge: string | null }[] = [];
  for (const raw of body.items) {
    const id = String(raw?.recommendedProductId ?? raw?.recommended_product_id ?? '').trim();
    if (!id || id === productId || seen.has(id)) continue;
    seen.add(id);
    const badge = String(raw?.badge ?? '').trim();
    items.push({
      recommended_product_id: id,
      badge: badge ? badge.slice(0, MAX_BADGE_LENGTH) : null,
    });
    if (items.length >= MAX_PER_PRODUCT) break;
  }

  // Every id must be a real product — a stale picker must not write a pairing
  // that the storefront would then silently drop.
  const ids = [productId, ...items.map((i) => i.recommended_product_id)];
  const { data: known, error: knownError } = await db
    .from('products')
    .select('id')
    .in('id', ids);
  if (knownError) {
    return NextResponse.json({ error: knownError.message }, { status: 500 });
  }
  const knownIds = new Set((known ?? []).map((p: any) => p.id));
  if (!knownIds.has(productId)) {
    return NextResponse.json({ error: 'Unknown product' }, { status: 404 });
  }
  const missing = items.filter((i) => !knownIds.has(i.recommended_product_id));
  if (missing.length > 0) {
    return NextResponse.json(
      { error: 'One of those products no longer exists — reload and try again.' },
      { status: 409 },
    );
  }

  // Replace rather than merge: the screen edits the whole list, so what it
  // sends IS the list. Delete first so a removed pairing really goes away.
  const { error: clearError } = await db
    .from('product_recommendations')
    .delete()
    .eq('product_id', productId);
  if (clearError) {
    const hint = migrationHint(clearError);
    return NextResponse.json({ error: hint ?? clearError.message }, { status: hint ? 409 : 500 });
  }

  if (items.length > 0) {
    const { error: insertError } = await db.from('product_recommendations').insert(
      items.map((item, index) => ({
        product_id: productId,
        recommended_product_id: item.recommended_product_id,
        badge: item.badge,
        sort_order: index,
        enabled: true,
      })),
    );
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  }

  await logAuditServer(db, { actor_id, actor_email }, {
    action: 'product_recommendations.update',
    entity_type: 'product',
    entity_id: productId,
  });

  const { data: rows } = await db
    .from('product_recommendations')
    .select('*')
    .eq('product_id', productId)
    .order('sort_order', { ascending: true });

  return NextResponse.json({ recommendations: rows ?? [] });
}

export async function DELETE(req: NextRequest) {
  const { role, actor_id, actor_email } = await resolveActor(req);
  if (!canEdit(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const productId = String(req.nextUrl.searchParams.get('productId') ?? '').trim();
  if (!productId) {
    return NextResponse.json({ error: 'productId is required' }, { status: 400 });
  }

  const { error } = await db
    .from('product_recommendations')
    .delete()
    .eq('product_id', productId);
  if (error) {
    const hint = migrationHint(error);
    return NextResponse.json({ error: hint ?? error.message }, { status: hint ? 409 : 500 });
  }

  await logAuditServer(db, { actor_id, actor_email }, {
    action: 'product_recommendations.clear',
    entity_type: 'product',
    entity_id: productId,
  });

  return NextResponse.json({ success: true });
}
