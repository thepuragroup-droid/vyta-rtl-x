'use client';

/**
 * Dialogs on the Stealth Health Payouts tab: fee rates, request payout, mark
 * received and void.
 */
import React, { useMemo, useState } from 'react';
import { Loader2, X, Percent, Send, CheckCircle2, Ban } from 'lucide-react';
import {
  orderPeriod,
  requestBlocker,
  sumOrders,
  type DateRange,
  type FeeRates,
  type PayoutOrder,
  type PayoutRequestView,
} from '@/lib/admin/stealth-health-payouts';
import { money, fmtDate } from '../ui';

function Modal({ title, icon: Icon, onClose, children, footer }: {
  title: string;
  icon: React.ElementType;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-white rounded-2xl border border-line w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-line sticky top-0 bg-white">
          <h3 className="text-base font-bold text-ink flex items-center gap-2">
            <Icon className="w-4 h-4 text-teal-dark" /> {title}
          </h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-line sticky bottom-0 bg-white">
          {footer}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-ink-muted font-semibold mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-ink-muted mt-1">{hint}</span>}
    </label>
  );
}

function PrimaryButton({ busy, disabled, onClick, children }: {
  busy: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} disabled={busy || disabled}
      className="inline-flex items-center gap-1.5 px-4 py-2 bg-teal-dark text-white rounded-lg text-sm font-medium hover:bg-teal/90 disabled:opacity-50">
      {busy && <Loader2 className="w-4 h-4 animate-spin" />} {children}
    </button>
  );
}

const Cancel = ({ onClose }: { onClose: () => void }) => (
  <button onClick={onClose} className="px-4 py-2 text-sm text-ink-muted hover:text-ink">Cancel</button>
);

const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <div className={`flex items-baseline justify-between gap-4 py-1 ${strong ? 'border-t border-line pt-2 mt-1' : ''}`}>
    <span className={strong ? 'text-sm font-semibold text-ink' : 'text-sm text-ink-muted'}>{label}</span>
    <span className={`tabular-nums ${strong ? 'text-base font-bold text-ink' : 'text-sm text-ink'}`}>{value}</span>
  </div>
);

// ---- Fee rates -------------------------------------------------------------

const toPct = (r: number) => String(Math.round(r * 100 * 100) / 100);

export function FeeRatesDialog({ rates, onClose, onSave }: {
  rates: FeeRates;
  onClose: () => void;
  onSave: (r: FeeRates) => Promise<void>;
}) {
  const [catalog, setCatalog] = useState(toPct(rates.catalog));
  const [custom, setCustom] = useState(toPct(rates.custom));
  const [busy, setBusy] = useState(false);
  const c = Number(catalog);
  const u = Number(custom);
  const valid = [c, u].every((n) => catalog !== '' && custom !== '' && Number.isFinite(n) && n >= 0 && n < 100);

  return (
    <Modal title="Processing fee rates" icon={Percent} onClose={onClose}
      footer={<>
        <Cancel onClose={onClose} />
        <PrimaryButton busy={busy} disabled={!valid} onClick={async () => {
          setBusy(true);
          try { await onSave({ catalog: c / 100, custom: u / 100 }); } finally { setBusy(false); }
        }}>Save rates</PrimaryButton>
      </>}>
      <p className="text-sm text-ink-muted">
        What Stealth Health keeps on each order, as a share of the total the customer was charged
        (shipping included).
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Catalog price (%)" hint="Price sent through checkout matched the catalog">
          <input type="number" min="0" max="99.99" step="0.01" value={catalog} inputMode="decimal"
            onChange={(e) => setCatalog(e.target.value)}
            className="w-full px-3 py-2 border border-line rounded-lg text-sm tabular-nums" />
        </Field>
        <Field label="Custom price (%)" hint="Order sold at a custom price">
          <input type="number" min="0" max="99.99" step="0.01" value={custom} inputMode="decimal"
            onChange={(e) => setCustom(e.target.value)}
            className="w-full px-3 py-2 border border-line rounded-lg text-sm tabular-nums" />
        </Field>
      </div>
      <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
        Changing a rate moves every order that isn&rsquo;t paid out yet, including orders on open requests.
        Paid-out orders keep the figures they were locked at.
      </p>
    </Modal>
  );
}

// ---- Request payout ----------------------------------------------------------

export function RequestPayoutDialog({ orders, filterRange, onClose, onCreate }: {
  /** The selected orders. */
  orders: PayoutOrder[];
  /** The date filter's range, used as the default period when set. */
  filterRange: DateRange;
  onClose: () => void;
  onCreate: (body: { order_ids: string[]; period_start: string | null; period_end: string | null; notes: string | null }) => Promise<void>;
}) {
  const eligible = useMemo(() => orders.filter((o) => !requestBlocker(o)), [orders]);
  const left = useMemo(() => orders.filter((o) => requestBlocker(o)), [orders]);
  const totals = sumOrders(eligible);
  const fallback = orderPeriod(eligible);
  const [from, setFrom] = useState(filterRange.from ?? fallback.from ?? '');
  const [to, setTo] = useState(filterRange.to ?? fallback.to ?? '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const reasons = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of left) {
      const r = requestBlocker(o)!.startsWith('already on') ? 'already on a request' : requestBlocker(o)!;
      m.set(r, (m.get(r) ?? 0) + 1);
    }
    return [...m.entries()].map(([r, n]) => `${n} ${r}`).join(', ');
  }, [left]);

  return (
    <Modal title="Request payout" icon={Send} onClose={onClose}
      footer={<>
        <Cancel onClose={onClose} />
        <PrimaryButton busy={busy} disabled={eligible.length === 0 || (!!from && !!to && from > to)} onClick={async () => {
          setBusy(true);
          try {
            await onCreate({
              order_ids: eligible.map((o) => o.id),
              period_start: from || null,
              period_end: to || null,
              notes: notes.trim() || null,
            });
          } finally { setBusy(false); }
        }}>Create request</PrimaryButton>
      </>}>
      {left.length > 0 && (
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
          {left.length} of the {orders.length} selected order{orders.length === 1 ? '' : 's'} {left.length === 1 ? 'is' : 'are'} left out ({reasons}).
        </p>
      )}
      {eligible.length === 0 ? (
        <p className="text-sm text-ink-muted">None of the selected orders can go on a request.</p>
      ) : (
        <>
          <div>
            <Row label={`${totals.count} order${totals.count === 1 ? '' : 's'} · gross`} value={money(totals.gross_cents, 'CAD')} />
            <Row label="Processing fees" value={`−${money(totals.fee_cents, 'CAD')}`} />
            <Row label="Net payout due" value={money(totals.net_cents, 'CAD')} strong />
            <p className="text-[11px] text-ink-muted mt-1.5">
              {totals.catalog_count} catalog · {totals.custom_count} custom
              {totals.usd_count > 0 && ` · ${totals.usd_count} converted from USD`}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Period from">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                className="w-full px-3 py-2 border border-line rounded-lg text-sm" />
            </Field>
            <Field label="Period to">
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                className="w-full px-3 py-2 border border-line rounded-lg text-sm" />
            </Field>
          </div>
          <Field label="Note on the PDF (optional)">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000}
              className="w-full px-3 py-2 border border-line rounded-lg text-sm resize-none" />
          </Field>
        </>
      )}
    </Modal>
  );
}

// ---- Mark received ---------------------------------------------------------------

export function ReceiveDialog({ request, onClose, onReceive }: {
  request: PayoutRequestView;
  onClose: () => void;
  onReceive: (amount: number | null, reference: string | null) => Promise<void>;
}) {
  const net = request.live.net_cents;
  const [amount, setAmount] = useState((net / 100).toFixed(2));
  const [reference, setReference] = useState(request.received_reference ?? '');
  const [busy, setBusy] = useState(false);
  const cents = amount.trim() === '' ? null : Math.round(Number(amount) * 100);
  const valid = cents == null || (Number.isFinite(cents) && cents >= 0);
  const diff = cents == null || !valid ? 0 : cents - net;

  return (
    <Modal title={`Mark ${request.payout_number} received`} icon={CheckCircle2} onClose={onClose}
      footer={<>
        <Cancel onClose={onClose} />
        <PrimaryButton busy={busy} disabled={!valid} onClick={async () => {
          setBusy(true);
          try { await onReceive(cents == null ? null : cents / 100, reference.trim() || null); } finally { setBusy(false); }
        }}>Mark received</PrimaryButton>
      </>}>
      <p className="text-sm text-ink-muted">
        Every order on this request that isn&rsquo;t paid out yet is marked paid out
        ({request.live.count - request.paid_count} of {request.live.count}).
      </p>
      <Field label="Amount received (CAD)"
        hint={diff !== 0 && valid
          ? <span className={diff < 0 ? 'text-rose-700' : 'text-amber-700'}>
              {diff < 0 ? `${money(-diff, 'CAD')} short of` : `${money(diff, 'CAD')} more than`} the {money(net, 'CAD')} net
            </span>
          : `Net payout due: ${money(net, 'CAD')}`}>
        <input type="number" min="0" step="0.01" value={amount} inputMode="decimal"
          onChange={(e) => setAmount(e.target.value)}
          className="w-full px-3 py-2 border border-line rounded-lg text-sm tabular-nums" />
      </Field>
      <Field label="Deposit reference (optional)">
        <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200}
          placeholder="e.g. their transfer ID"
          className="w-full px-3 py-2 border border-line rounded-lg text-sm" />
      </Field>
    </Modal>
  );
}

// ---- Void ----------------------------------------------------------------------------

export function VoidDialog({ request, onClose, onVoid }: {
  request: PayoutRequestView;
  onClose: () => void;
  onVoid: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Void ${request.payout_number}?`} icon={Ban} onClose={onClose}
      footer={<>
        <Cancel onClose={onClose} />
        <button onClick={async () => { setBusy(true); try { await onVoid(); } finally { setBusy(false); } }}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-rose-600 text-white rounded-lg text-sm font-medium hover:bg-rose-700 disabled:opacity-50">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Void request
        </button>
      </>}>
      <p className="text-sm text-ink-muted">
        Its {request.live.count} order{request.live.count === 1 ? '' : 's'} ({money(request.live.net_cents, 'CAD')} net)
        go back to <span className="font-medium text-ink">Not requested</span> and can go on a new request.
        The request number is kept, marked void. Requested {fmtDate(request.created_at)}.
      </p>
    </Modal>
  );
}

