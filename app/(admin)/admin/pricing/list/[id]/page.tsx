'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, Save, RotateCcw, Search, Loader2, TrendingUp, TrendingDown,
  Minus, Pencil, X, Check, CircleDot, Circle, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { usePermissions } from '@/lib/hooks/usePermissions';
import {
  getPricelist, updatePricelist,
  type PricelistItemWithProduct,
} from '@/lib/admin/pricelists';
import type { Pricelist } from '@/lib/supabase';

const PAGE_SIZE = 25;

/** 2dp string (or empty), for input display consistency. */
function to2dp(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === '') return '';
  const num = typeof n === 'number' ? n : parseFloat(n);
  if (!Number.isFinite(num)) return '';
  return num.toFixed(2);
}

export default function PricelistEditorPage() {
  const { id } = useParams<{ id: string }>();
  const { canEdit } = usePermissions();

  const [pricelist, setPricelist] = useState<Pricelist | null>(null);
  const [items, setItems] = useState<PricelistItemWithProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  // Baseline (server truth) vs edits (pending). Both keyed by product_id
  // so the spreadsheet input is O(1) to render and diff. Blank in `edits`
  // means "revert to default (unset in the list)" — API upsert only.
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});

  // Header edit-in-place for name/description.
  const [editingHeader, setEditingHeader] = useState(false);
  const [headerName, setHeaderName] = useState('');
  const [headerDescription, setHeaderDescription] = useState('');
  const [savingHeader, setSavingHeader] = useState(false);

  const [togglingActive, setTogglingActive] = useState(false);

  // Refs for arrow-key navigation in the price column.
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function fetchList() {
    setLoading(true);
    setError('');
    const data = await getPricelist(id);
    if (!data) {
      setError('Price list not found');
      setLoading(false);
      return;
    }
    setPricelist(data.pricelist);
    setHeaderName(data.pricelist.name);
    setHeaderDescription((data.pricelist as any).description ?? '');
    setItems(data.items);
    // Baseline map from the current items; edits mirror baseline so a
    // dirty check trivially compares the two.
    const baseline: Record<string, string> = {};
    for (const it of data.items) {
      const pid = it.product?.id ?? it.product_id;
      if (pid) baseline[pid] = to2dp(it.price);
    }
    setOriginal(baseline);
    setEdits(baseline);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const name = (it.product?.name ?? '').toLowerCase();
      const slug = (it.product?.slug ?? '').toLowerCase();
      const strength = (it.product?.strength ?? '').toLowerCase();
      return name.includes(q) || slug.includes(q) || strength.includes(q);
    });
  }, [items, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const rangeStart = filtered.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const rangeEnd = Math.min(filtered.length, (safePage + 1) * PAGE_SIZE);

  // Dirty diff — only rows where the edit is a valid number AND differs.
  const dirty = useMemo(() => {
    const out: Array<{ product_id: string; price: number }> = [];
    for (const [pid, val] of Object.entries(edits)) {
      const trimmed = (val ?? '').trim();
      if (trimmed === '') continue;
      const n = parseFloat(trimmed);
      if (!Number.isFinite(n) || n < 0) continue;
      if (to2dp(n) === original[pid]) continue;
      out.push({ product_id: pid, price: Math.round(n * 100) / 100 });
    }
    return out;
  }, [edits, original]);

  const dirtyCount = dirty.length;

  function flashSuccess(msg: string) {
    setSuccess(msg);
    setTimeout(() => setSuccess(''), 3000);
  }

  async function handleSave() {
    if (dirtyCount === 0) return;
    setSaving(true);
    setError('');
    const res = await updatePricelist(id, { items: dirty });
    setSaving(false);
    if (!res.success) {
      setError(res.error ?? 'Failed to save');
      return;
    }
    // Fold saved values into the baseline so dirty count drops to 0
    // without a full re-fetch (avoids a page-reset jump).
    setOriginal((prev) => {
      const next = { ...prev };
      for (const d of dirty) next[d.product_id] = to2dp(d.price);
      return next;
    });
    flashSuccess(`Saved ${dirty.length} change${dirty.length === 1 ? '' : 's'}`);
  }

  function handleReset() {
    setEdits(original);
    setSearch('');
    setPage(0);
  }

  async function saveHeader() {
    setSavingHeader(true);
    setError('');
    const res = await updatePricelist(id, {
      name: headerName.trim(),
      description: headerDescription.trim() || undefined,
    });
    setSavingHeader(false);
    if (!res.success) {
      setError(res.error ?? 'Failed to save header');
      return;
    }
    setEditingHeader(false);
    // Local optimistic update — server truth reloads on next fetch anyway.
    setPricelist((p) => p ? { ...p, name: headerName.trim(), description: headerDescription.trim() || null } as Pricelist : p);
    flashSuccess('List details updated');
  }

  async function toggleActive() {
    if (!pricelist) return;
    setTogglingActive(true);
    setError('');
    const res = await updatePricelist(id, { is_active: !pricelist.is_active });
    setTogglingActive(false);
    if (!res.success) {
      setError(res.error ?? 'Failed to change activation');
      return;
    }
    setPricelist((p) => p ? { ...p, is_active: !p.is_active } as Pricelist : p);
    flashSuccess(pricelist.is_active ? 'List deactivated' : 'List activated');
  }

  // Vertical arrow-key navigation across the price column. Ignores rows
  // that are filtered out or currently hidden by pagination.
  function focusRow(offset: number, fromPid: string) {
    const idx = paged.findIndex((it) => (it.product?.id ?? it.product_id) === fromPid);
    if (idx < 0) return;
    const nextIdx = idx + offset;
    if (nextIdx < 0 || nextIdx >= paged.length) return;
    const nextPid = paged[nextIdx].product?.id ?? paged[nextIdx].product_id;
    const el = inputRefs.current[nextPid];
    if (el) el.focus();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-bronze" />
      </div>
    );
  }
  if (!pricelist) {
    return (
      <div className="text-center py-20">
        <p className="text-ink-muted mb-4">{error || 'Price list not found.'}</p>
        <Link href="/admin/pricing" className="text-bronze hover:underline text-sm">
          ← Back to Pricing
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link href="/admin/pricing" className="text-ink-muted hover:text-ink" title="Back">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          {editingHeader ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={headerName}
                  onChange={(e) => setHeaderName(e.target.value)}
                  className="flex-1 px-3 py-2 bg-surface border border-line rounded-lg text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-bronze/40"
                />
                <button
                  onClick={saveHeader}
                  disabled={savingHeader || !headerName.trim()}
                  className="inline-flex items-center gap-1 px-3 py-2 bg-ink text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {savingHeader ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => { setEditingHeader(false); setHeaderName(pricelist.name); setHeaderDescription((pricelist as any).description ?? ''); }}
                  className="inline-flex items-center gap-1 px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink-muted"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <textarea
                value={headerDescription}
                onChange={(e) => setHeaderDescription(e.target.value)}
                placeholder="Description (optional)"
                rows={2}
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-bronze/40"
              />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold text-ink">{pricelist.name}</h1>
                {pricelist.is_active ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600">
                    <CircleDot className="w-3 h-3" /> Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-surface text-ink-muted border border-line">
                    <Circle className="w-3 h-3" /> Inactive
                  </span>
                )}
                {canEdit && (
                  <button
                    onClick={() => setEditingHeader(true)}
                    className="text-ink-muted hover:text-ink"
                    title="Edit name / description"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <p className="text-sm text-ink-muted">
                {(pricelist as any).description
                  ? <>{(pricelist as any).description} · {items.length} product{items.length === 1 ? '' : 's'}</>
                  : <>{items.length} product{items.length === 1 ? '' : 's'}</>}
              </p>
            </>
          )}
        </div>
        <button
          onClick={toggleActive}
          disabled={togglingActive}
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50 ${
            pricelist.is_active
              ? 'bg-surface border border-line text-ink-muted hover:text-ink'
              : 'bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20'
          }`}
        >
          {togglingActive ? <Loader2 className="w-4 h-4 animate-spin" /> : pricelist.is_active ? <Circle className="w-4 h-4" /> : <CircleDot className="w-4 h-4" />}
          {pricelist.is_active ? 'Deactivate list' : 'Make active list'}
        </button>
      </div>

      {/* Alerts */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <p className="text-sm text-red-800 flex-1">{error}</p>
          <button onClick={() => setError('')} className="text-red-500 hover:text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {success && (
        <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800">
          {success}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <input
            type="text"
            placeholder="Search products…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="w-full pl-10 pr-4 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bronze/40"
          />
        </div>
        <button
          onClick={handleReset}
          disabled={dirtyCount === 0}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink-muted hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RotateCcw className="w-4 h-4" /> Reset
        </button>
        <button
          onClick={handleSave}
          disabled={saving || dirtyCount === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save {dirtyCount > 0 ? `${dirtyCount} change${dirtyCount === 1 ? '' : 's'}` : 'changes'}
        </button>
      </div>
      <p className="text-xs text-ink-muted mb-3">
        Tip: use ↑/↓ or Enter to move between rows. Only the list price is editable.
      </p>

      {/* Grid */}
      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px]">
            <thead>
              <tr className="border-b border-line bg-surface">
                <th className="px-5 py-2.5 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Product</th>
                <th className="px-5 py-2.5 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">Default Price</th>
                <th className="px-5 py-2.5 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">List Price</th>
                <th className="px-5 py-2.5 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-12 text-center text-sm text-ink-muted">
                    {search ? 'No products match your search.' : 'This list has no products yet.'}
                  </td>
                </tr>
              ) : paged.map((it) => {
                const pid = (it.product?.id ?? it.product_id) as string;
                const defaultPrice = Number(it.product?.price ?? 0);
                const edited = edits[pid] ?? '';
                const baseVal = original[pid] ?? '';
                const isDirty = edited.trim() !== '' && to2dp(edited) !== baseVal;
                const parsedEdit = parseFloat(edited);
                const listPrice = Number.isFinite(parsedEdit) ? parsedEdit : parseFloat(baseVal || '0');
                const delta = listPrice - defaultPrice;
                const pct = defaultPrice > 0 ? (delta / defaultPrice) * 100 : 0;
                return (
                  <tr key={pid} className={isDirty ? 'bg-bronze/5' : 'hover:bg-surface'}>
                    <td className="px-5 py-2 text-sm text-ink">
                      <div className="font-medium">{it.product?.name ?? 'Unknown'}</div>
                      {it.product?.strength && (
                        <div className="text-xs text-ink-muted">{it.product.strength}</div>
                      )}
                    </td>
                    <td className="px-5 py-2 text-sm text-ink-muted text-right tabular-nums">
                      ${defaultPrice.toFixed(2)}
                    </td>
                    <td className="px-5 py-2">
                      <div className="relative flex justify-end">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ink-muted">$</span>
                        <input
                          ref={(el) => { inputRefs.current[pid] = el; }}
                          type="text"
                          inputMode="decimal"
                          value={edited}
                          disabled={!canEdit}
                          onChange={(e) => setEdits((prev) => ({ ...prev, [pid]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'ArrowUp') { e.preventDefault(); focusRow(-1, pid); }
                            else if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); focusRow(1, pid); }
                          }}
                          className={`w-28 pl-5 pr-2 py-1.5 rounded-lg border text-right tabular-nums text-sm focus:outline-none focus:ring-2 focus:ring-bronze/40 disabled:bg-surface disabled:text-ink-muted ${
                            isDirty
                              ? 'bg-white border-bronze'
                              : 'bg-surface border-line'
                          }`}
                        />
                      </div>
                    </td>
                    <td className="px-5 py-2 text-sm text-right tabular-nums">
                      {defaultPrice === 0 ? (
                        <span className="text-ink-muted inline-flex items-center justify-end gap-1">
                          <Minus className="w-3 h-3" />
                        </span>
                      ) : Math.abs(pct) < 0.1 ? (
                        <span className="text-ink-muted inline-flex items-center justify-end gap-1">
                          <Minus className="w-3 h-3" /> 0%
                        </span>
                      ) : pct > 0 ? (
                        <span className="text-red-600 inline-flex items-center justify-end gap-1">
                          <TrendingUp className="w-3 h-3" /> +{pct.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-emerald-600 inline-flex items-center justify-end gap-1">
                          <TrendingDown className="w-3 h-3" /> {pct.toFixed(1)}%
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-line">
            <span className="text-xs text-ink-muted">
              Showing {rangeStart}–{rangeEnd} of {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-line text-xs text-ink-muted hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Prev
              </button>
              <button
                onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
                disabled={safePage + 1 >= totalPages}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-line text-xs text-ink-muted hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Sticky save bar — appears only when dirty. */}
      {dirtyCount > 0 && (
        <div className="sticky bottom-4 mt-4 flex justify-center pointer-events-none">
          <div className="pointer-events-auto inline-flex items-center gap-3 px-4 py-2 rounded-full bg-ink text-white shadow-lg">
            <span className="text-xs">
              <strong>{dirtyCount}</strong> unsaved change{dirtyCount === 1 ? '' : 's'}
            </span>
            <button
              onClick={handleReset}
              className="text-xs text-white/70 hover:text-white inline-flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1 px-3 py-1 bg-white text-ink rounded-full text-xs font-semibold hover:bg-white/90 disabled:opacity-70"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save
            </button>
          </div>
        </div>
      )}
    </>
  );
}
