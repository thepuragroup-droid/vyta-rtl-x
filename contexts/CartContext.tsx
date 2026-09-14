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
import { motion, AnimatePresence } from 'framer-motion';
import { Beaker } from 'lucide-react';
import {
  trackAddToCart,
  trackRemoveFromCart,
  trackViewCart,
} from '@/lib/analytics/ecommerce';
import { cartItemToAnalytics } from '@/lib/analytics/cart';

/** A product can be purchased as a single vial or as a full case (box). */
export type PurchaseUnit = 'vial' | 'case';

export interface CartItem {
  /** Line key — unique per product *and* purchase unit (`${productId}::${unit}`)
   *  so a vial line and a case line of the same product coexist. */
  id: string;
  /** Catalog product UUID (what the server prices + decrements stock against). */
  productId: string;
  /** Whether this line is priced/counted per single vial or per full case. */
  unit: PurchaseUnit;
  /** Vials in one case — used to convert a case line back to vials for stock. */
  vialsPerBox: number;
  name: string;
  price: number;
  quantity: number;
  strength: string;
  image_url?: string;
  /** Max selectable quantity in *this line's unit* (already unit-adjusted). */
  stock_quantity: number;
}

/** Deterministic line key for a product + purchase unit. */
export function cartLineId(productId: string, unit: PurchaseUnit): string {
  return `${productId}::${unit}`;
}

/** Normalize a stored/legacy cart item into the unit-aware shape. Legacy
 *  carts (pre-vial/case) stored `id` as the raw product UUID and no unit —
 *  those are treated as `case` lines, matching the box price they carried. */
function normalizeCartItem(raw: any): CartItem {
  const productId: string = raw.productId ?? raw.id;
  const unit: PurchaseUnit = raw.unit === 'vial' ? 'vial' : 'case';
  const vialsPerBox = Number(raw.vialsPerBox) > 0 ? Number(raw.vialsPerBox) : 10;
  return {
    ...raw,
    id: cartLineId(productId, unit),
    productId,
    unit,
    vialsPerBox,
    stock_quantity: raw.stock_quantity ?? Infinity,
  };
}

/** Options for the fly-to-cart animation. */
interface FlyToCartOptions {
  image_url?: string;
}

interface CartContextType {
  items: CartItem[];
  /** Adds one unit. Returns true when the item was actually added (respects
   *  the stock cap), false when the stock ceiling blocked it. The line key
   *  (`id`) is derived from `productId` + `unit`, so callers omit it. */
  addItem: (item: Omit<CartItem, 'quantity' | 'id'>) => boolean;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  totalItems: number;
  totalPrice: number;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  /** Launches a flyer from `source` (a card element or its rect) toward the
   *  visible cart icon. Safe to call rapidly — each call queues its own. */
  flyToCart: (source: HTMLElement | DOMRect | null, opts?: FlyToCartOptions) => void;
  /** Increments on every successful add — Navigation watches this to bump. */
  bumpKey: number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const STORAGE_KEY = 'northern_peptides_cart';

// Helper function to get initial cart from localStorage
function getInitialCart(): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeCartItem);
      }
    }
  } catch (error) {
    console.error('Error loading cart:', error);
  }
  return [];
}

interface Flyer {
  id: number;
  startX: number;
  startY: number;
  image_url?: string;
}

// Half the flyer tile (36px) — used to center the tile on the source/target.
const TILE_HALF = 18;

export function CartProvider({ children }: { children: React.ReactNode }) {
  // Use lazy initialization to load cart synchronously from localStorage
  const [items, setItems] = useState<CartItem[]>(getInitialCart);
  const [isOpen, setIsOpen] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [bumpKey, setBumpKey] = useState(0);
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  const flyerIdRef = useRef(0);

  // Mark as hydrated after first client-side render
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  // Save cart to localStorage whenever it changes (only after hydration)
  useEffect(() => {
    if (isHydrated) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    }
  }, [items, isHydrated]);

  // Cross-tab sync: when the cart is changed in another tab, mirror it here so
  // a second open tab never checks out with a stale cart. The `storage` event
  // only fires in *other* tabs, so this can't loop with the save effect above.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      try {
        const parsed = e.newValue ? JSON.parse(e.newValue) : [];
        if (Array.isArray(parsed)) {
          setItems(parsed.map(normalizeCartItem));
        }
      } catch {
        /* ignore malformed cross-tab payloads */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // GA4 `view_cart` each time the drawer is opened with something in it.
  useEffect(() => {
    if (!isOpen) return;
    trackViewCart(items.map(cartItemToAnalytics));
    // Only the open transition matters — re-firing on every quantity edit made
    // while the drawer is up would inflate the event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const addItem = useCallback((newItem: Omit<CartItem, 'quantity' | 'id'>): boolean => {
    const cap = newItem.stock_quantity ?? Infinity;
    const lineId = cartLineId(newItem.productId, newItem.unit);
    let added = false;
    setItems((currentItems) => {
      const existingItem = currentItems.find((item) => item.id === lineId);

      if (existingItem) {
        const newQty = existingItem.quantity + 1;
        if (newQty > cap) return currentItems;
        added = true;
        return currentItems.map((item) =>
          item.id === lineId ? { ...item, quantity: newQty } : item,
        );
      }

      if (cap < 1) return currentItems;
      added = true;
      return [...currentItems, { ...newItem, id: lineId, quantity: 1 }];
    });
    if (added) {
      setBumpKey((k) => k + 1);
      // GA4 `add_to_cart` reports the delta (one unit), not the new line total.
      trackAddToCart(cartItemToAnalytics({ ...newItem, id: lineId, quantity: 1 }));
      // Record the cart-add for signed-in customers (fire-and-forget, no-op
      // when anonymous). Imported lazily to keep this context free of a hard
      // dependency on the auth client at module load.
      import('@/lib/customer/activity')
        .then(({ trackActivity }) =>
          trackActivity({ type: 'cart', productId: newItem.productId, productName: newItem.name, quantity: 1 }),
        )
        .catch(() => {});
    }
    return added;
  }, []);

  const removeItem = (id: string) => {
    // Read the line before dropping it — GA4 wants the removed quantity/price,
    // and the state updater must stay pure.
    const removed = items.find((item) => item.id === id);
    setItems((currentItems) => currentItems.filter((item) => item.id !== id));
    if (removed) trackRemoveFromCart(cartItemToAnalytics(removed));
  };

  const updateQuantity = (id: string, quantity: number) => {
    if (quantity < 1) {
      removeItem(id);
      return;
    }

    setItems((currentItems) =>
      currentItems.map((item) => {
        if (item.id !== id) return item;
        const clamped = Math.min(quantity, item.stock_quantity);
        return { ...item, quantity: clamped };
      })
    );
  };

  const clearCart = () => {
    setItems([]);
  };

  const flyToCart = useCallback(
    (source: HTMLElement | DOMRect | null, opts?: FlyToCartOptions) => {
      if (typeof window === 'undefined') return;
      let rect: DOMRect | null = null;
      if (source instanceof HTMLElement) rect = source.getBoundingClientRect();
      else if (source) rect = source;

      const startX = rect
        ? rect.left + rect.width / 2 - TILE_HALF
        : window.innerWidth / 2 - TILE_HALF;
      const startY = rect
        ? rect.top + rect.height / 2 - TILE_HALF
        : window.innerHeight / 2 - TILE_HALF;

      const id = ++flyerIdRef.current;
      setFlyers((cur) => [...cur, { id, startX, startY, image_url: opts?.image_url }]);
    },
    [],
  );

  const removeFlyer = useCallback((id: number) => {
    setFlyers((cur) => cur.filter((f) => f.id !== id));
  }, []);

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        removeItem,
        updateQuantity,
        clearCart,
        totalItems,
        totalPrice,
        isOpen,
        setIsOpen,
        flyToCart,
        bumpKey,
      }}
    >
      {children}
      <FlyOverlay flyers={flyers} onDone={removeFlyer} />
    </CartContext.Provider>
  );
}

function FlyOverlay({
  flyers,
  onDone,
}: {
  flyers: Flyer[];
  onDone: (id: number) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[300] overflow-hidden">
      <AnimatePresence>
        {flyers.map((f) => (
          <FlyerTile key={f.id} flyer={f} onDone={onDone} />
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

function FlyerTile({ flyer, onDone }: { flyer: Flyer; onDone: (id: number) => void }) {
  // Resolve the destination once, on mount — pick whichever cart icon is
  // actually visible (the hidden one reports a zero-size rect).
  const dest = (() => {
    if (typeof document === 'undefined') return null;
    const targets = Array.from(
      document.querySelectorAll('[data-cart-target]'),
    ) as HTMLElement[];
    const visible =
      targets.find((t) => t.getBoundingClientRect().width > 0) || targets[0];
    return visible ? visible.getBoundingClientRect() : null;
  })();

  const endX = dest
    ? dest.left + dest.width / 2 - TILE_HALF
    : window.innerWidth - 44;
  const endY = dest ? dest.top + dest.height / 2 - TILE_HALF : 28;

  // Curved arc: rise up-and-over before dropping onto the cart.
  const midX = (flyer.startX + endX) / 2;
  const midY = Math.min(flyer.startY, endY) - 90;

  return (
    <motion.div
      initial={{ x: flyer.startX, y: flyer.startY, scale: 1, opacity: 1 }}
      animate={{
        x: [flyer.startX, midX, endX],
        y: [flyer.startY, midY, endY],
        scale: [1, 0.85, 0.3],
        opacity: [1, 1, 0.2],
      }}
      transition={{ duration: 0.8, ease: 'easeInOut', times: [0, 0.55, 1] }}
      onAnimationComplete={() => onDone(flyer.id)}
      className="absolute left-0 top-0 flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-line bg-white shadow-lg shadow-black/20"
    >
      {flyer.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={flyer.image_url}
          alt=""
          className="h-full w-full object-contain p-1"
        />
      ) : (
        <Beaker className="h-4 w-4 text-teal-dark" />
      )}
    </motion.div>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error('useCart must be used within CartProvider');
  }
  return context;
}
