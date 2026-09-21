'use client';

/**
 * Cart Upsells — the "Frequently bought together" pairings.
 *
 * One product at a time: pick the product a shopper might have in their cart,
 * then pick what should be offered alongside it. The cart shows the first
 * three, in this order, for whatever the shopper is carrying.
 *
 * The other cart block, "You may also like", has no screen: it is ranked from
 * what people actually buy together (lib/products/recommendations.ts). All
 * there is to decide about it is whether it shows at all, which lives with the
 * other cart switches on /admin/promos.
 *
 * Pairings are DIRECTIONAL. Setting "buy BPC-157 with ARA290" does not also
 * make ARA290 an upsell under BPC-157 — so a cheap add-on can be attached to a
 * flagship without the flagship turning up beneath the add-on.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  Layers,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import { useUserRole } from '../layout';
import { PACK_BADGE_PRESETS } from '@/lib/pricing';

interface AdminProduct {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  image_url: string | null;
  category: string | null;
  stock_quantity: number;
  active: boolean;
}

interface RecommendationRow {
  id: string;
  product_id: string;
  recommended_product_id: string;
  sort_order: number;
  badge: string | null;
  enabled: boolean;
}

/** One row of the list being edited, before it is saved. */
interface DraftItem {
  recommendedProductId: string;
  badge: string;
}

/** Most pairings one product may carry — the API enforces the same ceiling. */
const MAX_ITEMS = 6;

const INPUT =
  'px-3 py-2 bg-surface rounded-lg border border-line text-sm text-ink ' +
  'placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-teal/40 ' +
  'disabled:opacity-50';

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export default function CartUpsellsPage() {
  const userRole = useUserRole();
  const isReadOnly = userRole !== 'admin';
  const toast = useToast();

  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [rows, setRows] = useState<RecommendationRow[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  /** The product whose list is open. Null until one is chosen. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftItem[]>([]);
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState(false);
  const [pickSearch, setPickSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/product-recommendations', {
        cache: 'no-store',
        headers: await authHeaders(),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load');
      setProducts(json.products ?? []);
      setRows(json.recommendations ?? []);
      setWarning(json.warning ?? null);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load cart upsells');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const byId = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  /** How many pairings each product carries — the count on the left-hand list. */
  const countsByProduct = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.product_id, (counts.get(row.product_id) ?? 0) + 1);
    }
    return counts;
  }, [rows]);

  /** Open a product's list. Unsaved edits to the previous one are discarded. */
  const open = useCallback(
    (productId: string) => {
      setSelectedId(productId);
      setPicking(false);
      setPickSearch('');
      setDraft(
        rows
          .filter((row) => row.product_id === productId)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((row) => ({
            recommendedProductId: row.recommended_product_id,
            badge: row.badge ?? '',
          })),
      );
    },
    [rows],
  );

  const dirty = useMemo(() => {
    if (!selectedId) return false;
    const saved = rows
      .filter((row) => row.product_id === selectedId)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((row) => `${row.recommended_product_id}:${row.badge ?? ''}`);
    const current = draft.map((item) => `${item.recommendedProductId}:${item.badge}`);
    return saved.join('|') !== current.join('|');
  }, [draft, rows, selectedId]);

  const save = useCallback(async () => {
    if (!selectedId || isReadOnly) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/product-recommendations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ productId: selectedId, items: draft }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Save failed');
      // Swap this product's rows for what came back, leaving every other
      // product's rows alone — the response only covers the one edited.
      setRows((current) => [
        ...current.filter((row) => row.product_id !== selectedId),
        ...(json.recommendations ?? []),
      ]);
      toast.success('Pairings saved');
    } catch (e: any) {
      toast.error(e.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [draft, isReadOnly, selectedId, toast]);

  const addItem = (productId: string) => {
    if (draft.length >= MAX_ITEMS) {
      toast.error(`That's the most a product can recommend (${MAX_ITEMS}).`);
      return;
    }
    if (draft.some((item) => item.recommendedProductId === productId)) return;
    setDraft((current) => [...current, { recommendedProductId: productId, badge: '' }]);
    setPicking(false);
    setPickSearch('');
  };

  const move = (index: number, by: -1 | 1) => {
    setDraft((current) => {
      const next = [...current];
      const target = index + by;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  const visibleProducts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return products
      .filter((p) => p.active)
      .filter(
        (p) =>
          !needle ||
          p.name.toLowerCase().includes(needle) ||
          (p.sku ?? '').toLowerCase().includes(needle),
      );
  }, [products, search]);

  const pickable = useMemo(() => {
    const needle = pickSearch.trim().toLowerCase();
    const taken = new Set(draft.map((item) => item.recommendedProductId));
    return products
      .filter((p) => p.active && p.id !== selectedId && !taken.has(p.id))
      .filter((p) => !needle || p.name.toLowerCase().includes(needle))
      .slice(0, 30);
  }, [draft, pickSearch, products, selectedId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading cart upsells…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal/10">
          <Layers className="h-5 w-5 text-teal-dark" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-ink sm:text-3xl">Cart Upsells</h1>
          <p className="text-sm text-ink-muted">
            What the cart offers alongside each product — the &ldquo;Frequently bought
            together&rdquo; row.
          </p>
        </div>
      </div>

      {warning && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{warning}</span>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-line bg-surface px-4 py-3 text-xs text-ink-muted">
        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-muted" />
        <span>
          Pairings are one-way: what you set here is shown when THIS product is in the
          cart. The cart shows the first three. Whether the row appears at all is the{' '}
          <Link href="/admin/promos" className="font-medium underline underline-offset-2">
            Promotions
          </Link>{' '}
          page&apos;s &ldquo;Cart suggestions&rdquo; switch.
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        {/* Product list */}
        <div className="rounded-xl border border-line bg-white">
          <div className="border-b border-line p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products…"
                className={`${INPUT} w-full pl-9`}
              />
            </div>
          </div>
          <div className="max-h-[32rem] overflow-y-auto divide-y divide-line">
            {visibleProducts.length === 0 && (
              <p className="p-4 text-sm text-ink-muted">No products match that search.</p>
            )}
            {visibleProducts.map((product) => {
              const count = countsByProduct.get(product.id) ?? 0;
              const isOpen = product.id === selectedId;
              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => open(product.id)}
                  className={`flex w-full items-center gap-3 p-3 text-left transition-colors ${
                    isOpen ? 'bg-teal/5' : 'hover:bg-surface'
                  }`}
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface">
                    {product.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.image_url}
                        alt=""
                        className="h-full w-full object-contain p-1"
                      />
                    ) : (
                      <Layers className="h-4 w-4 text-line" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{product.name}</p>
                    <p className="text-xs text-ink-muted">
                      {count > 0
                        ? `${count} pairing${count === 1 ? '' : 's'}`
                        : 'No pairings yet'}
                    </p>
                  </div>
                  {isOpen && <ArrowRight className="h-4 w-4 flex-shrink-0 text-teal-dark" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Editor */}
        <div className="rounded-xl border border-line bg-white p-5">
          {!selected ? (
            <div className="py-12 text-center">
              <Layers className="mx-auto mb-3 h-8 w-8 text-line" />
              <p className="text-sm font-medium text-ink">Pick a product to pair</p>
              <p className="mt-1 text-xs text-ink-muted">
                Choose one on the left, then add what should be offered with it.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-ink-muted">
                    Shown when the cart contains
                  </p>
                  <h2 className="text-lg font-semibold text-ink">{selected.name}</h2>
                </div>
                <button
                  type="button"
                  onClick={save}
                  disabled={isReadOnly || saving || !dirty}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-ink/90 disabled:opacity-40"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  {dirty ? 'Save pairings' : 'Saved'}
                </button>
              </div>

              {draft.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center">
                  <p className="text-sm text-ink-muted">
                    Nothing paired yet. The cart falls back to &ldquo;You may also
                    like&rdquo; for this product.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2.5">
                  {draft.map((item, index) => {
                    const product = byId.get(item.recommendedProductId);
                    return (
                      <li
                        key={item.recommendedProductId}
                        className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3"
                      >
                        <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-ink-muted">
                          {index + 1}
                        </span>
                        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-white">
                          {product?.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={product.image_url}
                              alt=""
                              className="h-full w-full object-contain p-1"
                            />
                          ) : (
                            <Layers className="h-4 w-4 text-line" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink">
                            {product?.name ?? 'Product removed'}
                          </p>
                          <p className="text-xs text-ink-muted">
                            {product ? `$${Number(product.price).toFixed(2)}` : '—'}
                            {product && Number(product.stock_quantity) <= 0 && (
                              <span className="ml-2 text-amber-700">
                                Out of stock — the cart hides it
                              </span>
                            )}
                          </p>
                        </div>

                        <input
                          type="text"
                          list="cart-upsell-badges"
                          value={item.badge}
                          disabled={isReadOnly}
                          onChange={(e) =>
                            setDraft((current) =>
                              current.map((row, i) =>
                                i === index ? { ...row, badge: e.target.value } : row,
                              ),
                            )
                          }
                          placeholder="Badge (optional)"
                          className={`${INPUT} w-full sm:w-44`}
                        />

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => move(index, -1)}
                            disabled={isReadOnly || index === 0}
                            aria-label="Move up"
                            className="rounded-lg border border-line bg-white p-2 text-ink-muted hover:text-ink disabled:opacity-30"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => move(index, 1)}
                            disabled={isReadOnly || index === draft.length - 1}
                            aria-label="Move down"
                            className="rounded-lg border border-line bg-white p-2 text-ink-muted hover:text-ink disabled:opacity-30"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDraft((current) => current.filter((_, i) => i !== index))
                            }
                            disabled={isReadOnly}
                            aria-label={`Remove ${product?.name ?? 'product'}`}
                            className="rounded-lg border border-line bg-white p-2 text-ink-muted hover:text-red-500 disabled:opacity-30"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              <datalist id="cart-upsell-badges">
                {PACK_BADGE_PRESETS.map((preset) => (
                  <option key={preset} value={preset} />
                ))}
              </datalist>

              <div className="mt-4 border-t border-line pt-4">
                {picking ? (
                  <div className="rounded-lg border border-line">
                    <div className="flex items-center gap-2 border-b border-line p-2.5">
                      <Search className="h-4 w-4 flex-shrink-0 text-ink-muted" />
                      <input
                        autoFocus
                        type="search"
                        value={pickSearch}
                        onChange={(e) => setPickSearch(e.target.value)}
                        placeholder="Search products to pair…"
                        className="flex-1 bg-transparent text-sm text-ink placeholder-ink-muted focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setPicking(false)}
                        aria-label="Close product picker"
                        className="rounded-lg p-1 text-ink-muted hover:text-ink"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="max-h-64 divide-y divide-line overflow-y-auto">
                      {pickable.length === 0 && (
                        <p className="p-3 text-sm text-ink-muted">
                          Nothing left to add from that search.
                        </p>
                      )}
                      {pickable.map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => addItem(product.id)}
                          className="flex w-full items-center gap-3 p-2.5 text-left hover:bg-surface"
                        >
                          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface">
                            {product.image_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={product.image_url}
                                alt=""
                                className="h-full w-full object-contain p-0.5"
                              />
                            ) : (
                              <Layers className="h-3.5 w-3.5 text-line" />
                            )}
                          </div>
                          <span className="min-w-0 flex-1 truncate text-sm text-ink">
                            {product.name}
                          </span>
                          <span className="text-xs tabular-nums text-ink-muted">
                            ${Number(product.price).toFixed(2)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPicking(true)}
                    disabled={isReadOnly || draft.length >= MAX_ITEMS}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink hover:border-teal/40 disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    Add a product
                  </button>
                )}
                <p className="mt-2 text-xs text-ink-muted">
                  {draft.length}/{MAX_ITEMS} paired — the cart shows the first three, in
                  this order.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
