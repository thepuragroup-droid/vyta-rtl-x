import type { CartItem } from '@/contexts/CartContext';
import type { AnalyticsItem } from './ecommerce';

/**
 * Cart line → GA4 item. The catalog UUID is the `item_id` (not the cart line
 * key), so every pack size of the same product rolls up to one product in GA4
 * and stays distinguishable through `item_variant` ("1-pack" / "10-pack").
 */
export function cartItemToAnalytics(item: CartItem): AnalyticsItem {
  const packSize = Number(item.packSize) > 0
    ? Number(item.packSize)
    : item.unit === 'case' ? Number(item.vialsPerBox) || 10 : 1;
  return {
    item_id: item.productId,
    item_name: item.name,
    item_variant: packSize > 1 ? `${packSize}-pack` : '1-pack',
    ...(item.strength ? { item_category: item.strength } : {}),
    price: item.price,
    quantity: item.quantity,
  };
}
