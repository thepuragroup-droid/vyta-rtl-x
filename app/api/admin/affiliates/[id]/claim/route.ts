import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { claimLead, releaseLead, verifyCrmActor } from '@/lib/admin/crm-actions';
import { resolveCustomerRef } from '@/lib/admin/customer-ref';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * POST /api/admin/affiliates/[id]/claim — become this affiliate's point of
 * contact, so one person owns encouraging and supporting them.
 *
 * The claim is the same record the customers desk uses (keyed by email), so
 * claiming an affiliate here shows them claimed there too — it's one human.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const actor = await verifyCrmActor(db, req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const ref = await resolveCustomerRef(db, params.id, 'affiliate');
  if (!ref) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { status, body } = await claimLead(db, actor, ref);
  return NextResponse.json(body, { status });
}

/** DELETE — release your own claim. Only the holder may release it. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const actor = await verifyCrmActor(db, req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const ref = await resolveCustomerRef(db, params.id, 'affiliate');
  if (!ref) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { status, body } = await releaseLead(db, actor, ref);
  return NextResponse.json(body, { status });
}
