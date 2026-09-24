import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { UserRole } from '@/lib/permissions';
import {
  isPuramassConfigured,
  fetchPuramassOrderStatus,
  PuramassApiError,
} from '@/lib/payments/puramass';
import { applyPuramassStatus, type PuramassLedgerOrder } from '@/lib/payments/puramass-poll';
import { isMissingColumnError } from '@/lib/payments/puramass-columns';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const LEDGER_SELECT =
  'id, status, transaction_id, customer_id, customer_email, customer_name, customer_phone, items, subtotal_cents, invoice_id, currency, shipping_address, shipping_address_source, created_at';
const LEDGER_SELECT_LEGACY =
  'id, status, transaction_id, customer_id, customer_email, items, subtotal_cents, invoice_id, currency, created_at';

const CONCURRENCY = 6;
const MAX_PER_RUN = 250;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function verifyReadAccess(req: NextRequest): Promise<boolean> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return false;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return false;
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  const role = (data?.role ?? 'customer') as UserRole;
  return role === 'admin' || role === 'assistant';
}

/**
 * POST /api/admin/puramass/orders/sync — poll PuraMass for many orders at once.
 *
 * The bulk counterpart to the per-row refresh: same read
 * (`GET /partner/store/orders/{id}`) and the same idempotent
 * `applyPuramassStatus` apply the cron poller uses, just driven on demand for a
 * chosen set instead of on a timer.
 *
 * Body (all optional): `{ statuses?: string[], ids?: string[], limit?: number }`
 *   - `ids`      — specific ledger rows (takes precedence).
 *   - `statuses` — every order in those local states, e.g. ['paid'] to backfill
 *                  shipping addresses onto already-paid orders, which the cron
 *                  never revisits because it only polls `payment_pending`.
 *   - neither    — every order with a transaction id.
 *
 * Capped at 250 orders per call and 6 concurrent partner reads, and it stops
 * early on a 429 so a large sweep can't get the account rate-limited.
 * Admin/assistant only.
 */
export async function POST(req: NextRequest) {
  if (!(await verifyReadAccess(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  if (!isPuramassConfigured()) {
    return NextResponse.json({ error: 'Stealth Health is not configured.' }, { status: 503 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // An empty body is a valid "sync everything" request.
    body = {};
  }

  const ids = Array.isArray(body.ids)
    ? (body.ids as unknown[]).filter((x): x is string => typeof x === 'string' && !!x)
    : [];
  const statuses = Array.isArray(body.statuses)
    ? (body.statuses as unknown[]).filter((x): x is string => typeof x === 'string' && !!x)
    : [];
  const limit = Math.min(MAX_PER_RUN, Math.max(1, Number(body.limit) || MAX_PER_RUN));

  const build = (columns: string) => {
    let q = db
      .from('puramass_orders')
      .select(columns)
      .not('transaction_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (ids.length > 0) q = q.in('id', Array.from(new Set(ids)));
    else if (statuses.length > 0) q = q.in('status', Array.from(new Set(statuses)));
    return q;
  };

  let { data, error } = await build(LEDGER_SELECT);
  // The address columns may not be queryable yet — sync the statuses anyway.
  if (error && isMissingColumnError(error)) {
    ({ data, error } = await build(LEDGER_SELECT_LEGACY));
  }
  if (error) {
    console.error('[puramass] sync query failed:', error);
    return NextResponse.json({ error: `Could not load orders: ${error.message}` }, { status: 500 });
  }

  const orders = (data ?? []) as unknown as PuramassLedgerOrder[];
  if (orders.length === 0) {
    return NextResponse.json({
      total: 0, polled: 0, changed: 0, paid: 0, addresses: 0, errors: 0, rate_limited: false,
    });
  }

  let polled = 0;
  let changed = 0;
  let paid = 0;
  let addresses = 0;
  let errors = 0;
  let rateLimited = false;

  for (const group of chunk(orders, CONCURRENCY)) {
    if (rateLimited) break; // back off on 429 — the caller can re-run
    await Promise.all(
      group.map(async (order) => {
        if (!order.transaction_id) return;
        try {
          const remote = await fetchPuramassOrderStatus(order.transaction_id);
          polled += 1;
          const res = await applyPuramassStatus(db, order, remote);
          if (res.changed) {
            changed += 1;
            if (res.status === 'paid') paid += 1;
          }
          if (res.contactUpdated) addresses += 1;
        } catch (err) {
          errors += 1;
          if (err instanceof PuramassApiError && err.status === 429) {
            rateLimited = true;
          } else {
            console.error(`[puramass] sync ${order.transaction_id} failed:`, err);
          }
        }
      }),
    );
  }

  return NextResponse.json({
    total: orders.length,
    polled,
    changed,
    paid,
    addresses,
    errors,
    rate_limited: rateLimited,
  });
}
