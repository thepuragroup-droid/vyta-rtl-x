import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendOutreachEmail, verifyCrmActor } from '@/lib/admin/crm-actions';
import { resolveCustomerRef } from '@/lib/admin/customer-ref';

// nodemailer needs the node runtime.
export const runtime = 'nodejs';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * POST /api/admin/customers/[id]/email
 *
 * Send one outreach / promo email to a customer and record it. Promo codes are
 * generated on the Stealth Health platform and pasted into the composer —
 * nothing here issues or validates one.
 *
 * Body: { subject, body, templateKey?, promoCode?, promoDetails?,
 *         promoExpires?, cc?: string | string[] }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const actor = await verifyCrmActor(db, req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const ref = await resolveCustomerRef(db, params.id);
  if (!ref) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { status, body: result } = await sendOutreachEmail(db, actor, ref, body);
  return NextResponse.json(result, { status });
}
