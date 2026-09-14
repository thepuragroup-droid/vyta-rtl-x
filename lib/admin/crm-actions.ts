/**
 * The CRM actions shared by the customer desk and the affiliate desk: claiming
 * a person, editing their lead state, and sending them an outreach email.
 *
 * The mechanics are identical on both desks, so they live here once and the
 * routes under `/api/admin/customers/[id]/…` and `/api/admin/affiliates/[id]/…`
 * are thin wrappers that resolve a `CustomerRef` and call in.
 *
 * The RECORDS are not shared. Every read and write is scoped to the calling
 * desk, so the same person can be a cold customer and a hot affiliate with
 * separate claims, notes and outreach histories.
 *
 * Every function returns `{ status, body }` rather than a NextResponse, so the
 * routes stay free of business logic and this file stays testable.
 *
 * SERVER ONLY — takes the service-role client.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { logAuditServer } from '@/lib/admin/audit';
import {
  fetchLead,
  isContactMethod,
  isLeadStatus,
  upsertLead,
  type LeadScope,
} from '@/lib/admin/customer-leads';
import type { CustomerRef } from '@/lib/admin/customer-ref';
import { sendMail, defaultFrom } from '@/lib/smtp';
import {
  PROMO_TEMPLATE_MAP,
  looksLikeEmail,
  parseAddressList,
  renderPromoEmail,
  renderPromoEmailText,
  renderSubject,
  type CartSummary,
  type CheckoutCta,
  type DiscountInput,
  type PromoEmailInput,
  type PromoTemplate,
} from '@/lib/customer/promo-email';

export interface Actor {
  userId: string;
  email: string | null;
  name: string | null;
}

export interface ActionResult {
  status: number;
  body: Record<string, unknown>;
}

/** Guard rail on a broadcast-shaped field — this is one-to-one outreach. */
const MAX_CC = 10;

const MIGRATION_REQUIRED = {
  error:
    'Lead management is not set up on this database yet — run customer-crm-migration.sql, then affiliate-crm-migration.sql.',
};

/**
 * Which desk this record belongs to. The customer desk and the affiliate desk
 * hold SEPARATE relationships with the same person — a cold customer can be a
 * hot affiliate — so every read and write is scoped.
 */
const scopeOf = (ref: CustomerRef): LeadScope =>
  ref.source === 'affiliate' ? 'affiliate' : 'customer';

/**
 * Identify the caller and confirm they may work the CRM.
 *
 * Admin and assistant both qualify: assistants do the day-to-day contacting,
 * and locking them out would make the desk useless to the people staffing it.
 */
export async function verifyCrmActor(
  db: SupabaseClient,
  req: { headers: { get(name: string): string | null } },
): Promise<Actor | null> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return null;
  const { data } = await db
    .from('customers')
    .select('id, email, first_name, last_name, role')
    .eq('id', user.id)
    .single();
  if (data?.role !== 'admin' && data?.role !== 'assistant') return null;
  const name = `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim();
  return {
    userId: user.id,
    email: data?.email ?? user.email ?? null,
    name: name || null,
  };
}

/** The identity columns stamped on every lead write, whichever desk wrote it. */
const identityPatch = (ref: CustomerRef) => ({
  customer_id: ref.customerId,
  affiliate_id: ref.affiliateId,
});

const auditEntity = (ref: CustomerRef) => ref.customerId ?? ref.affiliateId ?? ref.email;

/* ------------------------------------------------------------------ */
/* Claiming                                                            */
/* ------------------------------------------------------------------ */

export async function claimLead(
  db: SupabaseClient,
  actor: Actor,
  ref: CustomerRef,
): Promise<ActionResult> {
  const scope = scopeOf(ref);
  const { lead: existing, available } = await fetchLead(db, ref.email, scope);
  if (!available) return { status: 503, body: MIGRATION_REQUIRED };

  if (existing.claimed_by_id && existing.claimed_by_id !== actor.userId) {
    return {
      status: 409,
      body: {
        error: `Already claimed by ${existing.claimed_by_name || existing.claimed_by_email || 'another admin'}.`,
      },
    };
  }

  const { lead, error } = await upsertLead(db, ref.email, scope, {
    ...identityPatch(ref),
    claimed_by_id: actor.userId,
    claimed_by_email: actor.email,
    claimed_by_name: actor.name,
    claimed_at: new Date().toISOString(),
    updated_by_id: actor.userId,
    updated_by_name: actor.name,
  });
  if (error) return { status: 500, body: { error } };

  await logAuditServer(db, { actor_id: actor.userId, actor_email: actor.email }, {
    action: 'customer.claim',
    entity_type: ref.source === 'affiliate' ? 'affiliate' : 'customer',
    entity_id: auditEntity(ref),
  });

  return { status: 200, body: { ok: true, lead } };
}

export async function releaseLead(
  db: SupabaseClient,
  actor: Actor,
  ref: CustomerRef,
): Promise<ActionResult> {
  const scope = scopeOf(ref);
  const { lead: existing, available } = await fetchLead(db, ref.email, scope);
  if (!available) return { status: 503, body: MIGRATION_REQUIRED };

  if (existing.claimed_by_id && existing.claimed_by_id !== actor.userId) {
    return {
      status: 409,
      body: { error: 'Only the admin who claimed this person can release the claim.' },
    };
  }

  // Releasing drops the claim only — status, notes and contact method are the
  // lead's history and survive being handed to someone else.
  const { lead, error } = await upsertLead(db, ref.email, scope, {
    ...identityPatch(ref),
    claimed_by_id: null,
    claimed_by_email: null,
    claimed_by_name: null,
    claimed_at: null,
    updated_by_id: actor.userId,
    updated_by_name: actor.name,
  });
  if (error) return { status: 500, body: { error } };

  await logAuditServer(db, { actor_id: actor.userId, actor_email: actor.email }, {
    action: 'customer.claim_release',
    entity_type: ref.source === 'affiliate' ? 'affiliate' : 'customer',
    entity_id: auditEntity(ref),
  });

  return { status: 200, body: { ok: true, lead } };
}

/* ------------------------------------------------------------------ */
/* Lead state                                                          */
/* ------------------------------------------------------------------ */

/** An empty string from a form field means "clear this", not "set to ''". */
const orNull = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

/** Accept a date/datetime the picker produced, or null. Rejects nonsense. */
function orNullDate(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'string' || v.trim() === '') return v === '' ? null : undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Update lead status, contact method, notes and follow-up dates.
 *
 * Only the admin holding the claim may edit — that's the point of claiming.
 * An unclaimed lead is open to any admin, so triage doesn't require claiming
 * first.
 */
export async function patchLead(
  db: SupabaseClient,
  actor: Actor,
  ref: CustomerRef,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  const scope = scopeOf(ref);
  const { lead: existing, available } = await fetchLead(db, ref.email, scope);
  if (!available) return { status: 503, body: MIGRATION_REQUIRED };

  if (existing.claimed_by_id && existing.claimed_by_id !== actor.userId) {
    return {
      status: 409,
      body: {
        error: `${existing.claimed_by_name || existing.claimed_by_email || 'Another admin'} holds this record — they need to release the claim before you can edit the lead.`,
      },
    };
  }

  const patch: Record<string, unknown> = {
    ...identityPatch(ref),
    updated_by_id: actor.userId,
    updated_by_name: actor.name,
  };

  if (body.status !== undefined) {
    if (!isLeadStatus(body.status)) {
      return { status: 400, body: { error: 'Unknown lead status' } };
    }
    patch.status = body.status;
  }

  if (body.contact_method !== undefined) {
    const method = orNull(body.contact_method);
    if (method !== null && !isContactMethod(method)) {
      return { status: 400, body: { error: 'Unknown contact method' } };
    }
    patch.contact_method = method;
  }

  if (body.notes !== undefined) {
    const notes = orNull(body.notes);
    patch.notes = notes === null ? null : notes.slice(0, 10000);
  }

  for (const field of ['last_contacted_at', 'next_follow_up_at'] as const) {
    if (body[field] === undefined) continue;
    const value = orNullDate(body[field]);
    if (value === undefined) {
      return { status: 400, body: { error: `Invalid date for ${field}` } };
    }
    patch[field] = value;
  }

  const { lead, error } = await upsertLead(db, ref.email, scope, patch);
  if (error) return { status: 500, body: { error } };

  await logAuditServer(db, { actor_id: actor.userId, actor_email: actor.email }, {
    action: 'customer.lead_update',
    entity_type: ref.source === 'affiliate' ? 'affiliate' : 'customer',
    entity_id: auditEntity(ref),
  });

  return { status: 200, body: { ok: true, lead } };
}

/* ------------------------------------------------------------------ */
/* Outreach email                                                      */
/* ------------------------------------------------------------------ */

/**
 * True when `customer_emails` isn't there yet (migration not run).
 *
 * Exported because every desk that logs an outreach send has to make the same
 * call — "the table is missing" is a setup gap worth reporting once, not an
 * error worth failing a send that already left the building.
 */
export function isMissingEmailTable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  if (e.code === '42P01' || e.code === 'PGRST205') return true;
  const msg = typeof e.message === 'string' ? e.message : '';
  return /customer_emails/i.test(msg) && /(does not exist|schema cache)/i.test(msg);
}

export interface OutreachExtras {
  /**
   * The template set this send is allowed to use. Defaults to the promo
   * templates the customer and affiliate desks offer; the abandoned-cart path
   * passes the recovery set instead, so a recovery key is only ever accepted
   * where a recovery email is actually being built.
   */
  templates?: Record<string, PromoTemplate>;
  /** THIS recipient's basket. Never shared between recipients — see lib/customer/outreach.ts. */
  cart?: CartSummary | null;
  /** THIS recipient's payment-link button. */
  checkout?: CheckoutCta | null;
  /** Structured discount, so the promo box and the cart totals agree. */
  discount?: DiscountInput | null;
  /** Better `{{first_name}}` than the CRM record has — the ledger often knows one. */
  firstName?: string | null;
}

/**
 * Send one outreach / promo email and record it.
 *
 * The promo code is presented, never issued: codes are generated on the
 * Stealth Health platform (app.puramass.com) and pasted into the composer, so
 * nothing here validates or reserves one.
 *
 * The send is logged either way — a failed send stays visible in the history
 * instead of disappearing, which is what you want when someone asks "did we
 * ever email them?".
 *
 * `extras` carries what only the CALLER can know: this recipient's abandoned
 * cart, their payment link and the discount behind the code. Everything in it
 * is per-recipient, so a bulk send resolves it separately for each person
 * rather than reusing the draft's (see lib/customer/outreach.ts).
 */
export async function sendOutreachEmail(
  db: SupabaseClient,
  actor: Actor,
  ref: CustomerRef,
  body: Record<string, any>,
  extras: OutreachExtras = {},
): Promise<ActionResult> {
  if (!looksLikeEmail(ref.email)) {
    return { status: 400, body: { error: 'This record has no usable email address.' } };
  }

  const subject = String(body.subject ?? '').trim();
  const messageBody = String(body.body ?? '').trim();
  if (!subject) return { status: 400, body: { error: 'A subject is required.' } };
  if (!messageBody) return { status: 400, body: { error: 'The message body is empty.' } };

  const templateKey = String(body.templateKey ?? 'custom');
  const templates = extras.templates ?? PROMO_TEMPLATE_MAP;
  if (!templates[templateKey]) {
    return { status: 400, body: { error: 'Unknown template' } };
  }

  const promoCode = String(body.promoCode ?? '').trim() || null;
  const promoDetails = String(body.promoDetails ?? '').trim() || null;
  const promoExpires = String(body.promoExpires ?? '').trim() || null;

  // CC arrives as either a raw field or an already-split array.
  const ccRaw = Array.isArray(body.cc) ? body.cc.join(',') : String(body.cc ?? '');
  const cc = parseAddressList(ccRaw);
  const badCc = cc.filter((a) => !looksLikeEmail(a));
  if (badCc.length > 0) {
    return { status: 400, body: { error: `Not a valid CC address: ${badCc[0]}` } };
  }
  if (cc.length > MAX_CC) {
    return { status: 400, body: { error: `Too many CC addresses (max ${MAX_CC}).` } };
  }

  const firstName =
    (extras.firstName ?? '').trim() || (ref.name ?? '').trim().split(/\s+/)[0] || null;
  const input: PromoEmailInput = {
    firstName,
    subject,
    body: messageBody,
    promoCode,
    promoDetails,
    promoExpires,
    senderName: actor.name,
    discount: extras.discount ?? null,
    cart: extras.cart ?? null,
    checkout: extras.checkout ?? null,
    currency: extras.cart?.currency ?? null,
  };
  const html = renderPromoEmail(input);
  const text = renderPromoEmailText(input);
  const renderedSubject = renderSubject(input);

  const result = await sendMail({
    to: ref.email,
    ...(cc.length > 0 ? { cc } : {}),
    subject: renderedSubject,
    html,
    text,
    from: defaultFrom(),
    // Replies should reach the human who wrote it, not the noreply mailbox.
    ...(actor.email ? { replyTo: actor.email } : {}),
  });

  const { error: logError } = await db.from('customer_emails').insert({
    scope: scopeOf(ref),
    customer_id: ref.customerId,
    affiliate_id: ref.affiliateId,
    to_email: ref.email,
    cc_emails: cc,
    subject: renderedSubject,
    body_html: html,
    template: templateKey,
    promo_code: promoCode,
    promo_details: promoDetails,
    promo_expires: promoExpires,
    sent_by_id: actor.userId,
    sent_by_email: actor.email,
    sent_by_name: actor.name,
    success: result.success,
    error: result.error ?? null,
    message_id: result.id ?? null,
  });
  if (logError && !isMissingEmailTable(logError)) {
    console.error('[crm] outreach log insert failed:', logError.message);
  }

  await logAuditServer(db, { actor_id: actor.userId, actor_email: actor.email }, {
    action: 'customer.email_send',
    entity_type: ref.source === 'affiliate' ? 'affiliate' : 'customer',
    entity_id: auditEntity(ref),
  });

  if (!result.success) {
    return {
      status: 502,
      body: { error: result.error ?? 'The mail server rejected the message.' },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      to: ref.email,
      cc,
      subject: renderedSubject,
      // Surfaced so the UI can warn that the send worked but the history won't
      // show it until the migration runs.
      logged: !logError,
    },
  };
}

/**
 * The outreach emails one desk has sent to an address, newest first.
 *
 * Matched on email rather than an id so the history survives an account being
 * created later, and scoped so a promo pushed to an affiliate doesn't surface
 * as part of that person's customer correspondence.
 *
 * Returns `[]` (never throws) when `customer_emails` isn't there yet.
 */
export async function fetchEmailHistory(
  db: SupabaseClient,
  email: string,
  scope: LeadScope,
): Promise<{ emails: any[]; available: boolean }> {
  const normalized = email.trim().toLowerCase();
  const { data, error } = await db
    .from('customer_emails')
    .select(
      'id, to_email, cc_emails, subject, template, promo_code, promo_details, ' +
        'promo_expires, sent_by_name, sent_by_email, success, error, created_at',
    )
    .eq('scope', scope)
    .ilike('to_email', normalized)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('[crm] email history read failed:', error.message);
    return { emails: [], available: false };
  }
  // `ilike` is a coarse prefilter — `_` is a LIKE wildcard, so re-match exactly.
  return {
    emails: (data ?? []).filter(
      (r: any) => String(r.to_email ?? '').trim().toLowerCase() === normalized,
    ),
    available: true,
  };
}
