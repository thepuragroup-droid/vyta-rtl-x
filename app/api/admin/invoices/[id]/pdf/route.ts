import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { renderInvoiceHtml } from '@/lib/invoice-html';
import { fetchPuramassContext, isPuramassInvoice } from '@/lib/admin/puramass-invoice';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verifyAdmin(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return false;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return false;
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  // Warehouse staff can view/print an order's invoice while fulfilling it.
  return data?.role === 'admin' || data?.role === 'assistant' || data?.role === 'warehouse';
}

// GET /api/admin/invoices/[id]/pdf
// Returns a printer-ready HTML page (shared template with the customer
// download route — see lib/invoice-html.ts).
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!await verifyAdmin(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data: invoice, error } = await db
    .from('invoices')
    .select(`*,
      customers!invoices_customer_id_fkey (first_name, last_name, email, phone, shipping_address, shipping_city, shipping_state, shipping_postal_code, shipping_country),
      sales_persons (first_name, last_name, email)
    `)
    .eq('id', params.id)
    .single();

  if (error || !invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }

  const { data: lineItems } = await db
    .from('invoice_line_items')
    .select('*')
    .eq('invoice_id', params.id);

  const { data: payments } = await db
    .from('payments')
    .select('*')
    .eq('invoice_id', params.id)
    .order('paid_at', { ascending: false });

  // For a PuraMass sale the ship-to address, buyer phone and refunds live on
  // the hand-off ledger rather than on the invoice — pull them so the printed
  // document is packable, and so it names PuraMass as their source.
  const puramass = isPuramassInvoice(invoice)
    ? await fetchPuramassContext(db, invoice.id)
    : null;

  const html = renderInvoiceHtml({
    invoice,
    lineItems: lineItems ?? [],
    payments: payments ?? [],
    autoPrint: req.nextUrl.searchParams.get('download') === '1',
    viewer: 'admin',
    puramass,
  });

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `inline; filename="invoice-${invoice.invoice_number}.html"`,
    },
  });
}
