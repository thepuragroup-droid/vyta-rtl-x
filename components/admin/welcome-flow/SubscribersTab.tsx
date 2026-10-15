'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, ExternalLink, Loader2, MousePointerClick, Eye, Search, UserPlus, X } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { adminFetch } from '@/components/admin/affiliates/api';
import {
  STEP_NUMBERS,
  SUBSCRIBER_STATUSES,
  SUBSCRIBER_STATUS_META,
  type FlowOverview,
  type SubscriberRow,
  type SubscriberSendRow,
} from '@/lib/welcome-flow/types';
import { fmtDateTime, fmtMoney, inputCls, labelCls, primaryBtn, secondaryBtn, StatusBadge, stepTitle } from './shared';

/** One dot per email: what happened to it for this person. */
function dotFor(send: SubscriberSendRow | undefined): { cls: string; label: string } {
  if (!send) return { cls: 'bg-white border border-line', label: 'Not sent yet' };
  switch (send.status) {
    case 'sent':
      if (send.clicked_at) return { cls: 'bg-emerald-500', label: 'Sent · clicked' };
      if (send.opened_at) return { cls: 'bg-sky-500', label: 'Sent · opened' };
      return { cls: 'bg-ink/70', label: 'Sent' };
    case 'failed':
      return { cls: 'bg-red-500', label: `Failed (${send.attempts} attempt${send.attempts === 1 ? '' : 's'})` };
    case 'skipped':
      return { cls: 'bg-gray-200', label: 'Skipped' };
    default:
      return { cls: 'bg-amber-400', label: 'Sending' };
  }
}

function Progress({ sub }: { sub: SubscriberRow }) {
  const by = new Map(sub.sends.map((s) => [s.step, s]));
  return (
    <div className="flex items-center gap-1.5">
      {STEP_NUMBERS.map((n) => {
        const d = dotFor(by.get(n));
        return <span key={n} title={`${stepTitle(n)}: ${d.label}`} className={`h-2.5 w-2.5 rounded-full ${d.cls}`} />;
      })}
    </div>
  );
}

function Outcome({ sub }: { sub: SubscriberRow }) {
  if (sub.status === 'converted') {
    return (
      <span className="text-xs text-emerald-700">
        {sub.converted_amount != null ? fmtMoney(sub.converted_amount, sub.converted_currency || 'CAD') : 'Purchased'}
        {sub.attributed_step ? ` · after email ${sub.attributed_step}` : ' · before any email'}
      </span>
    );
  }
  if (sub.status === 'active' && sub.next) {
    return (
      <span className="text-xs text-ink-muted">
        Email {sub.next.step} · {new Date(sub.next.at) <= new Date() ? 'due now' : fmtDateTime(sub.next.at, sub.timezone)}
      </span>
    );
  }
  if (sub.exit_reason) return <span className="text-xs text-ink-muted">{sub.exit_reason}</span>;
  return <span className="text-xs text-ink-muted">—</span>;
}

function Detail({ sub, editable, onChanged }: { sub: SubscriberRow; editable: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [tz, setTz] = useState(sub.timezone);
  const by = new Map(sub.sends.map((s) => [s.step, s]));

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    if (action === 'remove' && !confirm(`Stop the welcome emails for ${sub.email}?`)) return;
    setBusy(true);
    const res = await adminFetch(`/api/admin/welcome-flow/subscribers/${sub.id}`, { method: 'PATCH', body: { action, ...extra } });
    setBusy(false);
    if (!res.ok) return toast.error(res.data.error ?? 'Could not update');
    toast.success(action === 'remove' ? 'Removed from the flow' : action === 'resume' ? 'Back in the flow' : 'Time zone updated');
    onChanged();
  };

  return (
    <div className="grid gap-5 bg-surface/60 px-4 py-4 lg:grid-cols-[1fr_260px]">
      <ol className="space-y-2">
        {STEP_NUMBERS.map((n) => {
          const s = by.get(n);
          const d = dotFor(s);
          return (
            <li key={n} className="flex flex-wrap items-start gap-x-4 gap-y-1 rounded-lg border border-line bg-white px-3 py-2 text-xs">
              <span className={`mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full ${d.cls}`} />
              <span className="w-40 font-medium text-ink">{stepTitle(n)}</span>
              {s ? (
                <span className="flex flex-1 flex-wrap gap-x-4 gap-y-1 text-ink-muted">
                  <span>{s.status === 'sent' ? `Sent ${fmtDateTime(s.sent_at, sub.timezone)}` : d.label}</span>
                  {s.status === 'sent' && (
                    <>
                      <span className="inline-flex items-center gap-1">
                        <Eye className="h-3 w-3" /> {s.opened_at ? `${fmtDateTime(s.opened_at)} (${s.open_count}×)` : 'not opened'}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MousePointerClick className="h-3 w-3" /> {s.clicked_at ? `${fmtDateTime(s.clicked_at)} (${s.click_count}×)` : 'no clicks'}
                      </span>
                    </>
                  )}
                  {s.promo_code && <span>Code {s.promo_code}</span>}
                  {s.offer_ends_at && <span>Offer ends {fmtDateTime(s.offer_ends_at, sub.timezone)}</span>}
                  {s.error && <span className="text-red-600">{s.error}</span>}
                  {s.subject && <span className="basis-full italic">“{s.subject}”</span>}
                </span>
              ) : (
                <span className="text-ink-muted">
                  {sub.status === 'active' && sub.next?.step === n
                    ? `Next · ${new Date(sub.next.at) <= new Date() ? 'due now' : fmtDateTime(sub.next.at, sub.timezone)}`
                    : 'Not sent'}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <div className="space-y-3 text-xs">
        <dl className="space-y-1.5">
          <div className="flex justify-between gap-2"><dt className="text-ink-muted">Enrolled</dt><dd className="text-ink">{fmtDateTime(sub.enrolled_at)}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-ink-muted">Source</dt><dd className="text-ink">{sub.source === 'manual' ? 'Added by admin' : 'Signup'}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-ink-muted">Tags</dt><dd className="text-ink">{sub.tags.join(', ') || '—'}</dd></div>
          {sub.converted_at && (
            <div className="flex justify-between gap-2"><dt className="text-ink-muted">Purchased</dt><dd className="text-ink">{fmtDateTime(sub.converted_at)}</dd></div>
          )}
          {sub.converted_order_ref && (
            <div className="flex justify-between gap-2"><dt className="text-ink-muted">Order</dt><dd className="truncate font-mono text-ink">{sub.converted_order_ref.replace(/^\w+:/, '')}</dd></div>
          )}
        </dl>

        {sub.customer_id && (
          <Link href={`/admin/customers/${sub.customer_id}`} className="inline-flex items-center gap-1 font-medium text-teal-dark hover:underline">
            Customer profile <ExternalLink className="h-3 w-3" />
          </Link>
        )}

        {editable && (
          <div className="space-y-2 border-t border-line pt-3">
            <label className={labelCls}>Time zone (send window)</label>
            <div className="flex gap-2">
              <input value={tz} onChange={(e) => setTz(e.target.value)} className={inputCls} placeholder="America/Toronto" />
              <button type="button" disabled={busy || tz === sub.timezone} onClick={() => act('timezone', { timezone: tz })} className={secondaryBtn}>
                Save
              </button>
            </div>
            {sub.status === 'active' && (
              <button type="button" disabled={busy} onClick={() => act('remove')} className={`${secondaryBtn} w-full justify-center text-red-700`}>
                Remove from flow
              </button>
            )}
            {sub.status === 'exited' && (
              <button type="button" disabled={busy} onClick={() => act('resume')} className={`${secondaryBtn} w-full justify-center`}>
                Resume flow
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AddSubscriber({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await adminFetch<{ sent?: number }>('/api/admin/welcome-flow/subscribers', { method: 'POST', body: { email, consent } });
    setBusy(false);
    if (!res.ok) return toast.error(res.data.error ?? 'Could not add them');
    toast.success(res.data.sent ? 'Added — Email 1 sent' : 'Added to the flow');
    onAdded();
    onClose();
  };

  return (
    <form onSubmit={submit} className="rounded-xl border border-line bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">Add someone to the flow</p>
        <button type="button" onClick={onClose} className="text-ink-muted hover:text-ink" aria-label="Close"><X className="h-4 w-4" /></button>
      </div>
      <p className="mb-3 text-xs text-ink-muted">
        For testing the series on yourself, or a customer who asked to join. They need an account and must not have
        ordered yet. If the flow is on, Email 1 goes straight away.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <label className={labelCls}>Account email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="name@example.com" />
        </div>
        <label className="flex items-center gap-2 text-xs text-ink">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          They agreed to receive marketing email
        </label>
        <button type="submit" disabled={busy || !consent} className={primaryBtn}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Add
        </button>
      </div>
    </form>
  );
}

export default function SubscribersTab({ editable, overview, onChanged }: {
  editable: boolean;
  overview: FlowOverview | null;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<SubscriberRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (status) params.set('status', status);
    if (query) params.set('q', query);
    const res = await adminFetch<{ subscribers: SubscriberRow[]; total: number; pageSize: number }>(
      `/api/admin/welcome-flow/subscribers?${params}`,
    );
    setLoading(false);
    if (!res.ok) return toast.error(res.data.error ?? 'Could not load subscribers');
    setRows(res.data.subscribers ?? []);
    setTotal(res.data.total ?? 0);
    setPageSize(res.data.pageSize ?? 50);
  }, [page, status, query, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = () => {
    load();
    onChanged();
  };

  const counts = overview?.byStatus;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { setStatus(''); setPage(0); }}
          className={`rounded-full px-3 py-1.5 text-xs font-medium ${status === '' ? 'bg-ink text-white' : 'border border-line bg-white text-ink-muted hover:text-ink'}`}
        >
          All{overview ? ` · ${overview.enrolled}` : ''}
        </button>
        {SUBSCRIBER_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => { setStatus(s); setPage(0); }}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${status === s ? 'bg-ink text-white' : 'border border-line bg-white text-ink-muted hover:text-ink'}`}
          >
            {SUBSCRIBER_STATUS_META[s].label}{counts ? ` · ${counts[s]}` : ''}
          </button>
        ))}
        <form
          onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); setPage(0); }}
          className="relative ml-auto w-full sm:w-64"
        >
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" className={`${inputCls} pl-9`} />
        </form>
        {editable && !adding && (
          <button type="button" onClick={() => setAdding(true)} className={secondaryBtn}>
            <UserPlus className="h-4 w-4" /> Add
          </button>
        )}
      </div>

      {adding && <AddSubscriber onClose={() => setAdding(false)} onAdded={refresh} />}

      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.08em] text-ink-muted">
              <th className="w-8 px-3 py-2.5" />
              <th className="px-3 py-2.5 font-semibold">Subscriber</th>
              <th className="px-3 py-2.5 font-semibold">Enrolled</th>
              <th className="px-3 py-2.5 font-semibold">Emails 1–5</th>
              <th className="px-3 py-2.5 font-semibold">Status</th>
              <th className="px-3 py-2.5 font-semibold">Next / outcome</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-ink-muted" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="py-12 text-center text-sm text-ink-muted">
                {query || status ? 'Nobody matches.' : 'Nobody has been enrolled yet. New consenting signups appear here once the flow is on.'}
              </td></tr>
            ) : (
              rows.map((sub) => (
                <React.Fragment key={sub.id}>
                  <tr
                    onClick={() => setOpen(open === sub.id ? null : sub.id)}
                    className="cursor-pointer border-b border-line last:border-0 hover:bg-surface/60"
                  >
                    <td className="px-3 py-3 text-ink-muted">
                      {open === sub.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-medium text-ink">{sub.first_name || '—'}</p>
                      <p className="text-xs text-ink-muted">{sub.email}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-ink-muted">{fmtDateTime(sub.enrolled_at)}</td>
                    <td className="px-3 py-3"><Progress sub={sub} /></td>
                    <td className="px-3 py-3"><StatusBadge status={sub.status} /></td>
                    <td className="px-3 py-3"><Outcome sub={sub} /></td>
                  </tr>
                  {open === sub.id && (
                    <tr className="border-b border-line">
                      <td colSpan={6} className="p-0"><Detail sub={sub} editable={editable} onChanged={refresh} /></td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-ink-muted">
        <span className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-ink/70" /> Sent</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-sky-500" /> Opened</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Clicked</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Failed</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-gray-200" /> Skipped</span>
        </span>
        {pages > 1 && (
          <span className="flex items-center gap-2">
            <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className={secondaryBtn}>Previous</button>
            Page {page + 1} of {pages}
            <button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} className={secondaryBtn}>Next</button>
          </span>
        )}
      </div>
    </div>
  );
}
