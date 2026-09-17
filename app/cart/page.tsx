'use client';

import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { ShoppingCart, Trash2, Plus, Minus, ArrowLeft, ArrowRight, ShoppingBag, Lock, Beaker, BadgePercent } from 'lucide-react';
import Link from 'next/link';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import { useCart } from '@/contexts/CartContext';
import { siteConfig } from '@/lib/config';
import { useRouter } from 'next/navigation';
import FreeShippingProgress from '@/components/FreeShippingProgress';
import { usePromos } from '@/contexts/PromosContext';

export default function CartPage() {
  const router = useRouter();
  const { items, removeItem, updateQuantity, totalPrice, clearCart } = useCart();

  // The promos running on this cart. Resolved once for the whole app by
  // PromosProvider: `freeShipping.active` already accounts for the hosted
  // checkout being the live one and for courier rates being on, and
  // `adDiscountOn` returns zero unless this visitor has actually earned the
  // paid-ads discount — came from an ad, signed in, and has not ordered before.
  // Both are settled again server-side at hand-off.
  const { freeShipping, adDiscount, adDiscountEligible, adDiscountOn } = usePromos();
  const discount = adDiscountOn(totalPrice);
  const estimatedTotal = Math.max(0, totalPrice - discount);

  // Redirect out when e-commerce is disabled — in an effect, not during render.
  useEffect(() => {
    if (!siteConfig.ecommerceEnabled) router.replace('/products');
  }, [router]);

  if (!siteConfig.ecommerceEnabled) return null;

  return (
    <main className="min-h-screen bg-white">
      <Navigation />

      <div className="pt-32 sm:pt-36 md:pt-44 pb-16 sm:pb-20 md:pb-28">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 lg:px-12">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 sm:mb-8"
          >
            <Link
              href="/products"
              className="inline-flex items-center gap-2 text-ink-muted hover:text-ink transition-colors mb-4 sm:mb-6 text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Continue Shopping</span>
            </Link>

            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-ink tracking-tight">
              Your Cart
            </h1>
          </motion.div>

          {items.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center py-12 sm:py-16 md:py-20"
            >
              <div className="w-16 sm:w-20 h-16 sm:h-20 bg-surface rounded-2xl flex items-center justify-center mx-auto mb-5 sm:mb-6 border border-line">
                <ShoppingBag className="w-8 sm:w-10 h-8 sm:h-10 text-ink-muted" />
              </div>
              <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-ink mb-2 sm:mb-3">Your cart is empty</h2>
              <p className="text-ink-muted mb-6 sm:mb-8 text-sm">
                Looks like you haven&apos;t added any products yet.
              </p>
              <Link
                href="/products"
                className="inline-flex items-center gap-2 bg-ink hover:bg-ink/90 text-white font-semibold px-5 sm:px-6 py-3 rounded-xl transition-all text-sm"
              >
                <ShoppingCart className="w-4 h-4" />
                <span>Browse Products</span>
              </Link>
            </motion.div>
          ) : (
            <div className="grid lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
              {/* Cart Items */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="lg:col-span-2"
              >
                <div className="bg-white rounded-xl border border-line overflow-hidden">
                  <div className="p-3 sm:p-4 md:p-5 border-b border-line">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm sm:text-base md:text-lg font-semibold text-ink">
                        Cart Items ({items.length})
                      </h2>
                      <button
                        onClick={clearCart}
                        className="text-red-500 hover:text-red-600 text-xs sm:text-sm font-medium transition-colors"
                      >
                        Clear All
                      </button>
                    </div>
                  </div>

                  <div className="divide-y divide-line">
                    {items.map((item, index) => (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className="p-3 sm:p-4 md:p-5"
                      >
                        <div className="flex items-start gap-3 sm:gap-4">
                          {/* Product Image */}
                          <div className="bg-surface w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0 border border-line">
                            {item.image_url ? (
                              <img
                                src={item.image_url}
                                alt={item.name}
                                className="w-full h-full object-contain rounded-lg sm:rounded-xl p-1"
                              />
                            ) : (
                              <Beaker className="w-6 sm:w-8 h-6 sm:h-8 text-line" />
                            )}
                          </div>

                          {/* Product Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <h3 className="font-semibold text-ink text-xs sm:text-sm md:text-base line-clamp-1">{item.name}</h3>
                                <p className="text-[10px] sm:text-xs text-ink-muted mt-0.5">
                                  {item.strength}
                                  <span className="ml-1.5 inline-flex items-center rounded-full bg-surface border border-line px-1.5 py-0.5 text-[9px] sm:text-[10px] font-medium text-ink-muted">
                                    {item.packSize > 1 ? `Pack of ${item.packSize}` : 'Single vial'}
                                  </span>
                                </p>
                              </div>
                              {/* Remove Button - Mobile */}
                              <button
                                onClick={() => removeItem(item.id)}
                                aria-label={`Remove ${item.name} from cart`}
                                className="text-ink-muted hover:text-red-500 transition-colors p-1 md:hidden"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>

                            {/* Mobile: Price and Controls inline */}
                            <div className="flex items-center justify-between mt-2 sm:mt-3">
                              <p className="text-ink font-bold text-xs sm:text-sm tabular-nums">
                                ${item.price.toFixed(2)}
                              </p>

                              {/* Quantity Controls */}
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => updateQuantity(item.id, item.quantity - 1)}
                                  aria-label={`Decrease quantity of ${item.name}`}
                                  className="w-7 sm:w-8 h-7 sm:h-8 rounded-lg bg-surface hover:bg-white border border-line flex items-center justify-center transition-colors"
                                >
                                  <Minus className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-ink" />
                                </button>
                                <span className="w-6 sm:w-8 text-center font-semibold text-xs sm:text-sm tabular-nums">{item.quantity}</span>
                                <button
                                  onClick={() => updateQuantity(item.id, item.quantity + 1)}
                                  disabled={item.quantity >= item.stock_quantity}
                                  aria-label={`Increase quantity of ${item.name}`}
                                  className="w-7 sm:w-8 h-7 sm:h-8 rounded-lg bg-surface hover:bg-white border border-line flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  <Plus className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-ink" />
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Item Total & Remove - Desktop */}
                          <div className="hidden md:flex items-center gap-4">
                            <div className="text-right min-w-[80px]">
                              <p className="font-bold text-ink tabular-nums">
                                ${(item.price * item.quantity).toFixed(2)}
                              </p>
                            </div>
                            <button
                              onClick={() => removeItem(item.id)}
                              aria-label={`Remove ${item.name} from cart`}
                              className="text-ink-muted hover:text-red-500 transition-colors p-2"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>

              </motion.div>

              {/* Order Summary */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="lg:col-span-1"
              >
                <div className="bg-white rounded-xl border border-line p-4 sm:p-5 lg:sticky lg:top-36">
                  <h2 className="text-sm sm:text-base md:text-lg font-semibold text-ink mb-4 sm:mb-5">Order Summary</h2>

                  <FreeShippingProgress
                    subtotal={totalPrice}
                    threshold={freeShipping.threshold}
                    active={freeShipping.active}
                    className="mb-4 sm:mb-5"
                  />

                  <div className="space-y-2 sm:space-y-3 mb-4 sm:mb-5">
                    <div className="flex justify-between text-ink-muted text-xs sm:text-sm">
                      <span>Subtotal</span>
                      <span className="font-medium text-ink tabular-nums">${totalPrice.toFixed(2)}</span>
                    </div>
                    {adDiscountEligible && discount > 0 && (
                      <div className="flex justify-between text-xs sm:text-sm">
                        <span className="inline-flex items-center gap-1.5 text-emerald-700">
                          <BadgePercent className="w-3.5 h-3.5" />
                          {adDiscount.percent}% first-order discount
                        </span>
                        <span className="font-semibold text-emerald-700 tabular-nums">
                          -${discount.toFixed(2)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-ink-muted text-xs sm:text-sm">
                      <span>Shipping</span>
                      <span className="font-medium text-ink">Calculated at checkout</span>
                    </div>
                    <div className="border-t border-line pt-2 sm:pt-3">
                      <div className="flex justify-between">
                        <span className="text-sm sm:text-base font-semibold text-ink">Estimated total</span>
                        <span className="text-lg sm:text-xl font-bold text-ink tabular-nums">
                          ${estimatedTotal.toFixed(2)}
                        </span>
                      </div>
                      <p className="text-[10px] sm:text-xs text-ink-muted mt-1.5">
                        Plus shipping, calculated at checkout once your address is entered.
                      </p>
                    </div>
                  </div>

                  <Link
                    href="/checkout"
                    className="group w-full bg-ink hover:bg-ink/90 text-white font-semibold py-3 sm:py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 text-sm"
                  >
                    <span>Proceed to Checkout</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                  </Link>

                  <p className="text-[10px] sm:text-xs text-ink-muted text-center mt-3 sm:mt-4 flex items-center justify-center gap-1.5">
                    <Lock className="w-3 h-3" />
                    Secure checkout
                  </p>

                  {/* Trust Badges */}
                  <div className="flex justify-center gap-4 sm:gap-6 mt-4 sm:mt-5 pt-4 sm:pt-5 border-t border-line">
                    <div className="text-center">
                      <div className="text-lg sm:text-xl mb-1">🔒</div>
                      <span className="text-[9px] sm:text-[10px] text-ink-muted">Secure</span>
                    </div>
                    <div className="text-center">
                      <div className="text-lg sm:text-xl mb-1">💸</div>
                      <span className="text-[9px] sm:text-[10px] text-ink-muted">e-Transfer</span>
                    </div>
                    <div className="text-center">
                      <div className="text-lg sm:text-xl mb-1">🇨🇦</div>
                      <span className="text-[9px] sm:text-[10px] text-ink-muted">Canada</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </div>
      </div>

      <Footer />
    </main>
  );
}
