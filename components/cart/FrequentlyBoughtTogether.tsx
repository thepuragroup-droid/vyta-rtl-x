'use client';

/**
 * "Frequently bought together" — the operator's own pairings for whatever is
 * in the cart, set per product in /admin/cart-upsells.
 *
 * Multi-select rather than three separate add buttons: the point of the block
 * is the stack, so the cards tick on and off and one button adds them all. The
 * "save up to X%" on that button is the best saving among the TICKED cards —
 * it moves as the selection does, because a figure that stays put while the
 * selection changes is a figure nobody can check.
 *
 * Every saving shown is the product's own compare-at pricing (what the product
 * page shows on the same pack), not a discount invented for this block.
 *
 * Renders nothing when there is nothing to suggest, so the cart can drop it in
 * unconditionally.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { Beaker, Check, Plus, ShoppingBag } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import {
  defaultPackFor,
  productHref,
  useAddSuggestion,
  type RecommendedProduct,
} from './recommendations';

export default function FrequentlyBoughtTogether({
  products,
  /** What the cart's first line is called — "these pair well with ARA290". */
  pairedWith,
  className = '',
}: {
  products: RecommendedProduct[];
  pairedWith?: string;
  className?: string;
}) {
  const toast = useToast();
  const addSuggestion = useAddSuggestion();
  const gridRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string[]>([]);

  // Only the ones a customer could actually buy right now.
  const buyable = useMemo(
    () => products.filter((product) => defaultPackFor(product) !== null),
    [products],
  );

  // Open with everything ticked — the block is a bundle offer, so the stack is
  // the default and un-ticking is the edit. Re-run when the suggestions change
  // so a card that has just arrived is not left silently unticked.
  const idKey = buyable.map((product) => product.id).join(',');
  useEffect(() => {
    setSelected(idKey ? idKey.split(',') : []);
  }, [idKey]);

  if (buyable.length === 0) return null;

  const bestSaving = buyable
    .filter((product) => selected.includes(product.id))
    .reduce((best, product) => {
      const pack = defaultPackFor(product);
      return Math.max(best, pack?.savingsPercent ?? 0);
    }, 0);

  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((one) => one !== id) : [...current, id],
    );
  };

  const addSelected = () => {
    const picked = buyable.filter((product) => selected.includes(product.id));
    if (picked.length === 0) return;
    const blocked: string[] = [];
    for (const product of picked) {
      if (!addSuggestion(product, gridRef.current)) blocked.push(product.name);
    }
    if (blocked.length === picked.length) {
      toast.error(
        picked.length === 1
          ? `${picked[0].name} is out of stock.`
          : "We couldn't add those — they're out of stock.",
      );
      return;
    }
    if (blocked.length > 0) {
      toast.error(`${blocked.join(', ')} couldn't be added — out of stock.`);
    }
    const addedCount = picked.length - blocked.length;
    toast.success(`Added ${addedCount} item${addedCount === 1 ? '' : 's'} to your cart.`);
  };

  return (
    <section className={className} aria-labelledby="fbt-heading">
      <h2 id="fbt-heading" className="text-lg font-bold text-ink sm:text-xl">
        Frequently Bought Together
      </h2>
      <p className="mt-1 text-xs text-ink-muted sm:text-sm">
        Complete your stack and save.
        {pairedWith ? ` These pair well with ${pairedWith}.` : ''}
      </p>

      <div ref={gridRef} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {buyable.map((product, index) => {
          const pack = defaultPackFor(product)!;
          const isSelected = selected.includes(product.id);
          const blurb =
            product.description_short ||
            (product.description ? `${product.description.slice(0, 70)}…` : null);
          return (
            <motion.div
              key={product.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className={`relative flex flex-col rounded-xl border p-3.5 transition-colors ${
                isSelected ? 'border-teal bg-teal/[0.04]' : 'border-line bg-white'
              }`}
            >
              {product.recommendation_badge && (
                <span className="absolute left-3 top-3 z-[1] rounded-full bg-teal/10 px-2 py-0.5 text-[10px] font-semibold text-teal-dark">
                  {product.recommendation_badge}
                </span>
              )}

              {/* The tick is the card's control; the rest of the card is a link
                  to the product, so "tell me more" and "add it" don't fight. */}
              <button
                type="button"
                onClick={() => toggle(product.id)}
                role="checkbox"
                aria-checked={isSelected}
                aria-label={`${isSelected ? 'Remove' : 'Add'} ${product.name}`}
                className={`absolute right-3 top-3 z-[1] flex h-7 w-7 items-center justify-center rounded-full border transition-colors ${
                  isSelected
                    ? 'border-teal bg-teal text-white'
                    : 'border-line bg-white text-ink-muted hover:border-teal/50'
                }`}
              >
                {isSelected ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              </button>

              <Link href={productHref(product)} className="group flex flex-1 flex-col">
                <div className="mx-auto mb-3 flex h-28 w-full items-center justify-center pt-4">
                  {product.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={product.image_url}
                      alt={product.name}
                      className="h-full max-w-[60%] object-contain transition-transform duration-200 group-hover:scale-105"
                    />
                  ) : (
                    <Beaker className="h-10 w-10 text-line" />
                  )}
                </div>

                <h3 className="text-sm font-semibold text-ink group-hover:text-teal-dark">
                  {product.name}
                </h3>
                {blurb && (
                  <p className="mt-1 line-clamp-2 text-xs leading-snug text-ink-muted">
                    {blurb}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-sm font-bold text-ink tabular-nums">
                    ${pack.price.toFixed(2)}
                  </span>
                  {pack.compareAt != null && (
                    <span className="text-xs text-ink-muted line-through tabular-nums">
                      ${pack.compareAt.toFixed(2)}
                    </span>
                  )}
                  {pack.savingsPercent > 0 && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      Save {pack.savingsPercent}%
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-ink-muted">{pack.label}</p>
              </Link>
            </motion.div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addSelected}
        disabled={selected.length === 0}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-ink/15 bg-white px-4 py-3.5 text-sm font-semibold text-ink transition-colors hover:border-ink/40 hover:bg-surface disabled:opacity-40"
      >
        <ShoppingBag className="h-4 w-4" />
        <span>
          Add {selected.length === buyable.length ? 'All' : selected.length || ''} Selected
          to Cart
        </span>
        {bestSaving > 0 && (
          <>
            <span className="text-line">|</span>
            <span className="text-teal-dark">Save up to {bestSaving}%</span>
          </>
        )}
      </button>
    </section>
  );
}
