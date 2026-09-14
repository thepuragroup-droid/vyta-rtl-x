import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import {
  readVisitorContext,
  isTrackingAllowed,
  ensureVisitorAttribution,
  refreshLastTouch,
  stampVisitorMilestone,
} from '@/lib/analytics/attribution-server';

// Service-role client: customer_activity is RLS-locked, so all writes go
// through this route.
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const ALLOWED_TYPES = new Set([
  'search',
  'view',
  'cart',
  'page',
  'click',
  'lab_result',
  'checkout_start',
  'signup',
  'purchase',
]);

/**
 * Events that mark a funnel step and are stamped onto the visitor row, so the
 * acquisition report is a single scan of `visitor_attribution` rather than an
 * aggregate over the whole event log.
 */
const MILESTONES: Record<string, 'signed_up_at' | 'checkout_at' | 'purchased_at'> = {
  signup: 'signed_up_at',
  checkout_start: 'checkout_at',
  purchase: 'purchased_at',
};

/**
 * Storefront paths only. Admin, warehouse and account-internal routes are not
 * part of a customer's shopping journey, and recording them would bury the
 * signal the customer page is meant to show.
 */
const IGNORED_PREFIXES = ['/admin', '/warehouse', '/api'];

/** Path only — no origin, no query string (which can carry tokens). */
function cleanPath(raw: unknown): string | null {
  const value = String(raw ?? '').trim();
  if (!value.startsWith('/')) return null;
  const path = value.split(/[?#]/)[0].slice(0, 300);
  if (IGNORED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  return path;
}

/**
 * Event payloads are shallow key/value detail written by the client, so they
 * are capped in both breadth and depth before being stored as JSONB — a
 * tracking call must never be a way to write an arbitrary blob into the row.
 */
function cleanMetadata(raw: unknown): Record<string, string | number | boolean> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, string | number | boolean> = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= 12) break;
    if (!/^[a-z0-9_]{1,40}$/i.test(key)) continue;
    if (typeof value === 'string') out[key] = value.slice(0, 200);
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean') out[key] = value;
    else continue;
    count += 1;
  }
  return count > 0 ? out : null;
}

/**
 * POST /api/customer/activity
 *
 * Records one storefront interaction — a page visit, search, product view,
 * cart add, click, COA open, checkout start, signup or purchase.
 *
 * Anonymous visitors are recorded too, keyed by the `aminocan_vid` cookie the
 * middleware mints, and their history is adopted by the account they later
 * create (see ./identify). Before this route accepted them, the entire
 * pre-signup journey — which is most of the funnel, and all of the part paid
 * traffic lands in — was invisible.
 *
 * Consent: an anonymous visitor is only recorded when the site's consent
 * banner is switched off or they pressed Accept. A signed-in customer is
 * always recorded — that is first-party service data about their own account.
 *
 * Always returns 200. A tracking call must never surface an error to the
 * browsing experience, and a non-2xx here would show up in the console of a
 * page that is working perfectly well.
 */
export async function POST(req: NextRequest) {
  try {
    // Identify the caller. Auth is optional now: a bearer token names a
    // customer, its absence just means we only have the cookie.
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    let customerId: string | null = null;
    if (token) {
      const { data: { user } } = await db.auth.getUser(token);
      customerId = user?.id ?? null;
    }

    const ctx = readVisitorContext(req.cookies);
    // No token and no cookie — nothing to attribute this to. Happens when a
    // client blocks cookies, which is a decision we respect by not tracking.
    if (!customerId && !ctx.anonymousId) {
      return NextResponse.json({ ok: false }, { status: 200 });
    }

    // Anonymous traffic is untrusted and unauthenticated, so it gets a budget.
    // Signed-in customers are already rate-limited by their session.
    if (!customerId) {
      const rl = checkRateLimit(`activity:${getClientIp(req)}`, { windowMs: 60_000, max: 120 });
      if (!rl.allowed) return NextResponse.json({ ok: false }, { status: 200 });
    }

    if (!(await isTrackingAllowed(db, req.cookies, { signedIn: !!customerId }))) {
      return NextResponse.json({ ok: false, consent: false }, { status: 200 });
    }

    let body: Record<string, any>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false }, { status: 200 });
    }

    const type = String(body.type ?? '');
    if (!ALLOWED_TYPES.has(type)) return NextResponse.json({ ok: false }, { status: 200 });

    const pagePath = type === 'page' ? cleanPath(body.pagePath) : null;
    // An un-recordable path is not an error — it's a page we deliberately skip.
    if (type === 'page' && !pagePath) return NextResponse.json({ ok: false }, { status: 200 });
    const pageTitle =
      type === 'page' && body.pageTitle != null ? String(body.pageTitle).slice(0, 200) : null;
    // Referrer is stored for the entry page only; strip the query string for
    // the same reason as the path.
    const referrer =
      type === 'page' && body.referrer != null
        ? String(body.referrer).split(/[?#]/)[0].slice(0, 300)
        : null;

    const searchQuery =
      type === 'search' ? String(body.searchQuery ?? '').trim().slice(0, 200) : null;
    // Ignore empty search terms.
    if (type === 'search' && !searchQuery) return NextResponse.json({ ok: false }, { status: 200 });

    const productIdRaw = body.productId != null ? String(body.productId) : null;
    // Only accept a UUID product id; anything else is stored as null so a bad
    // client value can't fail the insert (product_id is a uuid column).
    const productId =
      productIdRaw && /^[0-9a-fA-F-]{36}$/.test(productIdRaw) ? productIdRaw : null;
    const productName = body.productName != null ? String(body.productName).slice(0, 200) : null;
    const quantity =
      type === 'cart' && Number.isFinite(Number(body.quantity))
        ? Math.max(1, Math.floor(Number(body.quantity)))
        : null;
    const metadata = cleanMetadata(body.metadata);

    // Verify the token actually maps to a customer row before using it (the FK
    // requires it, and it keeps orphan rows out). A token without a profile
    // still records the event anonymously rather than dropping it.
    if (customerId) {
      const { data: customer } = await db
        .from('customers')
        .select('id')
        .eq('id', customerId)
        .maybeSingle();
      if (!customer) customerId = null;
    }
    if (!customerId && !ctx.anonymousId) {
      return NextResponse.json({ ok: false }, { status: 200 });
    }

    // Attribution first: the visitor row must exist before a milestone can be
    // stamped on it, and a page view is the natural point to move the
    // last-touch forward (it is the only event that follows a fresh arrival).
    await ensureVisitorAttribution(db, ctx);
    if (type === 'page') await refreshLastTouch(db, ctx);

    const row = {
      customer_id: customerId,
      anonymous_id: ctx.anonymousId,
      session_id: ctx.sessionId,
      activity_type: type,
      search_query: searchQuery,
      product_id: productId,
      product_name: productName,
      quantity,
      page_path: pagePath,
      page_title: pageTitle,
      referrer,
      metadata,
    };

    const { error } = await db.from('customer_activity').insert(row);

    // The anonymous columns arrive with marketing-attribution-migration.sql,
    // the page columns with customer-crm-migration.sql. Until those run, retry
    // with the original column set so tracking degrades instead of stopping —
    // but only for an event that has somewhere to go without them.
    if (error && /anonymous_id|session_id|metadata|page_path|page_title|referrer/.test(error.message ?? '')) {
      if (!customerId) return NextResponse.json({ ok: false, unmigrated: true }, { status: 200 });
      if (!['search', 'view', 'cart'].includes(type)) {
        return NextResponse.json({ ok: false, unmigrated: true }, { status: 200 });
      }
      await db.from('customer_activity').insert({
        customer_id: customerId,
        activity_type: type,
        search_query: searchQuery,
        product_id: productId,
        product_name: productName,
        quantity,
      });
    }

    const milestone = MILESTONES[type];
    if (milestone) {
      await stampVisitorMilestone(db, ctx.anonymousId, milestone);
    }

    return NextResponse.json({ ok: true });
  } catch {
    // Tracking is best-effort by design.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
