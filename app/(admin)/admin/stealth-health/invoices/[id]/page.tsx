'use client';

/**
 * One settlement invoice raised against Stealth Health: the claim, the orders
 * behind it, the payouts received, and the print view you actually send them.
 *
 * Everything on the page is re-derived from the terms FROZEN on the invoice, so
 * a later change to the commission can never restate an invoice already sent.
 */
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Loader2, Printer, Send, CheckCircle2, Ban, Wallet, FileText, Info,
} from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { useUserRole } from '@/app/(admin)/admin/layout';
import {
  getSettlementInvoice,
  updateSettlementInvoice,
  getSettlementTerms,
  type SettlementInvoiceDTO,
  type SettlementOrderDTO,
  type SettlementPayoutDTO,
} from '@/lib/admin/stealth-health-client';
import { DEFAULT_TERMS, type SettlementTerms } from '@/lib/admin/stealth-health';
import { money, fmtInt, fmtDate, StatusBadge, MoneyRow } from '../../_components/ui';

export default function SettlementInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const isAdmin = useUserRole() === 'admin';

  const [invoice, setInvoice] = useState<SettlementInvoiceDTO | null>(null);
  const [orders, setOrders] = useState<SettlementOrderDTO[]>([]);
  const [payouts, setPayouts] = useState<SettlementPayoutDTO[]>([]);
  const [terms, setTerms] = useState<SettlementTerms>(DEFAULT_TERMS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, t] = await Promise.all([getSettlementInvoice(id), getSettlementTerms()]);
      setInvoice(r.invoice);
      setOrders(r.orders ?? []);
      setPayouts(r.payouts ?? []);
      if (t) setTerms(t.terms);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load the invoice');
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (status: 'sent' | 'paid' | 'void') => {
    if (status === 'void' && !confirm(
      'Void this invoice? Its orders go back to unbilled so they can be re-invoiced. This cannot be undone.',
    )) return;
    setBusy(true);
    try {
      const r = await updateSettlementInvoice(id, { status });
      setInvoice(r.invoice);
      toast.success(status === 'void' ? 'Invoice voided' : `Marked as ${status}`);
      if (status === 'void') await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the invoice');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-ink-muted" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-sm text-ink-muted">That settlement invoice could not be found.</p>
        <button onClick={() => router.push('/admin/stealth-health')}
          className="text-sm text-bronze hover:underline">Back to Stealth Health</button>
      </div>
    );
  }

  const cur = invoice.currency;
  const paidPct = invoice.amount_due_cents > 0
    ? Math.min(100, Math.round((invoice.paid_cents / invoice.amount_due_cents) * 100))
    : 0;

  return (
    <>
      {/* Screen-only chrome — the print view below is what they receive. */}
      <div className="print:hidden">
        <Link href="/admin/stealth-health"
          className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink mb-3">
          <ArrowLeft className="w-4 h-4" /> Stealth Health
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h1 className="text-2xl font-bold text-ink flex items-center gap-2.5">
              {invoice.invoice_number} <StatusBadge status={invoice.status} />
            </h1>
            <p className="text-sm text-ink-muted mt-0.5">
              Settlement invoice to {terms.partner_name}
              {invoice.created_by_email ? ` · raised by ${invoice.created_by_email}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-line rounded-lg text-sm text-ink hover:bg-surface">
              <Printer className="w-4 h-4" /> Print / PDF
            </button>
            {isAdmin && invoice.status === 'draft' && (
              <button onClick={() => setStatus('sent')} disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-bronze text-white rounded-lg text-sm font-medium hover:bg-bronze/90 disabled:opacity-50">
                <Send className="w-4 h-4" /> Mark as sent
              </button>
            )}
            {isAdmin && (invoice.status === 'sent' || invoice.status === 'partial') && (
              <button onClick={() => setStatus('paid')} disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                <CheckCircle2 className="w-4 h-4" /> Mark as paid
              </button>
            )}
            {isAdmin && invoice.status !== 'void' && (
              <button onClick={() => setStatus('void')} disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-rose-200 text-rose-700 rounded-lg text-sm hover:bg-rose-50 disabled:opacity-50">
                <Ban className="w-4 h-4" /> Void
              </button>
            )}
          </div>
        </div>

        {invoice.status === 'void' && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 mb-5 text-sm text-rose-900">
            This invoice was voided on {fmtDate(invoice.voided_at)}. Its orders were released back to
            unbilled and will be picked up by the next settlement invoice.
          </div>
        )}

        {/* Money at a glance */}
        <div className="grid sm:grid-cols-3 gap-3 mb-6">
          <div className="bg-white rounded-xl border border-line p-5">
            <p className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold mb-1">Amount due</p>
            <p className="text-2xl font-bold tabular-nums text-ink">{money(invoice.amount_due_cents, cur)}</p>
            <p className="text-xs text-ink-muted mt-1">{fmtInt(invoice.order_count)} paid hand-offs</p>
          </div>
          <div className="bg-white rounded-xl border border-line p-5">
            <p className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold mb-1">Received</p>
            <p className="text-2xl font-bold tabular-nums text-emerald-700">{money(invoice.paid_cents, cur)}</p>
            <div className="h-1.5 bg-surface rounded-full overflow-hidden mt-2">
              <div className="h-full bg-emerald-500 rounded-full transition-[width] duration-500"
                style={{ width: `${paidPct}%` }} />
            </div>
          </div>
          <div className="bg-white rounded-xl border border-line p-5">
            <p className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold mb-1">Outstanding</p>
            <p className={`text-2xl font-bold tabular-nums ${invoice.balance_cents > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
              {money(invoice.balance_cents, cur)}
            </p>
            <p className="text-xs text-ink-muted mt-1">Due {fmtDate(invoice.due_date)}</p>
          </div>
        </div>

        {payouts.length > 0 && (
          <div className="bg-white rounded-xl border border-line p-5 mb-6">
            <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
              <Wallet className="w-4 h-4 text-bronze" /> Payouts against this invoice
            </h3>
            <div className="divide-y divide-line -my-2">
              {payouts.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-ink-muted">
                    {fmtDate(p.received_at)}{p.method ? ` · ${p.method}` : ''}{p.reference ? ` · ${p.reference}` : ''}
                  </span>
                  <span className="tabular-nums font-medium text-emerald-700">
                    {money(p.amount_cents, p.currency)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* The hand-offs billed */}
        <div className="bg-white rounded-xl border border-line overflow-hidden mb-6">
          <div className="px-5 py-3.5 border-b border-line flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
              <FileText className="w-4 h-4 text-bronze" /> Hand-offs on this invoice
            </h3>
            <span className="text-xs text-ink-muted">{fmtInt(orders.length)} orders</span>
          </div>
          {orders.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-muted">
              No hand-offs are attached — they were released when this invoice was voided.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface text-[10px] uppercase tracking-wider text-ink-muted">
                  <tr>
                    <th className="text-left font-semibold px-4 py-2.5">Paid</th>
                    <th className="text-left font-semibold px-4 py-2.5">Reference</th>
                    <th className="text-left font-semibold px-4 py-2.5">Buyer</th>
                    <th className="text-right font-semibold px-4 py-2.5">Goods</th>
                    <th className="text-right font-semibold px-4 py-2.5">Refunds</th>
                    <th className="text-right font-semibold px-4 py-2.5">Shipping</th>
                    <th className="text-right font-semibold px-4 py-2.5">Their cut</th>
                    <th className="text-right font-semibold px-4 py-2.5">Owed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {orders.map((o) => (
                    <tr key={o.id} className="hover:bg-surface/60">
                      <td className="px-4 py-2.5 whitespace-nowrap text-ink-muted text-xs">{o.day ?? '—'}</td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-ink-muted truncate max-w-[10rem]"
                        title={o.transaction_id ?? undefined}>
                        {o.partner_reference ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-ink-muted truncate max-w-[14rem]">
                        {o.customer_email ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{money(o.gross_cents, cur)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                        {o.refunds_cents > 0 ? `− ${money(o.refunds_cents, cur)}` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                        {o.shipping_cents > 0 ? money(o.shipping_cents, cur) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                        {o.fee_cents > 0 ? `− ${money(o.fee_cents, cur)}` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-ink">
                        {money(o.due_cents, cur)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 flex gap-2.5 mb-8">
          <Info className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-900 leading-relaxed">
            The figures above use the terms frozen on this invoice
            {invoice.commission_pct > 0 ? ` (${invoice.commission_pct}% commission)` : ' (no commission)'}
            {invoice.flat_fee_cents > 0 ? ` plus ${money(invoice.flat_fee_cents, cur)} per order` : ''}
            {invoice.shipping_remitted ? ', shipment fees remitted' : ', shipment fees retained by them'}.
            Changing the terms later will not restate this invoice.
          </p>
        </div>
      </div>

      {/* Print view — what Stealth Health receives. */}
      <PrintableInvoice invoice={invoice} orders={orders} terms={terms} />
    </>
  );
}

/**
 * The document itself. Hidden on screen and shown only when printing, so the
 * admin page keeps its controls while `window.print()` produces a clean invoice
 * with no navigation, buttons or status chrome on it.
 */
function PrintableInvoice({ invoice, orders, terms }: {
  invoice: SettlementInvoiceDTO;
  orders: SettlementOrderDTO[];
  terms: SettlementTerms;
}) {
  const cur = invoice.currency;
  return (
    <div className="hidden print:block text-[11px] text-black">
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-xl font-bold mb-1">Settlement Invoice</h1>
          <p className="text-[13px] font-semibold">{invoice.invoice_number}</p>
        </div>
        <div className="text-right">
          <p><span className="text-gray-500">Issued </span>{fmtDate(invoice.issue_date)}</p>
          <p><span className="text-gray-500">Due </span>{fmtDate(invoice.due_date)}</p>
          {(invoice.period_start || invoice.period_end) && (
            <p><span className="text-gray-500">Period </span>{fmtDate(invoice.period_start)} – {fmtDate(invoice.period_end)}</p>
          )}
        </div>
      </div>

      <div className="mb-6">
        <p className="text-gray-500 uppercase tracking-wider text-[9px] font-semibold mb-1">Billed to</p>
        <p className="font-semibold">{terms.partner_name}</p>
        {terms.partner_email && <p>{terms.partner_email}</p>}
        {terms.partner_address && <p className="whitespace-pre-line">{terms.partner_address}</p>}
      </div>

      <p className="mb-4 leading-relaxed">
        For {fmtInt(invoice.order_count)} order{invoice.order_count === 1 ? '' : 's'} paid through the
        Stealth Health hosted checkout and fulfilled by us
        {invoice.period_start || invoice.period_end
          ? ` between ${fmtDate(invoice.period_start)} and ${fmtDate(invoice.period_end)}`
          : ''}.
      </p>

      <table className="w-full mb-6 border-collapse">
        <thead>
          <tr className="border-b border-black">
            <th className="text-left py-1.5 font-semibold">Date</th>
            <th className="text-left py-1.5 font-semibold">Reference</th>
            <th className="text-right py-1.5 font-semibold">Goods</th>
            <th className="text-right py-1.5 font-semibold">Refunds</th>
            <th className="text-right py-1.5 font-semibold">Shipping</th>
            <th className="text-right py-1.5 font-semibold">Fees</th>
            <th className="text-right py-1.5 font-semibold">Owed</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="border-b border-gray-200">
              <td className="py-1">{o.day ?? '—'}</td>
              <td className="py-1 font-mono text-[10px]">{o.partner_reference ?? '—'}</td>
              <td className="py-1 text-right tabular-nums">{money(o.gross_cents, cur)}</td>
              <td className="py-1 text-right tabular-nums">{o.refunds_cents > 0 ? `−${money(o.refunds_cents, cur)}` : '—'}</td>
              <td className="py-1 text-right tabular-nums">{o.shipping_cents > 0 ? money(o.shipping_cents, cur) : '—'}</td>
              <td className="py-1 text-right tabular-nums">{o.fee_cents > 0 ? `−${money(o.fee_cents, cur)}` : '—'}</td>
              <td className="py-1 text-right tabular-nums font-semibold">{money(o.due_cents, cur)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="ml-auto w-64">
        <MoneyRow label="Goods collected" cents={invoice.gross_cents} currency={cur} />
        {invoice.refunds_cents > 0 && <MoneyRow label="Refunds" cents={invoice.refunds_cents} currency={cur} sign="−" />}
        {invoice.shipping_cents > 0 && <MoneyRow label="Shipment fees" cents={invoice.shipping_cents} currency={cur} sign="+" />}
        {invoice.fee_cents > 0 && <MoneyRow label={`Retained by ${terms.partner_name}`} cents={invoice.fee_cents} currency={cur} sign="−" />}
        <MoneyRow label="Total due" cents={invoice.amount_due_cents} currency={cur} strong />
        {invoice.paid_cents > 0 && (
          <>
            <MoneyRow label="Received" cents={invoice.paid_cents} currency={cur} sign="−" />
            <MoneyRow label="Balance" cents={invoice.balance_cents} currency={cur} strong />
          </>
        )}
      </div>

      {(invoice.notes || terms.notes) && (
        <div className="mt-8 pt-4 border-t border-gray-300">
          {invoice.notes && <p className="whitespace-pre-line mb-2">{invoice.notes}</p>}
          {terms.notes && <p className="whitespace-pre-line text-gray-600">{terms.notes}</p>}
        </div>
      )}
    </div>
  );
}
