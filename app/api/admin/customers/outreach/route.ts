/**
 * The customer desk's outreach endpoint — one draft, one email per person.
 *
 * GET  /api/admin/customers/outreach?ids=…            resolve chosen recipients
 * GET  /api/admin/customers/outreach?q=…&abandoned=1  search for more of them
 * GET  /api/admin/customers/outreach?history=1        who has already had what
 * POST /api/admin/customers/outreach                  send it
 *
 * The send is NOT a broadcast. Each recipient gets a separate message addressed
 * to them alone — their name in `{{first_name}}`, their own abandoned cart, and
 * their own Stealth Health payment link, re-read from the ledger at send time.
 * Nobody is CC'd on anybody else, and no recipient can see who else was
 * emailed. That is the difference between this and a mailing list, and it is
 * why the cart blocks are resolved per person rather than copied from the draft
 * the admin previewed (see lib/customer/outreach.ts).
 *
 * PROMO CODES ARE NOT ISSUED HERE. They are generated on app.puramass.com and
 * pasted into the composer; the discount type and amount only decide how the
 * offer is worded and what the email's "estimated total" says.
 *
 * A batch can also carry the desk's "skip anyone who already had this" rule
 * (`suppress` on the POST). It is re-evaluated HERE against the outreach log at
 * send time rather than trusted from the browser: the page built its list
 * minutes ago, and the whole point of the rule is that nobody gets the same
 * email twice — including from a colleague who sent it in between.
 *
 * Admin/assistant only — the same bar as every other CRM action.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logAuditServer } from '@/lib/admin/audit';
import { sendOutreachEmail, verifyCrmActor, type Actor } from '@/lib/admin/crm-actions';
import type { CustomerRef } from '@/lib/admin/customer-ref';
import {
  looksLikeEmail,
  normalizeDiscount,
  parseAddressList,
  PROMO_TEMPLATE_MAP,
  RECOVERY_TEMPLATE_MAP,
  type PromoTemplate,
} from '@/lib/customer/promo-email';
import {
  fetchOutreachHistory,
  loadRecipientCheckout,
  mapWithConcurrency,
  resolveOutreachRecipients,
  searchOutreachCandidates,
  splitBySuppression,
  CANDIDATE_LIMIT,
  MAX_BULK_RECIPIENTS,
  SEND_CONCURRENCY,
  type OutreachRecipient,
  type SuppressedRecipient,
} from '@/lib/customer/outreach';
import { suppressionSince, type AudienceFilters } from '@/lib/customer/audience';
import {
  loadRecoveryState,
  stampRecoverySend,
} from '@/lib/payments/puramass-recovery';

// nodemailer needs the node runtime.
export const runtime = 'nodejs';
// A full batch is MAX_BULK_RECIPIENTS sends at SEND_CONCURRENCY; the default
// function timeout would cut that short and leave the admin unsure who was
// actually emailed.
export const maxDuration = 60;

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * Both template sets are accepted here.
 *
 * The composer offers the recovery templates whenever the draft carries a
 * payment link and the outreach templates otherwise, and either can be
 * hand-edited into the other, so gating the key by mode would only reject
 * drafts an admin legitimately built.
 */
const ALL_TEMPLATES: Record<string, PromoTemplate> = {
  ...PROMO_TEMPLATE_MAP,
  ...RECOVERY_TEMPLATE_MAP,
};

/** Guard rail on a broadcast-shaped field — mirrors MAX_CC in crm-actions. */
const MAX_CC = 10;

/**
 * A recipient, in the shape the CRM's send/log path wants.
 *
 * Built from the already-resolved recipient rather than by calling
 * `resolveCustomerRef` again: that would be two more queries per person, and
 * everything it returns is on the recipient already.
 */
const refOf = (recipient: OutreachRecipient): CustomerRef => ({
  customerId: recipient.source === 'account' ? recipient.id : null,
  affiliateId: recipient.affiliateId,
  email: recipient.email,
  name: recipient.name,
  source: recipient.source,
});

const splitIds = (raw: string | null): string[] =>
  String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export async function GET(req: NextRequest) {
  const actor = await verifyCrmActor(db, req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const params = req.nextUrl.searchParams;
  const ids = splitIds(params.get('ids'));

  // ---- History mode: who has already had which kind of email? --------------
  //
  // The customer table asks for this to apply "skip anyone already sent the
  // restock email" across a list of hundreds without a query per row. Only the
  // template keys the desk is actually filtering on come back, so the answer
  // stays small and carries no subjects, bodies or promo codes — this is a
  // suppression lookup, not the correspondence history (that is per customer,
  // on their own page).
  if (params.get('history') === '1') {
    const templates = splitIds(params.get('templates'));
    if (templates.length === 0) {
      return NextResponse.json({ byEmail: {}, available: true, templates: [] });
    }
    const withinDays = Number(params.get('withinDays'));
    const history = await fetchOutreachHistory(db, {
      templates,
      since: suppressionSince({
        excludeWithinDays: Number.isFinite(withinDays) && withinDays > 0 ? withinDays : null,
      }),
    });
    return NextResponse.json({ ...history, templates });
  }

  // ---- Resolve mode: who are these people, and what did they leave behind? --
  if (ids.length > 0) {
    const recipients = await resolveOutreachRecipients(db, ids.slice(0, MAX_BULK_RECIPIENTS));
    // The full basket for the first recipient only — it is the one the composer
    // previews, and pulling every recipient's line items would be a query per
    // person for blocks nobody looks at until the send resolves them anyway.
    const primary = recipients[0] ?? null;
    const checkout = primary?.abandoned
      ? await loadRecipientCheckout(db, primary.abandoned.orderId)
      : null;

    return NextResponse.json({
      recipients,
      primary: primary
        ? {
            id: primary.id,
            cart: checkout?.cart ?? null,
            checkout: checkout?.checkout ?? null,
            reference: checkout?.reference ?? null,
            status: checkout?.status ?? null,
          }
        : null,
      // Ids the caller asked for that resolved to nobody — a customer deleted
      // since the page loaded, or a Stealth Health buyer with no ledger row.
      unresolved: ids.filter((id) => !recipients.some((r) => r.id === id)),
    });
  }

  // ---- Search mode ---------------------------------------------------------
  const candidates = await searchOutreachCandidates(db, {
    q: params.get('q') ?? '',
    // Cart-only is the default: this picker exists to chase abandoned
    // checkouts, and offering everyone is the deliberate wider choice.
    abandonedOnly: params.get('abandoned') !== '0',
    exclude: splitIds(params.get('exclude')),
    limit: Number(params.get('limit')) || CANDIDATE_LIMIT,
  });

  return NextResponse.json({ candidates, limit: CANDIDATE_LIMIT });
}

/**
 * The "skip anyone already sent X" condition, as it arrives from the browser.
 *
 * Unknown template keys are dropped rather than rejected: a key this release
 * does not know can only ever match nothing, and failing the whole send over
 * one stale chip would block a batch the admin can see is correct.
 */
function readSuppression(raw: unknown): Pick<AudienceFilters, 'excludeTemplates' | 'excludeWithinDays'> {
  const source = (raw ?? {}) as Record<string, unknown>;
  const templates = Array.isArray(source.templates)
    ? [...new Set(
        source.templates
          .map((t) => String(t ?? '').trim())
          .filter((t) => Boolean(ALL_TEMPLATES[t])),
      )]
    : [];
  const days = Number(source.withinDays);
  return {
    excludeTemplates: templates,
    excludeWithinDays: Number.isFinite(days) && days > 0 ? days : null,
  };
}

interface SendOutcome {
  id: string;
  email: string;
  name: string | null;
  success: boolean;
  error?: string;
  /** The cart this person's email actually carried, when it carried one. */
  reference?: string | null;
  /** Which recovery attempt this was for that cart. */
  attempt?: number;
  /** False when the send worked but the counter could not be written. */
  recorded?: boolean;
  /** False when the send worked but `customer_emails` could not record it. */
  logged?: boolean;
}

export async function POST(req: NextRequest) {
  const actor = await verifyCrmActor(db, req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // ---- Validate the draft before anybody is emailed ------------------------
  const subject = String(body.subject ?? '').trim();
  const message = String(body.body ?? '').trim();
  if (!subject) return NextResponse.json({ error: 'A subject is required.' }, { status: 400 });
  if (!message) return NextResponse.json({ error: 'The message body is empty.' }, { status: 400 });

  const templateKey = String(body.templateKey ?? 'custom');
  if (!ALL_TEMPLATES[templateKey]) {
    return NextResponse.json({ error: 'Unknown template' }, { status: 400 });
  }

  const requestedIds: string[] = Array.isArray(body.recipients)
    ? body.recipients.map((id: unknown) => String(id ?? '').trim()).filter(Boolean)
    : [];
  if (requestedIds.length === 0) {
    return NextResponse.json({ error: 'Pick at least one recipient.' }, { status: 400 });
  }
  if (requestedIds.length > MAX_BULK_RECIPIENTS) {
    return NextResponse.json(
      {
        error: `One send can address at most ${MAX_BULK_RECIPIENTS} customers. Send this batch, then pick the rest.`,
        field: 'recipients',
      },
      { status: 400 },
    );
  }

  // CC lands on the FIRST recipient's email only. Copying a colleague on all
  // forty would turn a one-to-one chase into forty copies of the same thread.
  const ccRaw = Array.isArray(body.cc) ? body.cc.join(',') : String(body.cc ?? '');
  const cc = parseAddressList(ccRaw);
  const badCc = cc.filter((a) => !looksLikeEmail(a));
  if (badCc.length > 0) {
    return NextResponse.json(
      { error: `Not a valid CC address: ${badCc[0]}`, field: 'cc' },
      { status: 400 },
    );
  }
  if (cc.length > MAX_CC) {
    return NextResponse.json(
      { error: `Too many CC addresses (max ${MAX_CC}).`, field: 'cc' },
      { status: 400 },
    );
  }

  // An amount that isn't a usable discount is rejected rather than ignored: an
  // admin who typed "150" into a percentage field must not have it silently
  // dropped and send a bare reminder they think carries an offer.
  const promoCode = String(body.promoCode ?? '').trim().toUpperCase() || null;
  const promoDetails = String(body.promoDetails ?? '').trim() || null;
  const discountRequested =
    body.discountType != null && String(body.discountType).trim() !== '' &&
    body.discountValue != null && String(body.discountValue).trim() !== '';
  const discount = discountRequested
    ? normalizeDiscount(String(body.discountType).trim(), body.discountValue)
    : null;
  if (discountRequested && !discount) {
    return NextResponse.json(
      {
        error: 'The discount must be a positive amount, and a percentage cannot be more than 100.',
        field: 'discount',
      },
      { status: 400 },
    );
  }
  if (discount && !promoCode && !promoDetails) {
    return NextResponse.json(
      {
        error:
          'Add the promo code the discount belongs to, or describe the offer, so the customer knows how to claim it.',
        field: 'promoCode',
      },
      { status: 400 },
    );
  }

  const resolved = await resolveOutreachRecipients(db, requestedIds);
  if (resolved.length === 0) {
    return NextResponse.json(
      { error: 'None of those recipients could be found.' },
      { status: 404 },
    );
  }

  // ---- Hold back anyone who has already had this kind of email -------------
  //
  // Re-checked here even though the page filtered its list by the same rule:
  // that list was built when the page loaded, and a duplicate promo is exactly
  // what slips through the gap while a draft is being written.
  const suppress = readSuppression(body.suppress);
  const { sendable: recipients, skipped, available: historyAvailable } =
    await splitBySuppression(db, resolved, suppress);

  if (!historyAvailable) {
    // The rule was asked for and could not be applied. Sending anyway would
    // break the promise the admin made when they set the condition, so nothing
    // goes out and they get to decide.
    return NextResponse.json(
      {
        error:
          'The outreach history could not be read, so "skip anyone already sent this" could not be applied. ' +
          'Nothing was sent — clear that condition to send anyway.',
        field: 'suppress',
      },
      { status: 503 },
    );
  }

  if (recipients.length === 0) {
    // Not a failure: the condition did its job. Reported as a normal result so
    // the composer says who was skipped rather than showing a send error.
    return NextResponse.json(
      {
        ok: true,
        sent: 0,
        failed: 0,
        withCart: 0,
        logged: true,
        unresolved: requestedIds.filter((id) => !resolved.some((r) => r.id === id)),
        results: [],
        skipped,
        cc: [],
      },
      { status: 200 },
    );
  }

  const attachCheckout = body.attachCheckout !== false;
  const includeCart = body.includeCart !== false;

  // ---- Send, one person at a time -----------------------------------------
  const outcomes = await mapWithConcurrency<OutreachRecipient, SendOutcome>(
    recipients,
    SEND_CONCURRENCY,
    async (recipient, index) => {
      const base: SendOutcome = {
        id: recipient.id,
        email: recipient.email,
        name: recipient.name,
        success: false,
      };

      // THIS person's cart and link, read fresh — never the draft's.
      const context =
        attachCheckout && recipient.abandoned
          ? await loadRecipientCheckout(db, recipient.abandoned.orderId, { includeCart })
          : null;

      const result = await sendOutreachEmail(
        db,
        actor,
        refOf(recipient),
        {
          ...body,
          subject,
          body: message,
          templateKey,
          // Normalised here so the code in the message and the code stamped on
          // the cart are the same string.
          promoCode,
          promoDetails,
          // Only the first recipient's message carries the CC.
          cc: index === 0 ? cc : [],
        },
        {
          templates: ALL_TEMPLATES,
          cart: context?.cart ?? null,
          checkout: context?.checkout ?? null,
          discount,
          firstName: recipient.firstName,
        },
      );

      if (result.status !== 200) {
        return {
          ...base,
          error: String(result.body?.error ?? 'The email could not be sent.'),
          reference: context?.reference ?? null,
        };
      }

      // Record the chase against the cart, so /admin/stealth-health shows this
      // buyer as already contacted whichever desk did the contacting.
      let attempt: number | undefined;
      let recorded: boolean | undefined;
      if (context?.orderId) {
        const previous = await loadRecoveryState(db, context.orderId);
        const stamp = await stampRecoverySend(db, context.orderId, {
          previousCount: previous.recovery_email_count,
          promoCode,
          discount,
        });
        attempt = previous.recovery_email_count + 1;
        recorded = stamp.recorded;
      }

      return {
        ...base,
        success: true,
        reference: context?.reference ?? null,
        logged: result.body?.logged !== false,
        ...(attempt !== undefined ? { attempt } : {}),
        ...(recorded !== undefined ? { recorded } : {}),
      };
    },
  );

  const sent = outcomes.filter((o) => o.success);
  const failed = outcomes.filter((o) => !o.success);

  await logAuditForBatch(actor, outcomes, skipped);

  return NextResponse.json(
    {
      // A partial success is still a success — some of these customers now have
      // the email, and reporting the whole batch as failed would get it re-sent.
      ok: sent.length > 0,
      // Only when NOTHING went out, so the caller has something to show.
      ...(sent.length === 0
        ? {
            error: `None of the ${failed.length} emails could be sent: ${
              failed[0]?.error ?? 'the mail server rejected them.'
            }`,
          }
        : {}),
      sent: sent.length,
      failed: failed.length,
      withCart: outcomes.filter((o) => o.reference).length,
      // False when at least one send is missing from `customer_emails`, so the
      // UI can say the email went out but the history will not show it.
      logged: sent.every((o) => o.logged !== false),
      unresolved: requestedIds.filter((id) => !resolved.some((r) => r.id === id)),
      // Who the "already had this" condition held back, and which email they
      // had — so the admin can see the rule worked rather than wondering why
      // the batch was smaller than the selection.
      skipped,
      results: outcomes,
      cc,
    },
    { status: sent.length > 0 ? 200 : 502 },
  );
}

/**
 * One audit line for the batch itself.
 *
 * `sendOutreachEmail` already logs each individual send; this records that they
 * were one action, so an audit reader sees "chased 12 carts" rather than twelve
 * unrelated emails that happen to share a timestamp.
 */
async function logAuditForBatch(
  actor: Actor,
  outcomes: SendOutcome[],
  skipped: SuppressedRecipient[],
): Promise<void> {
  if (outcomes.length < 2) return;
  await logAuditServer(
    db,
    { actor_id: actor.userId, actor_email: actor.email },
    {
      action: 'customer.bulk_email_send',
      entity_type: 'customer',
      // The people held back are named in the count too: an audit reader
      // comparing a 12-person batch against a 20-person selection should not
      // have to guess where the other eight went.
      entity_id:
        skipped.length > 0
          ? `${outcomes.length} recipients (${skipped.length} skipped — already emailed)`
          : `${outcomes.length} recipients`,
    },
  );
}
