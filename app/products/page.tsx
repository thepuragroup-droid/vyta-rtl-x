'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingCart, Filter, X, Search, Scale, Heart, Sparkles, Dumbbell, Brain, Zap, Beaker, ChevronRight, TestTube, Pill, Dna, ArrowUpDown } from 'lucide-react';
import Link from 'next/link';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import LabResultsButton from '@/components/LabResultsButton';
import { supabase } from '@/lib/supabase';
import { productPath } from '@/lib/products/url';
import { usePurchaseModal } from '@/contexts/PurchaseModalContext';
import { siteConfig } from '@/lib/config';
import { largestPackFor, vialPriceFor } from '@/lib/pricing';
import { useReviewStats } from '@/lib/hooks/useReviewStats';
import { RatingSummary } from '@/components/reviews/StarRating';
import { trackActivity } from '@/lib/customer/activity';
import { getStoreCategories, getCategoryIcon } from '@/lib/categories';
import type { LucideIcon } from 'lucide-react';

interface Product {
  id: string;
  name: string;
  slug: string;
  url_slug?: string | null;
  category: string | null;
  description: string;
  description_short: string | null;
  price: number;
  vial_price: number | null;
  strength: string;
  purity: string;
  form: string;
  active: boolean;
  image_url: string | null;
  box_image_url: string | null;
  stock_quantity: number;
  vials_per_box: number | null;
  coa_url: string[] | null;
}

interface CategoryChip {
  name: string;
  slug: string;
  url_slug?: string | null;
  icon: LucideIcon;
}

// Built-in fallback shown until the controlled category list loads (or if the
// fetch fails / the DB isn't migrated). The "All" chip is always prepended.
const FALLBACK_CATEGORIES: CategoryChip[] = [
  { name: 'All', slug: 'All', icon: Beaker },
  { name: 'Metabolic', slug: 'Weight Loss / Metabolic', icon: TestTube },
  { name: 'Healing', slug: 'Healing / Recovery', icon: Heart },
  { name: 'Anti-Aging', slug: 'Anti-Aging / Beauty', icon: Sparkles },
  { name: 'Performance', slug: 'Bodybuilding / Fitness', icon: Dna },
  { name: 'Cognitive', slug: 'Cognitive / Focus', icon: Brain },
  { name: 'Sexual Health', slug: 'Sexual Health', icon: Zap },
  { name: 'General Health', slug: 'General Health', icon: Pill },
  { name: 'Hormonal', slug: 'Hormonal / Fertility', icon: Scale },
  { name: 'Tanning', slug: 'Beauty / Tanning', icon: Sparkles },
];

// Temporarily hidden: the category filter pills under the hero. Set to true to
// bring the category bar back (desktop and mobile).
const SHOW_CATEGORY_BAR = false;

// Temporarily hidden: the "Research Compound Catalog" hero header. Set to true
// to bring it back (desktop and mobile). The hero carries the pt-44 that clears
// the fixed nav, so <main> takes over that clearance while it's hidden.
const SHOW_CATALOG_HERO = false;

const SCROLL_KEY = 'products_scroll';

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  // Star ratings for whatever is on screen, in one request rather than one
  // per card. Products nobody has reviewed are absent from the map.
  const reviewStats = useReviewStats(filteredProducts.map((p) => p.id));
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'price-asc' | 'price-desc'>('name');
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<CategoryChip[]>(FALLBACK_CATEGORIES);
  const scrollRestoredRef = useRef(false);
  const { openPurchaseModal } = usePurchaseModal();

  // A `?category=` link — the home page's wellness tiles send one — lands
  // here as the selected filter. Read from the URL rather than
  // `useSearchParams` so the page needs no Suspense boundary, and only on
  // mount: after that the chips own the selection.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('category');
    if (wanted) setSelectedCategory(wanted);
  }, []);

  // Load the controlled category list; fall back to the built-in list on
  // empty/failed fetch. "All" is always the first chip.
  useEffect(() => {
    let alive = true;
    getStoreCategories().then((rows) => {
      if (!alive || rows.length === 0) return;
      setCategories([
        { name: 'All', slug: 'All', icon: Beaker },
        ...rows.map((r) => ({ name: r.name, slug: r.slug, icon: getCategoryIcon(r.icon) })),
      ]);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    async function fetchProducts() {
      try {
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('active', true)
          .abortSignal(controller.signal);

        if (error) {
          console.error('Error fetching products:', error);
        } else {
          const sorted = (data || []).sort((a, b) => {
            // Push out-of-stock products to the bottom
            const aOut = (a.stock_quantity ?? 0) === 0;
            const bOut = (b.stock_quantity ?? 0) === 0;
            if (aOut !== bOut) return aOut ? 1 : -1;
            return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
          });
          setProducts(sorted);
          setFilteredProducts(sorted);
        }
      } catch {
        // timed out or aborted — show empty state rather than hang
      } finally {
        clearTimeout(timer);
        setLoading(false);
      }
    }

    fetchProducts();
    return () => controller.abort();
  }, []);

  // Restore scroll position after products finish loading
  useEffect(() => {
    if (loading || scrollRestoredRef.current) return;
    scrollRestoredRef.current = true;
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) {
      requestAnimationFrame(() => window.scrollTo({ top: parseInt(saved, 10), behavior: 'instant' }));
      sessionStorage.removeItem(SCROLL_KEY);
    }
  }, [loading]);

  // Save scroll position when leaving the page
  useEffect(() => {
    const handleUnload = () => {
      sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
    };
    window.addEventListener('pagehide', handleUnload);
    return () => window.removeEventListener('pagehide', handleUnload);
  }, []);

  useEffect(() => {
    let result = products;

    if (selectedCategory !== 'All') {
      result = result.filter((p) => p.category === selectedCategory);
    }

    const query = searchQuery.toLowerCase();

    // Score each product by how relevant the match is, so a name match
    // outranks a match that only appears in the description/category.
    // Higher score = more relevant. Only used to rank a text search.
    const score = (p: Product): number => {
      const name = p.name?.toLowerCase() ?? '';
      if (name === query) return 5; // exact name match
      if (name.startsWith(query)) return 4; // name starts with query ("reta" -> "Retatrutide")
      if (new RegExp(`\\b${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(name)) return 3; // query at a word boundary in the name
      if (name.includes(query)) return 2; // query anywhere in the name
      return 1; // matched only on description/category
    };

    if (searchQuery) {
      result = result.filter(
        (p) =>
          p.name?.toLowerCase().includes(query) ||
          p.description?.toLowerCase().includes(query) ||
          p.category?.toLowerCase().includes(query)
      );
    }

    // Sort a copy so we never mutate the shared `products` array. Out-of-stock
    // products are always pushed to the bottom regardless of the chosen sort.
    const sorted = result.slice().sort((a, b) => {
      const aOut = (a.stock_quantity ?? 0) === 0;
      const bOut = (b.stock_quantity ?? 0) === 0;
      if (aOut !== bOut) return aOut ? 1 : -1;

      if (sortBy === 'price-asc' || sortBy === 'price-desc') {
        // Treat unpriced items (price 0 / "N/A") as last within the priced list.
        const aPrice = a.price === 0 ? Infinity : a.price;
        const bPrice = b.price === 0 ? Infinity : b.price;
        if (aPrice !== bPrice) {
          return sortBy === 'price-asc' ? aPrice - bPrice : bPrice - aPrice;
        }
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      }

      // Name (default): when searching, rank by relevance first...
      if (searchQuery) {
        const diff = score(b) - score(a);
        if (diff !== 0) return diff;
      }
      // ...then fall back to alphabetical.
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

    setFilteredProducts(sorted);
  }, [selectedCategory, searchQuery, sortBy, products]);

  // Record what signed-in customers search for (debounced so we log the
  // settled term, not every keystroke). Fire-and-forget; no-op when anonymous.
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) return;
    const t = setTimeout(() => {
      trackActivity({ type: 'search', searchQuery: q });
    }, 900);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const saveScroll = () => {
    sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
  };

  // "Add" opens the vial/case picker so the shopper chooses single vial or a
  // full case (with the box image + discount) before it lands in the cart.
  const handleAddToCart = (product: Product) => {
    openPurchaseModal(product);
  };

  const getCategoryCount = (slug: string) => {
    if (slug === 'All') return products.length;
    return products.filter((p) => p.category === slug).length;
  };

  const selectedCategoryData = categories.find(c => c.slug === selectedCategory) || categories[0];

  return (
    <main className={`min-h-screen bg-white${SHOW_CATALOG_HERO ? '' : ' pt-28 sm:pt-32'}`}>
      <Navigation />

      {/* Hero Header Section (temporarily hidden via SHOW_CATALOG_HERO) */}
      {SHOW_CATALOG_HERO && (
      <section className="relative bg-white border-b border-line overflow-hidden">
        {/* Subtle pattern */}
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

        <div className="relative max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 pt-44 pb-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-teal/10 border border-teal/20 rounded-full mb-4">
              <Beaker className="w-3.5 h-3.5 text-teal-dark" />
              <span className="text-xs font-medium text-teal-dark">Pharmaceutical Grade Quality</span>
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4 tracking-tight text-ink">
              Research Compound Catalog
            </h1>
            <p className="text-base sm:text-lg text-ink-muted max-w-xl mx-auto">
              HPLC-verified peptides with 99%+ purity for scientific research
            </p>
          </motion.div>
        </div>
      </section>
      )}

      {/* Category Bar (temporarily hidden via SHOW_CATEGORY_BAR) */}
      {SHOW_CATEGORY_BAR && (
      <section className="bg-surface border-b border-line">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 py-6">
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
            {categories.map((category) => {
              const isActive = selectedCategory === category.slug;
              const count = getCategoryCount(category.slug);
              return (
                <button
                  key={category.slug}
                  onClick={() => setSelectedCategory(category.slug)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-full transition-all text-sm font-medium ${
                    isActive
                      ? 'bg-ink text-white'
                      : 'bg-white text-ink-muted hover:text-ink hover:bg-white border border-line'
                  }`}
                >
                  <category.icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-ink-muted'}`} />
                  <span>{category.name}</span>
                  <span className={`text-xs ${isActive ? 'text-white/70' : 'text-ink-muted'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>
      )}

      {/* Main Content */}
      <section className="py-8 sm:py-12">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
          {/* Search and Results Bar */}
          <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between mb-8">
            {/* Search */}
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
              <input
                type="text"
                placeholder="Search compounds..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-11 pr-4 py-3 bg-surface rounded-xl border border-line focus:outline-none focus:ring-2 focus:ring-teal/40 focus:border-transparent text-ink placeholder-ink-muted text-sm"
              />
            </div>

            {/* Results Info + Sort */}
            <div className="flex items-center gap-4 flex-wrap">
              {selectedCategory !== 'All' && (
                <button
                  onClick={() => setSelectedCategory('All')}
                  className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
                >
                  <X className="w-4 h-4" />
                  Clear filter
                </button>
              )}
              <div className="flex items-center gap-2 text-sm text-ink-muted">
                <span className="font-semibold text-ink tabular-nums">{filteredProducts.length}</span>
                <span>compounds</span>
                {selectedCategory !== 'All' && (
                  <span className="text-ink-muted">in {selectedCategoryData.name}</span>
                )}
              </div>

              {/* Sort control */}
              <div className="relative">
                <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-muted pointer-events-none" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'name' | 'price-asc' | 'price-desc')}
                  aria-label="Sort compounds"
                  className="appearance-none pl-8 pr-8 py-2 bg-surface rounded-lg border border-line text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40 focus:border-transparent cursor-pointer"
                >
                  <option value="name">Name: A–Z</option>
                  <option value="price-asc">Price: Low to High</option>
                  <option value="price-desc">Price: High to Low</option>
                </select>
                <ChevronRight className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-muted rotate-90 pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Products Grid */}
          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
              {[...Array(8)].map((_, i) => (
                <div
                  key={i}
                  className="bg-white rounded-xl border border-line overflow-hidden animate-pulse"
                >
                  <div className="bg-surface aspect-square" />
                  <div className="p-4 space-y-3">
                    <div className="h-4 bg-surface rounded w-3/4" />
                    <div className="h-4 bg-surface rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredProducts.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-16 sm:py-20"
            >
              <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="w-8 h-8 text-ink-muted" />
              </div>
              <h3 className="text-lg font-semibold text-ink mb-2">No compounds found</h3>
              <p className="text-ink-muted mb-6">Try adjusting your search or filter</p>
              <button
                onClick={() => {
                  setSelectedCategory('All');
                  setSearchQuery('');
                }}
                className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-white text-sm font-medium rounded-lg hover:bg-ink/90 transition-all"
              >
                View all compounds
                <ChevronRight className="w-4 h-4" />
              </button>
            </motion.div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
              {filteredProducts.map((product, index) => (
                <motion.div
                  key={product.id}
                  data-product-card
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.02 }}
                  className={`group bg-white rounded-xl border border-line overflow-hidden hover:shadow-lg hover:shadow-ink/5 hover:border-ink/20 transition-all ${
                    product.price === 0 || product.stock_quantity === 0 ? 'opacity-70' : ''
                  }`}
                >
                  {/* Product Image */}
                  <Link href={productPath(product)} onClick={saveScroll}>
                    <div className="relative bg-surface aspect-square p-4">
                      {product.image_url ? (
                        <img
                          src={product.image_url}
                          alt={product.name}
                          className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Beaker className="w-12 h-12 text-line" />
                        </div>
                      )}
                      {/* Purity Badge */}
                      <div className="absolute top-3 left-3">
                        <span className="text-[10px] font-semibold text-teal-dark bg-teal-50 px-2 py-1 rounded-full border border-teal/20">
                          {product.purity}
                        </span>
                      </div>
                      {/* Out of Stock overlay badge */}
                      {product.stock_quantity === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="bg-black/60 text-white text-[10px] font-semibold px-3 py-1 rounded-full tracking-wide">
                            Out of Stock
                          </span>
                        </div>
                      )}
                    </div>
                  </Link>

                  {/* Product Info */}
                  <div className="p-4">
                    <p className="text-[10px] text-ink-muted font-medium uppercase tracking-wider mb-1 line-clamp-1">
                      {product.strength}
                    </p>
                    <Link href={productPath(product)} onClick={saveScroll}>
                      <h3 className="font-semibold text-ink group-hover:text-ink-muted transition-colors line-clamp-1 mb-1 text-sm sm:text-base">
                        {product.name}
                      </h3>
                    </Link>

                    {/* Only products someone has actually reviewed show stars;
                        the rest keep the space the name already occupies. */}
                    <RatingSummary
                      average={reviewStats[product.id]?.average_rating ?? 0}
                      count={reviewStats[product.id]?.review_count ?? 0}
                      className="mb-2"
                    />

                    <div className="flex items-center justify-between gap-2">
                      {product.price === 0 ? (
                        <span className="text-lg font-bold text-ink-muted">N/A</span>
                      ) : (
                        <span className="flex flex-col leading-tight">
                          <span className="text-lg font-bold text-ink tabular-nums">
                            ${vialPriceFor(product).toFixed(2)}
                            <span className="text-[10px] font-medium text-ink-muted"> / vial</span>
                          </span>
                          {(() => {
                            const pack = largestPackFor(product);
                            if (!pack) return null;
                            return (
                              <span className="text-[10px] text-ink-muted">
                                Pack of {pack.size} · ${pack.price.toFixed(2)}
                                {pack.compareAt != null && (
                                  <span className="ml-1 line-through">
                                    ${pack.compareAt.toFixed(2)}
                                  </span>
                                )}{' '}
                                CAD
                              </span>
                            );
                          })()}
                        </span>
                      )}
                      <div className="flex items-center gap-1.5">
                        {product.coa_url && product.coa_url.length > 0 && (
                          <LabResultsButton productName={product.name} />
                        )}
                        {siteConfig.ecommerceEnabled && (
                          product.stock_quantity === 0 ? (
                            <span className="text-xs text-red-500 font-medium">Out of Stock</span>
                          ) : product.price === 0 ? (
                            <span className="text-xs text-ink-muted font-medium">Unavailable</span>
                          ) : (
                            <button
                              onClick={() => handleAddToCart(product)}
                              aria-label={`Add ${product.name} to cart`}
                              className="flex items-center gap-1.5 px-3 py-2 bg-ink hover:bg-ink/90 text-white text-xs font-medium rounded-lg transition-all"
                            >
                              <ShoppingCart className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">Add</span>
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Trust Bar */}
      <section className="py-12 sm:py-16 bg-surface">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
          <div className="bg-ink rounded-2xl p-6 sm:p-8">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-bold text-teal-light mb-1 tabular-nums">99%+</div>
                <div className="text-xs sm:text-sm text-white/60">Verified Purity</div>
              </div>
              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-bold text-white mb-1">3rd Party</div>
                <div className="text-xs sm:text-sm text-white/60">HPLC Tested</div>
              </div>
              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-bold text-white mb-1">Same Day</div>
                <div className="text-xs sm:text-sm text-white/60">Order Processing</div>
              </div>
              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-bold text-white mb-1">Discreet</div>
                <div className="text-xs sm:text-sm text-white/60">Secure Packaging</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
