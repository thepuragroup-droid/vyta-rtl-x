'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { ShoppingCart, ArrowLeft, Check, Package, Shield, Truck, Award, Beaker, BadgeCheck, FlaskConical, FileText, X, ChevronRight, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import LabResultsButton from '@/components/LabResultsButton';
import { supabase } from '@/lib/supabase';
import { useCart } from '@/contexts/CartContext';
import { useToast } from '@/contexts/ToastContext';
import { siteConfig } from '@/lib/config';
import {
  packOptionsFor, packsInStock, round2, vialPriceFor, vialsPerBoxOf,
  type ResolvedPackOption,
} from '@/lib/pricing';
import { trackActivity } from '@/lib/customer/activity';
import { trackViewItem } from '@/lib/analytics/ecommerce';
import { productPath } from '@/lib/products/url';

interface Product {
  id: string;
  name: string;
  slug: string;
  url_slug?: string | null;
  category: string;
  description: string;
  description_short: string | null;
  benefits: string | null;
  mechanism: string | null;
  price: number;
  vial_price: number | null;
  vials_per_box: number | null;
  /** Pack quantities this product is sold in. See lib/pricing.ts. */
  pack_sizes?: number[] | null;
  /** Per-pack label / price / compare-at, when an operator has set any. */
  pack_options?: unknown;
  strength: string;
  purity: string;
  form: string;
  stock_quantity: number;
  active: boolean;
  image_url: string | null;
  box_image_url: string | null;
  coa_url: string[] | null;
}

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const [product, setProduct] = useState<Product | null>(null);
  const [relatedProducts, setRelatedProducts] = useState<Product[]>([]);
  const [batWater, setBatWater] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  // Distinguishes a transient/network failure (retryable) from a genuinely
  // missing product (show "Product Not Found").
  const [fetchError, setFetchError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [showCoaModal, setShowCoaModal] = useState(false);
  const [activeCoa, setActiveCoa] = useState<string | null>(null);
  const { addItem, flyToCart } = useCart();
  const toast = useToast();
  const heroImageRef = useRef<HTMLDivElement>(null);
  /** The pack the customer is currently looking at. Null until the product
   *  loads and the first buyable pack is chosen for them. */
  const [packSize, setPackSize] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let cancelled = false;

    async function fetchProduct() {
      setLoading(true);
      setFetchError(false);
      try {
        // Resolve the public url_slug first, then fall back to the SKU slug so
        // links issued before url_slug existed keep working. maybeSingle() on
        // the first attempt: a miss here is expected for a legacy URL, not an
        // error.
        let { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('url_slug', slug)
          .abortSignal(controller.signal)
          .maybeSingle();

        if (!error && !data) {
          ({ data, error } = await supabase
            .from('products')
            .select('*')
            .eq('slug', slug)
            .abortSignal(controller.signal)
            .maybeSingle());
        }

        if (cancelled) return;

        if (error) {
          // maybeSingle() reports a missing row as `data: null` rather than an
          // error, so anything arriving here is transient (network, timeout /
          // abort, server) — the not-found case falls through to setProduct(null)
          // below. PGRST116 is still handled in case a caller reverts to
          // single().
          if (error.code === 'PGRST116') {
            setProduct(null);
          } else {
            console.error('Error fetching product:', error);
            setFetchError(true);
          }
          return;
        }

        // A legacy URL resolved — swap the address bar for the canonical one so
        // shares and bookmarks made from here carry the new URL. replace(), not
        // push(), so Back still leaves the page.
        if (data?.url_slug && data.url_slug !== slug) {
          router.replace(`/products/${data.url_slug}`, { scroll: false });
        }

        setProduct(data);

        if (data) {
          // Record the product view for signed-in customers (fire-and-forget).
          trackActivity({ type: 'view', productId: data.id, productName: data.name });
          // GA4 `view_item`, priced per vial to match the headline price on the
          // page (the case price is a multiple of it).
          trackViewItem({
            item_id: data.id,
            item_name: data.name,
            item_variant: 'Vial',
            item_category: data.category,
            price: vialPriceFor(data),
            quantity: 1,
          });

          const [{ data: related }, { data: bw }] = await Promise.all([
            supabase
              .from('products')
              .select('*')
              .eq('category', data.category)
              .neq('id', data.id)
              .eq('active', true)
              .limit(4),
            supabase
              .from('products')
              .select('*')
              .eq('slug', 'bacteriostatic-water-30ml')
              .single(),
          ]);

          if (cancelled) return;
          setRelatedProducts(related || []);
          setBatWater(bw ?? null);
        }
      } catch (err) {
        // Aborted (timeout) or a network failure — treat as retryable.
        if (!cancelled) {
          console.error('Error fetching product:', err);
          setFetchError(true);
        }
      } finally {
        clearTimeout(timer);
        if (!cancelled) setLoading(false);
      }
    }

    fetchProduct();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [slug, reloadKey]);

  // The packs this product is sold in, each already carrying its label, price
  // and compare-at. Computed before the early returns below so the effect that
  // picks a default can depend on it.
  const packs: ResolvedPackOption[] = product ? packOptionsFor(product) : [];
  const capFor = (size: number) => packsInStock(product?.stock_quantity ?? 0, size);
  const selectedPack =
    packs.find((option) => option.size === packSize) ?? packs[0] ?? null;

  // Open on the first pack the customer could actually buy, so the page never
  // lands on a sold-out option. Re-runs when the product changes (a related
  // product navigates here without unmounting).
  useEffect(() => {
    if (packs.length === 0) return;
    const first = packs.find((option) => capFor(option.size) >= 1) ?? packs[0];
    setPackSize(first.size);
    setQty(1);
    setAdded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id]);

  const selectPack = (size: number) => {
    setPackSize(size);
    setQty(1); // each pack has its own stock ceiling
    setAdded(false);
  };

  /** Adds the chosen pack straight to the cart — no modal in between. */
  const handleAddToCart = () => {
    if (!product || !selectedPack) return;
    const cap = capFor(selectedPack.size);
    if (cap < 1) {
      toast.error(
        selectedPack.size > 1
          ? `Not enough stock for a ${selectedPack.label.toLowerCase()}.`
          : 'Out of stock.',
      );
      return;
    }

    let anyAdded = false;
    for (let i = 0; i < qty; i++) {
      const ok = addItem({
        productId: product.id,
        unit: selectedPack.size > 1 ? 'case' : 'vial',
        packSize: selectedPack.size,
        vialsPerBox: vialsPerBoxOf(product.vials_per_box),
        name: product.name,
        price: selectedPack.price,
        strength: product.strength ?? '',
        image_url: product.image_url || undefined,
        stock_quantity: cap,
      });
      anyAdded = anyAdded || ok;
    }

    if (!anyAdded) {
      toast.error(`Only ${cap} in stock — that's all we have.`);
      return;
    }
    flyToCart(heroImageRef.current, { image_url: product.image_url || undefined });
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-white">
        <Navigation />
        <div className="bg-white border-b border-line pt-28 pb-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12">
            <div className="h-6 bg-surface rounded w-32 animate-pulse" />
          </div>
        </div>
        <div className="py-8 sm:py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12">
            <div className="animate-pulse">
              <div className="grid md:grid-cols-2 gap-6 sm:gap-8 md:gap-12">
                <div className="h-64 sm:h-80 md:h-[500px] bg-surface rounded-2xl" />
                <div className="space-y-4">
                  <div className="h-8 sm:h-10 bg-surface rounded w-3/4" />
                  <div className="h-5 sm:h-6 bg-surface rounded w-1/4" />
                  <div className="h-20 sm:h-24 bg-surface rounded" />
                  <div className="h-10 sm:h-12 bg-surface rounded w-1/2" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (fetchError) {
    return (
      <main className="min-h-screen bg-white">
        <Navigation />
        <div className="bg-white border-b border-line pt-28 pb-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 text-center">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-ink mb-4">Something went wrong</h1>
            <p className="text-ink-muted mb-8 text-sm sm:text-base">
              We couldn&apos;t load this product. Please check your connection and try again.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={() => setReloadKey((k) => k + 1)}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink hover:bg-ink/90 text-white text-sm font-semibold rounded-lg transition-all"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Try Again</span>
              </button>
              <Link
                href="/products"
                className="inline-flex items-center gap-2 text-teal-dark hover:text-teal-dark font-medium"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to Products</span>
              </Link>
            </div>
          </div>
        </div>
        <Footer />
      </main>
    );
  }

  if (!product) {
    return (
      <main className="min-h-screen bg-white">
        <Navigation />
        <div className="bg-white border-b border-line pt-28 pb-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 text-center">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-ink mb-4">Product Not Found</h1>
            <p className="text-ink-muted mb-8 text-sm sm:text-base">The product you&apos;re looking for doesn&apos;t exist.</p>
            <Link
              href="/products"
              className="inline-flex items-center gap-2 text-teal-dark hover:text-teal-dark font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Products</span>
            </Link>
          </div>
        </div>
        <Footer />
      </main>
    );
  }

  // ---- Display pricing ----
  // The headline quotes the pack the customer has SELECTED, not a fixed unit:
  // the pack buttons below are the variant picker, so the big number has to
  // follow them. `packOptionsFor` resolves each pack's label, price and
  // compare-at (see lib/pricing.ts) — falling back, for a product nobody has
  // configured, to the historical single-vial + full-case pair at vial × size.
  const vialUnitPrice = vialPriceFor(product);
  const headlinePrice = selectedPack?.price ?? vialUnitPrice;
  const headlineCompareAt = selectedPack?.compareAt ?? null;
  const selectedCap = selectedPack ? capFor(selectedPack.size) : 0;
  const lineTotal = round2(headlinePrice * qty);

  return (
    <main className="min-h-screen bg-white">
      <Navigation />

      {/* Hero Header */}
      <section className="relative bg-white border-b border-line overflow-hidden">
        <div className="absolute inset-0 opacity-[0.02]">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="molecular-grid" x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
                <circle cx="30" cy="30" r="1.5" fill="#07203A" />
                <circle cx="0" cy="0" r="1" fill="#07203A" />
                <circle cx="60" cy="0" r="1" fill="#07203A" />
                <circle cx="0" cy="60" r="1" fill="#07203A" />
                <circle cx="60" cy="60" r="1" fill="#07203A" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#molecular-grid)" />
          </svg>
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 pt-28 pb-6 sm:pb-8">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Link
              href="/products"
              className="inline-flex items-center gap-2 text-ink-muted hover:text-ink transition-colors text-sm mb-3 sm:mb-4"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Products</span>
            </Link>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <span className="text-[10px] sm:text-xs font-medium text-ink bg-surface px-2 sm:px-3 py-1 rounded-full border border-line">
                {product.category}
              </span>
              <span className="text-[10px] sm:text-xs font-semibold text-teal-dark bg-teal-50 px-2 sm:px-3 py-1 rounded-full border border-teal/20">
                {product.purity} Purity
              </span>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Product Detail */}
      <section className="py-6 sm:py-10 md:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12">
          <div className="grid md:grid-cols-2 gap-6 sm:gap-8 md:gap-12 mb-10 sm:mb-16">
            {/* Product Image */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <div
                ref={heroImageRef}
                data-product-hero-image
                className="bg-surface rounded-xl sm:rounded-2xl overflow-hidden border border-line relative"
              >
                <div className="aspect-square flex items-center justify-center p-4 sm:p-8">
                  {product.image_url ? (
                    <img
                      src={product.image_url}
                      alt={product.name}
                      className={`h-full w-full object-contain ${product.stock_quantity === 0 ? 'opacity-40' : ''}`}
                    />
                  ) : (
                    <Beaker className="w-16 sm:w-24 h-16 sm:h-24 text-line" />
                  )}
                </div>
                {product.stock_quantity === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="bg-black/65 text-white text-xs sm:text-sm font-semibold px-4 py-1.5 rounded-full tracking-wide">
                      Out of Stock
                    </span>
                  </div>
                )}
              </div>
            </motion.div>

            {/* Product Info */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="flex flex-col"
            >
              <h1 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold text-ink mb-3 sm:mb-4 tracking-tight">
                {product.name}
              </h1>

              <p className="text-ink-muted mb-4 sm:mb-6 leading-relaxed text-sm sm:text-base">
                {product.description}
              </p>

              {/* Product Specs */}
              <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4 sm:mb-6">
                <div className="bg-surface rounded-lg sm:rounded-xl p-3 sm:p-4 text-center border border-line">
                  <div className="text-[9px] sm:text-[10px] text-ink-muted uppercase tracking-wider mb-1">Purity</div>
                  <div className="text-teal-dark font-bold text-sm sm:text-base">{product.purity}</div>
                </div>
                <div className="bg-surface rounded-lg sm:rounded-xl p-3 sm:p-4 text-center border border-line">
                  <div className="text-[9px] sm:text-[10px] text-ink-muted uppercase tracking-wider mb-1">Strength</div>
                  <div className="text-ink font-bold text-sm sm:text-base">{product.strength}</div>
                </div>
                <div className="bg-surface rounded-lg sm:rounded-xl p-3 sm:p-4 text-center border border-line">
                  <div className="text-[9px] sm:text-[10px] text-ink-muted uppercase tracking-wider mb-1">Form</div>
                  <div className="text-ink font-bold text-sm sm:text-base">{product.form}</div>
                </div>
              </div>

              {/* COA Button */}
              {product.coa_url && product.coa_url.length > 0 && (
                <button
                  onClick={() => { setActiveCoa(product.coa_url![0]); setShowCoaModal(true); }}
                  className="w-full mb-4 sm:mb-6 flex items-center justify-between gap-3 px-4 sm:px-5 py-3 sm:py-4 rounded-xl bg-teal-dark text-white font-semibold hover:bg-teal/90 active:scale-[0.98] transition-all shadow-md shadow-teal/30 group"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0 bg-white/20 rounded-lg p-1.5">
                      <FileText className="w-4 h-4 sm:w-5 sm:h-5" />
                    </div>
                    <div className="text-left">
                      <div className="text-xs sm:text-sm font-bold uppercase tracking-wide leading-tight">Certificate of Analysis</div>
                      <div className="text-[10px] sm:text-xs text-white/75 font-normal">Third-party lab verified · PPB Analytical</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold bg-white/20 rounded-lg px-2.5 py-1 group-hover:bg-white/30 transition-colors">
                    View{product.coa_url.length > 1 ? ` (${product.coa_url.length})` : ''}
                    <ChevronRight className="w-3.5 h-3.5" />
                  </div>
                </button>
              )}

              {/* Benefits */}
              {product.benefits && (
                <div className="mb-4 sm:mb-6">
                  <h3 className="font-semibold text-ink mb-2 sm:mb-3 text-sm">Benefits</h3>
                  <ul className="space-y-1.5 sm:space-y-2">
                    {product.benefits.split(',').map((benefit, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <Check className="w-4 h-4 text-teal-dark flex-shrink-0 mt-0.5" />
                        <span className="text-ink-muted text-xs sm:text-sm">{benefit.trim()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Pack picker, price and Add to Cart.
                  The packs are the variants: they are laid out on the page
                  itself so a customer can compare a 1, a 3 and a 10 — and see
                  what each saves — without opening anything. Picking one
                  updates the headline price and what the button adds. */}
              <div className="mt-auto pt-4 sm:pt-6 border-t border-line">
                {product.price === 0 ? (
                  <div className="mb-4 text-2xl sm:text-3xl md:text-4xl font-bold text-ink-muted">
                    N/A
                  </div>
                ) : (
                  <>
                    {packs.length > 1 && (
                      <div className="mb-4 sm:mb-5">
                        <div className="mb-2 flex items-baseline justify-between gap-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                            Choose your pack
                          </p>
                          <span className="text-[11px] text-ink-muted tabular-nums">
                            ${vialUnitPrice.toFixed(2)} / vial at list price
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {packs.map((option) => {
                            const cap = capFor(option.size);
                            const soldOut = cap < 1;
                            const active = selectedPack?.size === option.size;
                            return (
                              <button
                                key={option.size}
                                type="button"
                                onClick={() => selectPack(option.size)}
                                disabled={soldOut}
                                aria-pressed={active}
                                className={`relative rounded-xl border p-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                                  active
                                    ? 'border-ink bg-ink text-white shadow-sm'
                                    : 'border-line bg-surface text-ink hover:border-ink/40 hover:bg-white'
                                }`}
                              >
                                {active && (
                                  <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-white">
                                    <Check className="h-3 w-3 text-ink" />
                                  </span>
                                )}
                                <span className="block pr-5 text-sm font-semibold">
                                  {option.label}
                                </span>
                                {soldOut ? (
                                  <span
                                    className={`block text-[11px] ${active ? 'text-white/70' : 'text-ink-muted'}`}
                                  >
                                    Not enough stock
                                  </span>
                                ) : (
                                  <>
                                    <span className="mt-0.5 block text-sm font-bold tabular-nums">
                                      ${option.price.toFixed(2)}
                                      {option.compareAt != null && (
                                        <span
                                          className={`ml-1.5 text-[11px] font-normal line-through ${
                                            active ? 'text-white/60' : 'text-ink-muted'
                                          }`}
                                        >
                                          ${option.compareAt.toFixed(2)}
                                        </span>
                                      )}
                                    </span>
                                    <span
                                      className={`block text-[11px] tabular-nums ${
                                        active ? 'text-white/70' : 'text-ink-muted'
                                      }`}
                                    >
                                      ${option.perVialPrice.toFixed(2)} / vial
                                    </span>
                                    {option.savings > 0 && (
                                      <span
                                        className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                          active
                                            ? 'bg-white/20 text-white'
                                            : 'bg-emerald-50 text-emerald-700'
                                        }`}
                                      >
                                        Save ${option.savings.toFixed(2)}
                                        {option.savingsPercent > 0 && ` (${option.savingsPercent}%)`}
                                      </span>
                                    )}
                                  </>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Headline — the selected pack's own price */}
                    <div className="mb-4 sm:mb-5">
                      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                        <span className="text-2xl sm:text-3xl md:text-4xl font-bold text-ink tabular-nums">
                          ${headlinePrice.toFixed(2)}
                        </span>
                        {headlineCompareAt != null && (
                          <span className="text-base sm:text-lg font-medium text-ink-muted line-through tabular-nums">
                            ${headlineCompareAt.toFixed(2)}
                          </span>
                        )}
                        <span className="text-sm sm:text-base font-medium text-ink-muted">
                          CAD{selectedPack ? ` · ${selectedPack.label.toLowerCase()}` : ''}
                        </span>
                      </div>
                      {selectedPack && (
                        <p className="mt-1 text-xs sm:text-sm text-ink-muted tabular-nums">
                          ${selectedPack.perVialPrice.toFixed(2)} per vial
                          {selectedPack.size > 1 && ` · ${selectedPack.size} vials`}
                          {selectedPack.savings > 0 &&
                            ` · you save $${selectedPack.savings.toFixed(2)}`}
                        </p>
                      )}
                    </div>

                    {/* Quantity — how many of the selected pack */}
                    {siteConfig.ecommerceEnabled && selectedCap >= 1 && (
                      <div className="mb-3 flex items-center gap-3">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                          Quantity
                        </span>
                        <div className="flex items-center overflow-hidden rounded-xl border border-line bg-surface">
                          <button
                            type="button"
                            onClick={() => setQty((q) => Math.max(1, q - 1))}
                            disabled={qty <= 1}
                            className="px-3.5 py-2 font-medium text-ink transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                            aria-label="Decrease quantity"
                          >
                            −
                          </button>
                          <span className="min-w-[2.5rem] text-center font-semibold tabular-nums">
                            {qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => setQty((q) => Math.min(selectedCap, q + 1))}
                            disabled={qty >= selectedCap}
                            className="px-3.5 py-2 font-medium text-ink transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                            aria-label="Increase quantity"
                          >
                            +
                          </button>
                        </div>
                        {qty > 1 && (
                          <span className="text-sm font-semibold text-ink tabular-nums">
                            ${lineTotal.toFixed(2)} total
                          </span>
                        )}
                      </div>
                    )}
                  </>
                )}

                <div className="flex items-stretch gap-3">
                  {siteConfig.ecommerceEnabled && (
                    product.stock_quantity === 0 ? (
                      <button
                        disabled
                        className="flex-1 font-semibold py-3 sm:py-4 rounded-xl bg-surface text-red-600 cursor-not-allowed flex items-center justify-center gap-2 text-sm border border-red-200"
                      >
                        <span>Out of Stock</span>
                      </button>
                    ) : product.price === 0 ? (
                      <button
                        disabled
                        className="flex-1 font-semibold py-3 sm:py-4 rounded-xl bg-surface text-ink-muted cursor-not-allowed flex items-center justify-center gap-2 text-sm border border-line"
                      >
                        <span>Currently Unavailable</span>
                      </button>
                    ) : (
                      <button
                        onClick={handleAddToCart}
                        disabled={selectedCap < 1}
                        className={`flex-1 font-semibold py-3 sm:py-4 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                          added ? 'bg-emerald-500 text-white' : 'bg-ink hover:bg-ink/90 text-white'
                        }`}
                      >
                        {added ? (
                          <>
                            <Check className="w-5 h-5" />
                            <span>Added to cart</span>
                          </>
                        ) : (
                          <>
                            <ShoppingCart className="w-5 h-5" />
                            <span>
                              Add to Cart
                              {selectedPack && packs.length > 1
                                ? ` · ${selectedPack.label}`
                                : ''}
                            </span>
                          </>
                        )}
                      </button>
                    )
                  )}

                  {product.coa_url && product.coa_url.length > 0 && (
                    <LabResultsButton
                      productName={product.name}
                      variant="detail"
                      className={siteConfig.ecommerceEnabled ? '' : 'flex-1'}
                    />
                  )}
                </div>

                {/* Trust Badges */}
                <div className="grid grid-cols-3 gap-3 sm:gap-4 mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-line">
                  <div className="flex flex-col items-center text-center">
                    <div className="w-8 sm:w-10 h-8 sm:h-10 bg-surface rounded-lg sm:rounded-xl flex items-center justify-center mb-1.5 sm:mb-2 border border-line">
                      <Shield className="w-4 sm:w-5 h-4 sm:h-5 text-teal-dark" />
                    </div>
                    <span className="text-[10px] sm:text-xs text-ink-muted">Lab Tested</span>
                  </div>
                  <div className="flex flex-col items-center text-center">
                    <div className="w-8 sm:w-10 h-8 sm:h-10 bg-surface rounded-lg sm:rounded-xl flex items-center justify-center mb-1.5 sm:mb-2 border border-line">
                      <Package className="w-4 sm:w-5 h-4 sm:h-5 text-teal-dark" />
                    </div>
                    <span className="text-[10px] sm:text-xs text-ink-muted">Secure Pack</span>
                  </div>
                  <div className="flex flex-col items-center text-center">
                    <div className="w-8 sm:w-10 h-8 sm:h-10 bg-surface rounded-lg sm:rounded-xl flex items-center justify-center mb-1.5 sm:mb-2 border border-line">
                      <Truck className="w-4 sm:w-5 h-4 sm:h-5 text-teal-dark" />
                    </div>
                    <span className="text-[10px] sm:text-xs text-ink-muted">Fast Ship</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Mechanism of Action */}
          {product.mechanism && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-surface rounded-xl sm:rounded-2xl p-4 sm:p-6 md:p-8 border border-line mb-8 sm:mb-10"
            >
              <div className="flex items-center gap-3 mb-3 sm:mb-4">
                <div className="w-9 sm:w-10 h-9 sm:h-10 bg-teal/10 rounded-lg sm:rounded-xl flex items-center justify-center">
                  <FlaskConical className="w-4 sm:w-5 h-4 sm:h-5 text-teal-dark" />
                </div>
                <h2 className="text-base sm:text-lg md:text-xl font-bold text-ink">Mechanism of Action</h2>
              </div>
              <p className="text-ink-muted leading-relaxed text-sm sm:text-base">{product.mechanism}</p>
            </motion.div>
          )}

          {/* Essential Add-on - Bacteriostatic Water */}
          {product.slug !== 'bacteriostatic-water-30ml' && batWater && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="mb-8 sm:mb-10"
            >
              <div className="bg-ink rounded-xl sm:rounded-2xl p-4 sm:p-6 text-white">
                <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
                  <div className="w-16 sm:w-20 h-16 sm:h-20 bg-white rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {batWater.image_url ? (
                      <img
                        src={batWater.image_url}
                        alt={batWater.name}
                        className="w-full h-full object-contain p-1.5 sm:p-2"
                      />
                    ) : (
                      <img
                        src="/images/products/Bacteriostatic Water 30ML.png"
                        alt={batWater.name}
                        className="w-full h-full object-contain p-1.5 sm:p-2"
                      />
                    )}
                  </div>
                  <div className="flex-1 text-center sm:text-left">
                    <div className="text-[10px] sm:text-xs font-medium text-teal-light mb-0.5 sm:mb-1">You&apos;ll also need</div>
                    <h3 className="text-base sm:text-lg font-bold mb-0.5 sm:mb-1">{batWater.name}</h3>
                    <p className="text-white/60 text-xs sm:text-sm">
                      Essential for reconstituting lyophilized peptides.
                    </p>
                  </div>
                  <div className="flex flex-col items-center gap-2 sm:gap-3 flex-shrink-0">
                    <div className="text-xl sm:text-2xl font-bold tabular-nums">${batWater.price.toFixed(2)}</div>
                    <Link
                      href={productPath(batWater)}
                      className="bg-white hover:bg-white/90 text-ink font-semibold px-4 sm:px-6 py-2 sm:py-2.5 rounded-lg transition-all text-xs sm:text-sm"
                    >
                      View Product
                    </Link>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Quality Certifications */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mb-10 sm:mb-16"
          >
            <div className="bg-ink rounded-xl sm:rounded-2xl p-4 sm:p-6 md:p-8">
              <h2 className="text-base sm:text-lg md:text-xl font-bold text-white mb-4 sm:mb-6 text-center">Quality Certifications</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
                <div className="flex flex-col items-center text-center p-3 sm:p-4 bg-white/5 rounded-lg sm:rounded-xl border border-white/10">
                  <div className="w-10 sm:w-12 h-10 sm:h-12 bg-teal/20 rounded-lg sm:rounded-xl flex items-center justify-center mb-2 sm:mb-3">
                    <Beaker className="w-5 sm:w-6 h-5 sm:h-6 text-teal-light" />
                  </div>
                  <h3 className="font-semibold text-white mb-0.5 sm:mb-1 text-xs sm:text-sm">99%+ Purity</h3>
                  <p className="text-[10px] sm:text-xs text-white/50">Third-party verified</p>
                </div>
                <div className="flex flex-col items-center text-center p-3 sm:p-4 bg-white/5 rounded-lg sm:rounded-xl border border-white/10">
                  <div className="w-10 sm:w-12 h-10 sm:h-12 bg-white/10 rounded-lg sm:rounded-xl flex items-center justify-center mb-2 sm:mb-3">
                    <Award className="w-5 sm:w-6 h-5 sm:h-6 text-white" />
                  </div>
                  <h3 className="font-semibold text-white mb-0.5 sm:mb-1 text-xs sm:text-sm">GMP Certified</h3>
                  <p className="text-[10px] sm:text-xs text-white/50">Good Manufacturing</p>
                </div>
                <div className="flex flex-col items-center text-center p-3 sm:p-4 bg-white/5 rounded-lg sm:rounded-xl border border-white/10">
                  <div className="w-10 sm:w-12 h-10 sm:h-12 bg-white/10 rounded-lg sm:rounded-xl flex items-center justify-center mb-2 sm:mb-3">
                    <BadgeCheck className="w-5 sm:w-6 h-5 sm:h-6 text-white" />
                  </div>
                  <h3 className="font-semibold text-white mb-0.5 sm:mb-1 text-xs sm:text-sm">ISO Compliant</h3>
                  <p className="text-[10px] sm:text-xs text-white/50">Intl standards</p>
                </div>
                <div className="flex flex-col items-center text-center p-3 sm:p-4 bg-white/5 rounded-lg sm:rounded-xl border border-white/10">
                  <div className="w-10 sm:w-12 h-10 sm:h-12 bg-white/10 rounded-lg sm:rounded-xl flex items-center justify-center mb-2 sm:mb-3">
                    <Shield className="w-5 sm:w-6 h-5 sm:h-6 text-white" />
                  </div>
                  <h3 className="font-semibold text-white mb-0.5 sm:mb-1 text-xs sm:text-sm">COA Available</h3>
                  <p className="text-[10px] sm:text-xs text-white/50">Certificate of Analysis</p>
                </div>
              </div>
              <div className="mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-white/10 text-center">
                <p className="text-xs sm:text-sm text-white/50">
                  <span className="font-medium text-white/70">For Research Purposes Only</span> - Not for human consumption.
                </p>
              </div>
            </div>
          </motion.div>

          {/* Related Products */}
          {relatedProducts.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
            >
              <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-ink mb-4 sm:mb-6">Related Products</h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 md:gap-5">
                {relatedProducts.map((relProduct) => (
                  <Link key={relProduct.id} href={productPath(relProduct)}>
                    <div className="group bg-white rounded-lg sm:rounded-xl overflow-hidden border border-line hover:shadow-lg hover:shadow-ink/5 hover:border-ink/20 transition-all">
                      <div className="relative bg-surface aspect-square flex items-center justify-center p-2 sm:p-4">
                        {relProduct.image_url ? (
                          <img
                            src={relProduct.image_url}
                            alt={relProduct.name}
                            className={`h-full w-full object-contain group-hover:scale-105 transition-transform duration-300 ${relProduct.stock_quantity === 0 ? 'opacity-50' : ''}`}
                          />
                        ) : (
                          <Beaker className="w-8 sm:w-12 h-8 sm:h-12 text-line" />
                        )}
                        {/* Out of stock badge — don't let shoppers click into a dead end blind */}
                        {relProduct.stock_quantity === 0 && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="bg-black/60 text-white text-[9px] sm:text-[10px] font-semibold px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-full tracking-wide">
                              Out of Stock
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="p-2.5 sm:p-4">
                        <p className="text-[9px] sm:text-[10px] text-ink-muted uppercase tracking-wider mb-0.5 sm:mb-1">{relProduct.strength}</p>
                        <h3 className="font-semibold text-ink group-hover:text-ink-muted transition-colors mb-1.5 sm:mb-2 line-clamp-1 text-xs sm:text-sm">
                          {relProduct.name}
                        </h3>
                        <div className="flex justify-between items-center gap-2">
                          {relProduct.price === 0 ? (
                            <span className="text-ink-muted font-bold text-sm">N/A</span>
                          ) : (
                            <span className="text-ink font-bold tabular-nums text-sm sm:text-base">
                              ${vialPriceFor(relProduct).toFixed(2)}{' '}
                              <span className="text-[9px] font-medium text-ink-muted">/ vial</span>
                            </span>
                          )}
                          {relProduct.stock_quantity === 0 && (
                            <span className="text-[10px] text-red-500 font-medium">Sold out</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </section>

      <Footer />

      {/* COA Modal */}
      {showCoaModal && product.coa_url && product.coa_url.length > 0 && activeCoa && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => setShowCoaModal(false)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-line flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-teal/10 rounded-lg flex items-center justify-center">
                  <FileText className="w-4 h-4 text-teal-dark" />
                </div>
                <div>
                  <p className="text-[10px] text-ink-muted uppercase tracking-wider font-medium">Certificate of Analysis</p>
                  <p className="text-sm font-semibold text-ink leading-tight">{product.name}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={activeCoa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-teal-dark hover:underline font-medium"
                >
                  Open in new tab
                </a>
                <button
                  onClick={() => setShowCoaModal(false)}
                  className="p-2 hover:bg-surface rounded-lg transition-colors text-ink-muted hover:text-ink"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Tab selector — only shown when multiple COAs */}
            {product.coa_url.length > 1 && (
              <div className="flex gap-1 px-5 pt-3 pb-0 flex-shrink-0 overflow-x-auto">
                {product.coa_url.map((url, idx) => (
                  <button
                    key={url}
                    onClick={() => setActiveCoa(url)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      activeCoa === url
                        ? 'bg-teal/10 text-teal-dark border border-teal/25'
                        : 'text-ink-muted hover:text-ink hover:bg-surface'
                    }`}
                  >
                    COA {idx + 1}
                  </button>
                ))}
              </div>
            )}

            {/* PDF Viewer */}
            <div className="flex-1 overflow-hidden rounded-b-2xl min-h-0 mt-3">
              {/* Desktop: inline PDF preview */}
              <iframe
                key={activeCoa}
                src={`${activeCoa}#toolbar=0&navpanes=0`}
                className="w-full h-full hidden sm:block"
                style={{ minHeight: '60vh' }}
                title={`Certificate of Analysis — ${product.name}`}
              />
              {/* Mobile: inline PDF iframes are unreliable on iOS/Android, so
                  offer a prominent button that always opens the PDF directly. */}
              <div className="sm:hidden flex flex-col items-center justify-center text-center gap-4 px-6 py-10">
                <div className="w-14 h-14 bg-teal/10 rounded-2xl flex items-center justify-center">
                  <FileText className="w-7 h-7 text-teal-dark" />
                </div>
                <p className="text-sm text-ink-muted leading-relaxed">
                  Third-party lab certificate for {product.name}.
                </p>
                <a
                  href={activeCoa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 w-full px-5 py-3.5 rounded-xl bg-teal-dark text-white font-semibold hover:bg-teal/90 active:scale-[0.98] transition-all shadow-md shadow-teal/30"
                >
                  <FileText className="w-4 h-4" />
                  Open Certificate of Analysis (PDF)
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
