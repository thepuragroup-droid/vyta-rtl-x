'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { ArrowRight, Beaker } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { vialPriceFor } from '@/lib/pricing';
import { productPath } from '@/lib/products/url';
import { useReviewStats } from '@/lib/hooks/useReviewStats';
import { RatingSummary } from '@/components/reviews/StarRating';

/**
 * "Best Sellers" — four cards, each carrying the one number a shopper cannot
 * get anywhere else on the page: what other customers rated it.
 *
 * Ratings come from `useReviewStats`, one request for all four ids, and a
 * product nobody has reviewed simply shows no stars rather than a hollow
 * "0.0 (0)".
 */

interface Product {
  id: string;
  name: string;
  slug: string;
  url_slug?: string | null;
  price: number;
  vial_price: number | null;
  purity: string | null;
  strength: string | null;
  image_url: string | null;
  stock_quantity: number;
  vials_per_box: number | null;
}

export default function BestSellers() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const stats = useReviewStats(products.map((p) => p.id));

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    (async () => {
      try {
        const { data } = await supabase
          .from('products')
          .select(
            'id, name, slug, price, vial_price, purity, strength, image_url, stock_quantity, vials_per_box, pack_sizes, pack_options',
          )
          .eq('active', true)
          .eq('featured', true)
          .gt('stock_quantity', 0)
          .order('price', { ascending: false })
          .limit(4)
          .abortSignal(controller.signal);
        if (data) setProducts(data);
      } catch {
        // timed out or failed — the section hides itself rather than spinning
      } finally {
        clearTimeout(timer);
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, []);

  if (!loading && products.length === 0) return null;

  return (
    <section className="py-14 sm:py-20 bg-surface">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
        <div className="flex items-end justify-between gap-4 mb-8">
          <div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-ink">Best Sellers</h2>
            <p className="text-sm text-ink-muted mt-1.5">
              Our most trusted and frequently purchased peptides.
            </p>
          </div>
          <Link
            href="/products"
            className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium text-ink hover:text-ink-muted whitespace-nowrap"
          >
            View All Products
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
          {loading
            ? [0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-white rounded-xl border border-line overflow-hidden animate-pulse"
                >
                  <div className="aspect-square bg-surface-2" />
                  <div className="p-3 sm:p-4 space-y-2">
                    <div className="h-4 bg-surface-2 rounded w-3/4" />
                    <div className="h-3 bg-surface-2 rounded w-1/3" />
                    <div className="h-9 bg-surface-2 rounded-lg w-full mt-3" />
                  </div>
                </div>
              ))
            : products.map((product, index) => {
                const rollup = stats[product.id];
                return (
                  <motion.div
                    key={product.id}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.05 }}
                    viewport={{ once: true }}
                    className="group bg-white rounded-xl border border-line overflow-hidden hover:shadow-card-hover hover:border-ink/20 transition-all flex flex-col"
                  >
                    <Link href={productPath(product)} className="block">
                      <div className="relative bg-surface aspect-square p-3 sm:p-5">
                        {product.image_url ? (
                          <img
                            src={product.image_url}
                            alt={product.name}
                            className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Beaker className="w-10 h-10 text-line" />
                          </div>
                        )}
                        {product.purity && (
                          <span className="absolute top-2.5 left-2.5 text-[9px] sm:text-[10px] font-semibold text-teal-dark bg-white/90 backdrop-blur-sm px-2 py-1 rounded-full border border-teal/20">
                            {product.purity}
                          </span>
                        )}
                      </div>
                    </Link>

                    <div className="p-3 sm:p-4 flex flex-col flex-1">
                      <Link href={productPath(product)}>
                        <h3 className="font-semibold text-ink text-sm sm:text-base leading-snug line-clamp-2 group-hover:text-ink-muted transition-colors">
                          {product.name}
                        </h3>
                      </Link>
                      {product.strength && (
                        <p className="text-[11px] sm:text-xs text-ink-muted mt-0.5">
                          {product.strength}
                        </p>
                      )}

                      <p className="text-sm sm:text-base font-bold text-ink tabular-nums mt-2">
                        {product.price > 0 ? (
                          <>
                            <span className="text-[11px] font-medium text-ink-muted">From </span>
                            ${vialPriceFor(product).toFixed(2)}
                          </>
                        ) : (
                          <span className="text-ink-muted">N/A</span>
                        )}
                      </p>

                      {rollup && (
                        <RatingSummary
                          average={rollup.average_rating}
                          count={rollup.review_count}
                          className="mt-1.5"
                        />
                      )}

                      <Link href={productPath(product)} className="mt-3 sm:mt-4 block">
                        <span className="w-full inline-flex items-center justify-center px-4 py-2.5 bg-ink hover:bg-ocean text-white text-xs sm:text-sm font-semibold rounded-lg transition-colors">
                          View Product
                        </span>
                      </Link>
                    </div>
                  </motion.div>
                );
              })}
        </div>

        <Link
          href="/products"
          className="sm:hidden mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-ink"
        >
          View All Products
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </section>
  );
}
