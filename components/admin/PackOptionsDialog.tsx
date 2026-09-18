'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Boxes, Check, Loader2, Search, X } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import type { Product } from '@/lib/supabase';
import {
  MAX_PACK_OPTIONS,
  PACK_SIZE_OPTIONS,
  formatPackSizes,
  normalizePackSizes,
  packPriceFor,
  packSizesFor,
  vialPriceFor,
  vialsPerBoxOf,
} from '@/lib/pricing';

/**
 * Bulk pack-options editor.
 *
 * The cell-edit grid is the main surface for pack options (type them into the
 * column, or select rows and stage one set across all of them). This dialog is
 * the answer to the other half of the job — "which products are ALLOWED these
 * options" — when you are not already in the grid: search and filter the
 * catalog, tick the products, pick the sizes once, save.
 *
 * Everything goes through ONE call to /api/admin/products/pack-sizes, so
 * opting two hundred products in costs one request rather than two hundred.
 */

interface PackOptionsDialogProps {
  products: Product[];
  /** Products ticked when the dialog opens (e.g. the current filter). */
  initialSelection?: string[];
  onClose: () => void;
  /** Fresh product rows returned by the API. */
  onSaved: (updated: Product[], message: string) => void;
}

type StatusFilter = 'all' | 'custom' | 'default';

export default function PackOptionsDialog({
  products,
  initialSelection = [],
  onClose,
  onSaved,
}: PackOptionsDialogProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelection));
  const [sizes, setSizes] = useState<number[]>([...PACK_SIZE_OPTIONS]);
  const [customSize, setCustomSize] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter(Boolean) as string[])].sort(),
    [products],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (category && p.category !== category) return false;
      const custom = normalizePackSizes(p.pack_sizes).length > 0;
      if (status === 'custom' && !custom) return false;
      if (status === 'default' && custom) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? '').toLowerCase().includes(q) ||
        (p.category ?? '').toLowerCase().includes(q)
      );
    });
  }, [products, query, category, status]);

  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.id));

  const toggleProduct = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach((p) => next.delete(p.id));
      else visible.forEach((p) => next.add(p.id));
      return next;
    });
  };

  const toggleSize = (size: number) => {
    setSizes((prev) =>
      prev.includes(size) ? prev.filter((s) => s !== size) : normalizePackSizes([...prev, size]),
    );
  };

  const addCustomSize = () => {
    const n = Math.floor(Number(customSize));
    if (!Number.isFinite(n) || n < 1) {
      setError('A custom pack size has to be a whole number of vials.');
      return;
    }
    if (sizes.length >= MAX_PACK_OPTIONS && !sizes.includes(n)) {
      setError(`A product can offer at most ${MAX_PACK_OPTIONS} pack options.`);
      return;
    }
    setError('');
    setSizes((prev) => normalizePackSizes([...prev, n]));
    setCustomSize('');
  };

  // Price preview against the first selected product, so the operator can see
  // what a customer will actually be charged before writing anything.
  const previewProduct = useMemo(
    () => products.find((p) => selected.has(p.id)) ?? null,
    [products, selected],
  );

  const save = async (clear: boolean) => {
    const ids = [...selected];
    if (ids.length === 0) {
      setError('Select at least one product.');
      return;
    }
    if (!clear && sizes.length === 0) {
      setError('Pick at least one pack size, or reset the selection to the default.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch<{ updated: number; products: Product[] }>(
        '/api/admin/products/pack-sizes',
        {
          method: 'PATCH',
          body: JSON.stringify({ product_ids: ids, pack_sizes: clear ? null : sizes }),
        },
      );
      const summary = clear
        ? `Reset ${res.updated} product${res.updated === 1 ? '' : 's'} to the default pack`
        : `Set ${formatPackSizes(sizes)} on ${res.updated} product${res.updated === 1 ? '' : 's'}`;
      onSaved(res.products ?? [], summary);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not save pack options');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-line px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal/10">
            <Boxes className="h-4 w-4 text-teal-dark" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-ink">Pack options</h2>
            <p className="text-xs text-ink-muted">
              Choose which products are sold in which pack sizes. Each pack is priced at the vial
              price × its size unless a per-pack price is set on the product itself.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="ml-auto text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 md:grid-cols-[1fr_300px]">
          {/* ---- Product picker ---- */}
          <div className="flex min-h-0 flex-col border-b border-line md:border-b-0 md:border-r">
            <div className="space-y-2 border-b border-line bg-surface px-4 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, SKU or category…"
                  className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
                >
                  <option value="">All categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as StatusFilter)}
                  className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
                >
                  <option value="all">Any pack setup</option>
                  <option value="custom">Has custom options</option>
                  <option value="default">On the default pack</option>
                </select>
                <button
                  type="button"
                  onClick={toggleAllVisible}
                  disabled={visible.length === 0}
                  className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-surface disabled:opacity-40"
                >
                  {allVisibleSelected ? 'Clear these' : `Select all ${visible.length}`}
                </button>
                {selected.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="text-xs font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                  >
                    Deselect all ({selected.size})
                  </button>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {visible.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-ink-muted">
                  No products match these filters.
                </p>
              ) : (
                <ul className="divide-y divide-line/60">
                  {visible.map((p) => {
                    const on = selected.has(p.id);
                    const current = packSizesFor(p);
                    const custom = normalizePackSizes(p.pack_sizes).length > 0;
                    return (
                      <li key={p.id}>
                        <label
                          className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors ${
                            on ? 'bg-teal/5' : 'hover:bg-surface/60'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggleProduct(p.id)}
                            className="h-4 w-4 rounded border-line accent-teal"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-ink">{p.name}</span>
                            <span className="block truncate text-[11px] text-ink-muted">
                              {p.sku || 'no SKU'} · {vialsPerBoxOf(p.vials_per_box)} vials / case
                            </span>
                          </span>
                          <span
                            className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${
                              custom ? 'bg-teal/10 text-teal-dark' : 'bg-surface-2 text-ink-muted'
                            }`}
                            title={custom ? 'Custom pack options' : 'Default: single vial + full case'}
                          >
                            {formatPackSizes(current)}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* ---- Pack sizes ---- */}
          <div className="flex min-h-0 flex-col overflow-y-auto p-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              Pack sizes
            </p>
            <div className="mb-3 grid grid-cols-4 gap-2">
              {[...new Set([...PACK_SIZE_OPTIONS, ...sizes])]
                .sort((a, b) => a - b)
                .map((size) => {
                  const on = sizes.includes(size);
                  return (
                    <button
                      key={size}
                      type="button"
                      onClick={() => toggleSize(size)}
                      aria-pressed={on}
                      className={`relative rounded-lg border py-2 text-sm font-semibold transition-colors ${
                        on
                          ? 'border-teal bg-teal/10 text-teal-dark'
                          : 'border-line bg-white text-ink-muted hover:border-teal/40 hover:text-ink'
                      }`}
                    >
                      {on && (
                        <Check className="absolute right-1 top-1 h-3 w-3 text-teal-dark" />
                      )}
                      {size}
                    </button>
                  );
                })}
            </div>

            <div className="mb-4 flex gap-2">
              <input
                value={customSize}
                onChange={(e) => setCustomSize(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomSize(); } }}
                inputMode="numeric"
                placeholder="Other size…"
                className="min-w-0 flex-1 rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
              />
              <button
                type="button"
                onClick={addCustomSize}
                className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface"
              >
                Add
              </button>
            </div>

            {/* What the customer will see, priced off a real product. */}
            {previewProduct && sizes.length > 0 && (
              <div className="mb-4 rounded-xl border border-line bg-surface p-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                  Preview · {previewProduct.name}
                </p>
                <ul className="space-y-1">
                  {sizes.map((size) => (
                    <li key={size} className="flex justify-between text-xs text-ink">
                      <span>{size === 1 ? 'Single vial' : `Pack of ${size}`}</span>
                      <span className="tabular-nums font-medium">
                        ${packPriceFor(previewProduct, size).toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[10px] text-ink-muted tabular-nums">
                  ${vialPriceFor(previewProduct).toFixed(2)} per vial × pack size
                </p>
              </div>
            )}

            <p className="mb-4 text-[11px] leading-relaxed text-ink-muted">
              Clearing the options puts a product back on its default pair — a single vial plus one
              full case of its vials-per-case. A pack that survives an edit here keeps any per-pack
              price it was given; one that is removed loses it. Per-pack prices, labels and
              compare-at figures are set on the product itself.
            </p>

            {error && (
              <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </p>
            )}

            <div className="mt-auto space-y-2">
              <button
                type="button"
                onClick={() => void save(false)}
                disabled={saving || selected.size === 0 || sizes.length === 0}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Apply to {selected.size} product{selected.size === 1 ? '' : 's'}
              </button>
              <button
                type="button"
                onClick={() => void save(true)}
                disabled={saving || selected.size === 0}
                className="w-full rounded-lg border border-line bg-white px-4 py-2 text-xs font-medium text-ink hover:bg-surface disabled:opacity-40"
              >
                Reset selection to the default pack
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
