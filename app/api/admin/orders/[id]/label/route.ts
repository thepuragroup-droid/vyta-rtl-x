import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchEasyshipDocument, getShippingConfig } from '@/lib/easyship';

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
  return data?.role === 'admin' || data?.role === 'assistant' || data?.role === 'warehouse';
}

// GET /api/admin/orders/[id]/label — proxy + download the EasyShip label PDF.
// Returns the file body inline; client can save or print.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await verifyStaff(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data: order } = await db
    .from('orders')
    .select('id, label_url, label_state')
    .eq('id', params.id)
    .maybeSingle();
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (!order.label_url) {
    return NextResponse.json({ error: 'No label available' }, { status: 404 });
  }

  const cfg = await getShippingConfig(db);
  try {
    const { blob, contentType } = await fetchEasyshipDocument(order.label_url, cfg.apiKey);
    return new NextResponse(blob, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="label-${params.id}.pdf"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'label download failed' }, { status: 502 });
  }
}
