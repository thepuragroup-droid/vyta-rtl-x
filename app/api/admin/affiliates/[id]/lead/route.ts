import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { patchLead, verifyCrmActor } from '@/lib/admin/crm-actions';
import { resolveCustomerRef } from '@/lib/admin/customer-ref';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * PATCH /api/admin/affiliates/[id]/lead
 *
 * How this affiliate relationship is doing: status, how they're being
 * contacted, working notes, and when to follow up next.
 *
 * Body: { status?, contact_method?, notes?, last_contacted_at?, next_follow_up_at? }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const actor = await verifyCrmActor(db, req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const ref = await resolveCustomerRef(db, params.id, 'affiliate');
  if (!ref) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { status, body: result } = await patchLead(db, actor, ref, body);
  return NextResponse.json(result, { status });
}
