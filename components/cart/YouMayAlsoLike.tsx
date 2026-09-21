'use client';

/**
 * "You may also like" — the cart's computed suggestions.
 *
 * Nothing here is configured: the order comes from
 * `lib/products/recommendations.ts`, which ranks the catalog against the cart
 * on what people have actually bought together. This component only draws it.
 *
 * A scroller rather than a grid, because the list is eight long and the block
 * sits below the fold on a screen whose job is checking out — it should be
 * skimmable in one gesture, not a second page of products.
 *
 * Renders nothing when there is nothing to suggest.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Beaker, ChevronLeft, ChevronRight, ShoppingCart } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import {
  defaultPackFor,
  productHref,
  useAddSuggestion,
  type RecommendedProduct,
} from './recommendations';

export default function YouMayAlsoLike({
  products,
  className = '',
}: {
  products: RecommendedProduct[];
  className?: string;
}) {
  const toast = useToast();
  const addSuggestion = useAddSuggestion();
  const railRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  // Arrows are disabled at the ends rather than hidden, so the row does not
  // jump sideways as the controls appear and disappear mid-scroll.
  const syncArrows = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    setAtStart(rail.scrollLeft <= 4);
    setAtEnd(rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 4);
  }, []);

  useEffect(() => {
    syncArrows();
    const rail = railRef.current;
    if (!rail) return;
    rail.addEventListener('scroll', syncArrows, { passive: true });
    window.addEventListener('resize', syncArrows);
    return () => {
      rail.removeEventListener('scroll', syncArrows);
      window.removeEventListener('resize', syncArrows);
    };
  }, [syncArrows, products.length]);

  const scrollBy = (direction: -1 | 1) => {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollBy({ left: direction * Math.max(200, rail.clientWidth * 0.8), behavior: 'smooth' });
  };

  const buyable = products.filter((product) => defaultPackFor(product) !== null);
  if (buyable.length === 0) return null;

  const add = (product: RecommendedProduct, source: HTMLElement | null) => {
    if (addSuggestion(product, source)) {
      toast.success(`${product.name} added to your cart.`);
    } else {
      toast.error(`${product.name} is out of stock.`);
    }
  };

  return (
    <section className={className} aria-labelledby="similar-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="similar-heading" className="text-lg font-bold text-ink sm:text-xl">
          You May Also Like
        </h2>
        <Link
          href="/products"
          className="inline-flex flex-shrink-0 items-center gap-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink sm:text-sm"
        >
          View All Products <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="relative mt-4">
        <button
          type="button"
          onClick={() => scrollBy(-1)}
          disabled={atStart}
          aria-label="Scroll suggestions left"
          className="absolute -left-2 top-1/2 z-[1] hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-white text-ink shadow-sm transition-opacity hover:bg-surface disabled:opacity-30 sm:flex"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div
          ref={railRef}
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {buyable.map((product) => {
            const pack = defaultPackFor(product)!;
            return (
              <div
                key={product.id}
                className="flex w-[13rem] flex-shrink-0 snap-start items-center gap-3 rounded-xl border border-line bg-white p-3 transition-colors hover:border-teal/40"
              >
                <Link
                  href={productHref(product)}
                  className="group flex min-w-0 flex-1 items-center gap-3"
                >
                  <div className="flex h-12 w-10 flex-shrink-0 items-center justify-center">
                    {product.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.image_url}
                        alt={product.name}
                        className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-105"
                      />
                    ) : (
                      <Beaker className="h-6 w-6 text-line" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-ink group-hover:text-teal-dark">
                      {product.name}
                    </p>
                    {product.strength && (
                      <p className="truncate text-[11px] text-ink-muted">{product.strength}</p>
                    )}
                    <p className="mt-0.5 text-xs font-bold text-ink tabular-nums">
                      ${pack.price.toFixed(2)}
                    </p>
                  </div>
                </Link>

                <button
                  type="button"
                  onClick={(event) => add(product, event.currentTarget)}
                  aria-label={`Add ${product.name} to cart`}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-ink transition-all hover:border-teal/50 hover:text-teal-dark active:scale-90"
                >
                  <ShoppingCart className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => scrollBy(1)}
          disabled={atEnd}
          aria-label="Scroll suggestions right"
          className="absolute -right-2 top-1/2 z-[1] hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-white text-ink shadow-sm transition-opacity hover:bg-surface disabled:opacity-30 sm:flex"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
