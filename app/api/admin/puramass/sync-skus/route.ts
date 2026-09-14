import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { UserRole } from '@/lib/permissions';
import { logAuditServer } from '@/lib/admin/audit';
import {
  isPuramassConfigured,
  fetchPuramassCatalog,
  type PuramassCatalogProduct,
} from '@/lib/payments/puramass';
import {
  PURAMASS_CATALOG_SNAPSHOT,
  matchProductToPuramass,
  type PuramassCatalogEntry,
} from '@/lib/payments/puramass-catalog';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Only our own partner SKUs (this namespace) are mapped. Any other SKU in the
// catalog response is ignored by the sync and purged by the cleanup route.
const AMINOCAN_SKU_PREFIX = 'aminocan-';

type Mapping = 'box' | 'vial';

interface Updated { id: string; name: string; mapping: Mapping; sku: string }
interface Ambiguous { id: string; name: string; mapping: Mapping; candidates: string[] }
interface Unmatched { id: string; name: string; mapping: Mapping }

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
 * POST /api/admin/puramass/sync-skus — auto-fill `products.puramass_sku`
 * (10-pack) and `products.puramass_sku_vial` (single vial) by matching each
 * product against the PuraMass catalog. The catalog is split by SKU suffix into
 * a box set (…-10-pack / general) and a vial set (…-vial); each product is
 * matched against both. Only `exact`/`matched` results are written;
 * `ambiguous`/`unmatched` are reported per mapping for a human. Admin only.
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
  const overwrite = Boolean(body?.overwrite);
  const dryRun = Boolean(body?.dryRun);

  // Load the catalog: prefer live, fall back to the bundled snapshot.
  let catalog: PuramassCatalogEntry[] = PURAMASS_CATALOG_SNAPSHOT;
  let source: 'live' | 'snapshot' = 'snapshot';
  if (isPuramassConfigured()) {
    try {
      const live: PuramassCatalogProduct[] = await fetchPuramassCatalog();
      if (live.length > 0) {
        catalog = live.map((p) => ({ sku: p.sku, name: p.name }));
        source = 'live';
      }
    } catch (err) {
      console.error('[puramass] live catalog fetch failed, using snapshot:', err);
    }
  }

  // Only target our own partner SKUs — those prefixed `aminocan-`. Any other
  // SKU in the catalog response (general / other-partner) is left alone.
  const partnerCatalog = catalog.filter((c) =>
    c.sku.toLowerCase().startsWith(AMINOCAN_SKU_PREFIX),
  );
  // Split by SKU suffix: vial set = …-vial; box set = everything else
  // (…-10-pack and general products within the aminocan- namespace).
  const vialCatalog = partnerCatalog.filter((c) => c.sku.toLowerCase().endsWith('-vial'));
  const boxCatalog = partnerCatalog.filter((c) => !c.sku.toLowerCase().endsWith('-vial'));

  // Load products. Only ACTIVE products are considered — inactive ones are
  // excluded from matching (and from the unmatched list). Fall back to
  // box-only columns if the vial migration hasn't run.
  let products: any[] = [];
  let vialColumnAvailable = true;
  const withVial = await db
    .from('products')
    .select('id, name, strength, puramass_sku, puramass_sku_vial')
    .eq('active', true);
  if (withVial.error) {
    vialColumnAvailable = false;
    const boxOnly = await db
      .from('products')
      .select('id, name, strength, puramass_sku')
      .eq('active', true);
    if (boxOnly.error) {
      return NextResponse.json({ error: 'Could not load products.' }, { status: 500 });
    }
    products = boxOnly.data ?? [];
  } else {
    products = withVial.data ?? [];
  }

  const updated: Updated[] = [];
  const skippedAlreadySet: Updated[] = [];
  const ambiguous: Ambiguous[] = [];
  const unmatched: Unmatched[] = [];

  // Process one mapping (box or vial) for one product.
  async function processMapping(
    p: any,
    mapping: Mapping,
    column: 'puramass_sku' | 'puramass_sku_vial',
    catalogSet: PuramassCatalogEntry[],
  ) {
    if (catalogSet.length === 0) return; // nothing of this form in the catalog
    const result = matchProductToPuramass(p.name, p.strength, catalogSet);

    // Only ever write a SKU in our own namespace. A match that somehow lands on
    // a non-`aminocan-` SKU is treated as unmatched (never written).
    const matchedIsPartner =
      !!result.sku && result.sku.toLowerCase().startsWith(AMINOCAN_SKU_PREFIX);

    if ((result.status === 'exact' || result.status === 'matched') && matchedIsPartner) {
      const current = (p[column] ?? '').trim();
      if (current && !overwrite) {
        skippedAlreadySet.push({ id: p.id, name: p.name, mapping, sku: current });
        return;
      }
      if (current === result.sku) {
        skippedAlreadySet.push({ id: p.id, name: p.name, mapping, sku: current });
        return;
      }
      if (!dryRun) {
        const { error: upErr } = await db
          .from('products')
          .update({ [column]: result.sku })
          .eq('id', p.id);
        if (upErr) {
          console.error(`[puramass] failed to set ${column} for ${p.id}:`, upErr);
          return;
        }
      }
      updated.push({ id: p.id, name: p.name, mapping, sku: result.sku! });
    } else if (result.status === 'ambiguous') {
      ambiguous.push({ id: p.id, name: p.name, mapping, candidates: result.candidates.map((c) => c.sku) });
    } else {
      unmatched.push({ id: p.id, name: p.name, mapping });
    }
  }

  for (const p of products) {
    await processMapping(p, 'box', 'puramass_sku', boxCatalog);
    if (vialColumnAvailable) {
      await processMapping(p, 'vial', 'puramass_sku_vial', vialCatalog);
    }
  }

  if (!dryRun) {
    await logAuditServer(
      db,
      { actor_id: auth.actorId ?? null, actor_email: auth.actorEmail ?? null },
      { action: 'puramass.sync_skus', entity_type: 'products', entity_id: null },
    );
  }

  const countBy = (mapping: Mapping) => ({
    updated: updated.filter((u) => u.mapping === mapping).length,
    skipped_already_set: skippedAlreadySet.filter((u) => u.mapping === mapping).length,
    ambiguous: ambiguous.filter((u) => u.mapping === mapping).length,
    unmatched: unmatched.filter((u) => u.mapping === mapping).length,
  });

  return NextResponse.json({
    source,
    catalog_count: catalog.length,
    partner_catalog_count: partnerCatalog.length,
    dry_run: dryRun,
    vial_column_available: vialColumnAvailable,
    counts: {
      updated: updated.length,
      skipped_already_set: skippedAlreadySet.length,
      ambiguous: ambiguous.length,
      unmatched: unmatched.length,
    },
    by_mapping: { box: countBy('box'), vial: countBy('vial') },
    updated,
    skipped_already_set: skippedAlreadySet,
    ambiguous,
    unmatched,
  });
}
