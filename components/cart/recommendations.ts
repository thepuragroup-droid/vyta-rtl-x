'use client';

/**
 * What the cart's two suggestion blocks share: the fetch, the pack a suggested
 * product would be added in, and the add itself.
 *
 * Both blocks are drawn from one request (`/api/products/recommendations`),
 * which returns the operator's curated pairings and the computed
 * "you may also like" list together — one round trip rather than two for a
 * screen that shows them side by side.
 *
 * Prices come back already resolved through the customer pricing chain, so a
 * suggestion is quoted at the price that customer would actually pay and the
 * card, the cart line and the checkout cannot disagree.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCart, type CartItem } from '@/contexts/CartContext';
import { supabase } from '@/lib/supabase';
import {
  packOptionsFor,
  packsInStock,
  vialsPerBoxOf,
  type ResolvedPackOption,
} from '@/lib/pricing';

/** A catalog row as the recommendation endpoint returns it. */
export interface RecommendedProduct {
  id: string;
  name: string;
  description_short: string | null;
  description: string | null;
  price: number;
  vial_price: number | null;
  vials_per_box: number;
  pack_sizes: number[] | null;
  pack_options: unknown;
  stock_quantity: number;
  strength: string | null;
  image_url: string | null;
  box_image_url: string | null;
  url_slug?: string | null;
  slug: string | null;
  category: string | null;
  /** Set on curated pairings: the operator's merchandising tag, if any. */
  recommendation_badge?: string | null;
  /** Set on computed suggestions: which signal put it there. */
  recommendation_reason?: 'bought-together' | 'same-category' | 'popular';
}

/**
 * The pack a suggestion is added in, matching what the product page opens on:
 * the 3-pack where the product is sold in one and has the stock, otherwise the
 * first pack the customer could actually buy.
 *
 * Null when nothing is buyable — the card is then not offered at all, rather
 * than being offered and failing on click.
 */
export const SUGGESTED_PACK_SIZE = 3;

export function defaultPackFor(product: RecommendedProduct): ResolvedPackOption | null {
  const packs = packOptionsFor(product as any);
  const buyable = (option: ResolvedPackOption) =>
    packsInStock(Number(product.stock_quantity) || 0, option.size) >= 1;
  return (
    packs.find((option) => option.size === SUGGESTED_PACK_SIZE && buyable(option)) ??
    packs.find(buyable) ??
    null
  );
}

/** The cart line a suggestion becomes, priced at its default pack. */
export function cartLineFor(
  product: RecommendedProduct,
  pack: ResolvedPackOption,
): Omit<CartItem, 'quantity' | 'id'> {
  return {
    productId: product.id,
    unit: pack.size > 1 ? 'case' : 'vial',
    packSize: pack.size,
    vialsPerBox: vialsPerBoxOf(product.vials_per_box),
    name: product.name,
    price: pack.price,
    strength: product.strength ?? '',
    image_url: product.image_url || undefined,
    stock_quantity: packsInStock(Number(product.stock_quantity) || 0, pack.size),
  };
}

/** The storefront path for a suggestion card. */
export function productHref(product: RecommendedProduct): string {
  return `/products/${product.url_slug || product.slug || product.id}`;
}

interface RecommendationsState {
  frequentlyBoughtTogether: RecommendedProduct[];
  youMayAlsoLike: RecommendedProduct[];
  loading: boolean;
}

/**
 * The suggestions for whatever is currently in the cart.
 *
 * Re-fetched when the SET of products changes, not on every quantity tick — a
 * shopper nudging a quantity up and down would otherwise re-rank the block
 * under their cursor. In-flight requests are abandoned rather than raced, so
 * the list on screen always belongs to the cart on screen.
 */
export function useCartRecommendations(): RecommendationsState {
  const { items } = useCart();
  const [state, setState] = useState<RecommendationsState>({
    frequentlyBoughtTogether: [],
    youMayAlsoLike: [],
    loading: true,
  });

  // A stable key for "which products are in the cart", so quantity edits and
  // re-orderings of the same set do not re-trigger the fetch.
  const idKey = useMemo(
    () => [...new Set(items.map((item) => item.productId))].sort().join(','),
    [items],
  );

  const requestId = useRef(0);

  useEffect(() => {
    // An empty cart renders neither block, so there is nothing worth asking
    // for — and "suggestions for nothing" is a different question anyway.
    if (!idKey) {
      setState({ frequentlyBoughtTogether: [], youMayAlsoLike: [], loading: false });
      return;
    }
    const id = ++requestId.current;
    const controller = new AbortController();
    (async () => {
      try {
        // A signed-in customer's own prices need their token; a guest simply
        // gets catalog pricing.
        const { data: { session } } = await supabase.auth.getSession();
        const headers: Record<string, string> = session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {};
        const res = await fetch(
          `/api/products/recommendations?ids=${encodeURIComponent(idKey)}`,
          { cache: 'no-store', headers, signal: controller.signal },
        );
        if (!res.ok) throw new Error('recommendations unavailable');
        const json = await res.json();
        if (requestId.current !== id) return;
        setState({
          frequentlyBoughtTogether: json.frequentlyBoughtTogether ?? [],
          youMayAlsoLike: json.youMayAlsoLike ?? [],
          loading: false,
        });
      } catch {
        // Suggestions are a nicety: a failed fetch leaves the blocks empty and
        // the cart itself untouched.
        if (requestId.current === id) {
          setState({ frequentlyBoughtTogether: [], youMayAlsoLike: [], loading: false });
        }
      }
    })();
    return () => controller.abort();
  }, [idKey]);

  return state;
}

/** Adds a suggestion to the cart. Returns false when stock blocked it. */
export function useAddSuggestion() {
  const { addItem, flyToCart } = useCart();
  return useCallback(
    (product: RecommendedProduct, source?: HTMLElement | null): boolean => {
      const pack = defaultPackFor(product);
      if (!pack) return false;
      const added = addItem(cartLineFor(product, pack));
      if (added) flyToCart(source ?? null, { image_url: product.image_url || undefined });
      return added;
    },
    [addItem, flyToCart],
  );
}
