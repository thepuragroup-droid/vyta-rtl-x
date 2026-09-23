'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Banknote, Copy, Loader2, Pencil, Plus, Ticket, Trash2, AlertCircle,
} from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { payoutMethodLabel, type AffiliateBalance } from '@/lib/affiliate/payouts';
import {
  adminFetch, codeStatus, describeCode, fmtMoney, shareLink, type AdminDiscountCode,
} from './api';
import DiscountCodeModal from './DiscountCodeModal';
import RecordPayoutModal, { type PayableCommission } from './RecordPayoutModal';

interface Payout {
  id: string;
  amount: number;
  method: string;
  reference: string | null;
  notes: string | null;
  paid_at: string;
  recorded_by_name: string | null;
}

interface PayoutData {
  migrationNeeded: boolean;
  summary: AffiliateBalance;
  payouts: Payout[];
  commissions: (PayableCommission & { status: string; payout_id: string | null })[];
}

const toneCls: Record<string, string> = {
  green: 'bg-emerald-100 text-emerald-700',
  gray: 'bg-gray-100 text-ink-muted',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
};

/**
 * The affiliate profile's discount codes, revenue and payout ledger — the
 * GoAffPro-style "what did they bring in, what do we owe them, what have we
 * sent" view.
 */
export default function AffiliateCodesPayouts({
  affiliateId,
  affiliateName,
  editable,
}: {
  affiliateId: string;
  affiliateName: string;
  editable: boolean;
}) {
  const toast = useToast();
  const [codes, setCodes] = useState<AdminDiscountCode[]>([]);
  const [codesMissing, setCodesMissing] = useState(false);
  const [payoutData, setPayoutData] = useState<PayoutData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AdminDiscountCode | null | 'new'>(null);
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [c, p] = await Promise.all([
      adminFetch<{ codes?: AdminDiscountCode[]; migrationNeeded?: boolean }>(
        `/api/admin/discount-codes?affiliate_id=${affiliateId}`,
      ),
      adminFetch<PayoutData>(`/api/admin/affiliates/${affiliateId}/payouts`),
    ]);
    setCodes(c.data.codes ?? []);
    setCodesMissing(!!c.data.migrationNeeded);
    if (p.ok) setPayoutData(p.data);
    setLoading(false);
  }, [affiliateId]);

  useEffect(() => {
    load();
  }, [load]);

  const voidPayout = async (p: Payout) => {
    if (!confirm(`Void the ${fmtMoney(p.amount)} payout from ${new Date(p.paid_at).toLocaleDateString()}? The commissions it settled go back to pending.`)) return;
    setBusy(p.id);
    const res = await adminFetch(`/api/admin/affiliates/${affiliateId}/payouts/${p.id}`, { method: 'DELETE' });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.data.error ?? 'Could not void the payout');
      return;
    }
    toast.success('Payout voided');
    load();
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-line bg-white py-10">
        <Loader2 className="h-5 w-5 animate-spin text-ink-muted" />
      </div>
    );
  }

  const s = payoutData?.summary;
  const pending = (payoutData?.commissions ?? []).filter((c) => c.status === 'pending');
  const codeRevenue = codes.reduce((sum, c) => sum + c.stats.revenue, 0);
  const codeOrders = codes.reduce((sum, c) => sum + c.stats.orders, 0);

  return (
    <div className="space-y-5">
      {(codesMissing || payoutData?.migrationNeeded) && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          Discount codes and payouts need <span className="font-mono">affiliate-discount-codes-payouts-migration.sql</span> to
          be run in Supabase.
        </div>
      )}

      {/* Revenue + balance */}
      {s && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Revenue brought in" value={fmtMoney(s.revenue)} hint={`${s.orders} credited sale${s.orders === 1 ? '' : 's'}`} />
          <Stat label="Commission earned" value={fmtMoney(s.earned)} hint={`${s.pendingCount} pending · ${fmtMoney(s.pendingAmount)}`} />
          <Stat
            label="Paid out"
            value={fmtMoney(s.paidOut)}
            hint={
              s.paidUnrecorded > 0
                ? `${fmtMoney(s.paidUnrecorded)} marked paid without a payout record`
                : `${payoutData?.payouts.length ?? 0} payment${payoutData?.payouts.length === 1 ? '' : 's'}`
            }
          />
          <Stat
            label="Balance owed"
            value={fmtMoney(s.balance)}
            hint={s.balance < 0 ? 'Overpaid' : s.balance === 0 ? 'All settled' : 'Earned, not yet paid'}
            highlight={s.balance > 0}
          />
        </div>
      )}

      {/* Discount codes */}
      <Section
        icon={<Ticket className="h-4 w-4 text-teal-dark" />}
        title="Discount codes"
        meta={codes.length > 0 ? `${codeOrders} orders · ${fmtMoney(codeRevenue)}` : undefined}
        action={
          editable && !codesMissing ? (
            <button
              onClick={() => setEditing('new')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
            >
              <Plus className="h-3.5 w-3.5" /> New code
            </button>
          ) : null
        }
      >
        {codes.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-ink-muted">
            No discount codes assigned. Create one and every paid order that uses it is credited to {affiliateName}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-muted">
                  <th className="px-4 py-2 font-semibold">Code</th>
                  <th className="px-4 py-2 font-semibold">Discount</th>
                  <th className="px-4 py-2 text-right font-semibold">Uses</th>
                  <th className="px-4 py-2 text-right font-semibold">Revenue</th>
                  <th className="px-4 py-2 text-right font-semibold">Commission</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {codes.map((c) => {
                  const st = codeStatus(c);
                  return (
                    <tr key={c.id}>
                      <td className="px-4 py-2.5 font-mono font-semibold text-ink">{c.code}</td>
                      <td className="px-4 py-2.5 text-ink">
                        {describeCode(c)}
                        <span className="block text-[11px] text-ink-muted">
                          {c.commission_rate != null ? `${c.commission_rate}% commission` : 'Default commission'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                        {c.stats.orders}{c.max_uses != null ? ` / ${c.max_uses}` : ''}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink">{fmtMoney(c.stats.revenue)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink">{fmtMoney(c.stats.commission)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${toneCls[st.tone]}`}>{st.label}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          <IconBtn title="Copy checkout link" onClick={() => copy(shareLink(c.code))}>
                            <Copy className="h-3.5 w-3.5" />
                          </IconBtn>
                          {editable && (
                            <IconBtn title="Edit" onClick={() => setEditing(c)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </IconBtn>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Payouts */}
      <Section
        icon={<Banknote className="h-4 w-4 text-teal-dark" />}
        title="Payments to affiliate"
        meta={payoutData ? `${payoutData.payouts.length}` : undefined}
        action={
          editable && !payoutData?.migrationNeeded ? (
            <button
              onClick={() => setPaying(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-2.5 py-1 text-xs font-medium text-white hover:bg-ink/90"
            >
              <Plus className="h-3.5 w-3.5" /> Record payment
            </button>
          ) : null
        }
      >
        {(payoutData?.payouts ?? []).length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-ink-muted">No payments recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-muted">
                  <th className="px-4 py-2 font-semibold">Date</th>
                  <th className="px-4 py-2 text-right font-semibold">Amount</th>
                  <th className="px-4 py-2 font-semibold">Method</th>
                  <th className="px-4 py-2 font-semibold">Reference</th>
                  <th className="px-4 py-2 text-right font-semibold">Settled</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {payoutData!.payouts.map((p) => {
                  const settled = payoutData!.commissions.filter((c) => c.payout_id === p.id).length;
                  return (
                    <tr key={p.id}>
                      <td className="px-4 py-2.5 text-ink">
                        {new Date(p.paid_at).toLocaleDateString()}
                        {p.recorded_by_name && (
                          <span className="block text-[11px] text-ink-muted">by {p.recorded_by_name}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">{fmtMoney(p.amount)}</td>
                      <td className="px-4 py-2.5 text-ink">{payoutMethodLabel(p.method)}</td>
                      <td className="max-w-[220px] px-4 py-2.5 text-ink">
                        <span className="block truncate font-mono text-xs">{p.reference || '—'}</span>
                        {p.notes && <span className="block truncate text-[11px] text-ink-muted">{p.notes}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs tabular-nums text-ink-muted">
                        {settled} commission{settled === 1 ? '' : 's'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {editable && (
                          <IconBtn title="Void payout" onClick={() => voidPayout(p)} disabled={busy === p.id}>
                            {busy === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </IconBtn>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {editing && (
        <DiscountCodeModal
          existing={editing === 'new' ? null : editing}
          fixedAffiliate={{ id: affiliateId, name: affiliateName }}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast.success(editing === 'new' ? 'Discount code created' : 'Discount code saved');
            setEditing(null);
            load();
          }}
        />
      )}

      {paying && s && (
        <RecordPayoutModal
          affiliateId={affiliateId}
          affiliateName={affiliateName}
          pending={pending}
          balance={s.balance}
          onClose={() => setPaying(false)}
          onSaved={(settled) => {
            toast.success(`Payment recorded${settled ? ` · ${settled} commission${settled === 1 ? '' : 's'} marked paid` : ''}`);
            setPaying(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, hint, highlight }: { label: string; value: string; hint?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border bg-white p-4 ${highlight ? 'border-teal/50' : 'border-line'}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{label}</p>
      <p className={`mt-2 text-lg font-bold ${highlight ? 'text-teal-dark' : 'text-ink'}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

function Section({
  icon, title, meta, action, children,
}: { icon: React.ReactNode; title: string; meta?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-teal/10">{icon}</div>
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {meta && <span className="text-xs tabular-nums text-ink-muted">{meta}</span>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function IconBtn({
  title, onClick, disabled, children,
}: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-surface hover:text-ink disabled:opacity-50"
    >
      {children}
    </button>
  );
}
