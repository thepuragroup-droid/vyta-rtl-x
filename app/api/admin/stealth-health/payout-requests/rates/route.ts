import { NextRequest, NextResponse } from 'next/server';
import {
  db,
  requireAdmin,
  payoutErrorResponse,
  auditPayout,
} from '@/lib/admin/stealth-health-data';

export const dynamic = 'force-dynamic';

function readRate(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n >= 1) return null;
  return Math.round(n * 10000) / 10000; // numeric(6,4)
}

/**
 * PUT /api/admin/stealth-health/payout-requests/rates — save the two
 * processing-fee rates, `{catalog, custom}` as fractions (0.032 = 3.2%).
 * Every order not yet paid out follows them; paid-out orders keep their locked
 * figures. Admin only.
 */
export async function PUT(req: NextRequest) {
  const actor = await requireAdmin(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const catalog = readRate(body.catalog);
  const custom = readRate(body.custom);
  if (catalog == null || custom == null) {
    return NextResponse.json({ error: 'Each rate must be between 0% and 100%.' }, { status: 400 });
  }

  try {
    const { data: existing, error: readErr } = await db.from('site_settings').select('id').limit(1).maybeSingle();
    if (readErr) return payoutErrorResponse(readErr);
    if (!existing) return NextResponse.json({ error: 'Site settings have not been set up.' }, { status: 409 });

    const { error } = await db
      .from('site_settings')
      .update({ sh_fee_rate_catalog: catalog, sh_fee_rate_custom: custom })
      .eq('id', (existing as any).id);
    if (error) return payoutErrorResponse(error);

    await auditPayout(actor, 'stealth_health.fee_rates', 'site_settings', [String((existing as any).id)]);
    return NextResponse.json({ rates: { catalog, custom } });
  } catch (err) {
    return payoutErrorResponse(err);
  }
}
