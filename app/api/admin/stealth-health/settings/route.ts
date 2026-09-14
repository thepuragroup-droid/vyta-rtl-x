import { NextRequest, NextResponse } from 'next/server';
import { logAuditServer } from '@/lib/admin/audit';
import {
  db,
  requireReader,
  requireAdmin,
  loadTerms,
  isMissingSchema,
} from '@/lib/admin/stealth-health-server';
import { normalizeTerms, describeTerms } from '@/lib/admin/stealth-health';

export const dynamic = 'force-dynamic';

/**
 * The commercial terms with Stealth Health.
 *
 * These live in their own table rather than on `site_settings` on purpose:
 * GET /api/admin/settings is a public, unauthenticated read of checkout
 * config, and what we pay a partner is not public.
 */

// GET — admin/assistant read of the current terms.
export async function GET(req: NextRequest) {
  if (!(await requireReader(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  const { terms, migrated } = await loadTerms();
  return NextResponse.json({ terms, migrated, summary: describeTerms(terms) });
}

// PUT — admin only. Changing the terms changes what every future invoice
// claims, so it sits behind the same bar as raising one.
export async function PUT(req: NextRequest) {
  const actor = await requireAdmin(req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, any> = {};

  for (const key of ['partner_name', 'partner_email', 'partner_address', 'notes'] as const) {
    if (key in body) {
      const v = String(body[key] ?? '').trim();
      updates[key] = v || null;
    }
  }
  if ('partner_name' in updates && !updates.partner_name) {
    return NextResponse.json({ error: 'partner_name cannot be empty' }, { status: 400 });
  }
  if (updates.partner_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.partner_email)) {
    return NextResponse.json({ error: `Invalid email: ${updates.partner_email}` }, { status: 400 });
  }

  if ('commission_pct' in body) {
    const n = Number(body.commission_pct);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return NextResponse.json(
        { error: 'commission_pct must be between 0 and 100' }, { status: 400 },
      );
    }
    updates.commission_pct = n;
  }

  for (const key of ['flat_fee_cents', 'shipping_fee_cents', 'payment_terms_days'] as const) {
    if (key in body) {
      const n = Math.round(Number(body[key]));
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: `${key} must be a non-negative number` }, { status: 400 });
      }
      updates[key] = n;
    }
  }

  if ('shipping_remitted' in body) updates.shipping_remitted = Boolean(body.shipping_remitted);
  if ('currency' in body) updates.currency = body.currency === 'CAD' ? 'CAD' : 'USD';

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  // Singleton upsert, matching how site_settings is handled.
  const { data: existing, error: readErr } = await db
    .from('stealth_health_settings')
    .select('id')
    .limit(1)
    .maybeSingle();
  if (readErr && isMissingSchema(readErr)) {
    return NextResponse.json(
      { error: 'Run stealth-health-settlement-migration.sql before editing the terms.' },
      { status: 409 },
    );
  }

  const write = existing?.id
    ? db.from('stealth_health_settings').update(updates).eq('id', existing.id).select('*').single()
    : db.from('stealth_health_settings').insert(updates).select('*').single();

  const { data, error } = await write;
  if (error) {
    if (isMissingSchema(error)) {
      return NextResponse.json(
        { error: 'Run stealth-health-settlement-migration.sql before editing the terms.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAuditServer(db, { actor_id: actor.id, actor_email: actor.email }, {
    action: 'update',
    entity_type: 'stealth_health_settings',
    entity_id: data?.id ?? null,
  });

  const terms = normalizeTerms(data);
  return NextResponse.json({ terms, migrated: true, summary: describeTerms(terms) });
}
