import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchEasyshipDocument, getShippingConfig } from '@/lib/easyship';
import { isMissingColumnError } from '@/lib/payments/puramass-columns';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function verifyStaff(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return false;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return false;
  const { data } = await db.from('customers').select('role, active').eq('id', user.id).single();
  if (data?.active === false) return false;
  // Warehouse staff print labels from the fulfillment queue.
  return data?.role === 'admin' || data?.role === 'assistant' || data?.role === 'warehouse';
}

/**
 * GET /api/admin/invoices/[id]/label — proxy the invoice's Easyship label PDF.
 *
 * The order-side twin (`/api/admin/orders/[id]/label`) only reaches a label
 * that hangs off an order. A Stealth Health hand-off has no order and carries
 * its shipment on the invoice itself, so this resolves the anchor the same way
 * buy-label does. Returned inline so the client can print or save it.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await verifyStaff(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data: invoice } = await db
    .from('invoices')
    .select('id, invoice_number, order_id')
    .eq('id', params.id)
    .maybeSingle();
  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }

  const table = invoice.order_id ? 'orders' : 'invoices';
  const rowId = invoice.order_id ?? params.id;
  const anchored = await db
    .from(table)
    .select('label_url, label_state')
    .eq('id', rowId)
    .maybeSingle();
  // An invoice-anchored shipment needs easyship-invoice-shipment-migration.sql;
  // without it there is simply no label to find.
  if (anchored.error && !isMissingColumnError(anchored.error)) {
    return NextResponse.json({ error: anchored.error.message }, { status: 500 });
  }
  const labelUrl = (anchored.data as { label_url?: string | null } | null)?.label_url;
  if (!labelUrl) {
    return NextResponse.json({ error: 'No label available' }, { status: 404 });
  }

  const cfg = await getShippingConfig(db);
  try {
    const { blob, contentType } = await fetchEasyshipDocument(labelUrl, cfg.apiKey);
    const ext = contentType.includes('png') ? 'png' : contentType.includes('jpeg') ? 'jpg' : 'pdf';
    return new NextResponse(blob, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="label-${invoice.invoice_number ?? params.id}.${ext}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'label download failed' }, { status: 502 });
  }
}
