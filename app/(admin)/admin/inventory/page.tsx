'use client';

/**
 * @deprecated Variant-based inventory surface (product_variants.qty_on_hand).
 *
 * The catalogue's source of truth for stock has moved to
 * `products.stock_quantity` (see simplify-product-stock-migration.sql), and
 * replenishment/low-stock now flows through the Products page + Stock Requests
 * waitlist + lib/admin/low-stock.ts. This page is retained only so legacy
 * variant data stays viewable; it is slated for removal once nothing depends on
 * the variant model. Do not build new features on it.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Package, Plus, Search, AlertTriangle, Download, Upload,
  BarChart2, RefreshCw, ChevronRight, X, Check, Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { useUserRole } from '../layout';
import { canEdit } from '@/lib/permissions';
import {
  getLowStockAlerts,
  getInventoryValuation,
  getSuppliers,
} from '@/lib/admin/inventory';
import { supabase } from '@/lib/supabase';
import type { LowStockAlert, ValuationResult } from '@/lib/types/ecommerce';

interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  cost_price: number | null;
  sale_price: number | null;
  is_active: boolean;
  variant_count: number;
  // Authoritative sellable stock (products.stock_quantity), the same number the
  // storefront and order flow use. Distinct from the legacy variant sum.
  stock_quantity: number;
}

export default function InventoryPage() {
  const userRole = useUserRole();
  const editable = canEdit(userRole);

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [alerts, setAlerts] = useState<LowStockAlert[]>([]);
  const [valuation, setValuation] = useState<ValuationResult | null>(null);
  const [showValuation, setShowValuation] = useState(false);
  const [csvMsg, setCsvMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [prodResult, alertsResult, valuationResult] = await Promise.all([
      fetchProducts(),
      getLowStockAlerts(),
      getInventoryValuation(),
    ]);
    setProducts(prodResult);
    setAlerts(alertsResult);
    setValuation(valuationResult);
    setLoading(false);
  }

  async function fetchProducts(): Promise<ProductRow[]> {
    const { data, error } = await supabase
      .from('products')
      .select(`
        id, name, sku, category, cost_price, sale_price, is_active, active, stock_quantity,
        product_variants (id, qty_on_hand)
      `)
      .order('name');

    if (error) return [];

    return (data ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      sku: p.sku ?? null,
      category: p.category ?? null,
      cost_price: p.cost_price ?? null,
      sale_price: p.sale_price ?? p.price ?? null,
      is_active: p.is_active ?? p.active ?? true,
      variant_count: p.product_variants?.length ?? 0,
      stock_quantity: Number(p.stock_quantity ?? 0),
    }));
  }

  const filtered = products.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q);
  });

  async function exportCSV() {
    const rows = [
      ['ID', 'SKU', 'Name', 'Category', 'Cost Price', 'Sale Price', 'Active', 'Variants', 'Stock'],
      ...filtered.map((p) => [
        p.id, p.sku ?? '', p.name, p.category ?? '',
        p.cost_price ?? '', p.sale_price ?? '',
        p.is_active, p.variant_count, p.stock_quantity,
      ]),
    ];
    const csv = rows.map((r) => r.map(String).map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleCSVImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvMsg('Parsing...');

    const text = await file.text();
    const lines = text.split('\n').filter(Boolean);
    const headers = lines[0].split(',').map((h) => h.replace(/"/g, '').trim().toLowerCase());

    const skuIdx = headers.indexOf('sku');
    const nameIdx = headers.indexOf('name');
    const qtyIdx = headers.findIndex((h) => h.includes('qty'));
    const costIdx = headers.findIndex((h) => h.includes('cost'));

    if (nameIdx === -1) { setCsvMsg('CSV must have a "name" column'); return; }

    let imported = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.replace(/^"|"$/g, '').trim());
      const name = cols[nameIdx];
      if (!name) continue;

      const updates: Record<string, unknown> = {};
      if (skuIdx !== -1 && cols[skuIdx]) updates.sku = cols[skuIdx];
      if (costIdx !== -1 && cols[costIdx]) updates.cost_price = parseFloat(cols[costIdx]) || null;

      await supabase
        .from('products')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .ilike('name', name);
      imported++;
    }

    setCsvMsg(`Imported ${imported} rows`);
    setTimeout(() => setCsvMsg(''), 3000);
    loadData();
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">Inventory</h1>
          {valuation && (
            <p className="text-sm text-ink-muted mt-1">
              {valuation.total_units.toLocaleString()} units ·{' '}
              <button
                onClick={() => setShowValuation(!showValuation)}
                className="text-bronze hover:underline"
              >
                ${valuation.total_value.toFixed(2)} total value
              </button>
            </p>
          )}
        </div>
        {editable && (
          <Link
            href="/admin/inventory/new"
            className="inline-flex items-center gap-2 bg-ink text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-ink/90 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Product
          </Link>
        )}
      </div>

      {/* Deprecation notice — the "Stock" column now shows the real, sellable
          products.stock_quantity, but this page's variant editor writes the
          legacy product_variants ledger, which the storefront no longer reads.
          Stock changes must be made on the Products page. */}
      <div className="mb-6 bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
        <Package className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-blue-800">
          <span className="font-semibold">Stock is managed on the Products page.</span>{' '}
          The <span className="font-medium">Stock</span> column here is the live sellable quantity, but
          editing variants on this legacy screen won&apos;t change what the store sells.{' '}
          <Link href="/admin/products" className="font-medium underline hover:no-underline">
            Go to Products
          </Link>{' '}
          to adjust stock.
        </p>
      </div>

      {/* Low Stock Alerts */}
      {alerts.length > 0 && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span className="font-semibold text-amber-800 text-sm">
              {alerts.length} variant{alerts.length !== 1 ? 's' : ''} below reorder threshold
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {alerts.slice(0, 8).map((a) => (
              <Link
                key={a.variant_id}
                href={`/admin/inventory/${a.product_id}`}
                className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded-lg hover:bg-amber-200 transition-colors"
              >
                {a.product_name} · {a.option_value} ({a.qty_on_hand}/{a.reorder_threshold})
              </Link>
            ))}
            {alerts.length > 8 && (
              <span className="text-xs text-amber-700">+{alerts.length - 8} more</span>
            )}
          </div>
        </div>
      )}

      {/* Valuation Breakdown */}
      {showValuation && valuation && (
        <div className="mb-6 bg-white rounded-xl border border-line overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-line">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-ink-muted" />
              <h2 className="font-semibold text-ink text-sm">Stock Valuation (Weighted Average Cost)</h2>
            </div>
            <button onClick={() => setShowValuation(false)}><X className="w-4 h-4 text-ink-muted" /></button>
          </div>
          <div className="overflow-x-auto max-h-64">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface">
                  <th className="px-4 py-2 text-left text-xs text-ink-muted font-semibold uppercase">Product</th>
                  <th className="px-4 py-2 text-left text-xs text-ink-muted font-semibold uppercase">SKU</th>
                  <th className="px-4 py-2 text-right text-xs text-ink-muted font-semibold uppercase">Qty</th>
                  <th className="px-4 py-2 text-right text-xs text-ink-muted font-semibold uppercase">Cost</th>
                  <th className="px-4 py-2 text-right text-xs text-ink-muted font-semibold uppercase">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50">
                {valuation.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 text-ink">{r.product_name}</td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-muted">{r.sku}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.qty_on_hand}</td>
                    <td className="px-4 py-2 text-right tabular-nums">${r.cost_price.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">${r.line_value.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-line text-right font-bold text-sm text-ink">
            Total: ${valuation.total_value.toFixed(2)}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <input
            type="text"
            placeholder="Search by name, SKU, category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-line rounded-lg text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-bronze/40"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadData}
            className="px-3 py-2.5 bg-white border border-line rounded-lg text-ink-muted hover:text-ink text-sm flex items-center gap-2 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={exportCSV}
            className="px-3 py-2.5 bg-white border border-line rounded-lg text-ink-muted hover:text-ink text-sm flex items-center gap-2 transition-colors"
          >
            <Download className="w-4 h-4" /> Export
          </button>
          {editable && (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-2.5 bg-white border border-line rounded-lg text-ink-muted hover:text-ink text-sm flex items-center gap-2 transition-colors"
              >
                <Upload className="w-4 h-4" /> Import
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleCSVImport}
              />
            </>
          )}
        </div>
      </div>

      {csvMsg && (
        <div className="mb-4 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700">
          {csvMsg}
        </div>
      )}

      <p className="text-xs text-ink-muted mb-4">{filtered.length} product{filtered.length !== 1 ? 's' : ''}</p>

      {/* Products Table */}
      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Product</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">SKU</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Category</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">Variants</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">Stock</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">Cost</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {loading && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-ink-muted text-sm">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-ink-muted text-sm">
                    No products found
                  </td>
                </tr>
              )}
              {filtered.map((p) => {
                const isLowStock = alerts.some((a) => a.product_id === p.id);
                return (
                  <tr key={p.id} className="hover:bg-surface transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-surface rounded-lg flex items-center justify-center flex-shrink-0">
                          <Package className="w-4 h-4 text-ink-muted" />
                        </div>
                        <Link
                          href={`/admin/inventory/${p.id}`}
                          className="font-medium text-ink hover:text-bronze transition-colors text-sm"
                        >
                          {p.name}
                        </Link>
                        {isLowStock && (
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 font-mono text-xs text-ink-muted">{p.sku ?? '—'}</td>
                    <td className="px-5 py-4 text-sm text-ink-muted">{p.category ?? '—'}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-sm text-ink">{p.variant_count}</td>
                    <td className="px-5 py-4 text-right tabular-nums text-sm font-medium text-ink">
                      <span className={p.stock_quantity === 0 ? 'text-red-500' : p.stock_quantity < 10 ? 'text-amber-500' : ''}>
                        {p.stock_quantity}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right tabular-nums text-sm text-ink-muted">
                      {p.cost_price != null ? `$${p.cost_price.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                        p.is_active
                          ? 'bg-emerald-500/10 text-emerald-600'
                          : 'bg-red-500/10 text-red-500'
                      }`}>
                        {p.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <Link
                        href={`/admin/inventory/${p.id}`}
                        className="text-ink-muted hover:text-ink transition-colors"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
