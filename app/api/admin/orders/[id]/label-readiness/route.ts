import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { diagnoseShipping } from '@/lib/easyship';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function verifyStaff(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return false;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return false;
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  return data?.role === 'admin' || data?.role === 'assistant';
}

// GET /api/admin/orders/[id]/label-readiness — pre-flight checklist
// for the admin label panel. Returns per-field flags so the UI can show
// what's missing before attempting to create a shipment or buy a label.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await verifyStaff(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data: order } = await db
    .from('orders')
    .select('id, fulfillment_type, shipping_address, easyship_shipment_id, label_state, tracking_number')
    .eq('id', params.id)
    .maybeSingle();
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  const dest = order.shipping_address as any;
  const diag = await diagnoseShipping();

  const checks = {
    is_shipment: order.fulfillment_type !== 'pickup',
    has_address: !!(dest?.address && dest?.city),
    has_postal: !!dest?.postalCode,
    has_country: !!dest?.country,
    has_phone: !!dest?.phone,
    easyship_configured: diag.ok,
    has_shipment: !!order.easyship_shipment_id,
    has_label: order.label_state === 'generated',
    has_tracking: !!order.tracking_number,
  };

  const blockers: string[] = [];
  if (!checks.is_shipment) blockers.push('Pickup orders do not need a label');
  if (!checks.has_address) blockers.push('Address missing');
  if (!checks.has_postal) blockers.push('Postal code missing');
  if (!checks.has_country) blockers.push('Country missing');
  if (!checks.easyship_configured) blockers.push(...diag.errors);

  return NextResponse.json({
    order_id: params.id,
    fulfillment_type: order.fulfillment_type,
    checks,
    blockers,
    can_create_shipment:
      checks.is_shipment &&
      checks.has_address &&
      checks.has_postal &&
      checks.has_country &&
      checks.easyship_configured &&
      !checks.has_shipment,
    can_buy_label:
      checks.is_shipment &&
      checks.easyship_configured &&
      checks.has_shipment &&
      !checks.has_label,
  });
}
