'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Plus, Edit2, Trash2, X, Loader2, Save, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { usePermissions } from '@/lib/hooks/usePermissions';
import ProductToggleSelector from '@/components/admin/ProductToggleSelector';
import NumericStepper from '@/components/admin/NumericStepper';
import { formatMoney, normalizeCurrency, type Currency } from '@/lib/currency';

interface Product { id: string; name: string; sku: string | null; price: number }
interface Override {
  id: string;
  customer_id: string;
  product_id: string;
  override_price: number;
  product: Product | null;
}
interface CustomerInfo {
  id: string; first_name: string | null; last_name: string | null; email: string; preferred_currency?: string | null;
}

const fullName = (c: CustomerInfo | null) =>
  c ? (`${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.email) : '—';

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  const t = session?.access_token;
  return t ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

export default function CustomerPricingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { canCreate, canEdit, canDelete } = usePermissions();

  const [customer, setCustomer] = useState<CustomerInfo | null>(null);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Override | null>(null);

  const cur: Currency = normalizeCurrency(customer?.preferred_currency);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function load() {
    setLoading(true);
    const headers = await authHeaders();
    const [custRes, ovRes] = await Promise.all([
      fetch(`/api/admin/customers/${id}`, { headers }).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/admin/price-overrides?customer_id=${id}`, { headers }).then((r) => r.json()).catch(() => ({ overrides: [] })),
    ]);
    const { data: prods } = await supabase.from('products').select('id, name, sku, price').eq('active', true).order('name');
    setCustomer(custRes.customer ?? null);
    setOverrides(ovRes.overrides ?? []);
    setProducts((prods ?? []).map((p: any) => ({ ...p, price: Number(p.price) })));
    setLoading(false);
  }

  async function reload() {
    const headers = await authHeaders();
    const res = await fetch(`/api/admin/price-overrides?customer_id=${id}`, { headers }).then((r) => r.json()).catch(() => ({ overrides: [] }));
    setOverrides(res.overrides ?? []);
  }

  async function del(o: Override) {
    const headers = await authHeaders();
    const res = await fetch(`/api/admin/price-overrides?id=${o.id}`, { method: 'DELETE', headers });
    if (!res.ok) { setError('Failed to delete override'); return; }
    await reload();
  }

  const money = (n: number) => formatMoney(n, cur);

  return (
    <div className="max-w-4xl">
      <Link href="/admin/pricing" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Customer Pricing
      </Link>

      <div className="flex items-start justify-between gap-4 mt-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-ink">{loading ? '…' : fullName(customer)}</h1>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${cur === 'USD' ? 'bg-blue-500/10 text-blue-600' : 'bg-bronze/10 text-bronze'}`}>{cur}</span>
          </div>
          <p className="text-sm text-ink-muted mt-1">
            {customer?.email}{customer?.email ? ' · ' : ''}{overrides.length} override{overrides.length !== 1 ? 's' : ''}
          </p>
        </div>
        {canCreate && (
          <button
            onClick={() => { setEditing(null); setShowModal(true); }}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/90"
          >
            <Plus className="w-4 h-4" /> Add Price Override
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg p-4 mb-6 bg-red-50 border border-red-200 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-red-700"><AlertCircle className="w-4 h-4 flex-shrink-0" />{error}</div>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-line bg-surface">
                {['Product', 'Default', 'Override', 'Discount', ''].map((h) => (
                  <th key={h} className={`px-5 py-3 text-xs font-semibold text-ink-muted uppercase tracking-wider ${h === 'Default' || h === 'Override' || h === 'Discount' ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {loading ? (
                <tr><td colSpan={5} className="px-5 py-12 text-center"><Loader2 className="w-5 h-5 animate-spin text-ink-muted mx-auto" /></td></tr>
              ) : overrides.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-12 text-center text-sm text-ink-muted">No overrides for this customer yet</td></tr>
              ) : overrides.map((o) => {
                const def = Number(o.product?.price ?? 0);
                const ovp = Number(o.override_price);
                const pct = def > 0 ? ((def - ovp) / def) * 100 : 0;
                return (
                  <tr key={o.id} className="hover:bg-surface transition-colors">
                    <td className="px-5 py-4 text-sm text-ink">{o.product?.name ?? '—'}</td>
                    <td className="px-5 py-4 text-right text-sm tabular-nums text-ink-muted">{money(def)}</td>
                    <td className="px-5 py-4 text-right text-sm tabular-nums text-bronze font-medium">{money(ovp)}</td>
                    <td className="px-5 py-4 text-right text-sm tabular-nums">
                      {def > 0 && pct !== 0
                        ? <span className={pct > 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>{pct > 0 ? '-' : '+'}{Math.abs(pct).toFixed(1)}%</span>
                        : <span className="text-ink-muted">—</span>}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1">
                        {canEdit && (
                          <button onClick={() => { setEditing(o); setShowModal(true); }} className="p-2 hover:bg-surface rounded-lg text-ink-muted hover:text-ink" title="Edit">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button onClick={() => del(o)} className="p-2 hover:bg-red-50 hover:text-red-600 rounded-lg text-ink-muted" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <OverrideModal
          customerId={id}
          editing={editing}
          products={products}
          onClose={() => setShowModal(false)}
          onSaved={async () => { setShowModal(false); await reload(); }}
        />
      )}
    </div>
  );
}

function OverrideModal({
  customerId, editing, products, onClose, onSaved,
}: {
  customerId: string;
  editing: Override | null;
  products: Product[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!editing;
  const [productId, setProductId] = useState<string | null>(editing?.product_id ?? null);
  const [price, setPrice] = useState<number | ''>(editing ? Number(editing.override_price) : '');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');

  async function save() {
    if (!productId) { setLocalError('Pick a product'); return; }
    if (price === '') { setLocalError('Enter an override price'); return; }
    setLocalError('');
    setBusy(true);
    const headers = await authHeaders();
    const res = await fetch('/api/admin/price-overrides', {
      method: 'POST', headers,
      body: JSON.stringify({ customer_id: customerId, product_id: productId, override_price: price }),
    });
    setBusy(false);
    if (!res.ok) { setLocalError('Failed to save override'); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-line w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line flex-shrink-0">
          <h2 className="font-semibold text-ink">{isEdit ? 'Edit Price Override' : 'Add Price Override'}</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {localError && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{localError}
            </div>
          )}
          <ProductToggleSelector
            products={products.map((p) => ({ ...p, slug: p.sku }))}
            value={productId}
            onChange={setProductId}
            disabled={isEdit}
            label="Product"
          />
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">Override Price</label>
            <NumericStepper value={price} onChange={setPrice} min={0} step={0.01} placeholder="0.00" prefix="$" />
          </div>
        </div>
        <div className="flex gap-3 px-5 pb-4 pt-4 border-t border-line flex-shrink-0">
          <button onClick={onClose} className="flex-1 px-4 py-2 bg-surface border border-line rounded-lg text-sm text-ink-muted hover:text-ink">Cancel</button>
          <button onClick={save} disabled={busy} className="flex-1 px-4 py-2 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/90 disabled:opacity-40 flex items-center justify-center gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Override
          </button>
        </div>
      </div>
    </div>
  );
}
