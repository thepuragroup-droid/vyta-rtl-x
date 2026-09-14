/**
 * Low-stock alert engine.
 *
 * For each product with a threshold:
 *   - cross below  (stock <= threshold && !low_stock_alerted)
 *       -> set low_stock_alerted = true FIRST (anti double-send),
 *          then email the admin recipient list.
 *   - recover      (stock > threshold && low_stock_alerted)
 *       -> reset low_stock_alerted = false.
 *
 * Best-effort: never throws. Called after a product edit, an invoice is
 * paid, or a PO is received.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendLowStockAlert } from '@/lib/email';

export const DEFAULT_LOW_STOCK_THRESHOLD = 10;

export interface LowStockProduct {
  id: string;
  name: string | null;
  sku: string | null;
  stock_quantity: number;
  low_stock_threshold: number;
}

/**
 * Resolve the admin alert recipient list:
 *   site_settings.admin_emails -> ADMIN_ALERT_EMAILS env -> invoice_cc_emails.
 */
async function getAdminAlertEmails(db: SupabaseClient): Promise<string[]> {
  try {
    const { data } = await db
      .from('site_settings')
      .select('admin_emails, invoice_cc_emails')
      .limit(1)
      .single();

    const fromSettings = Array.isArray(data?.admin_emails) ? (data!.admin_emails as string[]) : [];
    if (fromSettings.length > 0) return fromSettings;

    const fromEnv = (process.env.ADMIN_ALERT_EMAILS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (fromEnv.length > 0) return fromEnv;

    const fromCc = Array.isArray(data?.invoice_cc_emails) ? (data!.invoice_cc_emails as string[]) : [];
    return fromCc;
  } catch {
    return (process.env.ADMIN_ALERT_EMAILS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

export async function checkLowStockForProducts(
  db: SupabaseClient,
  productIds: string[],
): Promise<LowStockProduct[]> {
  try {
    const ids = Array.from(new Set(productIds.filter(Boolean)));
    if (ids.length === 0) return [];

    const { data, error } = await db
      .from('products')
      .select('id, name, sku, stock_quantity, low_stock_threshold, low_stock_alerted')
      .in('id', ids);

    if (error) {
      console.error('checkLowStockForProducts query failed:', error);
      return [];
    }

    const rows = (data ?? []) as (LowStockProduct & { low_stock_alerted: boolean })[];
    const crossedBelow: LowStockProduct[] = [];
    const recovered: string[] = [];

    for (const p of rows) {
      const threshold = p.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
      const isLow = (p.stock_quantity ?? 0) <= threshold;

      if (isLow && !p.low_stock_alerted) {
        crossedBelow.push({
          id: p.id,
          name: p.name,
          sku: p.sku,
          stock_quantity: p.stock_quantity,
          low_stock_threshold: threshold,
        });
      } else if (!isLow && p.low_stock_alerted) {
        recovered.push(p.id);
      }
    }

    // Recover: re-arm the flag so the next crossing alerts again.
    if (recovered.length > 0) {
      await db.from('products').update({ low_stock_alerted: false }).in('id', recovered);
    }

    if (crossedBelow.length > 0) {
      // Flip the flag FIRST so a concurrent run can't double-send.
      await db
        .from('products')
        .update({ low_stock_alerted: true })
        .in('id', crossedBelow.map((p) => p.id));

      const recipients = await getAdminAlertEmails(db);
      if (recipients.length > 0) {
        for (const p of crossedBelow) {
          try {
            await sendLowStockAlert({
              to: recipients,
              productName: p.name ?? p.id,
              sku: p.sku,
              stockQuantity: p.stock_quantity,
              threshold: p.low_stock_threshold,
            });
          } catch (err) {
            console.error('sendLowStockAlert failed for', p.id, err);
          }
        }
      }
    }

    return crossedBelow;
  } catch (err) {
    console.error('checkLowStockForProducts threw:', err);
    return [];
  }
}
