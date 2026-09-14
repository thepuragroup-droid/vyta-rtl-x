'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Package, Clock, CheckCircle, Truck, XCircle, ChevronRight, User, MapPin, LogOut, Beaker, KeyRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import ChangePasswordForm from '@/components/ChangePasswordForm';
import { useCustomer } from '@/contexts/CustomerContext';
import { getCustomerOrders, updateCustomer } from '@/lib/customer/api';
import PeptideLoader from '@/components/PeptideLoader';
import type { Order } from '@/lib/supabase';

// Real order lifecycle: pending -> received -> confirmed -> processing -> shipped -> delivered
// (plus cancelled). Unknown statuses fall back to a neutral badge so they never render blank.
const statusIcons: Record<string, React.ReactNode> = {
  pending: <Clock className="w-3 sm:w-3.5 h-3 sm:h-3.5" />,
  received: <Clock className="w-3 sm:w-3.5 h-3 sm:h-3.5" />,
  confirmed: <CheckCircle className="w-3 sm:w-3.5 h-3 sm:h-3.5" />,
  processing: <Package className="w-3 sm:w-3.5 h-3 sm:h-3.5" />,
  shipped: <Truck className="w-3 sm:w-3.5 h-3 sm:h-3.5" />,
  delivered: <CheckCircle className="w-3 sm:w-3.5 h-3 sm:h-3.5" />,
  expired: <XCircle className="w-3 sm:w-3.5 h-3 sm:h-3.5" />,
  cancelled: <XCircle className="w-3 sm:w-3.5 h-3 sm:h-3.5" />,
};

const statusColors: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-100',
  received: 'bg-cyan-50 text-cyan-700 border-cyan-100',
  confirmed: 'bg-blue-50 text-blue-700 border-blue-100',
  processing: 'bg-purple-50 text-purple-700 border-purple-100',
  shipped: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  delivered: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  expired: 'bg-red-50 text-red-700 border-red-100',
  cancelled: 'bg-red-50 text-red-700 border-red-100',
};

const FALLBACK_STATUS_COLOR = 'bg-slate-50 text-slate-600 border-slate-200';
const FALLBACK_STATUS_ICON = <Package className="w-3 sm:w-3.5 h-3 sm:h-3.5" />;

const getStatusColor = (status: string) => statusColors[status] ?? FALLBACK_STATUS_COLOR;
const getStatusIcon = (status: string) => statusIcons[status] ?? FALLBACK_STATUS_ICON;

export default function AccountDashboard() {
  const router = useRouter();
  const { customer, logout, isLoading, refreshCustomer } = useCustomer();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileData, setProfileData] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    shipping_address: '',
    shipping_city: '',
    shipping_state: '',
    shipping_postal_code: '',
    shipping_country: '',
  });
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (isLoading) return;

    if (!customer) {
      router.push('/login?redirect=/account/dashboard');
      return;
    }

    async function loadOrders() {
      const orderData = await getCustomerOrders(customer.id);
      setOrders(orderData);
      setLoading(false);
    }

    loadOrders();

    setProfileData({
      first_name: customer.first_name || '',
      last_name: customer.last_name || '',
      phone: customer.phone || '',
      shipping_address: customer.shipping_address || '',
      shipping_city: customer.shipping_city || '',
      shipping_state: customer.shipping_state || '',
      shipping_postal_code: customer.shipping_postal_code || '',
      shipping_country: customer.shipping_country || 'CA',
    });
  }, [customer, router, isLoading]);

  const handleLogout = async () => {
    setLoggingOut(true);
    await logout();
    setTimeout(() => router.replace('/'), 1200);
  };

  const handleSaveProfile = async () => {
    if (!customer) return;
    setSaving(true);

    const result = await updateCustomer(customer.id, profileData);

    if (result.success) {
      await refreshCustomer();
      setEditingProfile(false);
    }

    setSaving(false);
  };

  if (loggingOut) {
    return <PeptideLoader message="Signing you out..." type="logout" />;
  }

  if (isLoading || !customer) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <div className="animate-pulse text-slate-500 text-sm">Loading...</div>
      </main>
    );
  }

  return (
    <>
      <main className="min-h-screen bg-white">
        <Navigation showTicker={false} />

        <div className="pt-28 sm:pt-32 md:pt-44 pb-16 sm:pb-20 md:pb-28">
          <div className="max-w-6xl mx-auto px-4 sm:px-8 lg:px-12">
            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 sm:mb-8 md:mb-10"
            >
              <span className="text-[10px] sm:text-xs font-semibold text-cyan-600 uppercase tracking-[0.2em] mb-2 sm:mb-3 block">
                My Account
              </span>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-900 mb-1 sm:mb-2">
                Welcome back, {customer.first_name}!
              </h1>
              <p className="text-slate-500 text-xs sm:text-sm md:text-base">Manage your orders and account settings</p>
            </motion.div>

            <div className="grid lg:grid-cols-3 gap-4 sm:gap-6 md:gap-8">
              {/* Orders Section */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="lg:col-span-2"
              >
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="p-4 sm:p-5 md:p-6 border-b border-slate-100">
                    <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                      <Package className="w-4 sm:w-5 h-4 sm:h-5 text-cyan-600" />
                      Your Orders
                    </h2>
                  </div>

                  {loading ? (
                    <div className="p-6 sm:p-8 text-center">
                      <div className="animate-pulse text-slate-500 text-xs sm:text-sm">Loading orders...</div>
                    </div>
                  ) : orders.length === 0 ? (
                    <div className="p-6 sm:p-8 md:p-12 text-center">
                      <div className="w-12 sm:w-14 h-12 sm:h-14 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-3 sm:mb-4">
                        <Beaker className="w-6 sm:w-7 h-6 sm:h-7 text-slate-400" />
                      </div>
                      <p className="text-slate-500 mb-3 sm:mb-4 text-xs sm:text-sm">You haven&apos;t placed any orders yet</p>
                      <Link
                        href="/products"
                        className="inline-flex items-center gap-1 text-cyan-600 hover:text-cyan-700 font-semibold text-xs sm:text-sm"
                      >
                        Browse Products
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {orders.map((order, index) => (
                        <motion.div
                          key={order.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.05 }}
                          className="p-3 sm:p-4 md:p-5 hover:bg-slate-50/50 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-3 sm:gap-4">
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-900 text-xs sm:text-sm">
                                Order #{order.order_number}
                              </p>
                              <p className="text-[10px] sm:text-xs text-slate-500 mt-0.5">
                                {new Date(order.created_at).toLocaleDateString('en-US', {
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric',
                                })}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 sm:gap-3 md:gap-4">
                              <span
                                className={`hidden sm:inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-lg text-[10px] sm:text-xs font-medium border ${getStatusColor(order.status)}`}
                              >
                                {getStatusIcon(order.status)}
                                <span className="capitalize">{order.status}</span>
                              </span>
                              <span className="font-bold text-slate-900 text-xs sm:text-sm tabular-nums">
                                ${Number(order.total).toFixed(2)}
                              </span>
                              <Link
                                href={`/account/orders/${order.id}`}
                                className="w-7 sm:w-8 h-7 sm:h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                              >
                                <ChevronRight className="w-4 sm:w-5 h-4 sm:h-5" />
                              </Link>
                            </div>
                          </div>
                          {/* Mobile status badge */}
                          <div className="sm:hidden mt-2">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium border ${getStatusColor(order.status)}`}
                            >
                              {getStatusIcon(order.status)}
                              <span className="capitalize">{order.status}</span>
                            </span>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>

              {/* Profile Section */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="space-y-4 sm:space-y-5"
              >
                {/* Account Info */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 md:p-6">
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2 mb-3 sm:mb-4">
                    <User className="w-4 h-4 text-cyan-600" />
                    Account Info
                  </h3>

                  {editingProfile ? (
                    <div className="space-y-2 sm:space-y-3">
                      <div className="grid grid-cols-2 gap-2 sm:gap-3">
                        <input
                          type="text"
                          value={profileData.first_name}
                          onChange={(e) =>
                            setProfileData({ ...profileData, first_name: e.target.value })
                          }
                          className="px-3 py-2 sm:py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                          placeholder="First Name"
                        />
                        <input
                          type="text"
                          value={profileData.last_name}
                          onChange={(e) =>
                            setProfileData({ ...profileData, last_name: e.target.value })
                          }
                          className="px-3 py-2 sm:py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                          placeholder="Last Name"
                        />
                      </div>
                      <input
                        type="tel"
                        value={profileData.phone}
                        onChange={(e) => setProfileData({ ...profileData, phone: e.target.value })}
                        className="w-full px-3 py-2 sm:py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                        placeholder="Phone Number"
                      />
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={handleSaveProfile}
                          disabled={saving}
                          className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-500 text-white py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-semibold hover:from-cyan-600 hover:to-blue-600 disabled:opacity-50 transition-all shadow-lg shadow-cyan-500/25"
                        >
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => setEditingProfile(false)}
                          className="flex-1 bg-slate-100 text-slate-700 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-semibold hover:bg-slate-200 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1 sm:space-y-2">
                      <p className="text-slate-900 font-medium text-xs sm:text-sm">
                        {customer.first_name} {customer.last_name}
                      </p>
                      <p className="text-slate-500 text-xs sm:text-sm">{customer.email}</p>
                      {customer.phone && (
                        <p className="text-slate-500 text-xs sm:text-sm">{customer.phone}</p>
                      )}
                      <button
                        onClick={() => setEditingProfile(true)}
                        className="text-cyan-600 hover:text-cyan-700 text-xs sm:text-sm font-medium pt-1"
                      >
                        Edit Profile
                      </button>
                    </div>
                  )}
                </div>

                {/* Shipping Address */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 md:p-6">
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2 mb-3 sm:mb-4">
                    <MapPin className="w-4 h-4 text-cyan-600" />
                    Shipping Address
                  </h3>

                  {editingProfile ? (
                    <div className="space-y-2 sm:space-y-3">
                      <input
                        type="text"
                        value={profileData.shipping_address}
                        onChange={(e) =>
                          setProfileData({ ...profileData, shipping_address: e.target.value })
                        }
                        className="w-full px-3 py-2 sm:py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                        placeholder="Street Address"
                      />
                      <div className="grid grid-cols-2 gap-2 sm:gap-3">
                        <input
                          type="text"
                          value={profileData.shipping_city}
                          onChange={(e) =>
                            setProfileData({ ...profileData, shipping_city: e.target.value })
                          }
                          className="px-3 py-2 sm:py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                          placeholder="City"
                        />
                        <input
                          type="text"
                          value={profileData.shipping_state}
                          onChange={(e) =>
                            setProfileData({ ...profileData, shipping_state: e.target.value })
                          }
                          className="px-3 py-2 sm:py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                          placeholder="Province"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:gap-3">
                        <input
                          type="text"
                          value={profileData.shipping_postal_code}
                          onChange={(e) =>
                            setProfileData({ ...profileData, shipping_postal_code: e.target.value })
                          }
                          className="px-3 py-2 sm:py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                          placeholder="Postal Code"
                        />
                        <input
                          type="text"
                          value={profileData.shipping_country}
                          onChange={(e) =>
                            setProfileData({ ...profileData, shipping_country: e.target.value })
                          }
                          className="px-3 py-2 sm:py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                          placeholder="Country"
                        />
                      </div>
                    </div>
                  ) : customer.shipping_address ? (
                    <div className="text-slate-500 text-xs sm:text-sm space-y-0.5">
                      <p>{customer.shipping_address}</p>
                      <p>
                        {customer.shipping_city}, {customer.shipping_state}{' '}
                        {customer.shipping_postal_code}
                      </p>
                      <p>{customer.shipping_country}</p>
                    </div>
                  ) : (
                    <p className="text-slate-400 text-xs sm:text-sm">No address saved</p>
                  )}
                </div>

                {/* Password & Security */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 md:p-6">
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2 mb-3 sm:mb-4">
                    <KeyRound className="w-4 h-4 text-cyan-600" />
                    Password
                  </h3>
                  <ChangePasswordForm variant="customer" />
                </div>

                {/* Logout Button */}
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-2 bg-white rounded-xl border border-slate-200 py-2.5 sm:py-3 text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors text-xs sm:text-sm font-semibold"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </button>
              </motion.div>
            </div>
          </div>
        </div>

        <Footer />
      </main>
    </>
  );
}
