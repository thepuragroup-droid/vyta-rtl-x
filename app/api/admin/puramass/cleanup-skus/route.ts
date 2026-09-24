import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { UserRole } from '@/lib/permissions';
import { logAuditServer } from '@/lib/admin/audit';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Mappings must live in our own partner namespace; anything else is stale.
const VYTA_SKU_PREFIX = 'vyta-';
const isPartnerSku = (s: string | null | undefined) =>
  (s ?? '').trim().toLowerCase().startsWith(VYTA_SKU_PREFIX);

async function verifyAdmin(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { ok: false as const };
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return { ok: false as const };
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  const role = (data?.role ?? 'customer') as UserRole;
  return { ok: role === 'admin', role, actorId: user.id, actorEmail: user.email ?? null };
}

/**
 * POST /api/admin/puramass/cleanup-skus — clear any product PuraMass mapping
 * (`puramass_sku` / `puramass_sku_vial`) whose value is NOT prefixed
 * `vyta-` (e.g. stale placeholder SKUs). Clears per column and reports how
 * many values/products were affected. Admin only. `{ dryRun?: boolean }`.
 */
export async function POST(req: NextRequest) {
  const auth = await verifyAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const dryRun = Boolean(body?.dryRun);

  // Load products that currently carry a mapping. Fall back to box-only when the
  // vial column hasn't been migrated.
  let rows: any[] = [];
  let vialColumnAvailable = true;
  const withVial = await db
    .from('products')
    .select('id, name, puramass_sku, puramass_sku_vial')
    .or('puramass_sku.not.is.null,puramass_sku_vial.not.is.null');
  if (withVial.error) {
    vialColumnAvailable = false;
    const boxOnly = await db
      .from('products')
      .select('id, name, puramass_sku')
      .not('puramass_sku', 'is', null);
    if (boxOnly.error) {
      return NextResponse.json({ error: 'Could not load products.' }, { status: 500 });
    }
    rows = boxOnly.data ?? [];
  } else {
    rows = withVial.data ?? [];
  }

  const cleared: { id: string; name: string }[] = [];
  let clearedBox = 0;
  let clearedVial = 0;

  for (const p of rows) {
    const update: Record<string, null> = {};
    const boxVal = (p.puramass_sku ?? '').trim();
    const vialVal = (p.puramass_sku_vial ?? '').trim();
    if (boxVal && !isPartnerSku(boxVal)) update.puramass_sku = null;
    if (vialColumnAvailable && vialVal && !isPartnerSku(vialVal)) update.puramass_sku_vial = null;
    if (Object.keys(update).length === 0) continue;

    if (!dryRun) {
      const { error } = await db.from('products').update(update).eq('id', p.id);
      if (error) {
        console.error(`[puramass] cleanup failed for ${p.id}:`, error);
        continue;
      }
    }
    if ('puramass_sku' in update) clearedBox += 1;
    if ('puramass_sku_vial' in update) clearedVial += 1;
    cleared.push({ id: p.id, name: p.name });
  }

  if (!dryRun && cleared.length > 0) {
    await logAuditServer(
      db,
      { actor_id: auth.actorId ?? null, actor_email: auth.actorEmail ?? null },
      { action: 'puramass.cleanup_skus', entity_type: 'products', entity_id: null },
    );
  }

  return NextResponse.json({
    dry_run: dryRun,
    vial_column_available: vialColumnAvailable,
    cleared_products: cleared.length,
    cleared_box: clearedBox,
    cleared_vial: clearedVial,
    cleared_values: clearedBox + clearedVial,
    products: cleared.map((c) => c.name),
  });
}
