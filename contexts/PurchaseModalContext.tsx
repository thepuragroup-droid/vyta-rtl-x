'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingCart, X, Check, Beaker, Package } from 'lucide-react';
import { useCart, type PurchaseUnit } from '@/contexts/CartContext';
import { useToast } from '@/contexts/ToastContext';
import {
  packOptionsFor, packsInStock, round2, vialsPerBoxOf,
  type ResolvedPackOption,
} from '@/lib/pricing';
import { trackActivity } from '@/lib/customer/activity';

/** Minimal product shape the picker needs. Every storefront surface that opens
 *  the modal must supply these (vial price + box image drive the two options). */
export interface PurchaseModalProduct {
  id: string;
  name: string;
  strength?: string | null;
  /** Catalog case (box) price — the fallback vial-price source; the pack
   *  price the modal quotes is vial × vials_per_box, landing back on this
   *  figure. */
  price: number;
  /** Per-vial price override; derived from the case price when unset. */
  vial_price: number | null;
  /** Vials in one case (default 10). */
  vials_per_box: number | null;
  /** Pack quantities this product is sold in, e.g. [1, 3, 5, 10]. When unset
   *  the picker falls back to the historical pair — single vial + one full
   *  case. See lib/pricing.ts `packSizesFor`. */
  pack_sizes?: number[] | null;
  /** Per-pack label / price / compare-at, when an operator has set any. Wins
   *  over `pack_sizes`. See lib/pricing.ts `packOptionsFor`. */
  pack_options?: unknown;
  /** Stock, measured in vials. */
  stock_quantity: number;
  image_url: string | null;
  /** Packaging/box image, shown for the "case" option. */
  box_image_url?: string | null;
  /** Restrict which FORMS are offered (default both). Single vial maps to a
   *  pack of 1; 'case' to every multi-vial pack. Used by the PuraMass checkout
   *  upsell to hide a form PuraMass can't fulfil. A single remaining option
   *  collapses the picker to a "Sold as …" label. */
  allowedUnits?: PurchaseUnit[];
  /** Ignore store stock caps (PuraMass fulfils upsell add-ons). Default false. */
  ignoreStock?: boolean;
}

interface PurchaseModalContextType {
  /** Open the vial/case picker for a product. */
  openPurchaseModal: (product: PurchaseModalProduct) => void;
}

const PurchaseModalContext = createContext<PurchaseModalContextType | undefined>(
  undefined,
);

export function PurchaseModalProvider({ children }: { children: React.ReactNode }) {
  const [product, setProduct] = useState<PurchaseModalProduct | null>(null);

  const openPurchaseModal = useCallback((p: PurchaseModalProduct) => {
    setProduct(p);
    // Opening the vial/pack picker is a product view in its own right: on the
    // catalog, the hero ticker and the checkout upsell it is the only place a
    // customer looks at a product up close, so it belongs in the same activity
    // log as a product-page visit. Fire-and-forget, and a no-op for anonymous
    // visitors; `trackActivity` also folds away the second view when the
    // picker is opened straight off that product's own page.
    trackActivity({ type: 'view', productId: p.id, productName: p.name });
  }, []);

  const close = useCallback(() => setProduct(null), []);

  return (
    <PurchaseModalContext.Provider value={{ openPurchaseModal }}>
      {children}
      <AnimatePresence>
        {product && <PurchaseModal product={product} onClose={close} />}
      </AnimatePresence>
    </PurchaseModalContext.Provider>
  );
}

function PurchaseModal({
  product,
  onClose,
}: {
  product: PurchaseModalProduct;
  onClose: () => void;
}) {
  const { addItem, flyToCart } = useCart();
  const toast = useToast();
  const router = useRouter();
  const imageRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  const vialsPerBox = vialsPerBoxOf(product.vials_per_box);

  const allowedUnits: PurchaseUnit[] =
    product.allowedUnits && product.allowedUnits.length > 0
      ? product.allowedUnits
      : ['vial', 'case'];

  // The pack options this product offers — each already carrying its label,
  // price and compare-at — narrowed by the caller's allowed forms. A pack of 1
  // IS the single vial; anything larger is a "case".
  const offered = packOptionsFor(product).filter((option) =>
    option.size === 1 ? allowedUnits.includes('vial') : allowedUnits.includes('case'),
  );
  // Never render an empty picker: if the narrowing removed everything, fall
  // back to a single vial.
  const packs: ResolvedPackOption[] =
    offered.length > 0 ? offered : packOptionsFor({ ...product, pack_sizes: [1], pack_options: null });
  const singleForm = packs.length === 1;

  // Upsell add-ons ignore store stock (PuraMass fulfils them) — treat caps as
  // effectively unlimited so the picker/stepper aren't gated by local stock.
  const capFor = (size: number) =>
    product.ignoreStock ? 99 : packsInStock(product.stock_quantity, size);

  // Default to the smallest pack the customer can actually buy, so the picker
  // never opens on a sold-out option.
  const [packSize, setPackSize] = useState<number>(
    () => (packs.find((option) => capFor(option.size) >= 1) ?? packs[0]).size,
  );
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  const unit: PurchaseUnit = packSize > 1 ? 'case' : 'vial';

  useEffect(() => setMounted(true), []);

  // Lock body scroll while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Preload both unit images up front so toggling vial <-> case never flashes
  // an empty frame while the box image fetches.
  useEffect(() => {
    [product.image_url, product.box_image_url].forEach((src) => {
      if (!src) return;
      const img = new window.Image();
      img.src = src;
    });
  }, [product.image_url, product.box_image_url]);

  const unitCap = capFor(packSize);
  const selected = packs.find((option) => option.size === packSize) ?? packs[0];
  const unitPrice = selected.price;
  // For a multi-vial pack, show the box image; fall back to the main image.
  const displayImage =
    packSize > 1 ? product.box_image_url || product.image_url : product.image_url;

  // Subtotal breakdown, quoted at the SELECTED pack's own per-vial rate — on a
  // discounted pack that is below the catalog vial price, and quoting the
  // catalog one would not multiply out to the total beside it.
  const vialsShown = packSize * qty;
  const lineTotal = round2(unitPrice * qty);
  const lineCompareAt =
    selected.compareAt != null ? round2(selected.compareAt * qty) : null;

  const selectPack = (next: number) => {
    setPackSize(next);
    setQty(1); // each pack size has its own stock ceiling
  };

  /** Adds `qty` lines to the cart; true when at least one made it in. */
  const addToCart = (): boolean => {
    let anyAdded = false;
    for (let i = 0; i < qty; i++) {
      const ok = addItem({
        productId: product.id,
        unit,
        packSize,
        vialsPerBox,
        name: product.name,
        price: unitPrice,
        strength: product.strength ?? '',
        image_url: product.image_url || undefined,
        stock_quantity: unitCap,
      });
      anyAdded = anyAdded || ok;
    }
    return anyAdded;
  };

  const stockError = () =>
    toast.error(
      unitCap < 1
        ? packSize > 1
          ? `Not enough stock for a pack of ${packSize}.`
          : 'Out of stock.'
        : `Only ${unitCap} in stock — that's all we have.`,
    );

  const handleAdd = () => {
    if (addToCart()) {
      flyToCart(imageRef.current, { image_url: displayImage || undefined });
      setAdded(true);
      // Let the confirmation flash, then close.
      setTimeout(() => onClose(), 650);
    } else {
      stockError();
    }
  };

  const handleBuyNow = () => {
    if (addToCart()) {
      onClose();
      router.push('/checkout');
    } else {
      stockError();
    }
  };

  if (!mounted) return null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-x-0 top-0 z-[300] flex h-[100dvh] items-end justify-center bg-ink/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      {/* Panel — fixed width; the wide 16:9 image stage below means swapping
          the vial/box artwork never changes the panel's size */}
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 40, scale: 0.98 }}
        transition={{ type: 'spring', damping: 30, stiffness: 320 }}
        className="relative flex max-h-[100dvh] w-full flex-col overflow-y-auto rounded-t-2xl border border-line bg-white shadow-xl sm:max-h-[90vh] sm:max-w-4xl sm:flex-row sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Add ${product.name} to cart`}
      >
        {/* Close */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-line bg-white text-ink-muted transition-colors hover:border-ink/40 hover:text-ink"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Image — a fixed 16:9 stage. The square vial artwork letterboxes
            inside it, so toggling vial ↔ pack never resizes the container. */}
        <div className="relative flex items-center justify-center border-b border-line bg-surface p-6 sm:w-1/2 sm:border-b-0 sm:border-r sm:p-8">
          <div
            ref={imageRef}
            className="relative flex aspect-video w-full items-center justify-center"
          >
            {displayImage ? (
              <motion.img
                key={displayImage}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                src={displayImage}
                alt={`${product.name} — ${selected.label.toLowerCase()}`}
                className="h-full w-full object-contain"
                loading="eager"
                decoding="async"
              />
            ) : packSize > 1 ? (
              <Package className="w-16 h-16 text-line" />
            ) : (
              <Beaker className="w-16 h-16 text-line" />
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col p-5 sm:p-6">
          {/* Header — strength as a teal pill above a larger product name */}
          <div className="pr-10">
            {product.strength && (
              <span className="mb-2 inline-flex items-center rounded-full border border-teal/20 bg-teal-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-teal-dark">
                {product.strength}
              </span>
            )}
            <h2 className="text-xl font-bold leading-snug text-ink sm:text-2xl">
              {product.name}
            </h2>
          </div>

          {/* Pack size — one card per option the product is sold in; the
              active one inverts to ink with a check. A product offering only
              one form (or an upsell narrowed to one) collapses to a label. */}
          <p className="mt-5 mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            {singleForm ? 'Sold as' : 'Pack size'}
          </p>
          {singleForm ? (
            <div className="rounded-xl border border-line bg-surface p-3">
              <span className="block text-sm font-semibold text-ink">{selected.label}</span>
              <span className="block text-[11px] text-ink-muted tabular-nums">
                ${selected.price.toFixed(2)}
                {selected.compareAt != null && (
                  <span className="ml-1 line-through">${selected.compareAt.toFixed(2)}</span>
                )}
                {packSize > 1
                  ? ` · $${selected.perVialPrice.toFixed(2)} per vial`
                  : ' per vial'}
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {packs.map((option) => {
                const cap = capFor(option.size);
                return (
                  <PackCard
                    key={option.size}
                    active={packSize === option.size}
                    disabled={cap < 1}
                    onClick={() => selectPack(option.size)}
                    label={option.label}
                    badge={option.savings > 0 ? `Save $${option.savings.toFixed(2)}` : null}
                    sublabel={
                      cap < 1 ? (
                        'Not enough stock'
                      ) : (
                        <>
                          <span className="font-medium tabular-nums">
                            ${option.price.toFixed(2)}
                          </span>
                          {option.compareAt != null && (
                            <span className="ml-1 tabular-nums line-through opacity-70">
                              ${option.compareAt.toFixed(2)}
                            </span>
                          )}
                          {option.size > 1
                            ? ` · $${option.perVialPrice.toFixed(2)} / vial`
                            : ' per vial'}
                        </>
                      )
                    }
                  />
                );
              })}
            </div>
          )}

          {/* Quantity — a −/+ stepper clamped to the unit's stock ceiling */}
          <p className="mt-5 mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            Quantity
          </p>
          <div className="flex items-center overflow-hidden rounded-xl border border-line bg-surface">
            <button
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              disabled={qty <= 1}
              className="px-4 py-2.5 font-medium text-ink transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Decrease quantity"
            >
              −
            </button>
            <span className="flex-1 text-center font-semibold tabular-nums">{qty}</span>
            <button
              onClick={() => setQty((q) => Math.min(unitCap, q + 1))}
              disabled={qty >= unitCap}
              className="px-4 py-2.5 font-medium text-ink transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>

          {/* Subtotal + actions */}
          <div className="mt-auto border-t border-line pt-4 sm:mt-5">
            <div className="flex items-end justify-between">
              <div>
                <span className="block text-sm text-ink-muted">Subtotal</span>
                <span className="block text-[11px] tabular-nums text-ink-light">
                  ${selected.perVialPrice.toFixed(2)} × {vialsShown}{' '}
                  {vialsShown === 1 ? 'vial' : 'vials'}
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                {lineCompareAt != null && (
                  <span className="text-sm tabular-nums text-ink-light line-through">
                    ${lineCompareAt.toFixed(2)}
                  </span>
                )}
                <span className="text-xl font-bold tabular-nums text-ink">
                  ${lineTotal.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={handleAdd}
                disabled={added || unitCap < 1}
                className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-all ${
                  added
                    ? 'bg-emerald-500 text-white'
                    : 'border border-line bg-white text-ink hover:border-ink/40 disabled:cursor-not-allowed disabled:opacity-50'
                }`}
              >
                {added ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Added</span>
                  </>
                ) : (
                  <>
                    <ShoppingCart className="w-4 h-4" />
                    <span>Add to cart</span>
                  </>
                )}
              </button>
              <button
                onClick={handleBuyNow}
                disabled={added || unitCap < 1}
                className="rounded-xl bg-ink py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-ink/90 hover:shadow disabled:cursor-not-allowed disabled:opacity-50"
              >
                Buy now
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

/** One selectable pack-size card. The active card inverts to ink and carries a
 *  small check badge so the current choice reads at a glance; a discounted
 *  pack also carries its saving, which is the reason to pick it. */
function PackCard({
  active,
  disabled,
  onClick,
  label,
  sublabel,
  badge,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
  sublabel: React.ReactNode;
  badge?: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`relative rounded-xl border p-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? 'border-ink bg-ink text-white shadow-sm'
          : 'border-line bg-surface text-ink hover:border-ink/40 hover:bg-white'
      }`}
    >
      {active && (
        <span className="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full bg-white">
          <Check className="h-3 w-3 text-ink" />
        </span>
      )}
      <span className="block pr-5 text-sm font-semibold">{label}</span>
      <span className={`block text-[11px] ${active ? 'text-white/70' : 'text-ink-muted'}`}>
        {sublabel}
      </span>
      {badge && !disabled && (
        <span
          className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
            active ? 'bg-white/20 text-white' : 'bg-emerald-50 text-emerald-700'
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

export function usePurchaseModal() {
  const ctx = useContext(PurchaseModalContext);
  if (ctx === undefined) {
    throw new Error('usePurchaseModal must be used within PurchaseModalProvider');
  }
  return ctx;
}
