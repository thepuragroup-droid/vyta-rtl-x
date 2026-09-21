'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useCart } from '@/contexts/CartContext';
import {
  Package,
  Truck,
  CheckCircle,
  Clock,
  Search,
  Copy,
  Check,
  AlertCircle,
  MapPin,
  ExternalLink,
} from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';

interface OrderData {
  order_number: string;
  status: string;
  items: { name: string; quantity: number; price: number; strength?: string }[];
  total: number;
  crypto?: string | null;
  payment_amount_expected?: string | null;
  payment_tx_hash?: string | null;
  shipping_address: any;
  tracking_number: string | null;
  tracking_url?: string | null;
  created_at: string;
}

const explorerUrls: Record<string, string> = {
  btc: 'https://mempool.space/tx/',
  eth: 'https://etherscan.io/tx/',
  sol: 'https://explorer.solana.com/tx/',
};

function OrderTrackContent() {
  const searchParams = useSearchParams();
  const initialOrder = searchParams.get('order') || '';
  const initialEmail = searchParams.get('email') || '';
  const { clearCart } = useCart();

  const [orderInput, setOrderInput] = useState(initialOrder);
  const [emailInput, setEmailInput] = useState(initialEmail);
  const [orderData, setOrderData] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  // Clear cart when arriving from checkout redirect
  useEffect(() => {
    if (initialOrder) {
      clearCart();
    }
  }, [initialOrder, clearCart]);

  const searchOrder = async (orderNumber: string, email: string) => {
    if (!orderNumber.trim()) {
      setError('Please enter an order number');
      return;
    }
    if (!email.trim()) {
      setError('Please enter the email address used on the order');
      return;
    }

    setLoading(true);
    setError('');
    setOrderData(null);

    try {
      const data = await apiFetch<OrderData>(
        `/api/orders?orderNumber=${encodeURIComponent(orderNumber.trim())}&email=${encodeURIComponent(email.trim())}`,
      );
      setOrderData(data);
    } catch (err: any) {
      setError(err.message || 'Failed to find order');
    } finally {
      setLoading(false);
    }
  };

  // Auto-search only when the checkout redirect supplied BOTH the order number
  // and the email (the confirmation screen links here with both).
  useEffect(() => {
    if (initialOrder && initialEmail) {
      searchOrder(initialOrder, initialEmail);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOrder, initialEmail]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    searchOrder(orderInput, emailInput);
  };

  const copyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard unavailable (insecure context / older browser) — no-op */
    }
  };

  const getStatusStep = (status: string) => {
    const steps = ['pending', 'received', 'confirmed', 'processing', 'shipped', 'delivered'];
    // Clamp unknown statuses to 0 so the progress bar never goes negative.
    return Math.max(0, steps.indexOf((status ?? '').toLowerCase()));
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'pending': return 'text-yellow-600 bg-yellow-100';
      case 'received': return 'text-cyan-600 bg-cyan-100';
      case 'confirmed': return 'text-blue-600 bg-blue-100';
      case 'processing': return 'text-blue-600 bg-blue-100';
      case 'shipped': return 'text-purple-600 bg-purple-100';
      case 'delivered': return 'text-emerald-600 bg-emerald-100';
      case 'expired': return 'text-red-600 bg-red-100';
      case 'cancelled': return 'text-red-600 bg-red-100';
      default: return 'text-slate-600 bg-slate-100';
    }
  };

  return (
    <div className="min-h-screen bg-white py-8 sm:py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6 sm:mb-8">
          <Link href="/" className="inline-flex items-center gap-3 mb-4">
            <img src="/images/vyta-mark.png" alt="" aria-hidden="true" className="w-10 h-10 object-contain" />
            <span className="text-lg font-bold text-ink">VYTA</span>
          </Link>
          <h1 className="text-2xl sm:text-3xl font-bold text-ink mb-1 sm:mb-2">Track Your Order</h1>
          <p className="text-ink-muted text-xs sm:text-sm">Enter your order number to check status</p>
        </div>

        {/* Search Form */}
        <form onSubmit={handleSubmit} className="mb-6 sm:mb-8">
          <div className="bg-white rounded-xl border border-line shadow-sm p-3 sm:p-4 space-y-3">
            <div>
              <label htmlFor="track-order" className="block text-xs sm:text-sm font-medium text-ink-muted mb-1.5 sm:mb-2">Order Number</label>
              <input
                id="track-order"
                type="text"
                value={orderInput}
                onChange={(e) => setOrderInput(e.target.value.toUpperCase())}
                placeholder="AMC-XXXXXXXX"
                autoComplete="off"
                className="w-full px-3 sm:px-4 py-2.5 sm:py-3 border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-teal/40 font-mono uppercase text-xs sm:text-sm"
              />
            </div>
            <div>
              <label htmlFor="track-email" className="block text-xs sm:text-sm font-medium text-ink-muted mb-1.5 sm:mb-2">Email used on the order</label>
              <div className="flex gap-2 sm:gap-3">
                <input
                  id="track-email"
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="flex-1 px-3 sm:px-4 py-2.5 sm:py-3 border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-teal/40 text-xs sm:text-sm"
                />
                <button
                  type="submit"
                  disabled={loading}
                  aria-label="Track order"
                  className="px-4 sm:px-6 py-2.5 sm:py-3 bg-ink text-white rounded-lg font-semibold hover:bg-ink/90 transition-all disabled:opacity-50 flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm"
                >
                  {loading ? (
                    <div className="animate-spin rounded-full h-4 sm:h-5 w-4 sm:w-5 border-2 border-white border-t-transparent"></div>
                  ) : (
                    <>
                      <Search className="w-4 sm:w-5 h-4 sm:h-5" />
                      <span className="hidden sm:inline">Track</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </form>

        {/* Error Display */}
        {error && (
          <div className="mb-4 sm:mb-6 bg-red-50 border border-red-200 rounded-xl p-3 sm:p-4 flex items-start gap-2 sm:gap-3">
            <AlertCircle className="w-4 sm:w-5 h-4 sm:h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-red-800 text-xs sm:text-sm">{error}</p>
          </div>
        )}

        {/* Order Details */}
        {orderData && (
          <div className="space-y-4 sm:space-y-6">
            <div className="bg-white rounded-2xl border border-line shadow-lg overflow-hidden">
              {/* Order Header */}
              <div className="bg-ink px-4 sm:px-6 py-3 sm:py-4">
                <div className="flex items-center justify-between text-white">
                  <div>
                    <p className="text-white/60 text-[10px] sm:text-sm">Order Number</p>
                    <p className="font-bold text-base sm:text-lg">{orderData.order_number}</p>
                  </div>
                  <div className={`px-2 sm:px-3 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-sm font-semibold ${getStatusColor(orderData.status)}`}>
                    {(orderData.status ?? 'pending').toUpperCase()}
                  </div>
                </div>
              </div>

              <div className="p-4 sm:p-6">
                {/* Status Timeline */}
                {orderData.status !== 'expired' && orderData.status !== 'cancelled' && (
                  <div className="mb-6 sm:mb-8">
                    <h3 className="font-semibold text-ink mb-3 sm:mb-4 text-sm sm:text-base">Order Progress</h3>
                    <div className="relative">
                      <div className="flex justify-between">
                        {['Placed', 'Received', 'Confirmed', 'Processing', 'Shipped', 'Delivered'].map((step, index) => {
                          const currentStep = getStatusStep(orderData.status);
                          const isActive = index <= currentStep;
                          const isCurrent = index === currentStep;

                          return (
                            <div key={step} className="flex flex-col items-center flex-1">
                              <div
                                className={`w-8 sm:w-10 h-8 sm:h-10 rounded-full flex items-center justify-center mb-1 sm:mb-2 transition-all ${
                                  isActive
                                    ? 'bg-emerald-500 text-white'
                                    : 'bg-surface text-ink-muted border border-line'
                                } ${isCurrent ? 'ring-2 sm:ring-4 ring-emerald-200' : ''}`}
                              >
                                {isActive ? (
                                  <Check className="w-4 sm:w-5 h-4 sm:h-5" />
                                ) : (
                                  <span className="text-[10px] sm:text-sm font-semibold">{index + 1}</span>
                                )}
                              </div>
                              <span className={`text-[8px] sm:text-xs font-medium text-center ${isActive ? 'text-emerald-700' : 'text-ink-muted'}`}>
                                {step}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="absolute top-4 sm:top-5 left-0 right-0 h-0.5 bg-surface -z-10 mx-6 sm:mx-10">
                        <div
                          className="h-full bg-emerald-500 transition-all"
                          style={{ width: `${(getStatusStep(orderData.status) / 5) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tracking Number */}
                {orderData.tracking_number && (
                  <div className="mb-4 sm:mb-6 bg-purple-50 rounded-xl p-3 sm:p-4 border border-purple-200">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <Truck className="w-4 sm:w-5 h-4 sm:h-5 text-purple-600" />
                        <div>
                          <p className="text-[10px] sm:text-sm text-purple-600 font-medium">Tracking Number</p>
                          <code className="text-purple-900 font-mono font-semibold text-xs sm:text-sm">
                            {orderData.tracking_number}
                          </code>
                        </div>
                      </div>
                      <button
                        onClick={() => copyText(orderData.tracking_number!, 'tracking')}
                        aria-label="Copy tracking number"
                        className={`p-1.5 sm:p-2 rounded-lg transition-colors ${
                          copied === 'tracking'
                            ? 'bg-emerald-100 text-emerald-600'
                            : 'bg-purple-100 hover:bg-purple-200 text-purple-600'
                        }`}
                      >
                        {copied === 'tracking' ? <Check className="w-4 sm:w-5 h-4 sm:h-5" /> : <Copy className="w-4 sm:w-5 h-4 sm:h-5" />}
                      </button>
                    </div>
                  </div>
                )}

                {/* Payment Info */}
                <div className="grid grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
                  <div>
                    <div className="flex items-center gap-1.5 sm:gap-2 mb-1 sm:mb-2">
                      <Clock className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-ink-muted" />
                      <span className="text-[10px] sm:text-sm font-medium text-ink-muted">Order Date</span>
                    </div>
                    <p className="font-semibold text-ink text-xs sm:text-sm">
                      {new Date(orderData.created_at).toLocaleDateString('en-US', {
                        year: 'numeric', month: 'long', day: 'numeric',
                      })}
                    </p>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 sm:gap-2 mb-1 sm:mb-2">
                      <Package className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-ink-muted" />
                      <span className="text-[10px] sm:text-sm font-medium text-ink-muted">Total</span>
                    </div>
                    <p className="font-semibold text-ink text-xs sm:text-sm">
                      ${Number(orderData.total).toFixed(2)} CAD
                    </p>
                    {orderData.crypto && (
                      <p className="text-[10px] sm:text-xs text-ink-muted">
                        {orderData.payment_amount_expected} {orderData.crypto.toUpperCase()}
                      </p>
                    )}
                  </div>
                </div>

                {/* Transaction Hash */}
                {orderData.payment_tx_hash && (
                  <div className="mb-4 sm:mb-6">
                    <label className="block text-xs sm:text-sm font-medium text-ink-muted mb-1.5 sm:mb-2">Transaction</label>
                    <div className="bg-surface rounded-lg p-2 sm:p-3 break-all border border-line flex items-start justify-between gap-2">
                      <code className="text-[10px] sm:text-xs text-ink">{orderData.payment_tx_hash}</code>
                      <a
                        href={`${explorerUrls[orderData.crypto ?? ''] || ''}${orderData.payment_tx_hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0 p-1 text-teal-dark hover:text-ink transition-colors"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  </div>
                )}

                {/* Shipping Address */}
                {orderData.shipping_address && (
                  <div className="mb-4 sm:mb-6">
                    <div className="flex items-center gap-1.5 sm:gap-2 mb-1 sm:mb-2">
                      <MapPin className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-ink-muted" />
                      <span className="text-[10px] sm:text-sm font-medium text-ink-muted">Shipping Address</span>
                    </div>
                    <div className="text-[10px] sm:text-sm text-ink bg-surface p-2 sm:p-3 rounded-lg border border-line">
                      <p>{orderData.shipping_address.firstName} {orderData.shipping_address.lastName}</p>
                      <p>{orderData.shipping_address.address}</p>
                      <p>{orderData.shipping_address.city}, {orderData.shipping_address.state} {orderData.shipping_address.postalCode}</p>
                      <p>{orderData.shipping_address.country}</p>
                    </div>
                  </div>
                )}

                {/* Order Items */}
                <div className="border-t border-line pt-4 sm:pt-6">
                  <h3 className="font-semibold text-ink mb-3 sm:mb-4 text-sm sm:text-base">Items</h3>
                  <div className="space-y-2 sm:space-y-3">
                    {(orderData.items ?? []).map((item, idx) => (
                      <div key={idx} className="flex justify-between items-center p-2 sm:p-3 bg-surface rounded-lg">
                        <div>
                          <p className="font-medium text-ink text-xs sm:text-sm">{item.name}</p>
                          {item.strength && <p className="text-[10px] sm:text-xs text-ink-muted">{item.strength}</p>}
                          <p className="text-[10px] sm:text-sm text-ink-muted">Qty: {item.quantity}</p>
                        </div>
                        <span className="font-semibold text-ink text-xs sm:text-sm tabular-nums">
                          ${(item.price * item.quantity).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Help Section */}
            <div className="bg-white rounded-xl border border-line p-4 sm:p-6">
              <h3 className="font-semibold text-ink mb-2 sm:mb-3 text-sm sm:text-base">Need Help?</h3>
              <p className="text-[10px] sm:text-sm text-ink-muted mb-3 sm:mb-4">
                If you have questions about your order, please contact our support team with your
                order number: <code className="font-mono bg-surface px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-xs">{orderData.order_number}</code>
              </p>
              <a
                href="mailto:support@vytabio.com"
                className="text-teal-dark hover:text-ink font-medium text-xs sm:text-sm"
              >
                Contact Support &rarr;
              </a>
            </div>
          </div>
        )}

        {/* Back Link */}
        <div className="mt-6 sm:mt-8 text-center">
          <Link href="/products" className="text-ink-muted hover:text-teal-dark transition-colors text-xs sm:text-sm">
            &larr; Continue Shopping
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function OrderTrackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-white">
          <div className="text-ink text-sm sm:text-xl">Loading...</div>
        </div>
      }
    >
      <OrderTrackContent />
    </Suspense>
  );
}
