'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Search, Loader2, Check, Tag, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { getAllSuppliers } from '@/lib/admin/purchase-orders';
import { getSupplierPrices, saveSupplierPrices } from '@/lib/admin/supplier-prices';
import type { Supplier, SupplierPriceRow } from '@/lib/types/ecommerce';

export default function SupplierPricelistsPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [rows, setRows] = useState<SupplierPriceRow[]>([]);
  const [edited, setEdited] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [loadingRows, setLoadingRows] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { getAllSuppliers().then(setSuppliers); }, []);

  useEffect(() => {
    if (!supplierId) { setRows([]); setEdited({}); return; }
    setLoadingRows(true);
    setEdited({});
    getSupplierPrices(supplierId)
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoadingRows(false));
  }, [supplierId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.product_name.toLowerCase().includes(q) || (r.sku ?? '').toLowerCase().includes(q));
  }, [rows, search]);

  const dirtyCount = Object.keys(edited).length;

  function priceOf(r: SupplierPriceRow): number {
    if (r.product_id in edited) return edited[r.product_id];
    return r.supplier_price ?? r.original_price;
  }

  function setPrice(productId: string, value: number) {
    setEdited((prev) => ({ ...prev, [productId]: Math.max(0, value) }));
    setSavedAt(null);
  }

  function resetRow(r: SupplierPriceRow) {
    setEdited((prev) => ({ ...prev, [r.product_id]: r.original_price }));
    setSavedAt(null);
  }

  async function handleSave() {
    if (dirtyCount === 0) return;
    setSaving(true);
    setError('');
    const items = Object.entries(edited).map(([product_id, price]) => ({ product_id, price }));
    const res = await saveSupplierPrices(supplierId, items);
    setSaving(false);
    if (!res.success) { setError(res.error ?? 'Failed to save pricelist'); return; }
    // Fold the edits back into the loaded rows.
    setRows((prev) => prev.map((r) => r.product_id in edited ? { ...r, supplier_price: edited[r.product_id] } : r));
    setEdited({});
    setSavedAt(Date.now());
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/admin/purchase-orders" className="text-ink-muted hover:text-ink transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-ink">Supplier Pricelists</h1>
            <p className="text-sm text-ink-muted mt-1">Negotiated price per product, per supplier</p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || dirtyCount === 0}
          className="inline-flex items-center gap-2 bg-ink text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-ink/90 transition-colors disabled:opacity-40"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {saving ? 'Saving…' : dirtyCount > 0 ? `Save ${dirtyCount} change${dirtyCount === 1 ? '' : 's'}` : 'Saved'}
        </button>
      </div>

      {error && <div className="mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
      {savedAt && <div className="mb-5 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700">Pricelist saved.</div>}

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <select
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          className="sm:w-72 px-3 py-2.5 bg-white border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
        >
          <option value="">Select a supplier…</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <input
            type="text"
            placeholder="Filter products by name or SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={!supplierId}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-line rounded-lg text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-teal/40 disabled:opacity-50"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-line overflow-hidden">
        {!supplierId ? (
          <div className="py-16 text-center text-ink-muted text-sm">Select a supplier to edit its pricelist.</div>
        ) : loadingRows ? (
          <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-ink-muted" /></div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-ink-muted text-sm">{search ? 'No products match your filter' : 'No active products'}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface">
                  <th className="px-5 py-3 text-left text-xs text-ink-muted font-semibold uppercase tracking-wide">Product</th>
                  <th className="px-5 py-3 text-left text-xs text-ink-muted font-semibold uppercase tracking-wide">SKU</th>
                  <th className="px-5 py-3 text-right text-xs text-ink-muted font-semibold uppercase tracking-wide">Catalog Price</th>
                  <th className="px-5 py-3 text-right text-xs text-ink-muted font-semibold uppercase tracking-wide w-40">Supplier Price</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50">
                {filtered.map((r) => {
                  const dirty = r.product_id in edited;
                  const usingFallback = !dirty && r.supplier_price == null;
                  return (
                    <tr key={r.product_id} className={dirty ? 'bg-teal/5' : ''}>
                      <td className="px-5 py-3 text-ink font-medium">{r.product_name}</td>
                      <td className="px-5 py-3 font-mono text-xs text-ink-muted">{r.sku ?? '—'}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-ink-muted">${r.original_price.toFixed(2)}</td>
                      <td className="px-5 py-3">
                        <div className="relative flex justify-end">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ink-muted">$</span>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={priceOf(r)}
                            onChange={(e) => setPrice(r.product_id, parseFloat(e.target.value) || 0)}
                            className={`w-32 pl-5 pr-2 py-1.5 border rounded-lg text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-teal/40 ${usingFallback ? 'bg-surface border-line text-ink-muted' : 'bg-white border-line text-ink'}`}
                          />
                        </div>
                        {usingFallback && (
                          <p className="text-[10px] text-ink-muted text-right mt-0.5 flex items-center justify-end gap-1">
                            <Tag className="w-2.5 h-2.5" /> using catalog price
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <button onClick={() => resetRow(r)} title="Reset to catalog price" className="text-ink-muted hover:text-ink transition-colors">
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
