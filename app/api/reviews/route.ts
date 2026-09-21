import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import {
  PURCHASED_ORDER_STATUSES,
  REVIEW_BODY_MAX,
  REVIEW_TITLE_MAX,
  displayNameFor,
  normaliseRating,
  shapeReview,
  shapeStats,
  type ProductReview,
} from '@/lib/reviews';

/**
 * Product reviews — the storefront's read side and the customer's write side.
 *
 * ## Why this is a route and not a direct Supabase call
 *
 * Reading reviews could be done from the browser; writing one cannot. "Did
 * this person buy this product" is answered by `orders` / `order_items`, and
 * a customer's own token deliberately cannot read those tables broadly. So
 * the check runs here, with the service role, and `product_reviews` has no
 * insert policy at all: the only way a row appears is through this route,
 * after the purchase has been proven.
 *
 * GET ?product_id=<uuid>   one product: its reviews, its rollup, and — if the
 *                          caller is signed in — whether they may write one.
 * GET ?ids=<uuid,uuid,...> rollups only, for a grid of product cards.
 * POST                     create or update the caller's own review.
 */

const db = getSupabase();

/** A table this migration created is missing — say which, not "relation does not exist". */
function missingTable(message: string): boolean {
  return /does not exist|schema cache|could not find the/i.test(message);
}

const MIGRATION_HINT =
  'The product_reviews table is missing — run reviews-testimonials-migration.sql.';

async function resolveCustomer(req: NextRequest) {
  const header = req.headers.get('authorization');
  if (!header) return null;
  try {
    const { data: { user }, error } = await db.auth.getUser(header.replace('Bearer ', ''));
    if (error || !user) return null;
    const { data } = await db
      .from('customers')
      .select('id, first_name, last_name')
      .eq('id', user.id)
      .single();
    return {
      id: user.id,
      first_name: (data?.first_name as string) ?? null,
      last_name: (data?.last_name as string) ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * The order this customer bought `productId` in, or null.
 *
 * Storefront orders keep their lines in `orders.items` (a JSONB array whose
 * `id` is the product UUID); orders raised in the admin panel use the
 * `order_items` table instead. A customer can have both, so both are checked
 * — a review is gated on the purchase, not on which checkout produced it.
 */
async function findPurchase(customerId: string, productId: string): Promise<string | null> {
  const { data: orders } = await db
    .from('orders')
    .select('id, items')
    .eq('customer_id', customerId)
    .in('status', PURCHASED_ORDER_STATUSES as unknown as string[])
    .order('created_at', { ascending: false })
    .limit(200);

  if (!orders?.length) return null;

  for (const order of orders) {
    const items = Array.isArray(order.items) ? order.items : [];
    const hit = items.some((item: Record<string, unknown>) => {
      // `id` on a storefront line, `product_id` on anything normalised later.
      const id = item?.id ?? item?.product_id;
      return typeof id === 'string' && id === productId;
    });
    if (hit) return String(order.id);
  }

  // Admin-raised orders keep their lines in their own table. `product_id`
  // there is text, not a uuid column, so it is compared as the string it is.
  const { data: lines } = await db
    .from('order_items')
    .select('order_id')
    .eq('product_id', productId)
    .in('order_id', orders.map((o) => o.id));

  return lines?.[0]?.order_id ? String(lines[0].order_id) : null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ids = searchParams.get('ids');
  const productId = searchParams.get('product_id');

  // ── Rollups for a grid of cards ────────────────────────────────────────
  if (ids) {
    const wanted = ids.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50);
    if (wanted.length === 0) return NextResponse.json({ stats: [] });

    const { data, error } = await db
      .from('product_review_stats')
      .select('product_id, review_count, average_rating')
      .in('product_id', wanted);

    // A storefront grid must render with or without reviews, so a missing
    // table is an empty rollup rather than an error the card has to handle.
    if (error) return NextResponse.json({ stats: [] });
    return NextResponse.json({
      stats: (data ?? []).map((row) => shapeStats(row, String(row.product_id))),
    });
  }

  if (!productId) {
    return NextResponse.json({ error: 'product_id or ids required' }, { status: 400 });
  }

  // ── One product ────────────────────────────────────────────────────────
  const { data: rows, error } = await db
    .from('product_reviews')
    .select('id, product_id, customer_id, rating, title, body, author_name, verified, created_at')
    .eq('product_id', productId)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json(
      { error: missingTable(error.message) ? MIGRATION_HINT : error.message },
      { status: 500 },
    );
  }

  const customer = await resolveCustomer(req);
  const reviews: ProductReview[] = (rows ?? []).map((row) => {
    const review = shapeReview(row);
    if (customer && row.customer_id === customer.id) review.mine = true;
    return review;
  });

  const count = reviews.length;
  const stats = shapeStats(
    {
      review_count: count,
      average_rating: count
        ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / count) * 100) / 100
        : 0,
    },
    productId,
  );

  const mine = reviews.find((r) => r.mine) ?? null;
  const viewer = {
    signedIn: !!customer,
    // Someone who already reviewed it keeps the right to edit, without a
    // second trip through the order tables.
    canReview: customer ? !!mine || !!(await findPurchase(customer.id, productId)) : false,
    review: mine,
  };

  return NextResponse.json({ reviews, stats, viewer });
}

export async function POST(req: NextRequest) {
  const customer = await resolveCustomer(req);
  if (!customer) {
    return NextResponse.json({ error: 'Sign in to write a review' }, { status: 401 });
  }

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const productId = typeof body.product_id === 'string' ? body.product_id.trim() : '';
  if (!productId) {
    return NextResponse.json({ error: 'product_id required' }, { status: 400 });
  }

  const rating = normaliseRating(body.rating);
  if (rating === null) {
    return NextResponse.json({ error: 'Give the product a rating from 1 to 5' }, { status: 400 });
  }

  const orderId = await findPurchase(customer.id, productId);
  // An edit is allowed on the strength of the existing row: the purchase was
  // proven when it was written, and an order can be deleted afterwards.
  const { data: existing } = await db
    .from('product_reviews')
    .select('id, order_id')
    .eq('product_id', productId)
    .eq('customer_id', customer.id)
    .maybeSingle();

  if (!orderId && !existing) {
    return NextResponse.json(
      { error: 'Only customers who have ordered this product can review it' },
      { status: 403 },
    );
  }

  const title = typeof body.title === 'string' ? body.title.trim().slice(0, REVIEW_TITLE_MAX) : '';
  const text = typeof body.body === 'string' ? body.body.trim().slice(0, REVIEW_BODY_MAX) : '';

  const row = {
    product_id: productId,
    customer_id: customer.id,
    order_id: orderId ?? existing?.order_id ?? null,
    rating,
    title: title || null,
    body: text || null,
    author_name: displayNameFor(customer.first_name, customer.last_name),
    verified: true,
  };

  const { data, error } = existing
    ? await db.from('product_reviews').update(row).eq('id', existing.id).select('*').single()
    : await db.from('product_reviews').insert(row).select('*').single();

  if (error) {
    return NextResponse.json(
      { error: missingTable(error.message) ? MIGRATION_HINT : error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ review: { ...shapeReview(data), mine: true } });
}
