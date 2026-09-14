'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronLeft, RefreshCw, Mail } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { apiFetch } from '@/lib/api-fetch';

interface CategoryMeta {
  id: string;
  label: string;
  description: string;
}

interface ReasonCount {
  reason: string;
  label: string;
  count: number;
}

interface Summary {
  category: string;
  total: number;
  byReason: ReasonCount[];
}

interface ErrorEntry {
  id: string;
  category: string;
  source: string;
  kind: string;
  reason: string;
  reason_label: string;
  reason_hint: string;
  error: string | null;
  to_email: string | null;
  subject: string | null;
  reference_type: 'order' | 'invoice' | null;
  reference_id: string | null;
  created_at: string;
}

// Human labels for the email `kind` values (mirrors lib/admin/error-log.ts).
const KIND_LABELS: Record<string, string> = {
  etransfer_ack: 'Order acknowledgement',
  etransfer_instructions: 'e-Transfer instructions',
  etransfer_admin_notice: 'Admin order notice',
  packed: 'Packed notice',
  shipped: 'Shipped notice',
  invoice: 'Invoice email',
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

export default function ErrorLogPage() {
  const [categories, setCategories] = useState<CategoryMeta[]>([]);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [entries, setEntries] = useState<ErrorEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeCategory, setActiveCategory] = useState<string>('order_email');
  const [reasonFilter, setReasonFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setError('Not authenticated');
        setLoading(false);
        return;
      }
      const data = await apiFetch<{
        categories: CategoryMeta[];
        summaries: Summary[];
        entries: ErrorEntry[];
      }>('/api/admin/error-log?limit=500', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setCategories(data.categories ?? []);
      setSummaries(data.summaries ?? []);
      setEntries(data.entries ?? []);
      if (data.categories?.length && !data.categories.some((c) => c.id === activeCategory)) {
        setActiveCategory(data.categories[0].id);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load error log');
    }
    setLoading(false);
  }

  const activeSummary = useMemo(
    () => summaries.find((s) => s.category === activeCategory) ?? null,
    [summaries, activeCategory],
  );

  const activeMeta = useMemo(
    () => categories.find((c) => c.id === activeCategory) ?? null,
    [categories, activeCategory],
  );

  const categoryTotal = useMemo(
    () => entries.filter((e) => e.category === activeCategory).length,
    [entries, activeCategory],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (e.category !== activeCategory) return false;
      if (reasonFilter !== 'all' && e.reason !== reasonFilter) return false;
      if (q) {
        const hay = `${e.to_email ?? ''} ${e.subject ?? ''} ${e.error ?? ''} ${kindLabel(e.kind)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, activeCategory, reasonFilter, search]);

  return (
    <div className="max-w-5xl">
      <Link
        href="/admin/settings"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink transition-colors mb-4"
      >
        <ChevronLeft className="w-4 h-4" /> Back to settings
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-ink">Error Tracking</h1>
            <p className="text-sm text-ink-muted">
              Things that failed quietly in the background, so you can notice and act.
            </p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/90 disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Category tabs */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {categories.map((c) => {
            const sum = summaries.find((s) => s.category === c.id);
            const active = c.id === activeCategory;
            return (
              <button
                key={c.id}
                onClick={() => {
                  setActiveCategory(c.id);
                  setReasonFilter('all');
                }}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors border ${
                  active
                    ? 'bg-ink text-white border-ink font-medium'
                    : 'bg-white border-line text-ink-muted hover:text-ink hover:border-ink/20'
                }`}
              >
                <Mail className="w-4 h-4" />
                {c.label}
                {sum && sum.total > 0 && (
                  <span
                    className={`ml-0.5 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold tabular-nums ${
                      active ? 'bg-white/20 text-white' : 'bg-amber-500/15 text-amber-700'
                    }`}
                  >
                    {sum.total}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {activeMeta && (
        <p className="text-xs text-ink-muted mb-4">{activeMeta.description}</p>
      )}

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Reason breakdown */}
      {activeSummary && activeSummary.byReason.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setReasonFilter('all')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              reasonFilter === 'all'
                ? 'bg-ink text-white border-ink'
                : 'bg-white border-line text-ink-muted hover:text-ink'
            }`}
          >
            All ({activeSummary.total})
          </button>
          {activeSummary.byReason.map((r) => (
            <button
              key={r.reason}
              onClick={() => setReasonFilter(r.reason)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                reasonFilter === r.reason
                  ? 'bg-ink text-white border-ink'
                  : 'bg-white border-line text-ink-muted hover:text-ink'
              }`}
            >
              {r.label} ({r.count})
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="bg-white border border-line rounded-lg p-4 mb-4">
        <label className="block text-xs font-medium text-ink-muted mb-1">Search</label>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Recipient, subject, or error text…"
          className="w-full px-3 py-2 bg-surface rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-teal/40 text-sm text-ink"
        />
      </div>

      {/* Table */}
      <div className="bg-white border border-line rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-ink-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3 font-medium">When</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-left px-4 py-3 font-medium">Recipient</th>
                <th className="text-left px-4 py-3 font-medium">Reason</th>
                <th className="text-left px-4 py-3 font-medium">Reference</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-ink-muted">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-ink-muted">
                    {error
                      ? 'Could not load the error log — see the message above.'
                      : categoryTotal === 0
                        ? 'No failures 🎉 — all emails in this category sent successfully.'
                        : 'No entries match your search or filter.'}
                  </td>
                </tr>
              ) : (
                filtered.map((e) => {
                  const isOpen = expanded === e.id;
                  return (
                    <React.Fragment key={e.id}>
                      <tr
                        className="border-t border-line hover:bg-surface/50 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
                        role="button"
                        tabIndex={0}
                        aria-expanded={isOpen}
                        onClick={() => setExpanded(isOpen ? null : e.id)}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter' || ev.key === ' ') {
                            ev.preventDefault();
                            setExpanded(isOpen ? null : e.id);
                          }
                        }}
                      >
                        <td className="px-4 py-3 text-ink-muted whitespace-nowrap">
                          {new Date(e.created_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-ink">{kindLabel(e.kind)}</td>
                        <td className="px-4 py-3 text-ink break-all">
                          {e.to_email ?? <span className="text-ink-muted italic">unknown</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 text-xs font-medium whitespace-nowrap">
                            {e.reason_label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-ink-muted whitespace-nowrap">
                          {e.reference_type === 'order' ? (
                            <Link
                              href="/admin/orders"
                              onClick={(ev) => ev.stopPropagation()}
                              className="text-teal-dark hover:underline"
                            >
                              Order
                            </Link>
                          ) : e.reference_type === 'invoice' ? (
                            <Link
                              href="/admin/invoices"
                              onClick={(ev) => ev.stopPropagation()}
                              className="text-teal-dark hover:underline"
                            >
                              Invoice
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-t border-line bg-surface/40">
                          <td colSpan={5} className="px-4 py-4">
                            <div className="space-y-2 text-xs">
                              {e.subject && (
                                <div>
                                  <span className="text-ink-muted">Subject: </span>
                                  <span className="text-ink">{e.subject}</span>
                                </div>
                              )}
                              <div className="text-ink-muted">{e.reason_hint}</div>
                              {e.error && (
                                <div>
                                  <span className="text-ink-muted">Raw error: </span>
                                  <code className="text-red-600 break-all font-mono">{e.error}</code>
                                </div>
                              )}
                              {e.reference_id && (
                                <div>
                                  <span className="text-ink-muted">
                                    {e.reference_type === 'invoice' ? 'Invoice' : 'Order'} ID:{' '}
                                  </span>
                                  <code className="text-ink font-mono break-all">{e.reference_id}</code>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-ink-muted mt-3">
        Showing {filtered.length} of {categoryTotal} in this category (max 500 fetched).
        Select a row for the full error and hint.
      </p>
    </div>
  );
}
