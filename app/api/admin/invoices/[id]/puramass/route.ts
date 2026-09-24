import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getInvoiceCaller } from '@/lib/admin/invoice-access';
import { fetchPuramassContext, isPuramassInvoice } from '@/lib/admin/puramass-invoice';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * GET /api/admin/invoices/[id]/puramass
 *
 * The Stealth Health hand-off behind an invoice, for the invoice detail view.
 *
 * The detail page reads the invoice itself straight from Supabase under the
 * caller's RLS, but the hand-off ledger (`puramass_orders`) is service-role
 * only — the buyer's phone and shipping address never leave the server without
 * passing an admin check. Hence this small server route, alongside the tracking
 * one, rather than a client query.
 *
 * Responds `{ puramass: null }` for any invoice that isn't a Stealth Health sale, so
 * the caller can render the same way for both without special-casing a 404.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const caller = await getInvoiceCaller(db, req);
  if (!caller.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data: invoice, error } = await db
    .from('invoices')
    .select('id, source')
    .eq('id', params.id)
    .single();
  if (error || !invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }

  if (!isPuramassInvoice(invoice)) {
    return NextResponse.json({ puramass: null });
  }

  return NextResponse.json({ puramass: await fetchPuramassContext(db, invoice.id) });
}
