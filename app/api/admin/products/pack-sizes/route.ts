import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { canEdit } from '@/lib/permissions';
import { logAuditServer } from '@/lib/admin/audit';
import { recordProductChanges } from '@/lib/admin/product-history';
import { formatPackSizes, normalizePackSizes, reconcilePackOptions } from '@/lib/pricing';

/**
 * Bulk pack-options editor.
 *
 * PATCH /api/admin/products/pack-sizes
 *   { product_ids: string[], pack_sizes: number[] | null }
 *
 * Setting the same pack options on a hundred products is the common case —
 * doing it one PATCH per product means a hundred round-trips and a hundred
 * history/audit passes. This writes them in ONE update, then records history
 * for the rows that actually changed.
 *
 * `pack_sizes: null` (or an empty array) clears the opt-in, putting those
 * products back on the default single-vial + full-case pair.
 *
 * Admin-only: pack options are commercial configuration, not product copy, so
 * the descriptor-editor role (analytics) cannot reach this.
 */

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable');
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** Cap one request so a runaway client can't rewrite the whole catalog blind. */
const MAX_PRODUCTS = 500;

async function resolveActor(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return { role: 'customer' as const, actor_id: null, actor_email: null };
  try {
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return { role: 'customer' as const, actor_id: null, actor_email: null };
    const { data } = await supabase
      .from('customers')
      .select('id, email, role')
      .eq('id', user.id)
      .single();
    return {
      role: (data?.role ?? 'customer') as string,
      actor_id: data?.id ?? user.id,
      actor_email: data?.email ?? user.email ?? null,
    };
  } catch {
    return { role: 'customer' as const, actor_id: null, actor_email: null };
  }
}

export async function PATCH(request: NextRequest) {
  const { role, actor_id, actor_email } = await resolveActor(request);
  if (!canEdit(role as any)) {
    return NextResponse.json({ error: 'Unauthorized - Admin role required' }, { status: 403 });
  }

  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const ids = Array.isArray(body.product_ids)
    ? [...new Set(body.product_ids.map((id: unknown) => String(id ?? '').trim()).filter(Boolean))]
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: 'Select at least one product' }, { status: 400 });
  }
  if (ids.length > MAX_PRODUCTS) {
    return NextResponse.json(
      { error: `Too many products in one request (max ${MAX_PRODUCTS})` },
      { status: 400 },
    );
  }
  if (body.pack_sizes !== null && body.pack_sizes !== undefined && !Array.isArray(body.pack_sizes)) {
    return NextResponse.json({ error: 'Pack options must be a list of numbers' }, { status: 400 });
  }

  const cleaned = normalizePackSizes(body.pack_sizes);
  const packSizes = cleaned.length > 0 ? cleaned : null;

  // Read the "before" rows so history only logs products that really moved —
  // and so each product's per-pack pricing can be carried across the edit.
  const { data: before, error: readError } = await supabase
    .from('products')
    .select('id, name, pack_sizes, pack_options')
    .in('id', ids);

  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }
  if (!before || before.length === 0) {
    return NextResponse.json({ error: 'No matching products' }, { status: 404 });
  }

  // This dialog edits which sizes a product is sold in, not their prices — but
  // the storefront reads `pack_options` FIRST, so leaving it alone would mean a
  // size removed here kept selling. Reconcile it per product: a size that
  // survives keeps the price an operator set for it, one that goes is dropped.
  // Products sharing a result are updated together, so the common case (no
  // per-pack pricing anywhere, i.e. one NULL group) stays a single round-trip.
  const groups = new Map<string, { options: unknown; ids: string[] }>();
  for (const row of before) {
    const options = packSizes ? reconcilePackOptions(row.pack_options, packSizes) : null;
    const key = JSON.stringify(options);
    const group = groups.get(key);
    if (group) group.ids.push(row.id as string);
    else groups.set(key, { options, ids: [row.id as string] });
  }

  const stamp = new Date().toISOString();
  const updatedRows: Array<Record<string, unknown>> = [];
  for (const { options, ids: groupIds } of groups.values()) {
    const { data, error } = await supabase
      .from('products')
      .update({ pack_sizes: packSizes, pack_options: options, updated_at: stamp })
      .in('id', groupIds)
      .select();

    if (error) {
      // The most likely cause is a column not existing yet — say so plainly
      // rather than surfacing a raw Postgres error to the operator.
      const message = /pack_sizes/.test(error.message)
        ? 'Pack options column is missing — run pack-options-content-migration.sql.'
        : /pack_options/.test(error.message)
          ? 'Pack pricing column is missing — run pack-option-pricing-migration.sql.'
          : error.message;
      return NextResponse.json({ error: message }, { status: 500 });
    }
    updatedRows.push(...(data ?? []));
  }
  const updated = updatedRows;

  const beforeById = new Map(before.map((row) => [row.id as string, row]));
  // Either column moving counts: a product can keep its sizes and still have
  // its per-pack pricing pruned by the reconcile above.
  const changed = (updated ?? []).filter((row) => {
    const prev = beforeById.get(row.id as string);
    return (
      JSON.stringify(prev?.pack_sizes ?? null) !== JSON.stringify(row.pack_sizes ?? null) ||
      JSON.stringify(prev?.pack_options ?? null) !== JSON.stringify(row.pack_options ?? null)
    );
  });

  // History per changed row, mirroring what a single-product PATCH records.
  await Promise.all(
    changed.map((row) =>
      recordProductChanges(
        supabase,
        { actor_id, actor_email },
        row.id as string,
        beforeById.get(row.id as string) ?? {},
        row as Record<string, unknown>,
        { source: 'bulk_pack_options' },
      ),
    ),
  );

  await logAuditServer(supabase, { actor_id, actor_email }, {
    action: 'product.pack_options_bulk',
    entity_type: 'product',
    // The audit row carries no metadata column, so the detail that matters —
    // which options were applied to how many products — goes in the action.
    entity_id: `${changed.length} product(s) → ${packSizes ? formatPackSizes(packSizes) : 'default'}`,
  });

  return NextResponse.json({
    success: true,
    updated: changed.length,
    products: updated ?? [],
  });
}
