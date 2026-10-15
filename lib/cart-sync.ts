/**
 * Browser side of the saved cart (see app/api/cart/sync). Imported lazily by
 * CartContext, so the cart keeps no hard dependency on the auth client at load.
 */
import { supabase } from '@/lib/supabase';

export interface SyncLine {
  productId: string;
  packSize: number;
  quantity: number;
}

/** Fire-and-forget: mirror the cart's lines server-side. Never throws. */
export async function syncCart(items: SyncLine[]): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    await fetch('/api/cart/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ items }),
      keepalive: true,
    });
  } catch {
    /* bookkeeping only — never surfaces to the shopper */
  }
}
