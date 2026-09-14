import { NextRequest, NextResponse } from 'next/server';
import { attributeEmailPurchase } from '@/lib/analytics/attribution-server';
import { getSupabase } from '@/lib/supabase';
import { checkPayment, REQUIRED_CONFIRMATIONS } from '@/lib/payment-monitor';
import type { CryptoChain } from '@/lib/crypto-wallets';
import { sendPaymentConfirmed, sendAdminPaymentNotification } from '@/lib/email';
import { adjustStockForConfirmedOrder } from '@/lib/order-stock';

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getSupabase();

  // Fetch both pending and received orders
  const { data: orders, error } = await db
    .from('orders')
    .select('id, order_number, email, crypto, payment_address, payment_amount_expected, payment_expires_at, total, items, status')
    .in('status', ['pending', 'received'])
    .not('payment_address', 'is', null);

  if (error || !orders) {
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
  }

  let checked = 0, received = 0, confirmed = 0, expired = 0;

  for (const order of orders) {
    // Expire check (only for pending orders)
    if (order.status === 'pending' && order.payment_expires_at && new Date(order.payment_expires_at) < new Date()) {
      await db.from('orders').update({ status: 'expired' }).eq('id', order.id);
      expired++;
      continue;
    }

    const result = await checkPayment(
      order.crypto as CryptoChain,
      order.payment_address,
      order.payment_amount_expected
    );
    checked++;

    if (result?.received) {
      if (result.confirmed) {
        // Fully confirmed — update status and send emails
        await db.from('orders').update({
          status: 'confirmed',
          payment_amount_received: result.amount,
          payment_tx_hash: result.txHash,
          payment_confirmations: result.confirmations,
          payment_confirmed_at: new Date().toISOString(),
        }).eq('id', order.id);
        confirmed++;

        // Payment confirmed → decrement product stock once and log to history.
        await adjustStockForConfirmedOrder(db, order.id);

        // Credit the channel that won this buyer (see the interactive
        // check-payment route — this is the same step on the scheduled path).
        void attributeEmailPurchase(db, order.email);

        // Send customer email
        if (order.email) {
          sendPaymentConfirmed({ to: order.email, orderNumber: order.order_number })
            .catch((err) => console.error('Confirmed email failed:', err));
        }

        // Send admin email
        const orderItems = Array.isArray(order.items) ? order.items as Array<{ name: string; quantity: number }> : [];
        sendAdminPaymentNotification({
          orderNumber: order.order_number,
          total: Number(order.total),
          crypto: order.crypto,
          paymentAmount: result.amount,
          customerEmail: order.email || undefined,
          items: orderItems,
        }).catch((err) => console.error('Admin notification failed:', err));

      } else if (order.status === 'pending') {
        // Payment detected but not enough confirmations yet
        await db.from('orders').update({
          status: 'received',
          payment_amount_received: result.amount,
          payment_tx_hash: result.txHash,
          payment_confirmations: result.confirmations,
        }).eq('id', order.id);
        received++;
      } else {
        // Already received, just update confirmation count
        await db.from('orders').update({
          payment_confirmations: result.confirmations,
        }).eq('id', order.id);
      }
    }

    await new Promise((r) => setTimeout(r, 250));
  }

  return NextResponse.json({ checked, received, confirmed, expired, total: orders.length });
}
