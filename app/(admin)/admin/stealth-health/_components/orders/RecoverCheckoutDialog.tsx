'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import EmailComposer from '@/app/(admin)/admin/_components/EmailComposer';
import {
  RECOVERY_TEMPLATES,
  type CartSummary,
  type DiscountType,
} from '@/lib/customer/promo-email';
import type { PuramassOrderRow } from './OrdersTab';

/**
 * "Win this checkout back" — the abandoned-cart recovery composer.
 *
 * A thin wrapper around the shared EmailComposer. Its whole job is to fetch the
 * draft payload from the server before the composer opens, because the cart the
 * email shows (product names, line prices, totals) is resolved server-side from
 * the invoice and the SKU mapping. Drafting from the raw ledger row instead
 * would preview SKUs to the admin and send names to the customer — the one
 * thing this codebase's email builder is built not to do.
 */

interface DraftPayload {
  order: {
    id: string;
    reference: string;
    status: string;
    payment_link: string | null;
    customer_email: string | null;
    customer_name: string | null;
    created_at: string;
    recoverable: boolean;
  };
  firstName: string | null;
  cart: CartSummary;
  checkoutNote: string;
  senderName: string | null;
  recovery: {
    recovery_email_sent_at: string | null;
    recovery_email_count: number;
    recovery_promo_code: string | null;
    recovery_discount_type: string | null;
    recovery_discount_value: number | null;
  };
}

export interface RecoverySendPayload {
  templateKey: string;
  subject: string;
  body: string;
  promoCode: string;
  promoDetails: string;
  promoExpires: string;
  cc: string[];
  discountType: DiscountType | null;
  discountValue: number | null;
}

export interface RecoverySendResult {
  success: boolean;
  to?: string;
  attempt?: number;
  recorded?: boolean;
  error?: string;
}

interface Props {
  order: PuramassOrderRow;
  onClose: () => void;
  /** Posts the send. Resolves with the outcome rather than throwing. */
  onSend: (payload: RecoverySendPayload) => Promise<RecoverySendResult>;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return 'just now';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function RecoverCheckoutDialog({ order, onClose, onSend }: Props) {
  const [draft, setDraft] = useState<DraftPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState<RecoverySendResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/admin/puramass/orders/recover?id=${encodeURIComponent(order.id)}`,
          { cache: 'no-store', headers: await authHeaders() },
        );
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error ?? 'Could not load this checkout.');
        setDraft(json as DraftPayload);
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message ?? 'Could not load this checkout.');
      }
    })();
    return () => { cancelled = true; };
  }, [order.id]);

  const send = useCallback(
    async (payload: RecoverySendPayload) => {
      setSending(true);
      setSendError(null);
      const res = await onSend(payload);
      setSending(false);
      if (res.success) setSent(res);
      else setSendError(res.error ?? 'The email could not be sent.');
    },
    [onSend],
  );

  const subheading = useMemo(() => {
    if (!draft) return null;
    const bits: React.ReactNode[] = [
      <span key="ref" className="font-mono">{draft.order.reference}</span>,
      <span key="age">started {timeAgo(draft.order.created_at)}</span>,
    ];
    if (draft.recovery.recovery_email_count > 0) {
      bits.push(
        <span key="chased" className="text-amber-700">
          already chased {draft.recovery.recovery_email_count}×
          {draft.recovery.recovery_email_sent_at
            ? `, last ${timeAgo(draft.recovery.recovery_email_sent_at)}`
            : ''}
          {draft.recovery.recovery_promo_code ? ` with ${draft.recovery.recovery_promo_code}` : ''}
        </span>,
      );
    }
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {bits.map((b, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="text-ink-light">·</span>}
            {b}
          </React.Fragment>
        ))}
      </span>
    );
  }, [draft]);

  /**
   * Reasons this send can't go ahead, checked against the freshly-fetched draft
   * rather than the table row: the row can be minutes stale, and a cart that
   * was paid in the meantime must not be told it is still waiting.
   */
  const blocker = !draft
    ? null
    : !draft.order.recoverable
      ? draft.order.status === 'paid'
        ? 'This checkout has since been paid — there is nothing to recover.'
        : `A ${draft.order.status.replace(/_/g, ' ')} hand-off cannot be recovered.`
      : !draft.order.customer_email
        ? 'This hand-off has no customer email on it, so there is nobody to send to. Sync it from PuraMass first — the buyer\'s address arrives with the order.'
        : null;

  // ---- Loading / error / sent / blocked states share one small shell -------
  if (!draft || loadError || sent || blocker) {
    return (
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6">
        <div className="my-4 w-full max-w-lg overflow-hidden rounded-xl border border-line bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-base font-bold text-ink">Recover this checkout</h2>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface hover:text-ink"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="px-5 py-8 text-center">
            {sent ? (
              <>
                <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
                <p className="mt-3 text-sm font-medium text-ink">
                  Sent to {sent.to ?? order.customer_email}
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  {sent.attempt && sent.attempt > 1
                    ? `That is recovery email #${sent.attempt} for this cart.`
                    : 'Their payment link is on its way.'}
                </p>
                {sent.recorded === false && (
                  <p className="mx-auto mt-3 max-w-sm rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    The email went out, but the send could not be recorded against the order — run
                    abandoned-checkout-recovery-migration.sql so the history shows it.
                  </p>
                )}
              </>
            ) : loadError || blocker ? (
              <>
                <AlertTriangle className="mx-auto h-8 w-8 text-red-500" />
                <p className="mt-3 text-sm text-red-600">{loadError ?? blocker}</p>
              </>
            ) : (
              <>
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-ink-muted" />
                <p className="mt-3 text-sm text-ink-muted">Loading the cart…</p>
              </>
            )}
          </div>
          <div className="flex justify-end border-t border-line px-5 py-4">
            <button
              onClick={onClose}
              className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface"
            >
              {sent ? 'Done' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <EmailComposer
        toEmail={draft.order.customer_email!}
        recipientLabel="customer"
        heading="Recover this checkout"
        subheading={subheading}
        firstName={draft.firstName}
        senderName={draft.senderName}
        templates={RECOVERY_TEMPLATES}
        showDiscount
        cart={draft.cart}
        checkout={
          draft.order.payment_link
            ? {
                url: draft.order.payment_link,
                label: 'Complete your order',
                note: draft.checkoutNote,
              }
            : null
        }
        promoNote={
          'Promo codes are generated in app.puramass.com (the Stealth Health platform). ' +
          'Create the code there first, then paste it below — the type and amount you pick ' +
          'only decide how the offer is worded; PuraMass applies the real discount when the ' +
          'customer enters the code at checkout.'
        }
        sendLabel="Send recovery email"
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
