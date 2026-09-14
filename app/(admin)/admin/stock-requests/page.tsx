'use client';

import React from 'react';
import Link from 'next/link';
import { Bell, Beaker, Package, ArrowRight } from 'lucide-react';
import { useSmartLoad } from '@/lib/hooks/useSmartLoad';
import { SlowLoadingNotice, LoadingError } from '@/components/LoadingFeedback';

interface WaitlistProduct {
  product_id: string;
  name: string;
  slug: string | null;
  image_url: string | null;
  price: number;
  stock_quantity: number;
  count: number;
  latest_request: string;
}

interface StockRequestsResponse {
  products: WaitlistProduct[];
  totalRequests: number;
}

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleDateString('en-CA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

export default function StockRequestsPage() {
  const { data, loading, slow, error, reload } = useSmartLoad<StockRequestsResponse>(
    '/api/admin/stock-notifications',
  );

  const products = data?.products ?? [];
  const totalRequests = data?.totalRequests ?? 0;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 sm:mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Bell className="w-5 h-5 text-teal-dark" />
          <h1 className="text-xl sm:text-2xl font-bold text-ink">Stock Requests</h1>
        </div>
        <p className="text-ink-muted text-sm">
          Products customers are waiting on. Most-requested first — restock a product and
          everyone on its list is emailed automatically.
        </p>
      </div>

      {/* Summary cards */}
      {!loading && !error && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-line p-5">
            <p className="text-3xl font-bold text-ink tabular-nums">{products.length}</p>
            <p className="text-xs text-ink-muted uppercase tracking-wider mt-1">
              Products with requests
            </p>
          </div>
          <div className="bg-white rounded-xl border border-line p-5">
            <p className="text-3xl font-bold text-ink tabular-nums">{totalRequests}</p>
            <p className="text-xs text-ink-muted uppercase tracking-wider mt-1">
              Total people waiting
            </p>
          </div>
        </div>
      )}

      {/* Content card */}
      <div className="bg-white rounded-xl border border-line overflow-hidden">
        {error ? (
          <LoadingError message={error} onRetry={reload} />
        ) : loading ? (
          <div className="p-5">
            {slow && <SlowLoadingNotice onReload={reload} />}
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 animate-pulse">
                  <div className="w-10 h-10 rounded-lg bg-surface" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-surface rounded w-1/3" />
                    <div className="h-3 bg-surface rounded w-1/5" />
                  </div>
                  <div className="h-6 w-20 bg-surface rounded-full" />
                </div>
              ))}
            </div>
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-16 px-6">
            <div className="w-14 h-14 rounded-full bg-surface flex items-center justify-center mb-4">
              <Bell className="w-7 h-7 text-ink-muted" />
            </div>
            <p className="text-sm font-medium text-ink mb-1">No requests yet</p>
            <p className="text-sm text-ink-muted max-w-sm">
              When a customer signs up to be notified about an out-of-stock product, it will
              appear here — ranked by how many people are waiting.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead className="bg-surface">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                    Product
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                    Waiting
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                    Current Stock
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                    Latest Request
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50">
                {products.map((p) => (
                  <tr key={p.product_id} className="hover:bg-surface transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        {p.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.image_url}
                            alt={p.name}
                            className="w-10 h-10 rounded-lg object-cover border border-line"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-surface flex items-center justify-center">
                            <Beaker className="w-5 h-5 text-ink-muted" />
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-medium text-ink">{p.name}</p>
                          <p className="text-xs text-ink-muted tabular-nums">
                            ${Number(p.price ?? 0).toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center gap-1.5 bg-teal/10 text-teal-dark px-2.5 py-1 rounded-full text-xs font-medium">
                        <Bell className="w-3 h-3" />
                        {p.count}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {p.stock_quantity > 0 ? (
                        <span className="text-sm text-emerald-600 tabular-nums">
                          {p.stock_quantity} in stock
                        </span>
                      ) : (
                        <span className="text-sm text-red-600">Out of stock</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-sm text-ink-muted">
                        {formatDate(p.latest_request)}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link
                        href="/admin/products"
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-dark hover:underline"
                      >
                        <Package className="w-4 h-4" />
                        Restock
                        <ArrowRight className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
