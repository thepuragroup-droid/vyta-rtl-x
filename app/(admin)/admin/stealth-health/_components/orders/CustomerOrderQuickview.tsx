'use client';

/**
 * Admin quickview: renders a paid Stealth Health order exactly as the customer sees
 * it on /account/orders/[id]. Fidelity is guaranteed by pulling the data
 * through the SAME `getOrderWithItems` path the customer detail page uses, and
 * mirroring that page's markup (slate/cyan theme, receipt note, hidden address).
 */
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Package,
  Clock,
  CheckCircle,
  Truck,
  XCircle,
  Beaker,
  FileText,
  Loader2,
  EyeOff,
} from 'lucide-react';
import { getOrderWithItems, type CustomerOrder } from '@/lib/customer/api';
import type { OrderItem } from '@/lib/supabase';

// Mirrors statusConfig in app/(customer)/account/orders/[id]/page.tsx.
const statusConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  pending: { icon: <Clock className="w-4 h-4" />, color: 'text-amber-700 bg-amber-50 border-amber-100', label: 'Pending' },
  received: { icon: <CheckCircle className="w-4 h-4" />, color: 'text-cyan-700 bg-cyan-50 border-cyan-100', label: 'Payment Received' },
  confirmed: { icon: <CheckCircle className="w-4 h-4" />, color: 'text-blue-700 bg-blue-50 border-blue-100', label: 'Confirmed' },
  processing: { icon: <Package className="w-4 h-4" />, color: 'text-purple-700 bg-purple-50 border-purple-100', label: 'Processing' },
  shipped: { icon: <Truck className="w-4 h-4" />, color: 'text-indigo-700 bg-indigo-50 border-indigo-100', label: 'Shipped' },
  delivered: { icon: <CheckCircle className="w-4 h-4" />, color: 'text-emerald-700 bg-emerald-50 border-emerald-100', label: 'Delivered' },
  cancelled: { icon: <XCircle className="w-4 h-4" />, color: 'text-red-700 bg-red-50 border-red-100', label: 'Cancelled' },
};

type ItemRow = OrderItem & { product_name?: string; product_strength?: string };
type LoadState = 'loading' | 'ready' | 'empty' | 'error';

export default function CustomerOrderQuickview({
  invoiceId,
  notLinked,
  reason,
  onClose,
}: {
  /** Materialised invoice id (the account uses this as the order id). */
  invoiceId: string | null;
  /** True when an invoice exists but no customer account is linked to it. */
  notLinked?: boolean;
  /** Why the order is/ isn't visible — shown in the header banner. */
  reason: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<LoadState>(invoiceId ? 'loading' : 'empty');
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);

  useEffect(() => {
    if (!invoiceId) {
      setState('empty');
      return;
    }
    let cancelled = false;
    setState('loading');
    (async () => {
      try {
        const res = await getOrderWithItems(invoiceId);
        if (cancelled) return;
        if (!res) {
          setState('empty');
          return;
        }
        setOrder(res.order);
        setItems(res.items);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const status = order ? statusConfig[order.status] || statusConfig.pending : null;
  const subtotal = (order as any)?.subtotal as number | null | undefined;
  const shippingCost = (order as any)?.shipping_cost as number | null | undefined;
  const currency = (order as any)?.currency as string | null | undefined;

  const lineItems =
    items.length > 0
      ? items.map((it, i) => ({
          key: it.id ?? String(i),
          name: it.product_name || `Product ${i + 1}`,
          strength: it.product_strength,
          quantity: it.quantity,
          price: it.price_at_time,
        }))
      : (((order?.items as any[]) ?? []).map((it, i) => ({
          key: `${it.id ?? 'item'}-${i}`,
          name: it.name ?? `Product ${i + 1}`,
          strength: it.strength,
          quantity: it.quantity,
          price: it.price,
        })));

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-ink/40 p-4 backdrop-blur-sm sm:p-8"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.98 }}
          transition={{ type: 'spring', damping: 30, stiffness: 320 }}
          className="w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Customer order preview"
        >
          {/* Chrome: makes clear this is the customer's account page */}
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
              </span>
              <span className="truncate font-mono text-[11px] text-slate-400">
                aminocan.com/account/orders{invoiceId ? `/${invoiceId}` : ''}
              </span>
            </div>
            <button
              onClick={onClose}
              aria-label="Close preview"
              className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Visibility banner */}
          <div
            className={`flex items-start gap-2 px-5 py-2.5 text-xs font-medium ${
              invoiceId && !notLinked
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-amber-50 text-amber-700'
            }`}
          >
            {invoiceId && !notLinked ? (
              <CheckCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            ) : (
              <EyeOff className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            )}
            <span>{reason}</span>
          </div>

          <div className="max-h-[70vh] overflow-y-auto bg-white p-5 sm:p-6">
            {state === 'loading' ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin text-cyan-600" /> Loading the customer view…
              </div>
            ) : state === 'error' ? (
              <div className="py-16 text-center text-sm text-red-600">
                Could not load the customer view.
              </div>
            ) : state === 'empty' || !order ? (
              <div className="py-14 text-center">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100">
                  <EyeOff className="h-7 w-7 text-slate-400" />
                </div>
                <h3 className="text-base font-bold text-slate-900">Not shown to any customer</h3>
                <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{reason}</p>
              </div>
            ) : (
              <>
                {/* Order header card */}
                <div className="mb-5 rounded-xl border border-slate-200 p-5">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-600">
                        Order Details
                      </span>
                      <h1 className="text-2xl font-bold text-slate-900">#{order.order_number}</h1>
                      <p className="mt-1 text-xs text-slate-500">
                        Placed on{' '}
                        {new Date(order.created_at).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <div className="flex flex-col items-start gap-2 md:items-end">
                      {status && (
                        <div
                          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium ${status.color}`}
                        >
                          {status.icon}
                          <span>{status.label}</span>
                        </div>
                      )}
                      {/* Stealth Health orders are receipted by the partner — matches
                          the customer detail page (no invoice download). */}
                      <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                        <FileText className="h-4 w-4 text-cyan-600" />
                        <span>Receipt emailed by our checkout partner</span>
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid gap-5 md:grid-cols-3">
                  {/* Items */}
                  <div className="md:col-span-2">
                    <div className="overflow-hidden rounded-xl border border-slate-200">
                      <div className="border-b border-slate-100 p-5">
                        <h2 className="text-base font-bold text-slate-900">Order Items</h2>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {lineItems.map((item) => (
                          <div key={item.key} className="flex items-center gap-4 p-4 sm:p-5">
                            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100">
                              <Beaker className="h-6 w-6 text-cyan-500" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <h3 className="text-sm font-semibold text-slate-900">{item.name}</h3>
                              {item.strength && (
                                <p className="mt-0.5 text-xs text-slate-500">{item.strength}</p>
                              )}
                              <p className="mt-1 text-xs text-slate-400">Qty: {item.quantity}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-bold text-slate-900 tabular-nums">
                                ${(Number(item.price) * Number(item.quantity)).toFixed(2)}
                              </p>
                              <p className="text-xs text-slate-500 tabular-nums">
                                ${Number(item.price).toFixed(2)} each
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Summary */}
                  <div>
                    <div className="rounded-xl border border-slate-200 p-5">
                      <h3 className="mb-4 text-base font-bold text-slate-900">Order Summary</h3>
                      <div className="space-y-3 text-sm">
                        <div className="flex justify-between text-slate-500">
                          <span>Subtotal</span>
                          <span className="tabular-nums">
                            ${Number(subtotal ?? order.total).toFixed(2)}
                          </span>
                        </div>
                        <div className="flex justify-between text-slate-500">
                          <span>Shipping</span>
                          {shippingCost != null ? (
                            <span className="tabular-nums">${Number(shippingCost).toFixed(2)}</span>
                          ) : (
                            <span className="font-medium text-emerald-600">Free</span>
                          )}
                        </div>
                        <div className="border-t border-slate-100 pt-3">
                          <div className="flex justify-between">
                            <span className="font-bold text-slate-900">Total</span>
                            <span className="text-lg font-bold text-slate-900 tabular-nums">
                              ${Number(order.total).toFixed(2)}
                              {currency && currency !== 'CAD' && (
                                <span className="ml-1 text-sm font-medium text-slate-400">
                                  {currency}
                                </span>
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
