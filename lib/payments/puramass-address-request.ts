/**
 * "We didn't catch your shipping address" — request lifecycle.
 *
 * Some Stealth Health hand-offs land with `shipping_address` NULL:
 * the partner never reported one, so the order can't be packed. Instead of
 * chasing the buyer by hand, an admin sends them a link from
 * /admin/stealth-health (Orders tab); they fill the address in on /shipping-address/<token>
 * and it lands straight on the ledger row.
 *
 * SERVER ONLY — every function here needs the service-role client, and token
 * hashing uses node:crypto. The client-safe display/validation helpers live in
 * lib/payments/puramass-address.ts.
 *
 * Requires puramass-missing-address-migration.sql. Reads and writes degrade
 * rather than explode while that migration is not visible to PostgREST yet
 * (see lib/payments/puramass-columns.ts for the same pattern).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  toShippingAddress,
  type ShippingAddressLike,
  type ValidatedShippingAddress,
} from './puramass-address';
import { isMissingColumnError, stripUnmigratedFields } from './puramass-columns';
import { SITE_URL } from '@/lib/config';

/** How long an emailed link stays usable. Matches the migration's default. */
export const ADDRESS_REQUEST_TTL_DAYS = 30;

// ---- Tokens ---------------------------------------------------------------

/** 32 random bytes, URL-safe. Only its hash is stored. */
export function generateAddressToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashAddressToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Token shape check before touching the database (cheap junk filter). */
export function looksLikeAddressToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{20,120}$/.test(token);
}

/** Constant-time compare for two hex hashes of equal length. */
function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** The customer-facing link that carries the token. */
export function addressRequestLink(token: string): string {
  const base = SITE_URL.replace(/\/+$/, '');
  return `${base}/shipping-address/${token}`;
}

// ---- CC recipients --------------------------------------------------------

/** How many people can be copied on one request. */
export const MAX_CC_RECIPIENTS = 5;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ParsedRecipients {
  /** Valid, deduped, minus the primary recipient. */
  list: string[];
  /** Entries that aren't email addresses, echoed back for the error message. */
  invalid: string[];
  /** True when entries past MAX_CC_RECIPIENTS were dropped. */
  truncated: boolean;
}

/**
 * Parse the optional CC field.
 *
 * Accepts an array or one string separated by commas, semicolons or newlines,
 * because an admin pasting from a spreadsheet or an email client gets any of
 * those. Anything that isn't an address is reported rather than silently
 * dropped — a mistyped CC that vanishes looks like a delivery failure later.
 */
export function parseCcList(raw: unknown, primary?: string | null): ParsedRecipients {
  const parts: string[] = Array.isArray(raw)
    ? raw.map((v) => String(v ?? ''))
    : typeof raw === 'string'
      ? raw.split(/[,;\n]/)
      : [];

  const seen = new Set<string>();
  if (primary) seen.add(primary.trim().toLowerCase());

  const list: string[] = [];
  const invalid: string[] = [];
  let truncated = false;

  for (const part of parts) {
    const value = part.trim();
    if (!value) continue;
    if (!EMAIL_RE.test(value)) {
      invalid.push(value.slice(0, 80));
      continue;
    }
    const key = value.toLowerCase();
    // Copying the primary recipient twice just duplicates their inbox.
    if (seen.has(key)) continue;
    seen.add(key);
    if (list.length >= MAX_CC_RECIPIENTS) {
      truncated = true;
      continue;
    }
    list.push(value);
  }

  return { list, invalid, truncated };
}

// ---- Rows -----------------------------------------------------------------

export interface AddressRequestRow {
  id: string;
  puramass_order_id: string;
  token_hash: string;
  email: string;
  expires_at: string;
  sent_at: string | null;
  sent_count: number;
  submitted_at: string | null;
  submitted_address: unknown;
  created_at: string;
}

export interface LedgerRow {
  id: string;
  partner_reference: string;
  transaction_id: string | null;
  payment_link: string | null;
  status: string;
  subtotal_cents: number | null;
  currency: string | null;
  customer_id: string | null;
  customer_email: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  shipping_address: unknown;
  items: { sku?: string; quantity?: number }[] | null;
  invoice_id: string | null;
  paid_at: string | null;
  created_at: string;
}

const LEDGER_SELECT =
  'id, partner_reference, transaction_id, payment_link, status, subtotal_cents, currency, ' +
  'customer_id, customer_email, customer_name, customer_phone, shipping_address, items, ' +
  'invoice_id, paid_at, created_at';

const LEDGER_SELECT_LEGACY =
  'id, partner_reference, transaction_id, payment_link, status, subtotal_cents, currency, ' +
  'customer_id, customer_email, items, invoice_id, paid_at, created_at';

/** Read one ledger row, tolerating the address columns not existing yet. */
export async function loadLedgerRow(
  db: SupabaseClient,
  id: string,
): Promise<LedgerRow | null> {
  let { data, error } = await db
    .from('puramass_orders')
    .select(LEDGER_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error && isMissingColumnError(error)) {
    ({ data, error } = await db
      .from('puramass_orders')
      .select(LEDGER_SELECT_LEGACY)
      .eq('id', id)
      .maybeSingle());
  }
  if (error) {
    console.error('[puramass] address-request ledger read failed:', error);
    return null;
  }
  if (!data) return null;

  // The two selects give `data` a union type; the shape is checked field by
  // field below, so widen through `unknown` rather than trusting either arm.
  const row = data as unknown as Record<string, unknown>;
  return {
    id: String(row.id),
    partner_reference: String(row.partner_reference ?? ''),
    transaction_id: (row.transaction_id as string) ?? null,
    payment_link: (row.payment_link as string) ?? null,
    status: String(row.status ?? ''),
    subtotal_cents: typeof row.subtotal_cents === 'number' ? row.subtotal_cents : null,
    currency: (row.currency as string) ?? null,
    customer_id: (row.customer_id as string) ?? null,
    customer_email: (row.customer_email as string) ?? null,
    customer_name: (row.customer_name as string) ?? null,
    customer_phone: (row.customer_phone as string) ?? null,
    shipping_address: row.shipping_address ?? null,
    items: Array.isArray(row.items) ? (row.items as { sku?: string; quantity?: number }[]) : [],
    invoice_id: (row.invoice_id as string) ?? null,
    paid_at: (row.paid_at as string) ?? null,
    created_at: String(row.created_at ?? new Date().toISOString()),
  };
}

// ---- Creating / re-sending a request --------------------------------------

function expiryFromNow(): string {
  return new Date(Date.now() + ADDRESS_REQUEST_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export interface CreatedAddressRequest {
  request: AddressRequestRow;
  /** Raw token — exists only in memory and in the email that carries it. */
  token: string;
  link: string;
  /** True when an outstanding link was re-used rather than a new one minted. */
  reused: boolean;
}

/**
 * Mint a link for this order, or refresh the outstanding one.
 *
 * Re-using the open request matters: an admin who clicks "Request address"
 * twice must not invalidate the link in the first email. A request that was
 * already submitted, or has expired, is replaced with a fresh token.
 *
 * The raw token is not recoverable, so re-using a row means re-issuing its
 * token as well — the row's hash is rewritten in place, which keeps a single
 * live link per order and quietly retires the previous one.
 */
export async function createAddressRequest(
  db: SupabaseClient,
  order: LedgerRow,
  email: string,
): Promise<CreatedAddressRequest | { error: string }> {
  const token = generateAddressToken();
  const token_hash = hashAddressToken(token);

  const { data: open } = await db
    .from('puramass_address_requests')
    .select('id, puramass_order_id, token_hash, email, expires_at, sent_at, sent_count, submitted_at, submitted_address, created_at')
    .eq('puramass_order_id', order.id)
    .is('submitted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (open) {
    const { data, error } = await db
      .from('puramass_address_requests')
      .update({ token_hash, email, expires_at: expiryFromNow() })
      .eq('id', (open as AddressRequestRow).id)
      .select('id, puramass_order_id, token_hash, email, expires_at, sent_at, sent_count, submitted_at, submitted_address, created_at')
      .single();
    if (error || !data) {
      console.error('[puramass] address-request refresh failed:', error);
      return { error: error?.message ?? 'Could not refresh the address request.' };
    }
    return { request: data as AddressRequestRow, token, link: addressRequestLink(token), reused: true };
  }

  const { data, error } = await db
    .from('puramass_address_requests')
    .insert({
      puramass_order_id: order.id,
      token_hash,
      email,
      expires_at: expiryFromNow(),
    })
    .select('id, puramass_order_id, token_hash, email, expires_at, sent_at, sent_count, submitted_at, submitted_address, created_at')
    .single();

  if (error || !data) {
    console.error('[puramass] address-request insert failed:', error);
    return { error: error?.message ?? 'Could not create the address request.' };
  }
  return { request: data as AddressRequestRow, token, link: addressRequestLink(token), reused: false };
}

/** Stamp the send on both the request and the ledger row. Never throws. */
export async function markAddressRequestSent(
  db: SupabaseClient,
  request: AddressRequestRow,
  actor: { actor_id: string | null; actor_email: string | null },
): Promise<string> {
  const sent_at = new Date().toISOString();
  try {
    await db
      .from('puramass_address_requests')
      .update({
        sent_at,
        sent_count: (request.sent_count ?? 0) + 1,
        sent_by: actor.actor_id,
        sent_by_email: actor.actor_email,
      })
      .eq('id', request.id);
  } catch (err) {
    console.error('[puramass] address-request sent stamp failed:', err);
  }
  // Best-effort: the column arrives with this feature's migration.
  const { error } = await db
    .from('puramass_orders')
    .update({ address_requested_at: sent_at })
    .eq('id', request.puramass_order_id);
  if (error && !isMissingColumnError(error)) {
    console.error('[puramass] address_requested_at stamp failed:', error);
  }
  return sent_at;
}

// ---- Reading a request from the emailed token -----------------------------

export type AddressRequestLookup =
  | { ok: true; request: AddressRequestRow; order: LedgerRow }
  | { ok: false; reason: 'not_found' | 'expired' | 'order_missing' };

/**
 * Resolve an emailed token. Expiry is reported separately from "unknown" so
 * the page can offer the customer a way to get a fresh link instead of a dead
 * end; an unknown token stays deliberately vague.
 */
export async function loadAddressRequestByToken(
  db: SupabaseClient,
  token: string,
): Promise<AddressRequestLookup> {
  if (!looksLikeAddressToken(token)) return { ok: false, reason: 'not_found' };
  const token_hash = hashAddressToken(token);

  const { data, error } = await db
    .from('puramass_address_requests')
    .select('id, puramass_order_id, token_hash, email, expires_at, sent_at, sent_count, submitted_at, submitted_address, created_at')
    .eq('token_hash', token_hash)
    .maybeSingle();

  if (error) {
    console.error('[puramass] address-request lookup failed:', error);
    return { ok: false, reason: 'not_found' };
  }
  const request = data as AddressRequestRow | null;
  if (!request || !hashesMatch(request.token_hash, token_hash)) {
    return { ok: false, reason: 'not_found' };
  }
  if (new Date(request.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  const order = await loadLedgerRow(db, request.puramass_order_id);
  if (!order) return { ok: false, reason: 'order_missing' };

  return { ok: true, request, order };
}

// ---- Storing what the customer typed --------------------------------------

/**
 * Write the submitted address onto the order.
 *
 * The ledger row is the source of truth the admin page and the warehouse read,
 * so that write is the one that must succeed; the request row and the linked
 * invoice are updated best-effort afterwards.
 */
export async function applySubmittedAddress(
  db: SupabaseClient,
  request: AddressRequestRow,
  order: LedgerRow,
  submitted: ValidatedShippingAddress,
  meta: { ip?: string | null },
): Promise<{ ok: true; address: ShippingAddressLike } | { ok: false; error: string }> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    shipping_address: submitted.address,
    shipping_address_source: 'customer',
    shipping_address_updated_at: now,
    customer_name: submitted.full_name,
  };
  if (submitted.phone) patch.customer_phone = submitted.phone;

  let { error } = await db.from('puramass_orders').update(patch).eq('id', order.id);

  // Without the address columns there is nowhere to put the address at all —
  // report that plainly rather than pretending the submission was saved.
  if (error && isMissingColumnError(error)) {
    const reduced = stripUnmigratedFields(patch);
    console.error(
      '[puramass] address columns unavailable — cannot store the submitted address:',
      error.message,
    );
    if (Object.keys(reduced).length > 0) {
      await db.from('puramass_orders').update(reduced).eq('id', order.id);
    }
    return {
      ok: false,
      error:
        'We could not save the address right now. Please contact us and we will take it down manually.',
    };
  }
  if (error) {
    console.error('[puramass] submitted address write failed:', error);
    return { ok: false, error: 'We could not save the address right now. Please try again.' };
  }

  // Close the request out (audit trail of exactly what was typed).
  const { error: reqErr } = await db
    .from('puramass_address_requests')
    .update({
      submitted_at: now,
      submitted_ip: meta.ip ?? null,
      submitted_address: {
        ...submitted.address,
        full_name: submitted.full_name,
        phone: submitted.phone,
      },
    })
    .eq('id', request.id);
  if (reqErr) console.error('[puramass] address-request close-out failed:', reqErr);

  // Keep the materialised fulfillment invoice's contact block in step, so the
  // warehouse sees the same name/phone the customer just gave us.
  if (order.invoice_id) {
    const invoicePatch: Record<string, unknown> = { customer_name: submitted.full_name };
    if (submitted.phone) invoicePatch.customer_phone = submitted.phone;
    const { error: invErr } = await db
      .from('invoices')
      .update(invoicePatch)
      .eq('id', order.invoice_id);
    if (invErr) console.error('[puramass] invoice contact sync failed:', invErr);
  }

  return { ok: true, address: toShippingAddress(submitted.address) ?? submitted.address };
}
