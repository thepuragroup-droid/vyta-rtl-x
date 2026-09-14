import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyWarehouse, applyLineAction } from '@/lib/warehouse/server';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// POST /api/warehouse/queue/[id]/line
// body: { action: 'fulfill' | 'backorder', line_id, qty }
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await verifyWarehouse(db, req);
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  let body: { action?: 'fulfill' | 'backorder'; line_id?: string; qty?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (body.action !== 'fulfill' && body.action !== 'backorder') {
    return NextResponse.json({ error: 'action must be fulfill or backorder' }, { status: 400 });
  }
  if (!body.line_id) {
    return NextResponse.json({ error: 'line_id is required' }, { status: 400 });
  }
  const qty = Number(body.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json({ error: 'qty must be > 0' }, { status: 400 });
  }

  const result = await applyLineAction(
    db,
    auth,
    params.id,
    body.line_id,
    body.action,
    qty,
  );
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
