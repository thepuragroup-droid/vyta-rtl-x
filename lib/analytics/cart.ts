import type { CartItem } from '@/contexts/CartContext';
import type { AnalyticsItem } from './ecommerce';

/**
 * Cart line → GA4 item. The catalog UUID is the `item_id` (not the cart line
 * key), so a vial line and a case line of the same product roll up to one
 * product in GA4 and stay distinguishable through `item_variant`.
 */
export function cartItemToAnalytics(item: CartItem): AnalyticsItem {
  return {
    item_id: item.productId,
    item_name: item.name,
    item_variant: item.unit === 'case' ? 'Case' : 'Vial',
    ...(item.strength ? { item_category: item.strength } : {}),
    price: item.price,
    quantity: item.quantity,
  };
}
