'use client';

/**
 * The PuraMass side of an invoice, as rendered on /admin/invoices and
 * /admin/invoices/[id].
 *
 * A PuraMass (Stealth Health) sale is paid on PuraMass's own hosted checkout
 * page: PuraMass takes the money, collects the buyer's contact details and the
 * shipping address there, and reports them back onto the hand-off ledger. The
 * local invoice is materialised for fulfilment and reconciliation only, so none
 * of that detail is on the invoice row itself.
 *
 * These blocks surface it, and label every field with where it came from — an
 * address PuraMass reported and one an admin typed here must never look alike
 * to whoever is packing the parcel.
 */
import React, { useState } from 'react';
import Link from 'next/link';
import {
  MapPin, Copy, Check, ExternalLink, CreditCard, Store, PenLine, MailPlus, RotateCcw,
} from 'lucide-react';
import { formatAddressLines } from '@/lib/payments/puramass-address';
import {
  centsToAmount,
  isPuramassInvoice,
  puramassMoneySplit,
  PURAMASS_STATUS_BADGE,
  PURAMASS_STATUS_LABEL,
  type PuramassInvoiceContext,
} from '@/lib/admin/puramass-invoice';
import { formatMoney, normalizeCurrency } from '@/lib/currency';

/** `2h ago` / `3d ago`, for "we asked the customer" timestamps. */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Where an invoice came from. PuraMass hand-offs get a bronze chip; anything
 * else was raised in this admin and says so, so the two are never confused.
 *
 * Keyed on `invoices.source` rather than on the loaded hand-off, so it is right
 * from the first paint and stays right when the ledger row can't be found.
 */
export function InvoiceSourceBadge({
  source,
  compact = false,
}: {
  source?: string | null;
  /** Table rows show the PuraMass chip only — a chip on every row is noise. */
  compact?: boolean;
}) {
  if (isPuramassInvoice({ source })) {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-bronze/10 text-bronze align-middle"
        title="Placed through the Stealth Health (PuraMass) hosted checkout. Payment, taxes and the shipping address are collected by the partner and reported back to us."
      >
        <Store className="w-3 h-3" /> Stealth Health
      </span>
    );
  }
  if (compact) return null;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-slate-100 text-slate-600 align-middle"
      title="Raised in this admin — customer, pricing and shipping were entered here."
    >
      <PenLine className="w-3 h-3" /> Manual
    </span>
  );
}

/** Copy-to-clipboard affordance shared by the address and reference fields. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked — the value is on screen either way */
        }
      }}
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
      className="flex-shrink-0 rounded p-1 text-ink-light hover:text-ink"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

/**
 * Where the parcel goes, as PuraMass reported it (or as the buyer typed it on
 * /shipping-address/<token> when PuraMass had none).
 *
 * Plenty of orders legitimately have no address yet, so that case is explained
 * rather than left blank.
 */
export function PuramassShipTo({
  puramass,
  compact = false,
}: {
  puramass: PuramassInvoiceContext;
  /** Compact drops the phone line + copy button, for a table cell. */
  compact?: boolean;
}) {
  const lines = formatAddressLines(puramass.shipping_address);
  const fromCustomer = puramass.shipping_address_source === 'customer';

  if (lines.length === 0) {
    return (
      <div className="space-y-0.5">
        <span
          className="block text-xs text-ink-light"
          title={
            puramass.status === 'payment_pending'
              ? 'PuraMass reports the address once the order is paid.'
              : 'PuraMass has not returned a shipping address for this order. Re-sync it on PuraMass Orders, or ask the customer directly.'
          }
        >
          No shipping address yet
        </span>
        {puramass.address_requested_at && (
          <span
            className="inline-flex items-center gap-1 text-[11px] text-amber-700"
            title={`Asked the customer on ${new Date(puramass.address_requested_at).toLocaleString()} — waiting on their reply.`}
          >
            <MailPlus className="w-3 h-3" />
            Asked {timeAgo(puramass.address_requested_at)}
          </span>
        )}
      </div>
    );
  }

  const clipboard = [puramass.customer_name, ...lines, compact ? null : puramass.customer_phone]
    .filter(Boolean)
    .join('\n');

  return (
    <div className="flex items-start gap-1.5">
      <MapPin className="mt-0.5 w-3.5 h-3.5 flex-shrink-0 text-ink-light" />
      <div className="min-w-0">
        {/* Compact sits directly under the customer's name, so repeating it
            here would just be noise. */}
        {!compact && puramass.customer_name && (
          <div className="text-xs font-medium text-ink break-words">{puramass.customer_name}</div>
        )}
        {lines.map((line, i) => (
          <div key={i} className="text-xs leading-snug text-ink-muted break-words">{line}</div>
        ))}
        {!compact && puramass.customer_phone && (
          <div className="text-xs leading-snug text-ink-muted">{puramass.customer_phone}</div>
        )}
        {/* Only the exception is worth a chip: a partner-reported address is
            the norm on these orders, one the buyer typed in is not. */}
        {fromCustomer && (
          <span
            className="mt-1 inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700"
            title={
              puramass.shipping_address_updated_at
                ? `The customer entered this on ${new Date(puramass.shipping_address_updated_at).toLocaleString()}. A PuraMass sync will not overwrite it.`
                : 'The customer entered this themselves. A PuraMass sync will not overwrite it.'
            }
          >
            From customer
          </span>
        )}
      </div>
      {!compact && <CopyButton value={clipboard} label="shipping address" />}
    </div>
  );
}

/** One label/value row inside the detail panels. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-ink-muted flex-shrink-0">{label}</span>
      <span className="text-ink text-right min-w-0">{children}</span>
    </div>
  );
}

/**
 * "Ship To" card for the invoice detail view. Separate from the customer card
 * because the two can legitimately differ: the invoice's customer is whoever
 * the account/email belongs to, while this is who PuraMass is shipping to.
 */
export function PuramassShipToPanel({ puramass }: { puramass: PuramassInvoiceContext }) {
  return (
    <div className="bg-white rounded-xl border border-line p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-ink text-sm flex items-center gap-2">
          <MapPin className="w-4 h-4 text-bronze" /> Ship To
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-ink-muted">via PuraMass</span>
      </div>
      <PuramassShipTo puramass={puramass} />
      {puramass.customer_email && (
        <p className="mt-3 pt-3 border-t border-line/60 text-xs text-ink-muted break-words">
          {puramass.customer_email}
        </p>
      )}
    </div>
  );
}

/**
 * The hand-off itself: PuraMass's transaction, our reference, what PuraMass
 * charged, and anything it refunded. Everything here is PuraMass's record —
 * this admin cannot change it, it can only re-read it on PuraMass Orders.
 */
export function PuramassOrderPanel({ puramass }: { puramass: PuramassInvoiceContext }) {
  const badge = PURAMASS_STATUS_BADGE[puramass.status] ?? 'bg-gray-200 text-gray-600';
  const label = PURAMASS_STATUS_LABEL[puramass.status] ?? puramass.status;
  const goods = centsToAmount(puramass.subtotal_cents);
  const refunded = centsToAmount(puramass.refunded_total_cents) ?? 0;
  const cur = puramass.currency === 'CAD' ? 'CAD' : 'USD';

  return (
    <div className="bg-white rounded-xl border border-bronze/30 p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-ink text-sm flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-bronze" /> PuraMass Order
        </h2>
        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-semibold ${badge}`}>
          {label}
        </span>
      </div>

      <p className="text-xs text-ink-muted mb-3">
        Paid on the PuraMass hosted checkout. Payment, taxes and the shipping
        address are PuraMass&apos;s record — this invoice mirrors them for
        fulfilment.
      </p>

      <div className="space-y-2 text-sm">
        {puramass.transaction_id && (
          <Row label="Transaction">
            <span className="inline-flex items-center gap-1">
              <span className="font-mono text-xs truncate max-w-[9rem]" title={puramass.transaction_id}>
                {puramass.transaction_id}
              </span>
              <CopyButton value={puramass.transaction_id} label="transaction id" />
            </span>
          </Row>
        )}
        {puramass.partner_reference && (
          <Row label="Our reference">
            <span className="inline-flex items-center gap-1">
              <span className="font-mono text-xs truncate max-w-[9rem]" title={puramass.partner_reference}>
                {puramass.partner_reference}
              </span>
              <CopyButton value={puramass.partner_reference} label="partner reference" />
            </span>
          </Row>
        )}
        {goods != null && (
          <Row label="Goods charged">
            <span className="tabular-nums">
              {formatMoney(goods, cur)} <span className="text-xs text-ink-muted">{cur}</span>
            </span>
          </Row>
        )}
        {puramass.paid_at && (
          <Row label="Paid">{new Date(puramass.paid_at).toLocaleString()}</Row>
        )}
        {!puramass.paid_at && puramass.expires_at && (
          <Row label="Link expires">{new Date(puramass.expires_at).toLocaleString()}</Row>
        )}
        {puramass.created_at && (
          <Row label="Placed">{new Date(puramass.created_at).toLocaleString()}</Row>
        )}
      </div>

      {refunded > 0 && (
        <div className="mt-3 pt-3 border-t border-line/60">
          <div className="flex items-center justify-between text-sm">
            <span className="inline-flex items-center gap-1.5 text-amber-700 font-medium">
              <RotateCcw className="w-3.5 h-3.5" /> Refunded by PuraMass
            </span>
            <span className="tabular-nums font-semibold text-amber-700">
              – {formatMoney(refunded, cur)}
            </span>
          </div>
          {puramass.refunds.length > 0 && (
            <ul className="mt-2 space-y-1">
              {puramass.refunds.map((r, i) => (
                <li key={r.id ?? i} className="flex justify-between gap-2 text-[11px] text-ink-muted">
                  <span>
                    {r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}
                    {r.reason ? ` · ${r.reason}` : ''}
                  </span>
                  <span className="tabular-nums">
                    {r.amount_cents != null
                      ? `– ${formatMoney(centsToAmount(r.amount_cents) as number, cur)}`
                      : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {puramass.items.some((i) => i.sku) && (
        <div className="mt-3 pt-3 border-t border-line/60">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted mb-1.5">
            PuraMass SKUs
          </p>
          <ul className="space-y-1">
            {puramass.items.map((item, i) => (
              <li key={`${item.sku ?? item.name ?? i}`} className="flex justify-between gap-2 text-[11px]">
                <span className="font-mono text-ink-muted truncate" title={item.name ?? undefined}>
                  {item.sku ?? item.name}
                </span>
                <span className="text-ink-muted tabular-nums flex-shrink-0">
                  ×{item.quantity}
                  {item.unit_price_cents != null
                    ? ` · ${formatMoney(centsToAmount(item.unit_price_cents) as number, cur)}`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-line/60 flex flex-wrap items-center gap-3">
        {puramass.payment_link && (
          <a
            href={puramass.payment_link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-bronze hover:text-bronze/80"
          >
            <ExternalLink className="w-3.5 h-3.5" /> PuraMass transaction
          </a>
        )}
        <Link
          href="/admin/stealth-health?tab=orders"
          className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"
          title="Re-sync this order, or ask the customer for a missing address"
        >
          <Store className="w-3.5 h-3.5" /> Stealth Health Orders
        </Link>
      </div>
    </div>
  );
}

/**
 * An invoice's money, as the invoice table, the row preview and the invoice
 * detail view all render it.
 *
 * Normally that is one amount in one currency. A PuraMass hand-off can be two:
 * PuraMass charges the goods in the currency it reports on the ledger, while
 * the shipment fee stamped here is USD (see `puramassMoneySplit`). Nothing
 * converts between them, so rather than print their sum under the invoice's
 * stored currency — which describes the fee alone and made a CAD sale read as
 * USD — both amounts are shown, each labelled with its own currency.
 */
export function InvoiceTotalAmount({
  invoice,
  puramass,
  align = 'right',
  className = '',
}: {
  invoice: { subtotal?: unknown; shipping_cost?: unknown; total?: unknown; currency?: unknown };
  puramass?: PuramassInvoiceContext | null;
  align?: 'left' | 'right';
  className?: string;
}) {
  const split = puramassMoneySplit(invoice, puramass);

  if (!split) {
    const cur = normalizeCurrency(invoice.currency);
    return (
      <span className={`tabular-nums ${className}`}>
        {formatMoney(Number(invoice.total) || 0, cur)}
        <span className="ml-1 text-[10px] font-medium text-ink-muted">{cur}</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex flex-col ${align === 'right' ? 'items-end' : 'items-start'} ${className}`}
      title={
        `PuraMass charged the goods in ${split.goodsCurrency}; the ` +
        `${split.shippingCurrency} shipping fee is ours and is not converted. ` +
        'This invoice has no single-currency total.'
      }
    >
      <span className="tabular-nums">
        {formatMoney(split.goods, split.goodsCurrency)}
        <span className="ml-1 text-[10px] font-medium text-ink-muted">{split.goodsCurrency}</span>
      </span>
      {split.shipping > 0 && (
        <span className="text-[11px] font-normal text-ink-muted tabular-nums whitespace-nowrap">
          + {formatMoney(split.shipping, split.shippingCurrency)} {split.shippingCurrency} shipping
        </span>
      )}
    </span>
  );
}
