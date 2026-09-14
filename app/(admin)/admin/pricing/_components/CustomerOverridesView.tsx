'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Plus, Upload, Users, Search, AlertCircle, X, Loader2,
  ArrowRight, ArrowLeft, Save, Package, ArrowRightCircle, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { usePermissions } from '@/lib/hooks/usePermissions';
import PriceListImportModal from './PriceListImportModal';
import MultiSelectCustomer from '@/components/admin/MultiSelectCustomer';
import ProductToggleSelector from '@/components/admin/ProductToggleSelector';
import NumericStepper from '@/components/admin/NumericStepper';
import { formatMoney, normalizeCurrency, type Currency } from '@/lib/currency';

interface Customer {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  preferred_currency?: string | null;
}
interface Product { id: string; name: string; sku: string | null; price: number }
interface Override {
  id: string;
  customer_id: string;
  product_id: string;
  override_price: number;
  customer: Customer | null;
  product: Product | null;
}

const fullName = (c: { first_name: string | null; last_name: string | null; email: string } | null) =>
  c ? (`${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.email) : '—';

const CUSTOMERS_PER_PAGE = 10;
const PRODUCTS_PER_PAGE = 6;

async function token(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function authHeaders(): Promise<Record<string, string>> {
  const t = await token();
  if (t) return { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' };
  return { 'Content-Type': 'application/json' };
}

export default function CustomerOverridesView() {
  const { canCreate: mayCreate, canEdit: mayEdit, canDelete: _mayDelete } = usePermissions();

  const [overrides, setOverrides] = useState<Override[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [grouping, setGrouping] = useState<'customer' | 'product'>('customer');
  const [page, setPage] = useState(1);

  const [showSingle, setShowSingle] = useState(false);
  const [editing, setEditing] = useState<Override | null>(null);
  const [prefill, setPrefill] = useState<{ customerId?: string; productId?: string }>({});
  const [showBulk, setShowBulk] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [savingCurrency, setSavingCurrency] = useState<string | null>(null);

  useEffect(() => { loadAll(); }, []);
  // Page resets to 1 whenever the search or grouping changes.
  useEffect(() => { setPage(1); }, [search, grouping]);

  async function loadAll() {
    setLoading(true);
    const headers = await authHeaders();
    const [ovRes, custRes] = await Promise.all([
      fetch('/api/admin/price-overrides', { headers }).then((r) => r.json()).catch(() => ({ overrides: [] })),
      fetch('/api/admin/customers', { headers }).then((r) => r.json()).catch(() => ({ customers: [] })),
    ]);
    const { data: prods } = await supabase.from('products').select('id, name, sku, price').eq('active', true).order('name');
    setOverrides(ovRes.overrides ?? []);
    setCustomers(custRes.customers ?? []);
    setProducts((prods ?? []).map((p: any) => ({ ...p, price: Number(p.price) })));
    setLoading(false);
  }

  async function reloadOverrides() {
    const headers = await authHeaders();
    const res = await fetch('/api/admin/price-overrides', { headers }).then((r) => r.json()).catch(() => ({ overrides: [] }));
    setOverrides(res.overrides ?? []);
  }

  // Flip a customer's billing currency, optimistic with revert on failure.
  async function toggleCustomerCurrency(customerId: string, current: Currency) {
    if (!mayEdit) return;
    const next: Currency = current === 'USD' ? 'CAD' : 'USD';
    setSavingCurrency(customerId);
    const apply = (cur: string) => {
      setCustomers((prev) => prev.map((c) => c.id === customerId ? { ...c, preferred_currency: cur } : c));
      setOverrides((prev) => prev.map((o) =>
        o.customer_id === customerId && o.customer ? { ...o, customer: { ...o.customer, preferred_currency: cur } } : o));
    };
    apply(next);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/admin/customers/${customerId}`, {
        method: 'PATCH', headers, body: JSON.stringify({ preferred_currency: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      apply(current); // revert
      setError('Failed to update currency');
    } finally {
      setSavingCurrency(null);
    }
  }

  function openAdd(prefillArgs: { customerId?: string; productId?: string } = {}) {
    setEditing(null);
    setPrefill(prefillArgs);
    setShowSingle(true);
  }

  // ---- By-customer grouping: every customer, overrides-first then alpha ----
  const customerGroups = useMemo(() => {
    const byCust = new Map<string, Override[]>();
    for (const o of overrides) {
      const arr = byCust.get(o.customer_id) ?? [];
      arr.push(o);
      byCust.set(o.customer_id, arr);
    }
    const rows = customers.map((c) => ({ customer: c, overrides: byCust.get(c.id) ?? [] }));
    rows.sort((a, b) => {
      const ao = a.overrides.length > 0 ? 0 : 1;
      const bo = b.overrides.length > 0 ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return fullName(a.customer).localeCompare(fullName(b.customer));
    });
    return rows;
  }, [overrides, customers]);

  // ---- By-product grouping: products that have overrides ----
  const productGroups = useMemo(() => {
    const byProd = new Map<string, Override[]>();
    for (const o of overrides) {
      const arr = byProd.get(o.product_id) ?? [];
      arr.push(o);
      byProd.set(o.product_id, arr);
    }
    const rows = Array.from(byProd.entries()).map(([productId, ovs]) => ({
      product: ovs[0].product ?? products.find((p) => p.id === productId) ?? null,
      productId,
      overrides: ovs,
    }));
    rows.sort((a, b) => (a.product?.name ?? '').localeCompare(b.product?.name ?? ''));
    return rows;
  }, [overrides, products]);

  const filteredCustomerGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customerGroups;
    return customerGroups.filter((g) =>
      fullName(g.customer).toLowerCase().includes(q) || g.customer.email.toLowerCase().includes(q));
  }, [customerGroups, search]);

  const filteredProductGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return productGroups;
    return productGroups.filter((g) =>
      (g.product?.name ?? '').toLowerCase().includes(q) || (g.product?.sku ?? '').toLowerCase().includes(q));
  }, [productGroups, search]);

  const isCustomer = grouping === 'customer';
  const perPage = isCustomer ? CUSTOMERS_PER_PAGE : PRODUCTS_PER_PAGE;
  const totalItems = isCustomer ? filteredCustomerGroups.length : filteredProductGroups.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * perPage;
  const pagedCustomers = filteredCustomerGroups.slice(pageStart, pageStart + perPage);
  const pagedProducts = filteredProductGroups.slice(pageStart, pageStart + perPage);

  return (
    <>
      {/* Header */}
      <div className="flex justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">Customer Pricing</h1>
          <p className="text-sm text-ink-muted mt-1">Manage customer-specific price overrides</p>
        </div>
        {mayCreate && (
          <div className="flex flex-wrap gap-2 sm:gap-3 items-start">
            <button onClick={() => setShowImport(true)} className="inline-flex items-center gap-2 px-4 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink-muted hover:text-ink transition-colors">
              <Upload className="w-4 h-4" /> Import CSV
            </button>
            <button onClick={() => { setShowBulk(true); }} className="inline-flex items-center gap-2 px-4 py-2.5 bg-teal-dark text-white rounded-lg text-sm font-medium hover:bg-teal/90 transition-colors">
              <Users className="w-4 h-4" /> Bulk Edit Pricing
            </button>
            <button onClick={() => openAdd()} className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/90 transition-colors">
              <Plus className="w-4 h-4" /> Add Price Override
            </button>
          </div>
        )}
      </div>

      {/* Alerts */}
      {error && (
        <div className="rounded-lg p-4 mb-6 bg-red-50 border border-red-200 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-red-700"><AlertCircle className="w-4 h-4 flex-shrink-0" />{error}</div>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>
        </div>
      )}
      {success && (
        <div className="rounded-lg p-4 mb-6 bg-emerald-50 border border-emerald-200 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-emerald-700"><AlertCircle className="w-4 h-4 flex-shrink-0" />{success}</div>
          <button onClick={() => setSuccess('')} className="text-emerald-400 hover:text-emerald-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={isCustomer ? 'Search by customer…' : 'Search by product…'}
          className="w-full pl-11 pr-4 py-3 bg-surface border border-line rounded-xl text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-teal/40"
        />
      </div>

      {/* Grouping toggle + count */}
      <div className="flex items-center justify-between mb-6">
        <div className="inline-flex rounded-lg border border-line overflow-hidden">
          <button
            onClick={() => setGrouping('customer')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${
              isCustomer ? 'bg-ink text-white' : 'bg-white text-ink-muted hover:text-ink'
            }`}
          >
            <Users className="w-4 h-4" /> By Customer
          </button>
          <button
            onClick={() => setGrouping('product')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${
              !isCustomer ? 'bg-ink text-white' : 'bg-white text-ink-muted hover:text-ink'
            }`}
          >
            <Package className="w-4 h-4" /> By Product
          </button>
        </div>
        <span className="text-sm text-ink-muted">
          {isCustomer
            ? `${filteredCustomerGroups.length} customer${filteredCustomerGroups.length !== 1 ? 's' : ''}`
            : `${filteredProductGroups.length} product${filteredProductGroups.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid md:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : totalItems === 0 ? (
        <div className="bg-white rounded-xl border border-line p-12 text-center text-sm text-ink-muted">
          {search ? 'Nothing matches your search' : 'No price overrides yet'}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {isCustomer
            ? pagedCustomers.map((g) => (
                <CustomerCard
                  key={g.customer.id}
                  customer={g.customer}
                  overrides={g.overrides}
                  mayCreate={mayCreate}
                  mayEdit={mayEdit}
                  savingCurrency={savingCurrency === g.customer.id}
                  onToggleCurrency={toggleCustomerCurrency}
                  onAdd={() => openAdd({ customerId: g.customer.id })}
                />
              ))
            : pagedProducts.map((g) => (
                <ProductCard
                  key={g.productId}
                  product={g.product}
                  productId={g.productId}
                  overrides={g.overrides}
                  mayCreate={mayCreate}
                  onAdd={() => openAdd({ productId: g.productId })}
                />
              ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && totalItems > perPage && (
        <div className="flex items-center justify-center gap-4 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line text-sm text-ink-muted hover:text-ink hover:border-ink/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" /> Prev
          </button>
          <span className="text-sm text-ink-muted">Page {safePage} of {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line text-sm text-ink-muted hover:text-ink hover:border-ink/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Single create/edit modal */}
      {showSingle && (
        <SingleOverrideModal
          editing={editing}
          prefillCustomerId={prefill.customerId}
          prefillProductId={prefill.productId}
          customers={customers}
          products={products}
          onClose={() => setShowSingle(false)}
          onSaved={async (msg) => { setShowSingle(false); setSuccess(msg); await reloadOverrides(); }}
          onError={setError}
        />
      )}

      {/* Bulk flow */}
      {showBulk && (
        <BulkPricingModal
          customers={customers}
          products={products}
          overrides={overrides}
          onClose={() => setShowBulk(false)}
          onDone={async (msg) => { setShowBulk(false); setSuccess(msg); await reloadOverrides(); }}
        />
      )}

      {/* Import */}
      {showImport && (
        <PriceListImportModal
          customers={customers}
          onClose={() => setShowImport(false)}
          onDone={async (msg: string) => { setShowImport(false); setSuccess(msg); await reloadOverrides(); }}
        />
      )}
    </>
  );
}

// ---- Customer card ----
function CustomerCard({
  customer, overrides, mayCreate, mayEdit, savingCurrency, onToggleCurrency, onAdd,
}: {
  customer: Customer;
  overrides: Override[];
  mayCreate: boolean;
  mayEdit: boolean;
  savingCurrency: boolean;
  onToggleCurrency: (id: string, current: Currency) => void;
  onAdd: () => void;
}) {
  const cur = normalizeCurrency(customer.preferred_currency);
  const shown = overrides.slice(0, 4);
  const extra = overrides.length - shown.length;

  return (
    <div className="bg-white rounded-xl border border-line p-5 flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-ink truncate">{fullName(customer)}</p>
          <p className="text-xs text-ink-muted truncate">{customer.email}</p>
        </div>
        <span className="flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-teal/10 text-teal-dark">
          {overrides.length} override{overrides.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="mt-4 space-y-1.5 flex-1">
        {overrides.length === 0 ? (
          <p className="text-sm text-ink-muted">No overrides yet.</p>
        ) : (
          <>
            {shown.map((o) => {
              const def = Number(o.product?.price ?? 0);
              return (
                <div key={o.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-ink truncate">{o.product?.name ?? '—'}</span>
                  <span className="flex items-center gap-2 flex-shrink-0 tabular-nums">
                    {def > 0 && <span className="text-ink-muted line-through">{formatMoney(def, cur)}</span>}
                    <span className="font-semibold text-ink">{formatMoney(Number(o.override_price), cur)}</span>
                  </span>
                </div>
              );
            })}
            {extra > 0 && <p className="text-xs text-ink-muted">+{extra} more</p>}
          </>
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-line flex items-center gap-2">
        {mayCreate && (
          <button
            onClick={onAdd}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-ink text-white rounded-lg text-xs font-medium hover:bg-ink/90"
          >
            <Plus className="w-3.5 h-3.5" /> Add override
          </button>
        )}
        <CurrencyToggle currency={cur} editable={mayEdit} saving={savingCurrency}
          onClick={() => onToggleCurrency(customer.id, cur)} />
        <Link
          href={`/admin/pricing/customers/${customer.id}`}
          className="ml-auto text-xs font-medium text-teal-dark hover:text-teal-dark/80 inline-flex items-center gap-1"
        >
          See all <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}

function CurrencyToggle({
  currency, editable, saving, onClick,
}: { currency: Currency; editable: boolean; saving: boolean; onClick: () => void }) {
  const isUsd = currency === 'USD';
  const cls = `inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${
    isUsd ? 'border-blue-300 text-blue-600 bg-blue-50' : 'border-line text-ink-muted bg-surface'
  }`;
  if (!editable) {
    return <span className={cls} title="Billing currency">${' '}{currency}</span>;
  }
  return (
    <button onClick={onClick} disabled={saving} className={`${cls} hover:opacity-80 disabled:opacity-50`} title="Click to switch billing currency">
      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <span>$</span>} {currency}
    </button>
  );
}

// ---- Product card ----
function ProductCard({
  product, productId, overrides, mayCreate, onAdd,
}: {
  product: Product | null;
  productId: string;
  overrides: Override[];
  mayCreate: boolean;
  onAdd: () => void;
}) {
  const def = Number(product?.price ?? 0);
  const shown = overrides.slice(0, 4);
  const extra = overrides.length - shown.length;

  return (
    <div className="bg-white rounded-xl border border-line p-5 flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-ink truncate">{product?.name ?? '—'}</p>
          <p className="text-xs text-ink-muted">Default {formatMoney(def, 'CAD')}</p>
        </div>
        <span className="flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-teal/10 text-teal-dark">
          {overrides.length} customer{overrides.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="mt-4 space-y-1.5 flex-1">
        {shown.map((o) => {
          const cur = normalizeCurrency(o.customer?.preferred_currency);
          const pct = def > 0 ? ((def - Number(o.override_price)) / def) * 100 : 0;
          return (
            <div key={o.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-ink truncate">{fullName(o.customer)}</span>
              <span className="flex items-center gap-2 flex-shrink-0 tabular-nums">
                {def > 0 && pct !== 0 && (
                  <span className={pct > 0 ? 'text-emerald-600 text-xs' : 'text-red-600 text-xs'}>
                    {pct > 0 ? '-' : '+'}{Math.abs(pct).toFixed(0)}%
                  </span>
                )}
                <span className="font-semibold text-ink">{formatMoney(Number(o.override_price), cur)}</span>
              </span>
            </div>
          );
        })}
        {extra > 0 && <p className="text-xs text-ink-muted">+{extra} more</p>}
      </div>

      <div className="mt-4 pt-3 border-t border-line flex items-center gap-2">
        {mayCreate && (
          <button
            onClick={onAdd}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-ink text-white rounded-lg text-xs font-medium hover:bg-ink/90"
          >
            <Plus className="w-3.5 h-3.5" /> Add override
          </button>
        )}
        <Link
          href={`/admin/pricing/products/${productId}`}
          className="ml-auto text-xs font-medium text-teal-dark hover:text-teal-dark/80 inline-flex items-center gap-1"
        >
          See all <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-line p-5 animate-pulse">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-4 w-32 bg-surface rounded" />
          <div className="h-3 w-40 bg-surface rounded" />
        </div>
        <div className="h-5 w-16 bg-surface rounded-full" />
      </div>
      <div className="mt-4 space-y-2">
        <div className="h-3.5 w-full bg-surface rounded" />
        <div className="h-3.5 w-5/6 bg-surface rounded" />
        <div className="h-3.5 w-4/6 bg-surface rounded" />
      </div>
      <div className="mt-4 pt-3 border-t border-line flex gap-2">
        <div className="h-7 w-24 bg-surface rounded-lg" />
        <div className="h-7 w-16 bg-surface rounded-lg" />
        <div className="h-7 w-16 bg-surface rounded-lg ml-auto" />
      </div>
    </div>
  );
}

// ---- Single create/edit ----
function SingleOverrideModal({
  editing, prefillCustomerId, prefillProductId, customers, products, onClose, onSaved, onError: _onError,
}: {
  editing: Override | null;
  prefillCustomerId?: string;
  prefillProductId?: string;
  customers: Customer[];
  products: Product[];
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const isEdit = !!editing;
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>(
    editing ? [editing.customer_id] : prefillCustomerId ? [prefillCustomerId] : [],
  );
  const [productId, setProductId] = useState<string | null>(editing?.product_id ?? prefillProductId ?? null);
  const [price, setPrice] = useState<number | ''>(editing ? Number(editing.override_price) : '');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');

  async function save() {
    if (selectedCustomers.length === 0 || !productId) {
      setLocalError('Pick a customer and product');
      return;
    }
    if (price === '') {
      setLocalError('Enter an override price');
      return;
    }
    setLocalError('');
    setBusy(true);
    const headers = await authHeaders();
    const results = await Promise.all(selectedCustomers.map((customer_id) =>
      fetch('/api/admin/price-overrides', {
        method: 'POST', headers,
        body: JSON.stringify({ customer_id, product_id: productId, override_price: price }),
      }).then((r) => r.ok)
    ));
    setBusy(false);
    const ok = results.filter(Boolean).length;
    onSaved(`${ok} override${ok === 1 ? '' : 's'} saved.`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-line w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line flex-shrink-0">
          <h2 className="font-semibold text-ink">{isEdit ? 'Edit Price Override' : 'Add Price Override'}</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {localError && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {localError}
            </div>
          )}

          {isEdit ? (
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">Customer</label>
              <div className="px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink">{fullName(editing!.customer)}</div>
            </div>
          ) : (
            <MultiSelectCustomer
              customers={customers}
              selectedIds={selectedCustomers}
              onChange={setSelectedCustomers}
              label="Customers"
            />
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
            <NumericStepper
              value={price}
              onChange={setPrice}
              min={0}
              step={0.01}
              placeholder="0.00"
              prefix="$"
            />
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

// ---- Bulk 3-step ----
type BulkStep = 1 | 2 | 3;

function BulkPricingModal({
  customers, products, overrides, onClose, onDone,
}: {
  customers: Customer[];
  products: Product[];
  overrides: Override[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [step, setStep] = useState<BulkStep>(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [prices, setPrices] = useState<Record<string, number | ''>>({});
  const [busy, setBusy] = useState(false);

  const selectedCustomers = useMemo(
    () => customers.filter((c) => selected.includes(c.id)),
    [customers, selected],
  );

  // Rows that will actually be written: a set price that differs from what
  // every selected customer already has for that product.
  const changes = useMemo(() => {
    const rows: { product: Product; price: number; customerIds: string[] }[] = [];
    for (const p of products) {
      const priceVal = prices[p.id];
      if (priceVal === '' || priceVal === undefined) continue;
      const targets = selected.filter((cid) => {
        const existing = overrides.find((o) => o.customer_id === cid && o.product_id === p.id)?.override_price;
        return existing == null || Number(existing) !== Number(priceVal);
      });
      if (targets.length > 0) rows.push({ product: p, price: Number(priceVal), customerIds: targets });
    }
    return rows;
  }, [prices, products, selected, overrides]);

  async function save() {
    setBusy(true);
    const headers = await authHeaders();
    const payloads: { customer_id: string; product_id: string; override_price: number }[] = [];
    for (const row of changes) {
      for (const customer_id of row.customerIds) {
        payloads.push({ customer_id, product_id: row.product.id, override_price: row.price });
      }
    }
    const results = await Promise.all(payloads.map((c) =>
      fetch('/api/admin/price-overrides', { method: 'POST', headers, body: JSON.stringify(c) }).then((r) => r.ok)
    ));
    setBusy(false);
    const ok = results.filter(Boolean).length;
    const fail = results.length - ok;
    onDone(`${ok} saved${fail ? `, ${fail} failed` : ''}.`);
  }

  const hasChanges = Object.values(prices).some((v) => v !== '' && v !== undefined);
  const totalRows = changes.reduce((s, r) => s + r.customerIds.length, 0);

  // Arrow/Enter navigation between price inputs for fast entry.
  function onPriceKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault();
      const next = document.querySelector<HTMLInputElement>(`[data-bulk-price="${index + 1}"]`);
      next?.focus();
      next?.select();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = document.querySelector<HTMLInputElement>(`[data-bulk-price="${index - 1}"]`);
      prev?.focus();
      prev?.select();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      {step === 1 ? (
        <div className="bg-white rounded-2xl border border-line w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <h2 className="font-semibold text-ink flex items-center gap-2">
              <Users className="w-4 h-4 text-teal-dark" /> Select Customers
            </h2>
            <button onClick={onClose} className="text-ink-muted hover:text-ink"><X className="w-5 h-5" /></button>
          </div>
          <div className="p-5 overflow-y-auto flex-1">
            <MultiSelectCustomer
              customers={customers}
              selectedIds={selected}
              onChange={setSelected}
              label={`Customers${selected.length > 0 ? ` — ${selected.length} selected` : ''}`}
            />
          </div>
          <div className="flex gap-3 px-5 py-4 border-t border-line">
            <button onClick={onClose} className="px-4 py-2 border border-line rounded-lg text-sm text-ink-muted hover:text-ink">Cancel</button>
            <button
              onClick={() => setStep(2)}
              disabled={selected.length === 0}
              className="flex-1 px-4 py-2 bg-teal-dark text-white rounded-lg text-sm font-medium hover:bg-teal/90 disabled:opacity-40 flex items-center justify-center gap-2"
            >
              Next: Set Prices <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : step === 2 ? (
        <div className="bg-white rounded-2xl border border-line w-full max-w-5xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <h2 className="font-semibold text-ink flex items-center gap-2">
              <Users className="w-4 h-4 text-teal-dark" /> Bulk Edit Pricing — Step 2 of 3
            </h2>
            <button onClick={onClose} className="text-ink-muted hover:text-ink"><X className="w-5 h-5" /></button>
          </div>
          <div className="p-5 overflow-y-auto flex-1">
            <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-lg p-3 text-sm mb-4">
              Set a price for any product to apply across <strong>{selected.length}</strong> selected customer{selected.length === 1 ? '' : 's'}. Leave blank to skip.
              {' '}Use <strong>↑ / ↓</strong> or <strong>Enter</strong> to jump between price fields.
            </div>
            <div className="border border-line rounded-lg overflow-hidden">
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="border-b border-line sticky top-0 bg-surface z-10">
                      <th className="px-4 py-2 text-left text-xs text-ink-muted font-semibold uppercase tracking-wide">Product</th>
                      <th className="px-4 py-2 text-left text-xs text-ink-muted font-semibold uppercase tracking-wide">SKU</th>
                      <th className="px-4 py-2 text-right text-xs text-ink-muted font-semibold uppercase tracking-wide">Default Price</th>
                      <th className="px-4 py-2 text-right text-xs text-ink-muted font-semibold uppercase tracking-wide w-44">Override Price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/50">
                    {products.map((p, idx) => {
                      const priceVal = prices[p.id];
                      return (
                        <tr key={p.id}>
                          <td className="px-4 py-2 text-ink">{p.name}</td>
                          <td className="px-4 py-2 font-mono text-xs text-ink-muted">{p.sku ?? '—'}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-ink-muted">${p.price.toFixed(2)}</td>
                          <td className="px-4 py-2">
                            <NumericStepper
                              value={priceVal !== undefined ? priceVal : ''}
                              onChange={(v) => {
                                setPrices((prev) => {
                                  const next = { ...prev };
                                  if (v === '') delete next[p.id];
                                  else next[p.id] = v;
                                  return next;
                                });
                              }}
                              min={0}
                              step={0.01}
                              placeholder="Leave blank to skip"
                              prefix="$"
                              inputProps={{
                                onKeyDown: (e: React.KeyboardEvent) => onPriceKeyDown(e, idx),
                                ...({ 'data-bulk-price': idx } as Record<string, unknown>),
                              }}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="flex gap-3 px-5 py-4 border-t border-line">
            <button onClick={() => setStep(1)} className="px-4 py-2 bg-surface border border-line rounded-lg text-sm text-ink-muted hover:text-ink flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={!hasChanges}
              className="flex-1 px-4 py-2 bg-teal-dark text-white rounded-lg text-sm font-medium hover:bg-teal/90 disabled:opacity-40 flex items-center justify-center gap-2"
            >
              Next: Review <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-line w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <h2 className="font-semibold text-ink flex items-center gap-2">
              <ArrowRightCircle className="w-4 h-4 text-teal-dark" /> Review & Confirm — Step 3 of 3
            </h2>
            <button onClick={onClose} className="text-ink-muted hover:text-ink"><X className="w-5 h-5" /></button>
          </div>
          <div className="p-5 overflow-y-auto flex-1 space-y-5">
            <div>
              <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                Applies to {selectedCustomers.length} customer{selectedCustomers.length !== 1 ? 's' : ''}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {selectedCustomers.map((c) => {
                  const cur = normalizeCurrency(c.preferred_currency);
                  return (
                    <span key={c.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface border border-line text-xs text-ink">
                      {fullName(c)}
                      <span className={`font-semibold ${cur === 'USD' ? 'text-blue-600' : 'text-ink-muted'}`}>{cur}</span>
                    </span>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">Changes</p>
              {changes.length === 0 ? (
                <p className="text-sm text-ink-muted">Nothing to change — all selected customers already have these prices.</p>
              ) : (
                <div className="border border-line rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line bg-surface">
                        <th className="px-4 py-2 text-left text-xs text-ink-muted font-semibold uppercase tracking-wide">Product</th>
                        <th className="px-4 py-2 text-right text-xs text-ink-muted font-semibold uppercase tracking-wide">New Price</th>
                        <th className="px-4 py-2 text-right text-xs text-ink-muted font-semibold uppercase tracking-wide"># Customers</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/50">
                      {changes.map((row) => (
                        <tr key={row.product.id}>
                          <td className="px-4 py-2 text-ink">{row.product.name}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-semibold text-ink">${row.price.toFixed(2)}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-ink-muted">{row.customerIds.length}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-line bg-surface/60">
                        <td className="px-4 py-2 text-xs font-semibold text-ink-muted uppercase">Total overrides</td>
                        <td />
                        <td className="px-4 py-2 text-right tabular-nums font-semibold text-ink">{totalRows}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-3 px-5 py-4 border-t border-line">
            <button onClick={() => setStep(2)} className="px-4 py-2 bg-surface border border-line rounded-lg text-sm text-ink-muted hover:text-ink flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button
              onClick={save}
              disabled={busy || totalRows === 0}
              className="flex-1 px-4 py-2 bg-teal-dark text-white rounded-lg text-sm font-medium hover:bg-teal/90 disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Confirm & Save {totalRows} Override{totalRows !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
