'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import EmailComposer from '@/app/(admin)/admin/_components/EmailComposer';
import { RECOVERY_TEMPLATES, type CartSummary, type CheckoutCta } from '@/lib/customer/promo-email';
import {
  recipientLabel,
  type OutreachRecipient,
  type OutreachSendResult,
} from '@/lib/customer/outreach-types';
import { outreachIdFor } from '@/lib/admin/customer-id';
import type { PuramassOrderRow } from './OrdersTab';

/**
 * "Chase these carts" — the bulk half of abandoned-checkout recovery.
 *
 * One draft, one email per buyer. Each recipient's message is addressed only to
 * them and carries THEIR cart and THEIR hosted payment link, resolved from the
 * ledger at send time — nobody is CC'd or BCC'd on anyone else, and no buyer
 * can be shown another buyer's basket.
 *
 * The selected rows are turned into people, not orders: two abandoned carts
 * from the same buyer are one recipient who gets one email about their newest
 * live cart, rather than two emails with two payment links.
 */

interface Props {
  rows: PuramassOrderRow[];
  onClose: () => void;
  /** Reload the table once a batch has gone out, so the chase counters move. */
  onSent: () => void;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

interface Draft {
  recipients: OutreachRecipient[];
  cart: CartSummary | null;
  checkout: CheckoutCta | null;
}

export default function BulkRecoverDialog({ rows, onClose, onSent }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [result, setResult] = useState<OutreachSendResult | null>(null);

  // Rows with nobody to write to. Counted up front so the dialog can say how
  // many of the selection it will actually reach before anything is sent.
  const { ids, noEmail } = useMemo(() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    let noEmail = 0;
    for (const row of rows) {
      const id = outreachIdFor(row);
      if (!id) { noEmail += 1; continue; }
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return { ids, noEmail };
  }, [rows]);

  useEffect(() => {
    let cancelled = false;
    if (ids.length === 0) {
      setLoadError('None of the selected orders have a customer email on them, so there is nobody to write to. Sync them from PuraMass first.');
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `/api/admin/customers/outreach?ids=${ids.map(encodeURIComponent).join(',')}`,
          { cache: 'no-store', headers: await authHeaders() },
        );
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error ?? 'Could not load these customers.');
        const recipients: OutreachRecipient[] = json.recipients ?? [];
        if (recipients.length === 0) {
          throw new Error('None of the selected buyers could be resolved to a customer record.');
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
  }, [ids]);

  const searchRecipients = useMemo(
    () => async (query: string, opts: { abandonedOnly: boolean }): Promise<OutreachRecipient[]> => {
      const params = new URLSearchParams({
        q: query,
        abandoned: opts.abandonedOnly ? '1' : '0',
        exclude: ids.join(','),
      });
      const res = await fetch(`/api/admin/customers/outreach?${params}`, {
        cache: 'no-store',
        headers: await authHeaders(),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not search customers.');
      return json.candidates ?? [];
    },
    [ids],
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
    return (
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6">
        <div className="my-4 w-full max-w-lg overflow-hidden rounded-xl border border-line bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-base font-bold text-ink">Chase these carts</h2>
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
                  Sent {result.sent} email{result.sent === 1 ? '' : 's'} — one to each customer.
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  {result.withCart} carried the buyer&rsquo;s own cart and payment link.
                </p>
                {failures.length > 0 && (
                  <div className="mx-auto mt-3 max-w-sm rounded-lg bg-red-50 px-3 py-2 text-left text-xs text-red-700">
                    <p className="font-medium">
                      {failures.length} could not be sent:
                    </p>
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
                {result.results.some((r) => r.recorded === false) && (
                  <p className="mx-auto mt-3 max-w-sm rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    The emails went out, but some sends could not be recorded against their orders —
                    run abandoned-checkout-recovery-migration.sql so the history shows them.
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
                <p className="mt-3 text-sm text-ink-muted">Loading {ids.length} carts…</p>
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

  const [primary, ...extras] = draft.recipients;

  return (
    <>
      <EmailComposer
        toEmail={primary.email}
        recipientLabel="customer"
        heading="Chase these carts"
        subheading={
          <span>
            {draft.recipients.length} buyer{draft.recipients.length === 1 ? '' : 's'} from your
            selection, each getting their own email
            {noEmail > 0 ? ` · ${noEmail} selected order${noEmail === 1 ? '' : 's'} had no email and were left out` : ''}
          </span>
        }
        firstName={primary.firstName}
        senderName={null}
        // Chasing the same cart twice in a week is the mistake this dialog is
        // most able to make, so the buyer it opened on is counted into the
        // composer's recent-contact warning alongside the rest of the batch.
        primaryRecipient={primary}
        templates={RECOVERY_TEMPLATES}
        showDiscount
        cart={draft.cart}
        checkout={draft.checkout}
        attachable={{
          label: 'Send each buyer their own cart and payment link',
          description:
            'Every recipient gets the basket they left and the Stealth Health link that still takes payment for it, looked up per person when the email goes out.',
          defaultOn: true,
        }}
        bulk={{
          search: searchRecipients,
          excludeIds: [primary.id],
          initial: extras,
          defaultAbandonedOnly: true,
          defaultOn: true,
        }}
        promoNote={
          'Promo codes are generated in app.puramass.com (the Stealth Health platform). ' +
          'Create the code there first, then paste it below — the same code goes to everyone on ' +
          'this send, and PuraMass applies the real discount when each customer enters it.'
        }
        sendLabel="Send recovery emails"
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
