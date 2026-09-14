'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import EmailComposer from '../../_components/EmailComposer';
import {
  PROMO_TEMPLATES,
  RECOVERY_TEMPLATES,
  mergeTemplates,
  type CartSummary,
  type CheckoutCta,
} from '@/lib/customer/promo-email';
import {
  cartAmount,
  cartStatusLabel,
  recipientLabel,
  MAX_BULK_RECIPIENTS,
  type OutreachRecipient,
  type OutreachSendResult,
} from '@/lib/customer/outreach-types';
import { emailTypeLabel } from '@/lib/customer/audience';

/**
 * "Email these customers" — the customer desk's bulk send.
 *
 * One draft, one email per person. Each recipient's message is addressed only
 * to them and carries THEIR name, THEIR abandoned cart and THEIR payment link,
 * resolved from the ledger at send time by the route. Nobody is CC'd or BCC'd
 * on anyone else, and no customer can be shown another customer's basket.
 *
 * The same composer the single-customer page uses, so the discount nudge is
 * worded identically whether it goes to one buyer or thirty — the point of
 * putting this above the table was to make the second case as few clicks as the
 * first, not to grow a second copy of the email builder.
 */

interface Props {
  /**
   * Outreach ids from the directory — a `customers` UUID, or `pm:<email>` for
   * a Stealth Health buyer with no account. The directory rows already carry
   * exactly this, so the table hands them straight over.
   */
  ids: string[];
  /** Rows in the selection with nobody to write to, so the dialog can say so. */
  noEmailCount?: number;
  /**
   * The desk's "skip anyone already sent this" condition, carried through to
   * the send.
   *
   * The table already dropped these people before they could be ticked; sending
   * the rule as well is what closes the gap between then and now. The route
   * re-reads the outreach log at send time, so a customer another admin emailed
   * while this draft was being written is still skipped — and comes back in the
   * result as skipped rather than silently missing.
   */
  suppress?: { templates: string[]; withinDays: number | null };
  onClose: () => void;
  /** Reload the table once a batch has gone out. */
  onSent: () => void;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

/** "12 Aug" / "12 Aug 2025" — enough to place a send without a full timestamp. */
function fmtSentAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'previously';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

interface Draft {
  recipients: OutreachRecipient[];
  cart: CartSummary | null;
  checkout: CheckoutCta | null;
}

export default function BulkEmailDialog({
  ids,
  noEmailCount = 0,
  suppress,
  onClose,
  onSent,
}: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [result, setResult] = useState<OutreachSendResult | null>(null);

  const wanted = useMemo(() => [...new Set(ids.filter(Boolean))], [ids]);

  useEffect(() => {
    let cancelled = false;
    if (wanted.length === 0) {
      setLoadError('None of the selected rows have an email address, so there is nobody to write to.');
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `/api/admin/customers/outreach?ids=${wanted.map(encodeURIComponent).join(',')}`,
          { cache: 'no-store', headers: await authHeaders() },
        );
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error ?? 'Could not load these customers.');
        const recipients: OutreachRecipient[] = json.recipients ?? [];
        if (recipients.length === 0) {
          throw new Error('None of the selected rows could be resolved to a customer record.');
        }
        setDraft({
          recipients,
          cart: json.primary?.cart ?? null,
          checkout: json.primary?.checkout ?? null,
        });
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message ?? 'Could not load these customers.');
      }
    })();
    return () => { cancelled = true; };
  }, [wanted]);

  const searchRecipients = useMemo(
    () => async (query: string, opts: { abandonedOnly: boolean }): Promise<OutreachRecipient[]> => {
      const params = new URLSearchParams({
        q: query,
        abandoned: opts.abandonedOnly ? '1' : '0',
        exclude: wanted.join(','),
      });
      const res = await fetch(`/api/admin/customers/outreach?${params}`, {
        cache: 'no-store',
        headers: await authHeaders(),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not search customers.');
      return json.candidates ?? [];
    },
    [wanted],
  );

  const send = async (payload: {
    templateKey: string;
    subject: string;
    body: string;
    promoCode: string;
    promoDetails: string;
    promoExpires: string;
    cc: string[];
    discountType: string | null;
    discountValue: number | null;
    attachCheckout: boolean;
    extraRecipients: OutreachRecipient[];
  }) => {
    if (!draft) return;
    setSending(true);
    setSendError(null);
    try {
      const { extraRecipients, ...rest } = payload;
      const res = await fetch('/api/admin/customers/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          ...rest,
          recipients: [draft.recipients[0].id, ...extraRecipients.map((r) => r.id)],
          ...(suppress && suppress.templates.length > 0 ? { suppress } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'The emails could not be sent.');
      setResult(json as OutreachSendResult);
      onSent();
    } catch (e: any) {
      setSendError(e?.message ?? 'The emails could not be sent.');
    } finally {
      setSending(false);
    }
  };

  // ---- Loading / error / sent share one small shell ------------------------
  if (!draft || loadError || result) {
    const failures = result?.results.filter((r) => !r.success) ?? [];
    const skipped = result?.skipped ?? [];
    return (
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6">
        <div className="my-4 w-full max-w-lg overflow-hidden rounded-xl border border-line bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-base font-bold text-ink">Email these customers</h2>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface hover:text-ink"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="px-5 py-8 text-center">
            {result ? (
              <>
                {result.failed === 0 ? (
                  <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
                ) : (
                  <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
                )}

                <p className="mt-3 text-sm font-medium text-ink">
                  {result.sent === 0 && skipped.length > 0
                    ? 'Nobody was emailed — everyone in this batch had already had it.'
                    : `Sent ${result.sent} email${result.sent === 1 ? '' : 's'} — one to each customer.`}
                </p>
                {result.withCart > 0 && (
                  <p className="mt-1 text-xs text-ink-muted">
                    {result.withCart} carried the buyer&rsquo;s own cart and payment link.
                  </p>
                )}
                {/* Not a failure — the condition doing its job. Named so the
                    admin can see the batch shrank on purpose. */}
                {skipped.length > 0 && (
                  <div className="mx-auto mt-3 max-w-sm rounded-lg bg-surface px-3 py-2 text-left text-xs text-ink-muted">
                    <p className="font-medium text-ink">
                      {skipped.length} skipped — already sent this kind of email:
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {skipped.slice(0, 5).map((row) => (
                        <li key={row.id}>
                          {recipientLabel(row)} — {emailTypeLabel(row.template)},{' '}
                          {fmtSentAt(row.sentAt)}
                        </li>
                      ))}
                      {skipped.length > 5 && <li>…and {skipped.length - 5} more.</li>}
                    </ul>
                  </div>
                )}
                {failures.length > 0 && (
                  <div className="mx-auto mt-3 max-w-sm rounded-lg bg-red-50 px-3 py-2 text-left text-xs text-red-700">
                    <p className="font-medium">{failures.length} could not be sent:</p>
                    <ul className="mt-1 space-y-0.5">
                      {failures.slice(0, 5).map((f) => (
                        <li key={f.id}>
                          {recipientLabel(f)} — {f.error ?? 'the mail server rejected it'}
                        </li>
                      ))}
                      {failures.length > 5 && <li>…and {failures.length - 5} more.</li>}
                    </ul>
                  </div>
                )}
                {result.logged === false && (
                  <p className="mx-auto mt-3 max-w-sm rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    The emails went out, but some sends could not be recorded in the outreach
                    history, so they will not show on the customer&rsquo;s timeline.
                  </p>
                )}
              </>
            ) : loadError ? (
              <>
                <AlertTriangle className="mx-auto h-8 w-8 text-red-500" />
                <p className="mt-3 text-sm text-red-600">{loadError}</p>
              </>
            ) : (
              <>
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-ink-muted" />
                <p className="mt-3 text-sm text-ink-muted">
                  Loading {wanted.length} customer{wanted.length === 1 ? '' : 's'}…
                </p>
              </>
            )}
          </div>
          <div className="flex justify-end border-t border-line px-5 py-4">
            <button
              onClick={onClose}
              className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface"
            >
              {result ? 'Done' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const suppressing = Boolean(suppress && suppress.templates.length > 0);
  const [primary, ...extras] = draft.recipients;
  const withCarts = draft.recipients.filter((r) => r.abandoned);
  // The route resolves at most MAX_BULK_RECIPIENTS, so a bigger selection is
  // trimmed. Said out loud rather than silently sending to the first 40.
  const trimmed = Math.max(0, wanted.length - draft.recipients.length - noEmailCount);
  // Only worth offering the cart/payment-link attachment, the recovery wording
  // and the discount controls when somebody in the selection actually has a
  // cart to recover. Otherwise this is the plain outreach composer.
  const anyCart = withCarts.length > 0;
  const primaryCart = primary.abandoned;

  return (
    <>
      <EmailComposer
        toEmail={primary.email}
        recipientLabel="customer"
        heading="Email these customers"
        subheading={
          <span>
            {draft.recipients.length} customer{draft.recipients.length === 1 ? '' : 's'} from your
            selection, each getting their own email
            {anyCart
              ? ` · ${withCarts.length} of them ${withCarts.length === 1 ? 'has' : 'have'} an open checkout`
              : ''}
            {noEmailCount > 0
              ? ` · ${noEmailCount} selected row${noEmailCount === 1 ? '' : 's'} had no email and ${noEmailCount === 1 ? 'was' : 'were'} left out`
              : ''}
            {trimmed > 0
              ? ` · ${trimmed} more did not fit the ${MAX_BULK_RECIPIENTS}-customer limit for one send — send this batch, then pick the rest`
              : ''}
            {suppressing
              ? ` · anyone already sent ${suppress!.templates
                  .map(emailTypeLabel)
                  .join(' or ')} is skipped, re-checked when this goes out`
              : ''}
          </span>
        }
        firstName={primary.firstName}
        senderName={null}
        // Counted into the composer's "already emailed recently" warning
        // alongside anyone added in the picker — the person the draft opened on
        // may be the very one who was chased last week.
        primaryRecipient={primary}
        // Both sets: a bulk selection mixes buyers with an open cart and buyers
        // without one, and either wording may be the right one to send.
        templates={anyCart ? mergeTemplates(RECOVERY_TEMPLATES, PROMO_TEMPLATES) : PROMO_TEMPLATES}
        showDiscount={anyCart}
        cart={draft.cart}
        checkout={draft.checkout}
        attachable={
          anyCart
            ? {
                label: 'Attach each customer’s own cart and payment link',
                description: (
                  <>
                    Resolved per person when the email goes out, so nobody sees anyone else&rsquo;s
                    basket. {withCarts.length} of {draft.recipients.length} selected
                    {withCarts.length === 1 ? ' has' : ' have'} an open checkout
                    {primaryCart ? (
                      <>
                        {' '}— e.g. <span className="font-mono">{primaryCart.reference}</span> ·{' '}
                        {cartStatusLabel(primaryCart.status)}
                        {cartAmount(primaryCart) ? ` · ${cartAmount(primaryCart)}` : ''}
                      </>
                    ) : null}
                    . The rest get the message without a cart or a button.
                  </>
                ),
                defaultOn: true,
              }
            : null
        }
        bulk={{
          search: searchRecipients,
          excludeIds: [primary.id],
          initial: extras,
          // The selection is already made, so the picker opens on everyone
          // rather than filtering to carts — it is here to ADD a few more.
          defaultAbandonedOnly: false,
          defaultOn: true,
        }}
        promoNote={
          anyCart
            ? 'Promo codes are generated in app.puramass.com (the Stealth Health platform). ' +
              'Create the code there first, then paste it below — the same code goes to everyone on ' +
              'this send, and PuraMass applies the real discount when each customer enters it.'
            : undefined
        }
        sending={sending}
        onClose={onClose}
        onSend={send}
      />
      {sendError && (
        <div className="fixed inset-x-0 bottom-4 z-[60] mx-auto w-full max-w-md px-4">
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-lg">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{sendError}</span>
          </div>
        </div>
      )}
    </>
  );
}
