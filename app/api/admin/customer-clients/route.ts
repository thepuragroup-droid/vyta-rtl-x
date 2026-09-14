import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getInvoiceCaller, callerCanWrite } from '@/lib/admin/invoice-access';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * GET /api/admin/customer-clients?customer_id=<uuid>
 *
 * Returns the address book of drop-ship recipients ("clients") for a given
 * customer. Powers the InvoiceForm's Ships-to-Client picker so an admin can
 * reuse a saved client instead of re-typing the address every time.
 *
 * Any authenticated invoice caller (admin / assistant / affiliate) can read
 * — the underlying data is treated as staff-scoped, and affiliate scoping
 * is enforced by the customer picker itself (they can only pick their own
 * customers).
 */
export async function GET(req: NextRequest) {
  const caller = await getInvoiceCaller(db, req);
  if (!caller.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  const customerId = req.nextUrl.searchParams.get('customer_id');
  if (!customerId) {
    return NextResponse.json({ error: 'customer_id is required' }, { status: 400 });
  }
  const { data, error } = await db
    .from('customer_clients')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ clients: data ?? [] });
}

/**
 * POST /api/admin/customer-clients
 *
 * Create a new drop-ship client under a customer's address book. Admin-only
 * writes for now; the invoice creation flow uses this to save a fresh
 * client on the fly when Ships-to-Client is toggled with a new address.
 *
 * Body: { customer_id, first_name?, last_name?, address, city?, state?,
 *         postal_code?, country?, phone?, email? }
 */
export async function POST(req: NextRequest) {
  const caller = await getInvoiceCaller(db, req);
  if (!caller.ok || !callerCanWrite(caller.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.customer_id || typeof body.customer_id !== 'string') {
    return NextResponse.json({ error: 'customer_id is required' }, { status: 400 });
  }
  if (!body.address || typeof body.address !== 'string' || !body.address.trim()) {
    return NextResponse.json(
      { error: 'address is required (a client with no address cannot be used as a ship-to)' },
      { status: 400 },
    );
  }
  const insert = {
    customer_id: body.customer_id,
    first_name: body.first_name?.trim() || null,
    last_name: body.last_name?.trim() || null,
    address: body.address.trim(),
    city: body.city?.trim() || null,
    state: body.state?.trim() || null,
    postal_code: body.postal_code?.trim() || null,
    country: body.country?.trim() || 'CA',
    phone: body.phone?.trim() || null,
    email: body.email?.trim() || null,
  };
  const { data, error } = await db
    .from('customer_clients')
    .insert(insert)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ client: data }, { status: 201 });
}
