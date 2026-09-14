import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { claimLead, releaseLead, verifyCrmActor } from '@/lib/admin/crm-actions';
import { resolveCustomerRef } from '@/lib/admin/customer-ref';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * POST /api/admin/customers/[id]/claim — claim this customer as your own
 * (you'll be their point of contact). 409 if another admin holds it.
 *
 * The claim lives in `customer_leads`, keyed by email, so a Stealth Health
 * buyer with no `customers` row can be claimed exactly like a registered one —
 * and the same claim shows on the affiliates desk when they're an affiliate.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const actor = await verifyCrmActor(db, req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const ref = await resolveCustomerRef(db, params.id);
  if (!ref) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { status, body } = await claimLead(db, actor, ref);
  return NextResponse.json(body, { status });
}

/**
 * DELETE /api/admin/customers/[id]/claim — release your own claim. Only the
 * admin who claimed the customer may release it.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const actor = await verifyCrmActor(db, req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const ref = await resolveCustomerRef(db, params.id);
  if (!ref) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { status, body } = await releaseLead(db, actor, ref);
  return NextResponse.json(body, { status });
}
