/**
 * Email flows — the engine. Server-only.
 *
 * Runs both flows on one set of rules:
 *
 *   welcome  enrolled at signup (consenting accounts) — `enrollAndWelcome`
 *            sends Email 1 seconds after signup; the cron catches the rest.
 *   cart     enrolled by the cron once a cart has sat unchanged for the first
 *            email's delay (1 hour by default) — from a saved storefront cart,
 *            or an unpaid Stealth Health checkout.
 *
 * Per entry, every run, in this order:
 *   1. Purchased since the trigger?            → stop: 'converted'.
 *   2. Unsubscribed anywhere?                  → stop: 'unsubscribed'.
 *   3. Account off / consent withdrawn?        → stop: 'exited'.
 *   4. Welcome only: in an active cart flow?   → hold (cart takes priority).
 *      Cart only: cart emptied?                → stop: 'exited'.
 *   5. Next email due, inside their window, far enough from the last email of
 *      ANY flow, and its code usable?          → send it.
 *   6. Nothing left to send?                   → 'completed'.
 *
 * Sends are at-most-once: an `email_flow_sends` row (UNIQUE on entry + step) is
 * claimed BEFORE the SMTP call, so overlapping runs can never both send. A
 * rejected send is retried by later runs, up to MAX_SEND_ATTEMPTS.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { SITE_URL } from '@/lib/config';
import { sendMail } from '@/lib/smtp';
import { firstOrderStatus, normalizeOrderEmail } from '@/lib/promos/first-order';
import { readKlaviyoSettings, upsertKlaviyoProfile } from '@/lib/klaviyo/client';
import { isMissingColumnError } from '@/lib/payments/puramass-columns';
import {
  ENTRY_STATUS_META,
  FLOWS,
  FLOW_KEYS,
  IMPLIED_CONSENT_DAYS,
  MAX_SEND_ATTEMPTS,
  STEP_NUMBERS,
  normalizeCode,
  requiresCode,
  type CodeCheck,
  type ConsentBasis,
  type EntryStatus,
  type FlowKey,
  type FlowSettings,
  type FlowStep,
  type StepNumber,
} from './types';
import { DEFAULT_STEPS, defaultStep, shapeSettingsRow, shapeStepRow } from './defaults';
import { decide, nextStep, timezoneFor, type SendRecord } from './schedule';
import { renderFlowEmail, type RenderCart, type ResolvedOffer } from './render';
import { clickUrl, openPixelUrl, unsubscribeUrl, viewUrl } from './tokens';
import {
  CART_PRODUCT_COLUMNS,
  cartLineViews,
  itemCount,
  linesFromCheckout,
  restoreUrls,
  sanitizeCartLines,
  type CartProductRow,
  type SavedCartLine,
} from './carts';

type Db = SupabaseClient<any, any, any>;

/** Triggers older than this are never auto-enrolled, whatever `enabled_at` says. */
const ENROLL_LOOKBACK_DAYS = 7;
const WELCOME_LOOKBACK_DAYS = 14;
/** A purchase this long after the last email still counts as the flow's. */
const ATTRIBUTION_DAYS = 14;
/** Per run, across both flows — keeps one cron call inside a serverless limit. */
const MAX_SENDS_PER_RUN = 40;
/** Never call a cart abandoned sooner than this, whatever step 1's delay says. */
const MIN_ABANDON_MINUTES = 30;
const LEGACY_PAID_STATUSES = ['confirmed', 'paid', 'processing', 'shipped', 'delivered', 'completed'];
/** Unpaid hosted checkouts that count as an abandoned cart. */
const ABANDONED_CHECKOUT_STATUSES = ['payment_pending', 'expired', 'cancelled'];

export const MIGRATION_FILE = 'email-flows-migration.sql';

/** 42P01 / PGRST205: the table is not there — the migration has not run. */
export function isMissingTable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  if (e.code === '42P01' || e.code === 'PGRST205') return true;
  return /(email_flow_\w+|saved_carts)/.test(e.message ?? '') && /(does not exist|could not find)/i.test(e.message ?? '');
}

const lower = (e: string | null | undefined) => String(e ?? '').trim().toLowerCase();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface FlowConfig {
  flow: FlowKey;
  settings: FlowSettings;
  steps: Record<StepNumber, FlowStep>;
}

export type ConfigResult = { ok: true; config: FlowConfig } | { ok: false; migrationNeeded: boolean; error: string };

/** A flow's settings and five steps. Seeds anything missing from the defaults. */
export async function loadConfig(db: Db, flow: FlowKey): Promise<ConfigResult> {
  const [{ data: settingsRow, error: sErr }, { data: stepRows, error: stErr }] = await Promise.all([
    db.from('email_flow_settings').select('*').eq('flow', flow).maybeSingle(),
    db.from('email_flow_steps').select('*').eq('flow', flow),
  ]);
  const err = sErr ?? stErr;
  if (err) return { ok: false, migrationNeeded: isMissingTable(err), error: err.message };

  const have = new Set((stepRows ?? []).map((r: any) => Number(r.step)));
  const missing = DEFAULT_STEPS[flow].filter((s) => !have.has(s.step));
  if (missing.length) {
    await db.from('email_flow_steps').upsert(missing, { onConflict: 'flow,step', ignoreDuplicates: true });
  }
  if (!settingsRow) {
    await db.from('email_flow_settings').upsert({ flow }, { onConflict: 'flow', ignoreDuplicates: true });
  }

  const steps = {} as Record<StepNumber, FlowStep>;
  for (const n of STEP_NUMBERS) {
    const row = (stepRows ?? []).find((r: any) => Number(r.step) === n);
    steps[n] = row ? shapeStepRow(flow, { ...row, step: n }) : defaultStep(flow, n);
  }
  return { ok: true, config: { flow, settings: shapeSettingsRow(flow, settingsRow as any), steps } };
}

// ---------------------------------------------------------------------------
// Discount codes
// ---------------------------------------------------------------------------

function offerLabel(type: string, value: number): string {
  if (type === 'fixed') return `$${Number.isInteger(value) ? value : value.toFixed(2)}`;
  return `${+value.toFixed(2)}%`;
}

/**
 * Is each code usable today, and what does it take off? Read from
 * discount_codes at send time, so the email can only ever state the code's
 * real value. Fails closed: a code we cannot read is "not usable".
 */
export async function checkCodes(db: Db, rawCodes: (string | null | undefined)[], now = new Date()): Promise<Map<string, CodeCheck>> {
  const codes = [...new Set(rawCodes.map(normalizeCode).filter(Boolean))];
  const out = new Map<string, CodeCheck>();
  if (!codes.length) return out;

  const { data, error } = await db.from('discount_codes').select('*').in('code', codes);
  for (const code of codes) {
    const row = (data ?? []).find((r: any) => r.code === code) as any;
    const fail = (problem: string): CodeCheck => ({ code, usable: false, label: row ? offerLabel(row.discount_type, Number(row.discount_value) || 0) : null, problem });
    if (error) { out.set(code, fail('Discount codes could not be read.')); continue; }
    if (!row) { out.set(code, fail(`${code} does not exist in Discount Codes — create it there.`)); continue; }
    if (!row.active) { out.set(code, fail(`${code} is switched off in Discount Codes.`)); continue; }
    if (row.starts_at && Date.parse(row.starts_at) > now.getTime()) { out.set(code, fail(`${code} has not started yet.`)); continue; }
    if (row.expires_at && Date.parse(row.expires_at) <= now.getTime()) { out.set(code, fail(`${code} has expired.`)); continue; }
    if (row.max_uses != null) {
      const { count } = await db
        .from('puramass_orders')
        .select('id', { count: 'exact', head: true })
        .eq('discount_code_id', row.id)
        .eq('status', 'paid');
      if ((count ?? 0) >= Number(row.max_uses)) { out.set(code, fail(`${code} has reached its usage limit.`)); continue; }
    }
    const value = Number(row.discount_value) || 0;
    if (value <= 0) { out.set(code, fail(`${code} takes nothing off.`)); continue; }
    out.set(code, { code, usable: true, label: offerLabel(row.discount_type, value), problem: null });
  }
  return out;
}

export function resolveOffer(step: FlowStep, codes: Map<string, CodeCheck>): ResolvedOffer | null {
  if (!step.promo_code) return null;
  const check = codes.get(normalizeCode(step.promo_code));
  return check?.usable && check.label ? { code: check.code, label: check.label } : null;
}

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

export interface Conversion {
  at: string;
  ref: string | null;
  amount: number | null;
  currency: string | null;
}

interface ConversionWho {
  id: string;
  customer_id: string | null;
  email: string;
  enrolled_at: string;
}

interface AccountState {
  contact_consent?: boolean;
  active?: boolean;
  has_completed_first_order?: boolean;
}

/**
 * The first paid order since each entry's trigger, by account id or email,
 * across both checkouts — read in one batch rather than per person, because
 * the cron asks this of everyone in every flow every 15 minutes.
 *
 * A read failure marks everyone 'unknown': the caller then holds their email
 * rather than send a discount to somebody who may have just bought.
 */
export async function findConversions(
  db: Db,
  entries: ConversionWho[],
  accountFlags: Map<string, AccountState>,
  opts: { useFirstOrderFlag: boolean } = { useFirstOrderFlag: true },
): Promise<Map<string, Conversion | null | 'unknown'>> {
  const out = new Map<string, Conversion | null | 'unknown'>();
  if (!entries.length) return out;
  const floor = entries.reduce((min, s) => (s.enrolled_at < min ? s.enrolled_at : min), entries[0].enrolled_at);

  const [hosted, legacy] = await Promise.all([
    db
      .from('puramass_orders')
      .select('partner_reference, customer_id, customer_email, subtotal_cents, currency, paid_at, created_at')
      .eq('status', 'paid')
      .gte('created_at', floor)
      .limit(5000),
    db
      .from('orders')
      .select('order_number, customer_id, email, total, created_at')
      .in('status', LEGACY_PAID_STATUSES)
      .gte('created_at', floor)
      .limit(5000),
  ]);
  if (hosted.error || legacy.error) {
    for (const s of entries) out.set(s.id, 'unknown');
    return out;
  }

  type Paid = Conversion & { customerId: string | null; email: string | null; created: string };
  const paid: Paid[] = [
    ...((hosted.data ?? []) as any[]).map((r) => ({
      at: r.paid_at ?? r.created_at,
      created: r.created_at,
      ref: `puramass:${r.partner_reference}`,
      amount: r.subtotal_cents != null ? Number(r.subtotal_cents) / 100 : null,
      currency: r.currency ? String(r.currency).toUpperCase() : null,
      customerId: r.customer_id ?? null,
      email: normalizeOrderEmail(r.customer_email),
    })),
    ...((legacy.data ?? []) as any[]).map((r) => ({
      at: r.created_at,
      created: r.created_at,
      ref: `order:${r.order_number}`,
      amount: Number(r.total) || null,
      currency: 'CAD',
      customerId: r.customer_id ?? null,
      email: normalizeOrderEmail(r.email),
    })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  for (const s of entries) {
    const email = normalizeOrderEmail(s.email);
    const since = Date.parse(s.enrolled_at);
    // An order counts when it was PAID after the trigger — a checkout started
    // just before the cart went quiet and paid later is a recovered cart.
    const hit = paid.find(
      (p) =>
        Math.max(Date.parse(p.created), Date.parse(p.at)) >= since &&
        ((s.customer_id && p.customerId === s.customer_id) || (email && p.email === email)),
    );
    if (hit) {
      out.set(s.id, { at: hit.at, ref: hit.ref, amount: hit.amount, currency: hit.currency });
    } else if (opts.useFirstOrderFlag && s.customer_id && accountFlags.get(s.customer_id)?.has_completed_first_order) {
      // Welcome only: enrolment takes people who had not ordered, so a set
      // legacy flag means they bought since (in a way the reads can't see).
      out.set(s.id, { at: new Date().toISOString(), ref: null, amount: null, currency: null });
    } else {
      out.set(s.id, null);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Klaviyo — the flow's tag as a profile property, for segmentation there too
// ---------------------------------------------------------------------------

async function tagInKlaviyo(db: Db, flow: FlowKey, email: string, status: EntryStatus): Promise<void> {
  try {
    const s = await readKlaviyoSettings(db);
    if (!s.enabled || !s.privateKey) return;
    await upsertKlaviyoProfile(s.privateKey, {
      email,
      properties: { [FLOWS[flow].tag]: ENTRY_STATUS_META[status].label },
    });
  } catch (err: any) {
    console.error('[email-flows] klaviyo tag failed:', err?.message ?? err);
  }
}

// ---------------------------------------------------------------------------
// Suppressions
// ---------------------------------------------------------------------------

export async function suppressedEmails(db: Db, emails: string[]): Promise<Set<string>> {
  const list = [...new Set(emails.map(lower).filter(Boolean))];
  if (!list.length) return new Set();
  const { data } = await db.from('email_flow_suppressions').select('email').in('email', list);
  return new Set((data ?? []).map((r: any) => lower(r.email)));
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export interface EntryRecord {
  id: string;
  flow: FlowKey;
  customer_id: string | null;
  email: string;
  first_name: string | null;
  timezone: string;
  status: EntryStatus;
  source: string;
  consent_basis: ConsentBasis;
  enrolled_at: string;
  cart_id: string | null;
  last_step: number;
  last_sent_at: string | null;
  paused_reason: string | null;
}

export const ENTRY_COLUMNS =
  'id, flow, customer_id, email, first_name, timezone, status, source, consent_basis, enrolled_at, cart_id, last_step, last_sent_at, paused_reason';

interface NewEntry {
  customerId: string | null;
  email: string;
  firstName: string | null;
  timezone: string;
  source: string;
  consentBasis: ConsentBasis;
  enrolledAt?: string;
  cartId?: string | null;
}

export async function createEntry(db: Db, flow: FlowKey, e: NewEntry): Promise<EntryRecord | null> {
  const { data, error } = await db
    .from('email_flow_entries')
    .insert({
      flow,
      customer_id: e.customerId,
      email: lower(e.email),
      first_name: e.firstName?.trim() || null,
      timezone: e.timezone,
      source: e.source,
      consent_basis: e.consentBasis,
      tags: [FLOWS[flow].tag],
      enrolled_at: e.enrolledAt ?? new Date().toISOString(),
      cart_id: e.cartId ?? null,
    })
    .select(ENTRY_COLUMNS)
    .single();
  if (error) {
    // 23505: already in this flow (another run got there first) — not an error.
    if (error.code !== '23505') console.error('[email-flows] enroll failed:', error.message);
    return null;
  }
  await tagInKlaviyo(db, flow, e.email, 'active');
  return data as EntryRecord;
}

async function setStatus(db: Db, entry: EntryRecord, status: EntryStatus, extra: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  await db
    .from('email_flow_entries')
    .update({ status, updated_at: now, paused_reason: null, ...(status === 'exited' ? { exited_at: now } : {}), ...extra })
    .eq('id', entry.id);
  entry.status = status;
  await tagInKlaviyo(db, entry.flow, entry.email, status);
}

async function markConverted(db: Db, entry: EntryRecord, conv: Conversion) {
  const { data: sends } = await db
    .from('email_flow_sends')
    .select('step, sent_at')
    .eq('entry_id', entry.id)
    .eq('status', 'sent');
  const before = (sends ?? [])
    .filter((s: any) => s.sent_at && Date.parse(s.sent_at) <= Date.parse(conv.at))
    .sort((a: any, b: any) => Date.parse(b.sent_at) - Date.parse(a.sent_at));
  await setStatus(db, entry, 'converted', {
    converted_at: conv.at,
    converted_order_ref: conv.ref,
    converted_amount: conv.amount,
    converted_currency: conv.currency,
    attributed_step: before[0]?.step ?? null,
  });
  if (entry.cart_id) await db.from('saved_carts').update({ status: 'purchased' }).eq('id', entry.cart_id);
}

/**
 * Unsubscribe: this entry and every other live entry for the address stop,
 * the address is suppressed for every flow (guests have no account to mark),
 * and marketing consent is withdrawn on the account.
 */
export async function unsubscribe(db: Db, entryId: string): Promise<boolean> {
  const { data: row } = await db.from('email_flow_entries').select(ENTRY_COLUMNS).eq('id', entryId).maybeSingle();
  if (!row) return false;
  const entry = row as EntryRecord;
  const email = lower(entry.email);
  const now = new Date().toISOString();

  await db
    .from('email_flow_suppressions')
    .upsert({ email, reason: 'unsubscribed', source_flow: entry.flow }, { onConflict: 'email', ignoreDuplicates: true });

  // Entries store the address lower-cased (createEntry), so an exact match finds them all.
  const { data: live } = await db.from('email_flow_entries').select(ENTRY_COLUMNS).eq('status', 'active').eq('email', email);
  const targets = [entry, ...((live ?? []) as EntryRecord[]).filter((e) => e.id !== entry.id)];
  for (const e of targets) {
    // A finished entry keeps its outcome (a purchase stays a purchase); the
    // suppression above is what stops anything further.
    if (e.status !== 'active') continue;
    await setStatus(db, e, 'unsubscribed', { unsubscribed_at: now, exit_reason: 'Clicked unsubscribe' });
  }

  if (entry.customer_id) await db.from('customers').update({ contact_consent: false }).eq('id', entry.customer_id);
  await db.from('customers').update({ contact_consent: false }).ilike('email', email.replace(/[\\%_]/g, (c) => `\\${c}`));
  return true;
}

// ---------------------------------------------------------------------------
// Welcome enrolment
// ---------------------------------------------------------------------------

interface CustomerLite {
  id: string;
  email: string;
  first_name: string | null;
  shipping_state: string | null;
  shipping_country: string | null;
}

export async function enrollWelcome(
  db: Db,
  c: CustomerLite,
  settings: FlowSettings,
  source: 'signup' | 'manual' = 'signup',
): Promise<EntryRecord | null> {
  if ((await suppressedEmails(db, [c.email])).size) return null;
  return createEntry(db, 'welcome', {
    customerId: c.id,
    email: c.email,
    firstName: c.first_name,
    timezone: timezoneFor(c.shipping_state, c.shipping_country, settings.default_timezone),
    source,
    consentBasis: source === 'manual' ? 'manual' : 'express',
  });
}

/** Consenting customer accounts created since the flow was switched on, not yet enrolled. */
async function enrollNewSignups(db: Db, settings: FlowSettings, now: Date): Promise<number> {
  if (!settings.enabled_at) return 0;
  const floor = new Date(Math.max(Date.parse(settings.enabled_at), now.getTime() - WELCOME_LOOKBACK_DAYS * 864e5)).toISOString();

  const { data: candidates, error } = await db
    .from('customers')
    .select('id, email, first_name, shipping_state, shipping_country')
    .eq('role', 'customer')
    .eq('active', true)
    .eq('contact_consent', true)
    .gte('created_at', floor)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error || !candidates?.length) return 0;

  const ids = candidates.map((c: any) => c.id);
  const { data: existing } = await db.from('email_flow_entries').select('customer_id').eq('flow', 'welcome').in('customer_id', ids);
  const enrolled = new Set((existing ?? []).map((r: any) => r.customer_id));

  let n = 0;
  for (const c of candidates as CustomerLite[]) {
    if (enrolled.has(c.id)) continue;
    // Someone who bought before the cron reached them is not a "new subscriber".
    if ((await firstOrderStatus(db, { customerId: c.id, email: c.email })) !== 'first') continue;
    if (await enrollWelcome(db, c, settings)) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Cart enrolment
// ---------------------------------------------------------------------------

interface CartCandidate {
  email: string;
  customerId: string | null;
  firstName: string | null;
  state: string | null;
  country: string | null;
  /** When the cart last changed (or the checkout was started). */
  abandonedAt: string;
  cartId: string;
  source: 'cart' | 'checkout';
}

/** How long a cart must sit unchanged to count as abandoned: the first live email's delay. */
export function abandonAfterHours(config: FlowConfig): number {
  const first = STEP_NUMBERS.map((n) => config.steps[n]).find((s) => s.enabled);
  return Math.max(MIN_ABANDON_MINUTES / 60, first?.delay_hours ?? 1);
}

/**
 * A saved cart for an unpaid checkout, so its emails can show the items and
 * restore them like any other cart. Keyed on the checkout reference, so a
 * re-run finds the same row.
 */
async function cartForCheckout(db: Db, row: any): Promise<string | null> {
  const lines = linesFromCheckout(row.items);
  if (!lines.length) return null;
  const { data: existing } = await db.from('saved_carts').select('id').eq('checkout_ref', row.partner_reference).maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await db
    .from('saved_carts')
    .insert({
      checkout_ref: row.partner_reference,
      customer_id: row.customer_id ?? null,
      email: lower(row.customer_email),
      items: lines,
      item_count: itemCount(lines),
      status: 'open',
      updated_at: row.created_at,
    })
    .select('id')
    .single();
  if (error) {
    // Two runs at once: the other one made it.
    const { data: again } = await db.from('saved_carts').select('id').eq('checkout_ref', row.partner_reference).maybeSingle();
    return again?.id ?? null;
  }
  return data.id;
}

async function cartCandidates(db: Db, config: FlowConfig, now: Date): Promise<CartCandidate[]> {
  const settings = config.settings;
  if (!settings.enabled_at) return [];
  const idleBefore = new Date(now.getTime() - abandonAfterHours(config) * 3600e3).toISOString();
  const floor = new Date(Math.max(Date.parse(settings.enabled_at), now.getTime() - ENROLL_LOOKBACK_DAYS * 864e5)).toISOString();
  const out: CartCandidate[] = [];

  // A. Unpaid hosted checkouts — the strongest signal: they reached payment.
  //    A cart an admin already chased by hand from the Abandoned tab is left
  //    to that conversation.
  // The name and manual-chase columns arrive with later migrations; without
  // them the read falls back to the base columns rather than failing.
  const checkoutsWith = (cols: string) =>
    db
      .from('puramass_orders')
      .select(cols)
      .in('status', ABANDONED_CHECKOUT_STATUSES)
      .lte('created_at', idleBefore)
      .gte('created_at', floor)
      .not('customer_email', 'is', null)
      .limit(300);
  const baseCols = 'partner_reference, customer_id, customer_email, items, created_at';
  let res: { data: unknown; error: unknown } = await checkoutsWith(`${baseCols}, customer_name, recovery_email_sent_at`);
  if (res.error && isMissingColumnError(res.error)) res = await checkoutsWith(baseCols);
  const checkouts = res.error ? [] : ((res.data ?? []) as any[]);
  for (const row of checkouts) {
    if (row.recovery_email_sent_at) continue;
    const cartId = await cartForCheckout(db, row);
    if (!cartId) continue;
    out.push({
      email: lower(row.customer_email),
      customerId: row.customer_id ?? null,
      firstName: row.customer_name ? String(row.customer_name).trim().split(/\s+/)[0] : null,
      state: null,
      country: null,
      abandonedAt: row.created_at,
      cartId,
      source: 'checkout',
    });
  }

  // B. Saved storefront carts that have gone quiet.
  const { data: carts } = await db
    .from('saved_carts')
    .select('id, customer_id, anonymous_id, email, updated_at')
    .eq('status', 'open')
    .gt('item_count', 0)
    .is('checkout_ref', null)
    .lte('updated_at', idleBefore)
    .gte('updated_at', floor)
    .limit(300);
  const anonIds = [...new Set((carts ?? []).filter((c: any) => !c.customer_id && !c.email && c.anonymous_id).map((c: any) => c.anonymous_id))];
  const visitors = new Map<string, { customer_email: string | null; customer_id: string | null }>();
  if (anonIds.length) {
    const { data } = await db.from('visitor_attribution').select('anonymous_id, customer_email, customer_id').in('anonymous_id', anonIds);
    for (const v of (data ?? []) as any[]) visitors.set(v.anonymous_id, v);
  }
  for (const c of (carts ?? []) as any[]) {
    const v = c.anonymous_id ? visitors.get(c.anonymous_id) : undefined;
    const customerId = c.customer_id ?? v?.customer_id ?? null;
    const email = lower(c.email ?? v?.customer_email ?? '');
    out.push({ email, customerId, firstName: null, state: null, country: null, abandonedAt: c.updated_at, cartId: c.id, source: 'cart' });
  }

  // Fill in the account behind each candidate: email, name, address.
  const ids = [...new Set(out.map((c) => c.customerId).filter(Boolean))] as string[];
  if (ids.length) {
    const { data } = await db.from('customers').select('id, email, first_name, shipping_state, shipping_country').in('id', ids);
    const byId = new Map((data ?? []).map((r: any) => [r.id, r]));
    for (const c of out) {
      const r: any = c.customerId ? byId.get(c.customerId) : null;
      if (!r) continue;
      c.email = c.email || lower(r.email);
      c.firstName = c.firstName || r.first_name || null;
      c.state = r.shipping_state ?? null;
      c.country = r.shipping_country ?? null;
    }
  }
  return out.filter((c) => normalizeOrderEmail(c.email));
}

/**
 * Who may get the cart series: anyone who ticked the marketing box, plus
 * anyone who started a checkout in the last 6 months (CASL implied consent —
 * an inquiry). Returns the basis per email, or nothing when neither holds.
 */
async function consentFor(db: Db, emails: string[], now: Date): Promise<Map<string, ConsentBasis>> {
  const list = [...new Set(emails.map(lower))];
  const out = new Map<string, ConsentBasis>();
  if (!list.length) return out;
  const since = new Date(now.getTime() - IMPLIED_CONSENT_DAYS * 864e5).toISOString();
  const [{ data: express }, { data: inquiries }] = await Promise.all([
    db.from('customers').select('email, contact_consent, active').in('email', list),
    db.from('puramass_orders').select('customer_email').in('customer_email', list).gte('created_at', since).limit(5000),
  ]);
  for (const r of (inquiries ?? []) as any[]) out.set(lower(r.customer_email), 'implied');
  for (const r of (express ?? []) as any[]) {
    if (r.active === false) out.delete(lower(r.email));
    else if (r.contact_consent) out.set(lower(r.email), 'express');
  }
  return out;
}

async function enrollAbandonedCarts(db: Db, config: FlowConfig, now: Date): Promise<number> {
  const candidates = await cartCandidates(db, config, now);
  if (!candidates.length) return 0;

  // One candidate per person: the most recent abandonment, a checkout winning a tie.
  const byEmail = new Map<string, CartCandidate>();
  for (const c of candidates) {
    const prev = byEmail.get(c.email);
    if (!prev || Date.parse(c.abandonedAt) > Date.parse(prev.abandonedAt) || (c.source === 'checkout' && prev.source !== 'checkout')) {
      byEmail.set(c.email, c);
    }
  }
  const emails = [...byEmail.keys()];
  const reentryFloor = new Date(now.getTime() - config.settings.reentry_days * 864e5).toISOString();

  const [suppressed, consent, { data: recent }] = await Promise.all([
    suppressedEmails(db, emails),
    consentFor(db, emails, now),
    db.from('email_flow_entries').select('email, enrolled_at, status').eq('flow', 'cart').in('email', emails),
  ]);
  // Re-entry: a live entry blocks; so does one that began inside the window.
  const blocked = new Set(
    ((recent ?? []) as any[])
      .filter((r) => r.status === 'active' || r.enrolled_at >= reentryFloor)
      .map((r) => lower(r.email)),
  );

  const eligible = [...byEmail.values()].filter((c) => !suppressed.has(c.email) && !blocked.has(c.email) && consent.has(c.email));
  if (!eligible.length) return 0;

  // Somebody who bought since leaving the cart is not abandoned.
  const conversions = await findConversions(
    db,
    eligible.map((c) => ({ id: c.cartId, customer_id: c.customerId, email: c.email, enrolled_at: c.abandonedAt })),
    new Map(),
    { useFirstOrderFlag: false },
  );

  let n = 0;
  for (const c of eligible) {
    const conv = conversions.get(c.cartId);
    if (conv === 'unknown') continue;
    if (conv) {
      await db.from('saved_carts').update({ status: 'purchased' }).eq('id', c.cartId);
      continue;
    }
    const entry = await createEntry(db, 'cart', {
      customerId: c.customerId,
      email: c.email,
      firstName: c.firstName,
      timezone: timezoneFor(c.state, c.country, config.settings.default_timezone),
      source: c.source,
      consentBasis: consent.get(c.email)!,
      enrolledAt: c.abandonedAt,
      cartId: c.cartId,
    });
    if (entry) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

interface RunContext {
  db: Db;
  config: FlowConfig;
  codes: Map<string, CodeCheck>;
  now: Date;
  budget: { sends: number };
  result: RunResult;
  /** Lower-cased email → when ANY flow last emailed them. */
  lastContact: Map<string, string>;
  /** Welcome: people currently in an active cart flow. */
  inCartFlow: Set<string>;
  suppressed: Set<string>;
}

export interface RunResult {
  flow?: FlowKey;
  skipped?: string;
  enrolled: number;
  checked: number;
  sent: number;
  failed: number;
  converted: number;
  completed: number;
  exited: number;
  paused: number;
  /** Step → entries waiting on an unusable code. */
  heldForCode: Partial<Record<StepNumber, number>>;
}

const emptyResult = (flow?: FlowKey): RunResult => ({
  flow, enrolled: 0, checked: 0, sent: 0, failed: 0, converted: 0, completed: 0, exited: 0, paused: 0, heldForCode: {},
});

async function claimSend(db: Db, entry: EntryRecord, step: StepNumber, existing?: SendRecord & { id?: string }): Promise<string | null> {
  if (existing?.id) {
    const { data } = await db
      .from('email_flow_sends')
      .update({ status: 'sending', attempts: existing.attempts + 1, error: null, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .eq('status', 'failed')
      .eq('attempts', existing.attempts)
      .select('id');
    return data?.[0]?.id ?? null;
  }
  const { data, error } = await db
    .from('email_flow_sends')
    .insert({ entry_id: entry.id, flow: entry.flow, step, status: 'sending', attempts: 1, to_email: entry.email })
    .select('id')
    .single();
  if (error) return null;
  return data.id;
}

async function recordSkip(db: Db, entry: EntryRecord, step: StepNumber, reason: string) {
  await db
    .from('email_flow_sends')
    .upsert(
      { entry_id: entry.id, flow: entry.flow, step, status: 'skipped', attempts: 0, to_email: entry.email, error: reason },
      { onConflict: 'entry_id,step', ignoreDuplicates: true },
    );
  await db.from('email_flow_entries').update({ last_step: step, updated_at: new Date().toISOString() }).eq('id', entry.id).lt('last_step', step);
}

interface SavedCartRow {
  id: string;
  restore_token: string;
  items: unknown;
  item_count: number;
  status: string;
  updated_at: string;
}

async function loadCart(db: Db, cartId: string | null): Promise<SavedCartRow | null> {
  if (!cartId) return null;
  const { data } = await db.from('saved_carts').select('id, restore_token, items, item_count, status, updated_at').eq('id', cartId).maybeSingle();
  return (data as SavedCartRow) ?? null;
}

export async function cartProducts(db: Db, lines: SavedCartLine[]): Promise<CartProductRow[]> {
  const ids = [...new Set(lines.map((l) => l.productId))];
  if (!ids.length) return [];
  const { data } = await db.from('products').select(CART_PRODUCT_COLUMNS).in('id', ids);
  return (data ?? []) as CartProductRow[];
}

/** The cart as an email shows it, plus its restore links. */
export async function renderCartFor(db: Db, cart: SavedCartRow | null, code: string | null): Promise<RenderCart | null> {
  if (!cart) return null;
  const lines = sanitizeCartLines(cart.items);
  const products = await cartProducts(db, lines);
  return { lines: cartLineViews(lines, products), ...restoreUrls(SITE_URL, cart.restore_token, code) };
}

async function deliver(rc: RunContext, entry: EntryRecord, stepNo: StepNumber, sendId: string, cart: SavedCartRow | null): Promise<boolean> {
  const { db, config, now } = rc;
  const step = config.steps[stepNo];
  const offer = resolveOffer(step, rc.codes);
  const offerEndsAt = step.deadline_hours ? new Date(now.getTime() + step.deadline_hours * 3600 * 1000) : null;
  const unsub = unsubscribeUrl(SITE_URL, entry.id);

  const email = renderFlowEmail(step, {
    firstName: entry.first_name,
    offer,
    offerEndsAt,
    now,
    timezone: entry.timezone,
    settings: config.settings,
    siteUrl: SITE_URL,
    cart: entry.flow === 'cart' ? await renderCartFor(db, cart, offer?.code ?? null) : null,
    trackLink: (url) => clickUrl(SITE_URL, sendId, url),
    openPixelUrl: openPixelUrl(SITE_URL, sendId),
    viewUrl: viewUrl(SITE_URL, sendId),
    unsubscribeUrl: unsub,
  });

  const res = await sendMail({
    to: entry.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
    headers: {
      'List-Unsubscribe': `<${unsub}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });

  const stamp = new Date().toISOString();
  await db
    .from('email_flow_sends')
    .update({
      status: res.success ? 'sent' : 'failed',
      subject: email.subject,
      promo_code: offer?.code ?? null,
      offer_ends_at: offerEndsAt?.toISOString() ?? null,
      message_id: res.id ?? null,
      error: res.success ? null : (res.error ?? 'Send failed').slice(0, 500),
      body_html: res.success ? email.html : null,
      sent_at: res.success ? stamp : null,
      updated_at: stamp,
    })
    .eq('id', sendId);

  if (res.success) {
    await db.from('email_flow_entries').update({ last_step: stepNo, last_sent_at: stamp, updated_at: stamp }).eq('id', entry.id);
    entry.last_step = stepNo;
    entry.last_sent_at = stamp;
    rc.lastContact.set(lower(entry.email), stamp);
  }

  // The customer desk's email history and "Nudged" column read this log.
  const { error: logErr } = await db.from('customer_emails').insert({
    customer_id: entry.customer_id,
    to_email: entry.email,
    subject: email.subject,
    body_html: email.html,
    template: `${entry.flow}_${stepNo}`,
    promo_code: offer?.code ?? null,
    promo_details: offer ? `${offer.label} off` : null,
    promo_expires: offerEndsAt?.toISOString() ?? null,
    sent_by_name: `${FLOWS[entry.flow].label} (automatic)`,
    success: res.success,
    error: res.success ? null : res.error ?? null,
    message_id: res.id ?? null,
  });
  if (logErr && !isMissingColumnError(logErr)) console.error('[email-flows] outreach log failed:', logErr.message);

  return res.success;
}

/** One entry, one pass: stop it, finish it, hold it, or send what is due. */
async function processEntry(rc: RunContext, entry: EntryRecord, account: AccountState | null, conv: Conversion | null | 'unknown') {
  const { db, config, now } = rc;
  rc.result.checked++;
  const email = lower(entry.email);

  // 1. Purchased → stop.
  if (conv === 'unknown') return; // can't tell — hold rather than offer a discount to a buyer
  if (conv) {
    await markConverted(db, entry, conv);
    rc.result.converted++;
    return;
  }
  if (entry.status === 'completed') return; // only here for the attribution window

  // 2. Unsubscribed (from any flow) → stop.
  if (rc.suppressed.has(email)) {
    await setStatus(db, entry, 'unsubscribed', { exit_reason: 'Unsubscribed', unsubscribed_at: new Date().toISOString() });
    rc.result.exited++;
    return;
  }

  // 3. Account off, or the consent they enrolled on withdrawn → stop. An
  //    implied (checkout) or admin-attested basis does not rest on the box.
  if (account && account.active === false) {
    await setStatus(db, entry, 'exited', { exit_reason: 'Account deactivated' });
    rc.result.exited++;
    return;
  }
  if (account && entry.consent_basis === 'express' && account.contact_consent === false) {
    await setStatus(db, entry, 'exited', { exit_reason: 'Marketing consent withdrawn' });
    rc.result.exited++;
    return;
  }

  // 4. Flow-specific holds.
  let cart: SavedCartRow | null = null;
  if (entry.flow === 'welcome') {
    if (rc.inCartFlow.has(email)) {
      if (!entry.paused_reason) {
        await db.from('email_flow_entries').update({ paused_reason: 'In the cart abandonment flow', updated_at: new Date().toISOString() }).eq('id', entry.id);
      }
      rc.result.paused++;
      return;
    }
    if (entry.paused_reason) {
      await db.from('email_flow_entries').update({ paused_reason: null, updated_at: new Date().toISOString() }).eq('id', entry.id);
      entry.paused_reason = null;
    }
  } else {
    cart = await loadCart(db, entry.cart_id);
    if (!cart || cart.status === 'emptied' || cart.item_count <= 0) {
      await setStatus(db, entry, 'exited', { exit_reason: 'Cart emptied' });
      rc.result.exited++;
      return;
    }
    if (cart.status === 'purchased') {
      await setStatus(db, entry, 'converted', { converted_at: new Date().toISOString(), exit_reason: null });
      rc.result.converted++;
      return;
    }
    // They came back and changed the cart before the first email: the cart
    // isn't abandoned yet, so the clock restarts from their last change.
    // (An admin's manual add is backdated on purpose, so it is left alone.)
    if (entry.last_step === 0 && entry.source !== 'manual' && Date.parse(cart.updated_at) > Date.parse(entry.enrolled_at)) {
      await db.from('email_flow_entries').update({ enrolled_at: cart.updated_at, updated_at: new Date().toISOString() }).eq('id', entry.id);
      entry.enrolled_at = cart.updated_at;
    }
  }

  // 5. What's next?
  const { data: sendRows } = await db.from('email_flow_sends').select('id, step, status, attempts').eq('entry_id', entry.id);
  const sends = (sendRows ?? []) as (SendRecord & { id: string })[];

  let step = nextStep(sends);
  while (step && !config.steps[step].enabled) {
    await recordSkip(db, entry, step, 'Email switched off');
    sends.push({ id: '', step, status: 'skipped', attempts: 0 });
    step = nextStep(sends);
  }
  if (!step) {
    await setStatus(db, entry, 'completed');
    rc.result.completed++;
    return;
  }

  // The gap counts from the last email of ANY flow, so a cart reminder and a
  // welcome email never land on the same morning.
  const lastAny = rc.lastContact.get(email);
  const lastSent = [entry.last_sent_at, lastAny].filter(Boolean).map((t) => Date.parse(t!)).sort((a, b) => b - a)[0];
  const decision = decide(
    {
      step,
      delayHours: config.steps[step].delay_hours,
      enrolledAt: new Date(entry.enrolled_at),
      lastSentAt: lastSent ? new Date(lastSent) : null,
      timezone: entry.timezone,
      windowStart: config.settings.send_window_start,
      windowEnd: config.settings.send_window_end,
      minGapHours: config.settings.min_gap_hours,
    },
    now,
  );
  if (!decision.send) return;

  // An offer email waits until an admin has chosen its code, and any step
  // with a code waits while that code is unusable — rather than going out
  // saying "Use code X" for a code checkout will refuse, or with no offer.
  const code = config.steps[step].promo_code;
  const noCode = !code && requiresCode(config.flow, step);
  if (noCode || (code && !rc.codes.get(normalizeCode(code))?.usable)) {
    rc.result.heldForCode[step] = (rc.result.heldForCode[step] ?? 0) + 1;
    return;
  }

  if (rc.budget.sends <= 0) return;
  const existing = sends.find((s) => s.step === step);
  const sendId = await claimSend(db, entry, step, existing);
  if (!sendId) return;
  rc.budget.sends--;

  const ok = await deliver(rc, entry, step, sendId, cart);
  if (ok) rc.result.sent++;
  else rc.result.failed++;
}

async function customersById(db: Db, ids: string[]) {
  const map = new Map<string, AccountState>();
  if (!ids.length) return map;
  const { data } = await db.from('customers').select('id, contact_consent, active, has_completed_first_order').in('id', ids);
  for (const c of (data ?? []) as any[]) map.set(c.id, c);
  return map;
}

/** Lower-cased email → the latest email any flow sent them. */
async function lastContactFor(db: Db, emails: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const list = [...new Set(emails.map(lower))];
  if (!list.length) return map;
  const { data } = await db.from('email_flow_entries').select('email, last_sent_at').in('email', list).not('last_sent_at', 'is', null);
  for (const r of (data ?? []) as any[]) {
    const k = lower(r.email);
    if (!map.has(k) || r.last_sent_at > map.get(k)!) map.set(k, r.last_sent_at);
  }
  return map;
}

async function activeCartEmails(db: Db): Promise<Set<string>> {
  const { data } = await db.from('email_flow_entries').select('email').eq('flow', 'cart').eq('status', 'active').limit(5000);
  return new Set((data ?? []).map((r: any) => lower(r.email)));
}

async function buildContext(db: Db, config: FlowConfig, now: Date, entries: EntryRecord[], budget: { sends: number }): Promise<RunContext> {
  const emails = entries.map((e) => e.email);
  const [codes, lastContact, inCartFlow, suppressed] = await Promise.all([
    checkCodes(db, STEP_NUMBERS.map((n) => config.steps[n].promo_code), now),
    lastContactFor(db, emails),
    config.flow === 'welcome' ? activeCartEmails(db) : Promise.resolve(new Set<string>()),
    suppressedEmails(db, emails),
  ]);
  return { db, config, codes, now, budget, result: emptyResult(config.flow), lastContact, inCartFlow, suppressed };
}

async function processEntries(db: Db, config: FlowConfig, now: Date, entries: EntryRecord[], budget: { sends: number }, result?: RunResult) {
  const rc = await buildContext(db, config, now, entries, budget);
  if (result) rc.result = result;
  const accounts = await customersById(db, entries.map((s) => s.customer_id).filter(Boolean) as string[]);
  const conversions = await findConversions(db, entries, accounts, { useFirstOrderFlag: config.flow === 'welcome' });
  for (const entry of entries) {
    try {
      const account = entry.customer_id ? accounts.get(entry.customer_id) ?? null : null;
      await processEntry(rc, entry, account, conversions.get(entry.id) ?? 'unknown');
    } catch (err: any) {
      console.error('[email-flows] entry failed:', entry.id, err?.message ?? err);
    }
  }
  return rc.result;
}

/** One flow: enroll, then walk everyone in it. */
export async function runFlow(db: Db, flow: FlowKey, now = new Date(), budget = { sends: MAX_SENDS_PER_RUN }): Promise<RunResult> {
  const loaded = await loadConfig(db, flow);
  if (!loaded.ok) return { ...emptyResult(flow), skipped: loaded.migrationNeeded ? 'migration-needed' : loaded.error };
  const { config } = loaded;
  if (!config.settings.enabled) return { ...emptyResult(flow), skipped: 'disabled' };

  const result = emptyResult(flow);
  result.enrolled = flow === 'welcome'
    ? await enrollNewSignups(db, config.settings, now)
    : await enrollAbandonedCarts(db, config, now);

  const attributionFloor = new Date(now.getTime() - ATTRIBUTION_DAYS * 864e5).toISOString();
  const [{ data: active }, { data: recent }] = await Promise.all([
    db.from('email_flow_entries').select(ENTRY_COLUMNS).eq('flow', flow).eq('status', 'active').order('enrolled_at', { ascending: true }).limit(500),
    db.from('email_flow_entries').select(ENTRY_COLUMNS).eq('flow', flow).eq('status', 'completed').gte('last_sent_at', attributionFloor).limit(500),
  ]);
  const entries = [...((active ?? []) as EntryRecord[]), ...((recent ?? []) as EntryRecord[])];
  return processEntries(db, config, now, entries, budget, result);
}

/**
 * The cron: every flow. Cart first, so an abandonment enrolled this run
 * already holds that person's welcome email.
 */
export async function runAllFlows(db: Db, now = new Date()): Promise<RunResult[]> {
  const budget = { sends: MAX_SENDS_PER_RUN };
  const order: FlowKey[] = ['cart', ...FLOW_KEYS.filter((f) => f !== 'cart')];
  const results: RunResult[] = [];
  for (const flow of order) results.push(await runFlow(db, flow, now, budget));
  return results;
}

/** Process one entry now — Email 1 straight after signup, or an admin add. */
export async function processOne(db: Db, entryId: string, now = new Date()): Promise<RunResult> {
  const { data: row } = await db.from('email_flow_entries').select(ENTRY_COLUMNS).eq('id', entryId).maybeSingle();
  if (!row) return { ...emptyResult(), skipped: 'not-found' };
  const entry = row as EntryRecord;
  if (entry.status !== 'active') return { ...emptyResult(entry.flow), skipped: `status-${entry.status}` };
  const loaded = await loadConfig(db, entry.flow);
  if (!loaded.ok) return { ...emptyResult(entry.flow), skipped: loaded.migrationNeeded ? 'migration-needed' : loaded.error };
  if (!loaded.config.settings.enabled) return { ...emptyResult(entry.flow), skipped: 'disabled' };
  return processEntries(db, loaded.config, now, [entry], { sends: 1 });
}

/**
 * Called from the signup route. Enrolls a consenting new customer in the
 * welcome flow and sends Email 1 right away. Never throws.
 */
export async function enrollAndWelcome(db: Db, customerId: string): Promise<void> {
  try {
    const loaded = await loadConfig(db, 'welcome');
    if (!loaded.ok || !loaded.config.settings.enabled) return;
    const { data: c } = await db
      .from('customers')
      .select('id, email, first_name, shipping_state, shipping_country, role, active, contact_consent')
      .eq('id', customerId)
      .maybeSingle();
    if (!c || c.role !== 'customer' || c.active === false || !c.contact_consent) return;
    const entry = await enrollWelcome(db, c as CustomerLite, loaded.config.settings);
    if (entry) await processOne(db, entry.id);
  } catch (err: any) {
    console.error('[email-flows] enrollAndWelcome failed:', err?.message ?? err);
  }
}

/**
 * Admin: put someone's current cart into the cart flow now — for testing the
 * series on yourself. Uses their most recent open saved cart, and backdates
 * the trigger by step 1's delay so Email 1 is due straight away.
 */
export async function enrollCartManually(
  db: Db,
  customer: CustomerLite,
  config: FlowConfig,
): Promise<{ entry: EntryRecord | null; error?: string }> {
  const { data: cart } = await db
    .from('saved_carts')
    .select('id, item_count')
    .eq('customer_id', customer.id)
    .eq('status', 'open')
    .gt('item_count', 0)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!cart) return { entry: null, error: 'They have no saved cart. Sign in as them, add something to the cart, and try again.' };
  if ((await suppressedEmails(db, [customer.email])).size) return { entry: null, error: 'That address has unsubscribed.' };
  const enrolledAt = new Date(Date.now() - abandonAfterHours(config) * 3600e3).toISOString();
  const entry = await createEntry(db, 'cart', {
    customerId: customer.id,
    email: customer.email,
    firstName: customer.first_name,
    timezone: timezoneFor(customer.shipping_state, customer.shipping_country, config.settings.default_timezone),
    source: 'manual',
    consentBasis: 'manual',
    enrolledAt,
    cartId: cart.id,
  });
  return entry ? { entry } : { entry: null, error: 'Already in the cart flow.' };
}
