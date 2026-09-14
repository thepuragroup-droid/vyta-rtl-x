/**
 * Resolve a CRM route id to the identity every desk actually needs: an email
 * (there always is one) plus whichever account rows back it.
 *
 * Three kinds of person are addressed by the admin CRM routes:
 *   • a `customers` UUID — a registered customer
 *   • `pm:<email>` — someone who only ever bought through the Stealth Health
 *     hosted checkout and has no account here
 *   • an `affiliates` UUID — reached from the affiliates desk
 *
 * Lead records, outreach emails and claims are all keyed by EMAIL so they work
 * across all three, and this is the single place that mapping happens. That is
 * also why claiming an affiliate shows on the customers page and vice versa:
 * it is one relationship record for one human.
 *
 * SERVER ONLY — takes the service-role client.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  emailFromPuramassId,
  fetchPuramassLedger,
  isPuramassId,
  normalizeEmail,
} from '@/lib/admin/customer-directory';

export interface CustomerRef {
  /** NULL for a Stealth Health buyer, or an affiliate with no `customers` row. */
  customerId: string | null;
  /** Set when this person is an affiliate. */
  affiliateId: string | null;
  email: string;
  name: string | null;
  source: 'account' | 'puramass' | 'affiliate';
}

/** Which table to look a UUID up in first. */
export type RefKind = 'customer' | 'affiliate';

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // Next decodes the segment already; a stray `%` would make a second decode
    // throw, so it degrades to the raw value.
    return value;
  }
}

export async function resolveCustomerRef(
  db: SupabaseClient,
  rawId: string,
  kind: RefKind = 'customer',
): Promise<CustomerRef | null> {
  const id = safeDecode(rawId);

  if (isPuramassId(id)) {
    const email = emailFromPuramassId(id);
    if (!email) return null;
    // Confirm the buyer actually exists in the ledger — otherwise anyone could
    // mint a lead for an arbitrary address by typing it into the URL.
    const orders = await fetchPuramassLedger(db, { email, limit: 1 });
    if (orders.length === 0) return null;
    return {
      customerId: null,
      affiliateId: null,
      email,
      name: orders[0].customer_name ?? null,
      source: 'puramass',
    };
  }

  return kind === 'affiliate'
    ? resolveAffiliate(db, id)
    : resolveCustomer(db, id);
}

async function resolveCustomer(db: SupabaseClient, id: string): Promise<CustomerRef | null> {
  const { data } = await db
    .from('customers')
    .select('id, email, first_name, last_name, affiliate_id')
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;

  return {
    customerId: data.id,
    affiliateId: data.affiliate_id ?? null,
    email: normalizeEmail(data.email),
    name: `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim() || null,
    source: 'account',
  };
}

/**
 * Affiliates are created with `affiliates.id = customers.id` (see the affiliate
 * create route), so the matching account is usually just the same id — but an
 * affiliate seeded another way may have none, which is why the customer lookup
 * falls back to matching on email and then to no account at all.
 */
async function resolveAffiliate(db: SupabaseClient, id: string): Promise<CustomerRef | null> {
  const { data } = await db
    .from('affiliates')
    .select('id, email, first_name, last_name')
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;

  const email = normalizeEmail(data.email);
  const { data: account } = await db
    .from('customers')
    .select('id')
    .or(`id.eq.${data.id},email.ilike.${email.replace(/[,()]/g, '')}`)
    .maybeSingle();

  return {
    customerId: account?.id ?? null,
    affiliateId: data.id,
    email,
    name: `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim() || null,
    source: 'affiliate',
  };
}
