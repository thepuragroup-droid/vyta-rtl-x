import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createEasyshipShipment } from '@/lib/easyship';
import type { EasyshipShipmentRequest } from '@/lib/types/ecommerce';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verifyAdmin(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { ok: false, userId: null as string | null };
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return { ok: false, userId: null };
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  return { ok: data?.role === 'admin', userId: user.id };
}

const ORIGIN = {
  name: process.env.EASYSHIP_ORIGIN_NAME ?? 'Aminocan Fulfillment',
  address: process.env.EASYSHIP_ORIGIN_ADDRESS ?? '',
  city: process.env.EASYSHIP_ORIGIN_CITY ?? '',
  postal_code: process.env.EASYSHIP_ORIGIN_POSTAL ?? '',
  country_alpha2: process.env.EASYSHIP_ORIGIN_COUNTRY ?? 'CA',
};

// POST /api/admin/easyship/shipments
export async function POST(req: NextRequest) {
  const { ok, userId } = await verifyAdmin(req);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { order_id, courier_id } = await req.json();

  if (!order_id || !courier_id) {
    return NextResponse.json({ error: 'order_id and courier_id are required' }, { status: 400 });
  }

  // Fetch order + items
  const { data: order, error: orderErr } = await db
    .from('orders')
    .select('*, order_items(*)')
    .eq('id', order_id)
    .single();

  if (orderErr || !order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  const dest = order.shipping_address ?? {};

  const parcels = (order.order_items ?? []).map((item: any) => ({
    description: item.name_snapshot ?? item.product_name ?? 'Product',
    quantity: item.qty ?? item.quantity ?? 1,
    actual_weight: 0.1,
    height: 5,
    width: 10,
    length: 15,
    declared_currency: 'CAD',
    declared_customs_value: item.unit_price ?? item.price_at_time ?? 0,
  }));

  const shipmentPayload: EasyshipShipmentRequest = {
    order_id,
    selected_courier_id: courier_id,
    origin: ORIGIN,
    destination: {
      firstName: dest.firstName ?? '',
      lastName: dest.lastName ?? '',
      address: dest.address ?? '',
      city: dest.city ?? '',
      state: dest.state ?? '',
      postalCode: dest.postalCode ?? '',
      country: dest.country ?? '',
      country_alpha2: dest.country ?? 'CA',
      phone: dest.phone,
    },
    parcels,
  };

  try {
    const result = await createEasyshipShipment(shipmentPayload);

    // Update order with shipment data
    await db
      .from('orders')
      .update({
        easyship_shipment_id: result.easyship_shipment_id,
        tracking_number: result.tracking_number,
        shipping_carrier: result.courier_name,
        status: 'shipped',
        shipped_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', order_id);

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Easyship shipment error:', err);
    return NextResponse.json({ error: err.message ?? 'Failed to create shipment' }, { status: 502 });
  }
}
