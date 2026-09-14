import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyWarehouse } from '@/lib/warehouse/server';
import { logAuditServer } from '@/lib/admin/audit';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// PATCH /api/warehouse/queue/[id]/checklist
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await verifyWarehouse(db, req);
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  let body: { handling_checklist?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const list = body.handling_checklist;
  if (!Array.isArray(list) || list.some((k) => typeof k !== 'string')) {
    return NextResponse.json(
      { error: 'handling_checklist must be string[]' },
      { status: 400 },
    );
  }

  const { error } = await db
    .from('invoices')
    .update({ handling_checklist: list })
    .eq('id', params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAuditServer(
    db,
    { actor_id: auth.actorId, actor_email: auth.actorEmail },
    { action: 'invoice.handling_checklist_update', entity_type: 'invoice', entity_id: params.id },
  );

  return NextResponse.json({ ok: true, handling_checklist: list });
}
