'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCustomer } from '@/contexts/CustomerContext';
import { Package, Clock, ChevronRight, Beaker, Loader2, ArrowLeft } from 'lucide-react';
import { getCustomerOrders } from '@/lib/customer/api';
import type { Order } from '@/lib/supabase';

export default function OrderHistoryPage() {
  const router = useRouter();
  const { customer, isLoading: customerLoading } = useCustomer();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (customerLoading) return;
    if (!customer) {
      router.push('/login?redirect=/account/orders');
      return;
    }

    const fetchOrders = async () => {
      try {
        const data = await getCustomerOrders(customer.id);
        setOrders(data);
      } catch (err: any) {
        setError(err?.message || 'Failed to load orders');
      } finally {
        setLoading(false);
      }
    };

    fetchOrders();
  }, [customer, customerLoading, router]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'text-yellow-700 bg-yellow-100';
      case 'received': return 'text-cyan-700 bg-cyan-100';
      case 'confirmed': return 'text-blue-700 bg-blue-100';
      case 'processing': return 'text-blue-700 bg-blue-100';
      case 'shipped': return 'text-purple-700 bg-purple-100';
      case 'delivered': return 'text-emerald-700 bg-emerald-100';
      case 'expired': return 'text-red-700 bg-red-100';
      case 'cancelled': return 'text-red-700 bg-red-100';
      default: return 'text-ink-muted bg-surface';
    }
  };

  if (customerLoading || (loading && customer)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="w-6 h-6 text-bronze animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white py-8 sm:py-12 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/account/dashboard" className="p-2 rounded-lg hover:bg-surface transition-colors">
            <ArrowLeft className="w-5 h-5 text-ink" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-ink">Order History</h1>
            <p className="text-sm text-ink-muted">View all your past orders</p>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        {orders.length === 0 && !loading ? (
          <div className="bg-surface rounded-2xl p-10 text-center border border-line">
            <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 border border-line">
              <Package className="w-8 h-8 text-ink-muted" />
            </div>
            <h2 className="text-lg font-semibold text-ink mb-2">No orders yet</h2>
            <p className="text-ink-muted text-sm mb-6">Your order history will appear here after your first purchase.</p>
            <Link
              href="/products"
              className="inline-flex items-center gap-2 bg-ink hover:bg-ink/90 text-white px-6 py-3 rounded-xl font-semibold transition-all text-sm"
            >
              Browse Products
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <Link
                key={order.id}
                href={`/account/orders/${order.id}`}
                className="block bg-white rounded-xl border border-line p-4 sm:p-5 hover:shadow-md transition-all group"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-surface rounded-xl flex items-center justify-center border border-line">
                      <Package className="w-5 h-5 text-ink-muted" />
                    </div>
                    <div>
                      <p className="font-semibold text-ink text-sm">{order.order_number}</p>
                      <div className="flex items-center gap-1.5 text-xs text-ink-muted">
                        <Clock className="w-3 h-3" />
                        <span>{new Date(order.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                      {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                    </span>
                    <ChevronRight className="w-4 h-4 text-ink-muted group-hover:text-bronze transition-colors" />
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink-muted">
                    {(order as any).source === 'stealth_health'
                      ? 'Secure checkout'
                      : order.crypto
                        ? order.crypto.toUpperCase()
                        : 'e-Transfer'}
                    {order.tracking_number && <span className="ml-2">| Tracking: {order.tracking_number}</span>}
                  </span>
                  <span className="font-semibold text-ink tabular-nums">
                    ${Number(order.total).toFixed(2)} {(order as any).currency ?? 'CAD'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
