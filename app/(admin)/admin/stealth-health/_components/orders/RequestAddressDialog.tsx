'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  MapPin,
  Send,
  Users,
  X,
} from 'lucide-react';
import { formatAddressLines, toShippingAddress } from '@/lib/payments/puramass-address';
import type { PuramassOrderRow } from './OrdersTab';

interface RequestAddressDialogProps {
  order: PuramassOrderRow;
  onClose: () => void;
  /**
   * Send the request. Resolves with the outcome: on success the link is handed
   * back so it can be copied and sent another way as well.
   */
  onSend: (opts: { email: string; cc: string | null; note: string | null }) => Promise<{
    success: boolean;
    email?: string;
    cc?: string[];
    link?: string;
    reused?: boolean;
    error?: string;
  }>;
}

/**
 * "Ask the customer for their shipping address" — confirmation dialog.
 *
 * The send is customer-facing, so it is never one accidental click away: the
 * admin sees exactly who it goes to, can add a line of their own, and is warned
 * when the order already has an address.
 *
 * The recipient is prefilled from the ledger and is almost always right —
 * PuraMass reports the buyer's email on every order, and the address is missing
 * for an unrelated reason (its payload carries `shipping: null`). It stays
 * editable for the two cases the prefill can't cover: a hand-off with no email
 * on the row at all, and a customer who asks for the link somewhere else.
 */
export default function RequestAddressDialog({
  order,
  onClose,
  onSend,
}: RequestAddressDialogProps) {
  const existing = useMemo(() => toShippingAddress(order.shipping_address), [order.shipping_address]);
  const existingLines = formatAddressLines(existing);

  const [email, setEmail] = useState(order.customer_email ?? '');
  const [cc, setCc] = useState('');
  // The CC field is out of the way until asked for — most sends don't want one.
  const [showCc, setShowCc] = useState(false);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{
    email: string;
    cc: string[];
    link: string;
    reused: boolean;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const alreadyAsked = !!order.address_requested_at;

  const send = async () => {
    setError(null);
    const to = email.trim();
    if (!to) {
      setError('Enter the email address to send this to.');
      return;
    }
    setSending(true);
    const res = await onSend({
      email: to,
      cc: cc.trim() || null,
      note: note.trim() || null,
    });
    setSending(false);
    if (res.success) {
      setSent({
        email: res.email ?? to,
        cc: res.cc ?? [],
        link: res.link ?? '',
        reused: !!res.reused,
      });
    } else {
      setError(res.error ?? 'The request could not be sent.');
      // A send that failed after the link was minted still hands back the link.
      if (res.link) setSent({ email: to, cc: [], link: res.link, reused: !!res.reused });
    }
  };

  const copyLink = async () => {
    if (!sent?.link) return;
    try {
      await navigator.clipboard.writeText(sent.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy the link — select it and copy manually.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-bronze/10">
              <MapPin className="h-5 w-5 text-bronze" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-ink">Ask for the shipping address</h2>
              <p className="text-xs text-ink-muted">
                {order.partner_reference.slice(0, 18)}
                {order.partner_reference.length > 18 ? '…' : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={sending}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface hover:text-ink disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {sent ? (
          <div className="space-y-4 p-6">
            {error ? (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error} The link below is live — you can send it another way.</span>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                <Check className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Emailed to <span className="font-medium">{sent.email}</span>
                  {sent.cc.length > 0 && (
                    <>
                      , copying <span className="font-medium">{sent.cc.join(', ')}</span>
                    </>
                  )}
                  .{sent.reused ? ' The link from the earlier email still works.' : ''}
                </span>
              </div>
            )}

            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Their link
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={sent.link}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs text-ink"
                />
                <button
                  onClick={copyLink}
                  title="Copy link"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:border-ink/20 hover:text-ink"
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </button>
                <a
                  href={sent.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open the customer's page"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:border-ink/20 hover:text-ink"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
              <p className="mt-1.5 text-xs text-ink-light">
                Anyone with this link can set the address on this one order, so share it only with
                the customer. It expires in 30 days.
              </p>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={onClose}
                className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-ink/90"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 p-6">
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <p className="text-sm text-ink">
              We&apos;ll email the customer a private link to a page that shows this order and asks
              for their shipping address. Whatever they submit is written straight onto this
              hand-off.
            </p>

            {existingLines.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <p className="font-semibold">This order already has an address on file:</p>
                <p className="mt-1">{existingLines.join(', ')}</p>
                <p className="mt-1.5">Sending anyway lets the customer correct it.</p>
              </div>
            )}

            {alreadyAsked && (
              <div className="rounded-lg border border-line bg-surface p-3 text-xs text-ink-muted">
                Last asked {new Date(order.address_requested_at!).toLocaleString()}. Re-sending
                re-uses the same link, so the earlier email keeps working.
              </div>
            )}

            <div>
              <label
                htmlFor="request-address-email"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-muted"
              >
                Send to
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                <input
                  id="request-address-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="customer@example.com"
                  className="w-full rounded-lg border border-line bg-white py-2.5 pl-10 pr-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
                />
              </div>
              {!order.customer_email && (
                <p className="mt-1 text-xs text-amber-700">
                  This hand-off has no email on file — enter one to reach the customer.
                </p>
              )}
            </div>

            {showCc ? (
              <div>
                <label
                  htmlFor="request-address-cc"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-muted"
                >
                  CC <span className="font-normal normal-case text-ink-light">(optional)</span>
                </label>
                <div className="relative">
                  <Users className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                  <input
                    id="request-address-cc"
                    type="text"
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    placeholder="someone@example.com, another@example.com"
                    className="w-full rounded-lg border border-line bg-white py-2.5 pl-10 pr-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
                  />
                </div>
                <p className="mt-1 text-xs text-ink-light">
                  Up to 5, separated by commas. They see the same email — and the customer sees
                  who was copied.
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowCc(true)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-bronze transition-colors hover:text-bronze-dark"
              >
                <Users className="h-3.5 w-3.5" />
                Copy someone else
              </button>
            )}

            <div>
              <label
                htmlFor="request-address-note"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-muted"
              >
                Add a note <span className="font-normal normal-case text-ink-light">(optional)</span>
              </label>
              <textarea
                id="request-address-note"
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 500))}
                rows={3}
                placeholder="Anything you'd like to say to them — appears in the email."
                className="w-full resize-none rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                disabled={sending}
                className="rounded-lg border border-line px-4 py-2 text-sm text-ink-muted transition-colors hover:border-ink/20 hover:text-ink disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={send}
                disabled={sending}
                className="inline-flex items-center gap-2 rounded-lg bg-bronze px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-bronze-dark disabled:opacity-50"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {alreadyAsked ? 'Send again' : 'Send request'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
