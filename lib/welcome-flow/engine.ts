/**
 * Welcome flow — the engine. Server-only.
 *
 * Two ways in:
 *   - `enrollAndWelcome` runs from the signup route, so Email 1 lands seconds
 *     after a consenting account is created.
 *   - `runWelcomeFlow` runs from the cron (every 15 minutes): it enrolls any
 *     consenting signup the first path missed, then walks every active
 *     subscriber and sends whatever is due.
 *
 * Per subscriber, every run, in this order:
 *   1. Purchased since enrolling?            → stop: 'converted'.
 *   2. Consent withdrawn / account disabled? → stop: 'exited'.
 *   3. Next email due, inside their window, and its code usable? → send it.
 *   4. Nothing left to send?                 → 'completed'.
 *
 * Sends are at-most-once: a `welcome_flow_sends` row is claimed (UNIQUE on
 * subscriber + step) BEFORE the SMTP call, so two overlapping runs can never
 * both send the same email. A rejected send is retried by later runs, up to
 * MAX_SEND_ATTEMPTS.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { SITE_URL } from '@/lib/config';
import { sendMail } from '@/lib/smtp';
import { firstOrderStatus, normalizeOrderEmail } from '@/lib/promos/first-order';
import { readKlaviyoSettings, upsertKlaviyoProfile } from '@/lib/klaviyo/client';
import { isMissingColumnError } from '@/lib/payments/puramass-columns';
import {
  DEFAULT_STEPS,
  MAX_SEND_ATTEMPTS,
  STEP_NUMBERS,
  SUBSCRIBER_STATUS_META,
  WELCOME_FLOW_TAG,
  defaultStep,
  normalizeCode,
  shapeSettingsRow,
  shapeStepRow,
  type CodeCheck,
  type StepNumber,
  type SubscriberStatus,
  type WelcomeFlowSettings,
  type WelcomeFlowStep,
} from './types';
import { decide, nextStep, timezoneFor, type SendRecord } from './schedule';
import { renderWelcomeEmail, type ResolvedOffer } from './render';
import { clickUrl, openPixelUrl, unsubscribeUrl } from './tokens';

type Db = SupabaseClient<any, any, any>;

/** Signups older than this are never auto-enrolled, whatever `enabled_at` says. */
const ENROLL_LOOKBACK_DAYS = 14;
/** A purchase this long after the last email still counts as the flow's. */
const ATTRIBUTION_DAYS = 14;
/** Per run — keeps one cron call well inside a serverless time limit. */
const MAX_SENDS_PER_RUN = 40;
const LEGACY_PAID_STATUSES = ['confirmed', 'paid', 'processing', 'shipped', 'delivered', 'completed'];

export const MIGRATION_FILE = 'welcome-flow-migration.sql';

/** 42P01 / PGRST205: the table is not there — the migration has not run. */
export function isMissingTable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  if (e.code === '42P01' || e.code === 'PGRST205') return true;
  return /welcome_flow_\w+/.test(e.message ?? '') && /(does not exist|could not find)/i.test(e.message ?? '');
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface FlowConfig {
  settings: WelcomeFlowSettings;
  steps: Record<StepNumber, WelcomeFlowStep>;
}

export type ConfigResult = { ok: true; config: FlowConfig } | { ok: false; migrationNeeded: boolean; error: string };

/** Settings and the five steps. Seeds any missing step from the defaults. */
export async function loadConfig(db: Db): Promise<ConfigResult> {
  const [{ data: settingsRow, error: sErr }, { data: stepRows, error: stErr }] = await Promise.all([
    db.from('welcome_flow_settings').select('*').eq('id', 1).maybeSingle(),
    db.from('welcome_flow_steps').select('*'),
  ]);
  const err = sErr ?? stErr;
  if (err) return { ok: false, migrationNeeded: isMissingTable(err), error: err.message };

  const have = new Set((stepRows ?? []).map((r: any) => Number(r.step)));
  const missing = DEFAULT_STEPS.filter((s) => !have.has(s.step));
  if (missing.length) {
    await db.from('welcome_flow_steps').upsert(missing, { onConflict: 'step', ignoreDuplicates: true });
  }
  if (!settingsRow) {
    await db.from('welcome_flow_settings').upsert({ id: 1 }, { onConflict: 'id', ignoreDuplicates: true });
  }

  const steps = {} as Record<StepNumber, WelcomeFlowStep>;
  for (const n of STEP_NUMBERS) {
    const row = (stepRows ?? []).find((r: any) => Number(r.step) === n);
    steps[n] = row ? shapeStepRow({ ...row, step: n }) : defaultStep(n);
  }
  return { ok: true, config: { settings: shapeSettingsRow(settingsRow as any), steps } };
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

/**
 * The first paid order since each subscriber enrolled, by account id or email,
 * across both checkouts — read in one batch rather than per person, because the
 * cron asks this of everyone in the flow every 15 minutes.
 *
 * A read failure marks everyone 'unknown': the caller then holds their email
 * rather than send a discount to somebody who may have just bought.
 *
 * `has_completed_first_order` on the account catches a legacy order the reads
 * can't see. Enrolment only takes people who had not ordered, so a set flag
 * means they bought since.
 */
export async function findConversions(
  db: Db,
  subs: ConversionWho[],
  accountFlags: Map<string, { has_completed_first_order?: boolean }>,
): Promise<Map<string, Conversion | null | 'unknown'>> {
  const out = new Map<string, Conversion | null | 'unknown'>();
  if (!subs.length) return out;
  const floor = subs.reduce((min, s) => (s.enrolled_at < min ? s.enrolled_at : min), subs[0].enrolled_at);

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
    for (const s of subs) out.set(s.id, 'unknown');
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

  for (const s of subs) {
    const email = normalizeOrderEmail(s.email);
    const since = Date.parse(s.enrolled_at);
    const hit = paid.find(
      (p) =>
        Date.parse(p.created) >= since &&
        ((s.customer_id && p.customerId === s.customer_id) || (email && p.email === email)),
    );
    if (hit) {
      out.set(s.id, { at: hit.at, ref: hit.ref, amount: hit.amount, currency: hit.currency });
    } else if (s.customer_id && accountFlags.get(s.customer_id)?.has_completed_first_order) {
      out.set(s.id, { at: new Date().toISOString(), ref: null, amount: null, currency: null });
    } else {
      out.set(s.id, null);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Klaviyo — the "Welcome Flow" tag, for segmentation there too
// ---------------------------------------------------------------------------

async function tagInKlaviyo(db: Db, email: string, status: SubscriberStatus): Promise<void> {
  try {
    const s = await readKlaviyoSettings(db);
    if (!s.enabled || !s.privateKey) return;
    await upsertKlaviyoProfile(s.privateKey, {
      email,
      properties: { [WELCOME_FLOW_TAG]: SUBSCRIBER_STATUS_META[status].label },
    });
  } catch (err: any) {
    console.error('[welcome-flow] klaviyo tag failed:', err?.message ?? err);
  }
}

// ---------------------------------------------------------------------------
// Enrolment
// ---------------------------------------------------------------------------

interface CustomerLite {
  id: string;
  email: string;
  first_name: string | null;
  shipping_state: string | null;
  shipping_country: string | null;
}

export interface SubscriberRecord {
  id: string;
  customer_id: string | null;
  email: string;
  first_name: string | null;
  timezone: string;
  status: SubscriberStatus;
  source: string;
  enrolled_at: string;
  last_step: number;
  last_sent_at: string | null;
}

const SUBSCRIBER_COLUMNS = 'id, customer_id, email, first_name, timezone, status, source, enrolled_at, last_step, last_sent_at';

export async function enrollCustomer(
  db: Db,
  c: CustomerLite,
  settings: WelcomeFlowSettings,
  source: 'signup' | 'manual' = 'signup',
): Promise<SubscriberRecord | null> {
  const { data, error } = await db
    .from('welcome_flow_subscribers')
    .insert({
      customer_id: c.id,
      email: c.email.trim().toLowerCase(),
      first_name: c.first_name?.trim() || null,
      timezone: timezoneFor(c.shipping_state, c.shipping_country, settings.default_timezone),
      source,
    })
    .select(SUBSCRIBER_COLUMNS)
    .single();
  if (error) {
    // 23505: already enrolled (another run got there first) — not an error.
    if (error.code !== '23505') console.error('[welcome-flow] enroll failed:', error.message);
    return null;
  }
  await tagInKlaviyo(db, c.email, 'active');
  return data as SubscriberRecord;
}

/** Consenting customer accounts created since the flow was switched on, not yet enrolled. */
async function enrollNewSignups(db: Db, settings: WelcomeFlowSettings, now: Date): Promise<number> {
  if (!settings.enabled_at) return 0;
  const floor = new Date(Math.max(Date.parse(settings.enabled_at), now.getTime() - ENROLL_LOOKBACK_DAYS * 864e5)).toISOString();

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
  const { data: existing } = await db.from('welcome_flow_subscribers').select('customer_id').in('customer_id', ids);
  const enrolled = new Set((existing ?? []).map((r: any) => r.customer_id));

  let n = 0;
  for (const c of candidates as CustomerLite[]) {
    if (enrolled.has(c.id)) continue;
    // Someone who bought before the cron reached them is not a "new subscriber".
    const status = await firstOrderStatus(db, { customerId: c.id, email: c.email });
    if (status !== 'first') continue;
    if (await enrollCustomer(db, c, settings)) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Status changes
// ---------------------------------------------------------------------------

async function setStatus(db: Db, sub: SubscriberRecord, status: SubscriberStatus, extra: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  await db
    .from('welcome_flow_subscribers')
    .update({ status, updated_at: now, ...(status === 'exited' ? { exited_at: now } : {}), ...extra })
    .eq('id', sub.id);
  await tagInKlaviyo(db, sub.email, status);
}

async function markConverted(db: Db, sub: SubscriberRecord, conv: Conversion) {
  const { data: sends } = await db
    .from('welcome_flow_sends')
    .select('step, sent_at')
    .eq('subscriber_id', sub.id)
    .eq('status', 'sent');
  const before = (sends ?? [])
    .filter((s: any) => s.sent_at && Date.parse(s.sent_at) <= Date.parse(conv.at))
    .sort((a: any, b: any) => Date.parse(b.sent_at) - Date.parse(a.sent_at));
  await setStatus(db, sub, 'converted', {
    converted_at: conv.at,
    converted_order_ref: conv.ref,
    converted_amount: conv.amount,
    converted_currency: conv.currency,
    attributed_step: before[0]?.step ?? null,
  });
}

/** Unsubscribe: out of the flow, and marketing consent withdrawn on the account. */
export async function unsubscribe(db: Db, subscriberId: string): Promise<boolean> {
  const { data: sub } = await db.from('welcome_flow_subscribers').select(SUBSCRIBER_COLUMNS).eq('id', subscriberId).maybeSingle();
  if (!sub) return false;
  const s = sub as SubscriberRecord;
  if (s.status !== 'unsubscribed') {
    await setStatus(db, s, 'unsubscribed', { unsubscribed_at: new Date().toISOString(), exit_reason: 'Clicked unsubscribe' });
  }
  if (s.customer_id) {
    await db.from('customers').update({ contact_consent: false }).eq('id', s.customer_id);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

interface RunContext {
  db: Db;
  config: FlowConfig;
  codes: Map<string, CodeCheck>;
  now: Date;
  sendsLeft: number;
  result: RunResult;
}

export interface RunResult {
  skipped?: string;
  enrolled: number;
  checked: number;
  sent: number;
  failed: number;
  converted: number;
  completed: number;
  exited: number;
  /** Step → subscribers waiting on an unusable code. */
  heldForCode: Partial<Record<StepNumber, number>>;
}

const emptyResult = (): RunResult => ({ enrolled: 0, checked: 0, sent: 0, failed: 0, converted: 0, completed: 0, exited: 0, heldForCode: {} });

/** Claim the (subscriber, step) row. Returns its id, or null when another run holds it. */
async function claimSend(db: Db, sub: SubscriberRecord, step: StepNumber, existing?: SendRecord & { id?: string }): Promise<string | null> {
  if (existing?.id) {
    const { data } = await db
      .from('welcome_flow_sends')
      .update({ status: 'sending', attempts: existing.attempts + 1, error: null, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .eq('status', 'failed')
      .eq('attempts', existing.attempts)
      .select('id');
    return data?.[0]?.id ?? null;
  }
  const { data, error } = await db
    .from('welcome_flow_sends')
    .insert({ subscriber_id: sub.id, step, status: 'sending', attempts: 1, to_email: sub.email })
    .select('id')
    .single();
  if (error) return null;
  return data.id;
}

async function recordSkip(db: Db, sub: SubscriberRecord, step: StepNumber, reason: string) {
  await db
    .from('welcome_flow_sends')
    .upsert({ subscriber_id: sub.id, step, status: 'skipped', attempts: 0, to_email: sub.email, error: reason }, { onConflict: 'subscriber_id,step', ignoreDuplicates: true });
  await db.from('welcome_flow_subscribers').update({ last_step: step, updated_at: new Date().toISOString() }).eq('id', sub.id).lt('last_step', step);
}

export function resolveOffer(step: WelcomeFlowStep, codes: Map<string, CodeCheck>): ResolvedOffer | null {
  if (!step.promo_code) return null;
  const check = codes.get(normalizeCode(step.promo_code));
  return check?.usable && check.label ? { code: check.code, label: check.label } : null;
}

async function deliver(rc: RunContext, sub: SubscriberRecord, stepNo: StepNumber, sendId: string): Promise<boolean> {
  const { db, config, now } = rc;
  const step = config.steps[stepNo];
  const offer = resolveOffer(step, rc.codes);
  const offerEndsAt = stepNo === 5 ? new Date(now.getTime() + config.settings.final_offer_hours * 3600 * 1000) : null;
  const unsub = unsubscribeUrl(SITE_URL, sub.id);

  const email = renderWelcomeEmail(step, {
    firstName: sub.first_name,
    offer,
    offerEndsAt,
    now,
    timezone: sub.timezone,
    settings: config.settings,
    siteUrl: SITE_URL,
    trackLink: (url) => clickUrl(SITE_URL, sendId, url),
    openPixelUrl: openPixelUrl(SITE_URL, sendId),
    unsubscribeUrl: unsub,
  });

  const res = await sendMail({
    to: sub.email,
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
    .from('welcome_flow_sends')
    .update({
      status: res.success ? 'sent' : 'failed',
      subject: email.subject,
      promo_code: offer?.code ?? null,
      offer_ends_at: offerEndsAt?.toISOString() ?? null,
      message_id: res.id ?? null,
      error: res.success ? null : (res.error ?? 'Send failed').slice(0, 500),
      sent_at: res.success ? stamp : null,
      updated_at: stamp,
    })
    .eq('id', sendId);

  if (res.success) {
    await db
      .from('welcome_flow_subscribers')
      .update({ last_step: stepNo, last_sent_at: stamp, updated_at: stamp })
      .eq('id', sub.id);
    sub.last_step = stepNo;
    sub.last_sent_at = stamp;
  }

  // The customer desk's email history and "Nudged" column read this log.
  const { error: logErr } = await db.from('customer_emails').insert({
    customer_id: sub.customer_id,
    to_email: sub.email,
    subject: email.subject,
    body_html: email.html,
    template: `welcome_${stepNo}`,
    promo_code: offer?.code ?? null,
    promo_details: offer ? `${offer.label} off` : null,
    promo_expires: offerEndsAt?.toISOString() ?? null,
    sent_by_name: 'Welcome flow (automatic)',
    success: res.success,
    error: res.success ? null : res.error ?? null,
    message_id: res.id ?? null,
  });
  if (logErr && !isMissingColumnError(logErr)) console.error('[welcome-flow] outreach log failed:', logErr.message);

  return res.success;
}

/** One subscriber, one pass: stop them, finish them, or send what is due. */
async function processSubscriber(
  rc: RunContext,
  sub: SubscriberRecord,
  customer: AccountState | null,
  conv: Conversion | null | 'unknown',
) {
  const { db, config, now } = rc;
  rc.result.checked++;

  // 1. Purchased → stop.
  if (conv === 'unknown') return; // can't tell — hold rather than offer a discount to a buyer
  if (conv) {
    await markConverted(db, sub, conv);
    rc.result.converted++;
    return;
  }
  if (sub.status === 'completed') return; // only here for the attribution window

  // 2. Consent withdrawn or account switched off → stop. Manual enrolments
  //    rest on the admin's own attestation, so only the account state applies.
  if (customer && customer.active === false) {
    await setStatus(db, sub, 'exited', { exit_reason: 'Account deactivated' });
    rc.result.exited++;
    return;
  }
  if (customer && sub.source === 'signup' && customer.contact_consent === false) {
    await setStatus(db, sub, 'exited', { exit_reason: 'Marketing consent withdrawn' });
    rc.result.exited++;
    return;
  }

  // 3. What's next?
  const { data: sendRows } = await db
    .from('welcome_flow_sends')
    .select('id, step, status, attempts, sent_at')
    .eq('subscriber_id', sub.id);
  const sends = (sendRows ?? []) as (SendRecord & { id: string; sent_at: string | null })[];

  let step = nextStep(sends);
  // Switched-off emails are passed over, in order, without waiting on them.
  while (step && !config.steps[step].enabled) {
    await recordSkip(db, sub, step, 'Email switched off');
    sends.push({ id: '', step, status: 'skipped', attempts: 0, sent_at: null });
    step = nextStep(sends);
  }
  if (!step) {
    await setStatus(db, sub, 'completed');
    rc.result.completed++;
    return;
  }

  const decision = decide(
    {
      step,
      delayDays: config.steps[step].delay_days,
      enrolledAt: new Date(sub.enrolled_at),
      lastSentAt: sub.last_sent_at ? new Date(sub.last_sent_at) : null,
      timezone: sub.timezone,
      windowStart: config.settings.send_window_start,
      windowEnd: config.settings.send_window_end,
      minGapHours: config.settings.min_gap_hours,
    },
    now,
  );
  if (!decision.send) return;

  // A step built around a code waits while that code is unusable, rather than
  // going out saying "Use code VYTA20" for a code checkout will refuse.
  const code = config.steps[step].promo_code;
  if (code && !rc.codes.get(normalizeCode(code))?.usable) {
    rc.result.heldForCode[step] = (rc.result.heldForCode[step] ?? 0) + 1;
    return;
  }

  if (rc.sendsLeft <= 0) return;
  const existing = sends.find((s) => s.step === step);
  const sendId = await claimSend(db, sub, step, existing);
  if (!sendId) return;
  rc.sendsLeft--;

  const ok = await deliver(rc, sub, step, sendId);
  if (ok) rc.result.sent++;
  else rc.result.failed++;
}

async function buildContext(db: Db, config: FlowConfig, now: Date): Promise<RunContext> {
  const codes = await checkCodes(db, STEP_NUMBERS.map((n) => config.steps[n].promo_code), now);
  return { db, config, codes, now, sendsLeft: MAX_SENDS_PER_RUN, result: emptyResult() };
}

interface AccountState {
  contact_consent?: boolean;
  active?: boolean;
  has_completed_first_order?: boolean;
}

async function customersById(db: Db, ids: string[]) {
  const map = new Map<string, AccountState>();
  if (!ids.length) return map;
  const { data } = await db.from('customers').select('id, contact_consent, active, has_completed_first_order').in('id', ids);
  for (const c of (data ?? []) as any[]) map.set(c.id, c);
  return map;
}

/** The cron: enroll, then walk everyone in the flow. */
export async function runWelcomeFlow(db: Db, now = new Date()): Promise<RunResult> {
  const loaded = await loadConfig(db);
  if (!loaded.ok) return { ...emptyResult(), skipped: loaded.migrationNeeded ? 'migration-needed' : loaded.error };
  const { config } = loaded;
  if (!config.settings.enabled) return { ...emptyResult(), skipped: 'disabled' };

  const rc = await buildContext(db, config, now);
  rc.result.enrolled = await enrollNewSignups(db, config.settings, now);

  const attributionFloor = new Date(now.getTime() - ATTRIBUTION_DAYS * 864e5).toISOString();
  const [{ data: active }, { data: recent }] = await Promise.all([
    db.from('welcome_flow_subscribers').select(SUBSCRIBER_COLUMNS).eq('status', 'active').order('enrolled_at', { ascending: true }).limit(500),
    db.from('welcome_flow_subscribers').select(SUBSCRIBER_COLUMNS).eq('status', 'completed').gte('last_sent_at', attributionFloor).limit(500),
  ]);
  const subs = [...((active ?? []) as SubscriberRecord[]), ...((recent ?? []) as SubscriberRecord[])];
  const customers = await customersById(db, subs.map((s) => s.customer_id).filter(Boolean) as string[]);
  const conversions = await findConversions(db, subs, customers);

  for (const sub of subs) {
    try {
      const account = sub.customer_id ? customers.get(sub.customer_id) ?? null : null;
      await processSubscriber(rc, sub, account, conversions.get(sub.id) ?? 'unknown');
    } catch (err: any) {
      console.error('[welcome-flow] subscriber failed:', sub.id, err?.message ?? err);
    }
  }
  return rc.result;
}

/**
 * Process one subscriber now — Email 1 straight after signup, or an admin's
 * "send what's due". Respects every rule the cron does.
 */
export async function processOne(db: Db, subscriberId: string, now = new Date()): Promise<RunResult> {
  const loaded = await loadConfig(db);
  if (!loaded.ok) return { ...emptyResult(), skipped: loaded.migrationNeeded ? 'migration-needed' : loaded.error };
  const { data: sub } = await db.from('welcome_flow_subscribers').select(SUBSCRIBER_COLUMNS).eq('id', subscriberId).maybeSingle();
  if (!sub) return { ...emptyResult(), skipped: 'not-found' };
  const s = sub as SubscriberRecord;
  if (s.status !== 'active') return { ...emptyResult(), skipped: `status-${s.status}` };
  const rc = await buildContext(db, loaded.config, now);
  const customers = await customersById(db, s.customer_id ? [s.customer_id] : []);
  const conversions = await findConversions(db, [s], customers);
  await processSubscriber(rc, s, s.customer_id ? customers.get(s.customer_id) ?? null : null, conversions.get(s.id) ?? 'unknown');
  return rc.result;
}

/**
 * Called from the signup route. Enrolls a consenting new customer and sends
 * Email 1 right away. Never throws — a signup must not fail over this.
 */
export async function enrollAndWelcome(db: Db, customerId: string): Promise<void> {
  try {
    const loaded = await loadConfig(db);
    if (!loaded.ok || !loaded.config.settings.enabled) return;
    const { data: c } = await db
      .from('customers')
      .select('id, email, first_name, shipping_state, shipping_country, role, active, contact_consent')
      .eq('id', customerId)
      .maybeSingle();
    if (!c || c.role !== 'customer' || c.active === false || !c.contact_consent) return;
    const sub = await enrollCustomer(db, c as CustomerLite, loaded.config.settings);
    if (sub) await processOne(db, sub.id);
  } catch (err: any) {
    console.error('[welcome-flow] enrollAndWelcome failed:', err?.message ?? err);
  }
}
