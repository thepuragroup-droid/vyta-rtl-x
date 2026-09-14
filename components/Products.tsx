"use client";

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { usePurchaseModal } from "@/contexts/PurchaseModalContext";
import { ShoppingCart, ArrowRight, Beaker } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { siteConfig } from "@/lib/config";
import { casePriceFor, vialPriceFor } from "@/lib/pricing";
import { productPath } from '@/lib/products/url';

interface Product {
  id: string;
  name: string;
  slug: string;
  url_slug?: string | null;
  description_short: string | null;
  price: number;
  vial_price: number | null;
  purity: string;
  strength: string;
  image_url: string | null;
  box_image_url: string | null;
  stock_quantity: number;
  vials_per_box: number | null;
}

export default function Products() {
  const { openPurchaseModal } = usePurchaseModal();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    async function fetchFeaturedProducts() {
      try {
        const { data } = await supabase
          .from("products")
          .select(
            "id, name, slug, description_short, price, vial_price, purity, strength, image_url, box_image_url, stock_quantity, vials_per_box",
          )
          .eq("active", true)
          .eq("featured", true)
          .gt("stock_quantity", 0)
          .limit(8)
          .abortSignal(controller.signal);
        if (data) {
          const sorted = data.sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
          );
          setProducts(sorted);
        }
      } catch {
        // timed out or failed — show empty grid rather than spinning forever
      } finally {
        clearTimeout(timer);
        setLoading(false);
      }
    }
    fetchFeaturedProducts();
    return () => controller.abort();
  }, []);

  // "Add" opens the vial/case picker — the shopper chooses single vial or a
  // full case (with the box image + discount) there.
  const handleAddToCart = (product: Product) => {
    openPurchaseModal(product);
  };

  if (loading) {
    return (
      <section className="py-16 sm:py-20 bg-white">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
          <div className="mb-10">
            <div className="h-8 bg-surface rounded w-48 mb-2 animate-pulse" />
            <div className="h-4 bg-surface rounded w-64 animate-pulse" />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
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
        </div>
      </section>
    );
  }

  return (
    <section className="py-16 sm:py-20 bg-white">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-bronze/10 border border-bronze/20 rounded-full mb-3">
              <Beaker className="w-3.5 h-3.5 text-bronze" />
              <span className="text-xs font-medium text-bronze">
                Featured Compounds
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-ink mb-2">
              Popular Research Peptides
            </h2>
            <p className="text-ink-muted">
              High-purity compounds for scientific research
            </p>
          </div>
          <Link
            href="/products"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-ink hover:text-ink-muted"
          >
            View full catalog
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {/* Products Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-5">
          {products.map((product, index) => (
            <motion.div
              key={product.id}
              data-product-card
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              viewport={{ once: true }}
              className="group bg-white rounded-lg sm:rounded-xl border border-line overflow-hidden hover:shadow-lg hover:shadow-ink/5 hover:border-ink/20 transition-all"
            >
              {/* Product Image */}
              <Link href={productPath(product)}>
                <div className="relative bg-surface aspect-square p-2 sm:p-4">
                  {product.image_url ? (
                    <img
                      src={product.image_url}
                      alt={product.name}
                      className={`w-full h-full object-contain group-hover:scale-105 transition-transform duration-300 ${product.stock_quantity === 0 ? 'opacity-50' : ''}`}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Beaker className="w-10 sm:w-12 h-10 sm:h-12 text-line" />
                    </div>
                  )}
                  {/* Purity Badge */}
                  <div className="absolute top-2 sm:top-3 left-2 sm:left-3">
                    <span className="text-[8px] sm:text-[10px] font-semibold text-bronze bg-bronze-50 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full border border-bronze/20">
                      {product.purity}
                    </span>
                  </div>
                  {/* Out of Stock overlay */}
                  {product.stock_quantity === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="bg-black/60 text-white text-[8px] sm:text-[10px] font-semibold px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-full tracking-wide">
                        Out of Stock
                      </span>
                    </div>
                  )}
                </div>
              </Link>

              {/* Product Info */}
              <div className="p-2.5 sm:p-4">
                <Link href={productPath(product)}>
                  <h3 className="font-semibold text-ink group-hover:text-ink-muted transition-colors line-clamp-1 mb-0.5 sm:mb-1 text-xs sm:text-base">
                    {product.name}
                  </h3>
                </Link>
                <p className="text-[10px] sm:text-xs text-ink-muted mb-2 sm:mb-3">
                  {product.strength}
                </p>

                <div className="flex items-center justify-between gap-1">
                  {product.price === 0 ? (
                    <span className="text-sm sm:text-lg font-bold text-ink-muted">
                      N/A
                    </span>
                  ) : (
                    <span className="flex flex-col leading-tight">
                      <span className="text-sm sm:text-lg font-bold text-ink tabular-nums">
                        ${vialPriceFor(product).toFixed(2)}
                        <span className="text-[9px] sm:text-[10px] font-medium text-ink-muted">
                          {" "}
                          / vial
                        </span>
                      </span>
                      <span className="text-[9px] sm:text-[10px] text-ink-muted">
                        Pack of {product.vials_per_box ?? 10} · $
                        {casePriceFor(product).toFixed(2)}
                      </span>
                    </span>
                  )}
                  {product.stock_quantity === 0 ? (
                    <span className="text-[10px] sm:text-xs text-red-500 font-medium">
                      Out of Stock
                    </span>
                  ) : product.price === 0 ? (
                    <span className="text-[10px] sm:text-xs text-ink-muted font-medium">
                      Unavailable
                    </span>
                  ) : siteConfig.ecommerceEnabled ? (
                    <button
                      onClick={() => handleAddToCart(product)}
                      aria-label={`Add ${product.name} to cart`}
                      className="flex items-center justify-center gap-1.5 p-2 sm:px-3 sm:py-2 bg-ink hover:bg-ink/90 text-white text-xs font-medium rounded-lg transition-all"
                    >
                      <ShoppingCart className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Add</span>
                    </button>
                  ) : null}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
