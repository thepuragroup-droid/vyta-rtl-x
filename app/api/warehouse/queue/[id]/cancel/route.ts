import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyWarehouse, cancelOrderForInvoice } from '@/lib/warehouse/server';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// POST /api/warehouse/queue/[id]/cancel  (cancel the linked order)
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await verifyWarehouse(db, req);
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const result = await cancelOrderForInvoice(db, auth, params.id);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
