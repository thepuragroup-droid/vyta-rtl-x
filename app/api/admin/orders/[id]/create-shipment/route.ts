import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { autoCreateShipmentForOrder } from '@/lib/shipping/auto-shipment';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function verifyAdmin(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return false;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return false;
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  return data?.role === 'admin';
}

// POST /api/admin/orders/[id]/create-shipment — manual shipment create.
// Uses the same best-effort auto-shipment helper with force=true so the
// settings flag is bypassed. Errors are surfaced (admin needs to know).
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  // Courier picked in the admin UI before creating the shipment. Falls back to
  // the courier stored on the order (from checkout) inside the helper.
  let courierId: string | undefined;
  try {
    const body = await req.json();
    if (body?.courier_service_id) courierId = String(body.courier_service_id);
  } catch {
    /* no body — use the stored/preferred courier */
  }

  const { data: order } = await db
    .from('orders')
    .select('id, easyship_shipment_id, easyship_courier_id, fulfillment_type, shipping_address, email, total')
    .eq('id', params.id)
    .maybeSingle();
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  await autoCreateShipmentForOrder(db, order as any, true, courierId);

  const { data: refreshed } = await db
    .from('orders')
    .select('id, easyship_shipment_id, label_state, label_url, tracking_number, carrier, auto_shipment_status, auto_shipment_error')
    .eq('id', params.id)
    .single();

  return NextResponse.json({ order: refreshed });
}
