import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  isValidEmail,
  KlaviyoApiError,
  readKlaviyoSettings,
  subscribeToKlaviyoList,
  type KlaviyoProfileInput,
} from '@/lib/klaviyo/client';
import { isKlaviyoAdmin } from '@/lib/klaviyo/admin-auth';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const maxDuration = 60;

const PAGE = 1000;
/** Klaviyo accepts up to 1000 profiles per subscription job; stay well under. */
const BATCH = 500;

/**
 * POST /api/admin/klaviyo/sync-customers
 *
 * One-off backfill: subscribes every existing customer who ticked the
 * marketing-consent box at signup to the configured Klaviyo list. Customers
 * without consent are never subscribed. Safe to re-run — subscribing someone
 * already on the list is a no-op in Klaviyo.
 */
export async function POST(req: NextRequest) {
  if (!(await isKlaviyoAdmin(db, req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const s = await readKlaviyoSettings(db);
  if (!s.privateKey) {
    return NextResponse.json({ error: 'Save a Klaviyo private API key first.' }, { status: 400 });
  }
  if (!s.listId) {
    return NextResponse.json({ error: 'Choose a newsletter list first.' }, { status: 400 });
  }

  const profiles: KlaviyoProfileInput[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('customers')
      .select('email, first_name, last_name')
      .eq('contact_consent', true)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      return NextResponse.json({ error: `Could not read customers: ${error.message}` }, { status: 500 });
    }
    for (const c of data ?? []) {
      if (isValidEmail(c.email)) {
        profiles.push({ email: c.email, first_name: c.first_name, last_name: c.last_name });
      }
    }
    if (!data || data.length < PAGE) break;
  }

  let submitted = 0;
  for (let i = 0; i < profiles.length; i += BATCH) {
    const batch = profiles.slice(i, i + BATCH);
    try {
      await subscribeToKlaviyoList(s.privateKey, s.listId, batch, 'VYTA customer backfill');
      submitted += batch.length;
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof KlaviyoApiError
              ? `Klaviyo stopped the sync: ${err.detail}`
              : 'Could not reach Klaviyo.',
          submitted,
          total: profiles.length,
        },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({ success: true, submitted, total: profiles.length });
}
