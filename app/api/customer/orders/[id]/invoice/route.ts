import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { renderInvoiceHtml } from '@/lib/invoice-html';
import { createInvoiceForOrder } from '@/lib/admin/order-invoice-server';

// Service-role client: invoices are RLS-locked, so the ownership check below
// is the only thing standing between a token and an invoice — keep it strict.
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/customer/orders/[id]/invoice
 *
 * Returns the printer-ready invoice for one of the signed-in customer's own
 * orders — the same document the admin invoice PDF route renders. The
 * customer is identified from their Supabase access token (Bearer) and must
 * own the order. `?download=1` appends the auto-print script.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  // Ownership check — the order must belong to the requesting customer.
  const { data: order } = await db
    .from('orders')
    .select('id, customer_id')
    .eq('id', params.id)
    .maybeSingle();
  if (!order || order.customer_id !== user.id) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  // Every order gets an invoice at placement; createInvoiceForOrder is
  // idempotent, so calling it here also backfills older orders on demand.
  let { data: invoice } = await db
    .from('invoices')
    .select(`*,
      customers!invoices_customer_id_fkey (first_name, last_name, email, phone, shipping_address, shipping_city, shipping_state, shipping_postal_code, shipping_country),
      sales_persons (first_name, last_name, email)
    `)
    .eq('order_id', order.id)
    .maybeSingle();

  if (!invoice) {
    const created = await createInvoiceForOrder(db, order.id);
    if (!created.ok || !created.invoice_id) {
      return NextResponse.json(
        { error: 'No invoice is available for this order yet.' },
        { status: 404 },
      );
    }
    const { data: fresh } = await db
      .from('invoices')
      .select(`*,
        customers!invoices_customer_id_fkey (first_name, last_name, email, phone, shipping_address, shipping_city, shipping_state, shipping_postal_code, shipping_country),
        sales_persons (first_name, last_name, email)
      `)
      .eq('id', created.invoice_id)
      .maybeSingle();
    invoice = fresh;
  }

  if (!invoice) {
    return NextResponse.json(
      { error: 'No invoice is available for this order yet.' },
      { status: 404 },
    );
  }

  const { data: lineItems } = await db
    .from('invoice_line_items')
    .select('*')
    .eq('invoice_id', invoice.id);

  const { data: payments } = await db
    .from('payments')
    .select('*')
    .eq('invoice_id', invoice.id)
    .order('paid_at', { ascending: false });

  const html = renderInvoiceHtml({
    invoice,
    lineItems: lineItems ?? [],
    payments: payments ?? [],
    autoPrint: req.nextUrl.searchParams.get('download') === '1',
    viewer: 'customer',
  });

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `inline; filename="invoice-${invoice.invoice_number}.html"`,
    },
  });
}
