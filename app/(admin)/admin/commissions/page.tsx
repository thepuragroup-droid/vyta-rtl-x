'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Check, Search, DollarSign, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  getAllCommissions,
  markCommissionPaid,
  getAllSalesCommissions,
  markSalesCommissionPaid,
} from '@/lib/admin/api';

type Source = 'affiliate' | 'sales';

const PAGE_SIZE = 20;

type UnifiedCommission = {
  id: string;
  source: Source;
  recipient_name: string;
  recipient_email: string;
  reference: string;
  total: number;
  amount: number;
  status: string;
  paid_at: string | null;
  created_at: string;
};

export default function AdminCommissions() {
  const [commissions, setCommissions] = useState<UnifiedCommission[]>([]);
  const [paying, setPaying] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | Source>('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [recipientFilter, setRecipientFilter] = useState<string>('all');
  const [downloading, setDownloading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
    const [affiliate, sales] = await Promise.all([
      getAllCommissions(),
      getAllSalesCommissions(),
    ]);

    const affiliateRows: UnifiedCommission[] = affiliate.map((c) => ({
      id: c.id,
      source: 'affiliate',
      recipient_name: c.affiliate_name || '—',
      recipient_email: c.affiliate_email || '',
      // Keyed on an order (storefront) or an invoice (hosted checkout).
      reference: c.order_number || (c.order_id ?? c.invoice_id)?.slice(0, 8) || '—',
      total: c.order_total || 0,
      amount: c.amount || 0,
      status: c.status,
      paid_at: c.paid_at,
      created_at: c.created_at,
    }));

    const salesRows: UnifiedCommission[] = sales.map((c) => ({
      id: c.id,
      source: 'sales',
      recipient_name: c.sales_person_name || '—',
      recipient_email: c.sales_person_email || '',
      reference: c.invoice_number || c.invoice_id?.slice(0, 8) || '—',
      total: c.invoice_total || 0,
      amount: c.amount || 0,
      status: c.status,
      paid_at: c.paid_at,
      created_at: c.created_at,
    }));

    const merged = [...affiliateRows, ...salesRows].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    setCommissions(merged);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleMarkPaid = async (comm: UnifiedCommission) => {
    setPaying(comm.id);
    if (comm.source === 'affiliate') {
      await markCommissionPaid(comm.id);
    } else {
      await markSalesCommissionPaid(comm.id);
    }
    await load();
    setPaying(null);
  };

  const recipients = useMemo(() => {
    const map = new Map<string, { key: string; label: string; source: Source }>();
    for (const c of commissions) {
      if (!c.recipient_name || c.recipient_name === '—') continue;
      const key = `${c.source}::${c.recipient_name}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: `${c.recipient_name} (${c.source === 'affiliate' ? 'Affiliate' : 'Sales'})`,
          source: c.source,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [commissions]);

  const filtered = useMemo(() => {
    let result = commissions;
    if (sourceFilter !== 'all') {
      result = result.filter((c) => c.source === sourceFilter);
    }
    if (statusFilter !== 'all') {
      result = result.filter((c) => c.status === statusFilter);
    }
    if (recipientFilter !== 'all') {
      const [src, ...nameParts] = recipientFilter.split('::');
      const name = nameParts.join('::');
      result = result.filter((c) => c.source === src && c.recipient_name === name);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.recipient_name.toLowerCase().includes(q) ||
          c.recipient_email.toLowerCase().includes(q) ||
          c.reference.toLowerCase().includes(q),
      );
    }
    return result;
  }, [commissions, sourceFilter, statusFilter, recipientFilter, search]);

  // Reset to the first page whenever the active filters or search query change.
  useEffect(() => {
    setPage(0);
  }, [sourceFilter, statusFilter, recipientFilter, search]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, (page + 1) * PAGE_SIZE);
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const downloadReport = async () => {
    setDownloading(true);
    try {
      const params = new URLSearchParams();
      if (sourceFilter !== 'all') params.set('source', sourceFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (recipientFilter !== 'all') params.set('recipient', recipientFilter);
      if (search) params.set('q', search);
      const qs = params.toString();
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/admin/commissions/report${qs ? `?${qs}` : ''}`, {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (!res.ok) {
        alert('Could not generate report');
        return;
      }
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), '_blank');
    } finally {
      setDownloading(false);
    }
  };

  const pendingTotal = commissions
    .filter((c) => c.status === 'pending')
    .reduce((sum, c) => sum + c.amount, 0);
  const paidTotal = commissions
    .filter((c) => c.status === 'paid')
    .reduce((sum, c) => sum + c.amount, 0);

  return (
    <>
      {/* Stats */}
      <div className="flex flex-wrap gap-4 mb-6 text-sm">
        <div className="flex items-center gap-2 bg-white border border-line rounded-lg px-4 py-2.5">
          <DollarSign className="w-4 h-4 text-ink-muted" />
          <span className="text-ink font-semibold">{commissions.length}</span>
          <span className="text-ink-muted">total</span>
        </div>
        <div className="flex items-center gap-2 bg-white border border-line rounded-lg px-4 py-2.5">
          <span className="w-2 h-2 rounded-full bg-amber-500" />
          <span className="text-teal-dark font-semibold tabular-nums">${pendingTotal.toFixed(2)}</span>
          <span className="text-ink-muted">pending</span>
        </div>
        <div className="flex items-center gap-2 bg-white border border-line rounded-lg px-4 py-2.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-emerald-500 font-semibold tabular-nums">${paidTotal.toFixed(2)}</span>
          <span className="text-ink-muted">paid</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <input
            type="text"
            placeholder="Search by name, email, or order/invoice..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-line rounded-lg text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-teal/40"
          />
        </div>
        <select
          value={recipientFilter}
          onChange={(e) => setRecipientFilter(e.target.value)}
          className="px-3 pr-8 py-2.5 bg-white border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40 appearance-none max-w-[240px]"
        >
          <option value="all">All Recipients</option>
          {recipients.map((r) => (
            <option key={r.key} value={r.key}>{r.label}</option>
          ))}
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as 'all' | Source)}
          className="px-3 pr-8 py-2.5 bg-white border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40 appearance-none"
        >
          <option value="all">All Sources</option>
          <option value="affiliate">Affiliate</option>
          <option value="sales">Sales Person</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 pr-8 py-2.5 bg-white border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40 appearance-none"
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button
          onClick={downloadReport}
          disabled={downloading}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink hover:bg-ink/90 text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          <FileText className="w-4 h-4" />
          {downloading ? 'Generating…' : 'Download Report'}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="p-5 md:p-6 border-b border-line flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">All Commissions</h2>
          <span className="text-sm text-ink-muted">{filtered.length} shown</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead>
              <tr className="border-b border-line">
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Source</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Recipient</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Order / Invoice</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Total</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Commission</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => <CommissionSkeletonRow key={i} />)
              ) : pageRows.map((comm) => (
                <tr key={`${comm.source}-${comm.id}`} className="hover:bg-surface transition-colors">
                  <td className="px-5 py-4">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                      comm.source === 'affiliate'
                        ? 'bg-blue-500/10 text-blue-500'
                        : 'bg-purple-500/10 text-purple-500'
                    }`}>
                      {comm.source === 'affiliate' ? 'Affiliate' : 'Sales Person'}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <div className="font-medium text-ink text-sm">{comm.recipient_name}</div>
                    <div className="text-xs text-ink-muted">{comm.recipient_email}</div>
                  </td>
                  <td className="px-5 py-4 font-mono text-sm text-ink">{comm.reference}</td>
                  <td className="px-5 py-4 text-sm text-ink tabular-nums">${comm.total.toFixed(2)}</td>
                  <td className="px-5 py-4 font-semibold text-emerald-400 tabular-nums">${comm.amount.toFixed(2)}</td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                      comm.status === 'paid' ? 'bg-emerald-500/10 text-emerald-400' :
                      comm.status === 'pending' ? 'bg-amber-500/10 text-amber-400' :
                      'bg-red-500/10 text-red-400'
                    }`}>
                      {comm.status}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    {comm.status === 'pending' && (
                      <button
                        onClick={() => handleMarkPaid(comm)}
                        disabled={paying === comm.id}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg text-xs font-medium hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{paying === comm.id ? '...' : 'Mark Paid'}</span>
                      </button>
                    )}
                    {comm.status === 'paid' && (
                      <span className="text-xs text-ink-muted">
                        Paid {comm.paid_at ? new Date(comm.paid_at).toLocaleDateString() : ''}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-ink-muted text-sm">
                    {commissions.length === 0
                      ? 'No commissions yet'
                      : 'No commissions match your filters'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && total > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3 border-t border-line">
            <span className="text-sm text-ink-muted">
              Showing <span className="font-medium text-ink tabular-nums">{rangeStart}</span>–
              <span className="font-medium text-ink tabular-nums">{rangeEnd}</span> of{' '}
              <span className="font-medium text-ink tabular-nums">{total}</span>
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-muted">Page {page + 1} of {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line text-sm text-ink-muted hover:text-ink hover:border-ink/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" /> Prev
              </button>
              <button
                onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
                disabled={page + 1 >= totalPages}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line text-sm text-ink-muted hover:text-ink hover:border-ink/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function CommissionSkeletonRow() {
  return (
    <tr className="animate-pulse">
      <td className="px-5 py-4"><div className="h-5 w-16 bg-surface rounded-full" /></td>
      <td className="px-5 py-4">
        <div className="h-3.5 w-28 bg-surface rounded mb-1.5" />
        <div className="h-3 w-40 bg-surface rounded" />
      </td>
      <td className="px-5 py-4"><div className="h-3.5 w-20 bg-surface rounded" /></td>
      <td className="px-5 py-4"><div className="h-3.5 w-16 bg-surface rounded" /></td>
      <td className="px-5 py-4"><div className="h-4 w-16 bg-surface rounded" /></td>
      <td className="px-5 py-4"><div className="h-5 w-14 bg-surface rounded-full" /></td>
      <td className="px-5 py-4"><div className="h-7 w-24 bg-surface rounded-lg" /></td>
    </tr>
  );
}
