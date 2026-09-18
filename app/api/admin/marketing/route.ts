import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { canManageMarketing, canViewAnalytics, type UserRole } from '@/lib/permissions';
import { readSiteConfigRow, shapeSiteConfig } from '@/lib/site-config';
import { logAuditServer } from '@/lib/admin/audit';

const db = getSupabase();

// GA4 measurement id: G- followed by 4+ uppercase alphanumerics.
const GA4_REGEX = /^G-[A-Z0-9]{4,}$/;
// GTM container id: GTM- followed by 4+ uppercase alphanumerics.
const GTM_REGEX = /^GTM-[A-Z0-9]{4,}$/;

async function resolveActor(
  req: NextRequest,
): Promise<{ role: UserRole; actor_id: string | null; actor_email: string | null }> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { role: 'customer', actor_id: null, actor_email: null };
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return { role: 'customer', actor_id: null, actor_email: null };
  const { data } = await db.from('customers').select('id, email, role').eq('id', user.id).single();
  return {
    role: (data?.role ?? 'customer') as UserRole,
    actor_id: data?.id ?? user.id,
    actor_email: data?.email ?? user.email ?? null,
  };
}

// GET /api/admin/marketing — branding + tracking config. Readable by admin /
// assistant (read-only) / analytics; the values are non-secret. Writes stay
// gated by canManageMarketing.
export async function GET(req: NextRequest) {
  const { role } = await resolveActor(req);
  if (!canViewAnalytics(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  const config = await readSiteConfigRow(db);
  return NextResponse.json({ config });
}

// PUT /api/admin/marketing — update ONLY the branding/tracking columns of the
// site_settings singleton (admin / analytics). The sensitive /admin/settings
// columns (API keys, emails) are never touched here.
export async function PUT(req: NextRequest) {
  const { role, actor_id, actor_email } = await resolveActor(req);
  if (!canManageMarketing(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, any> = {};

  // Branding text/urls: trim; empty → null.
  for (const key of [
    'store_name',
    'store_tagline',
    'logo_url',
    'favicon_url',
    'hero_video_url',
    'hero_image_url',
  ] as const) {
    if (key in body) {
      const v = String(body[key] ?? '').trim();
      updates[key] = v.length > 0 ? v : null;
    }
  }

  // GTM container id: uppercase + validate shape when non-empty.
  if ('gtm_container_id' in body) {
    const raw = String(body.gtm_container_id ?? '').trim().toUpperCase();
    if (raw && !GTM_REGEX.test(raw)) {
      return NextResponse.json(
        { error: 'GTM Container ID should look like GTM-XXXXXXX' },
        { status: 400 },
      );
    }
    updates.gtm_container_id = raw.length > 0 ? raw : null;
  }

  // GA4 measurement id: uppercase + validate shape when non-empty.
  if ('ga4_measurement_id' in body) {
    const raw = String(body.ga4_measurement_id ?? '').trim().toUpperCase();
    if (raw && !GA4_REGEX.test(raw)) {
      return NextResponse.json(
        { error: 'GA4 Measurement ID should look like G-XXXXXXXXXX' },
        { status: 400 },
      );
    }
    updates.ga4_measurement_id = raw.length > 0 ? raw : null;
  }

  // Meta pixel id: numeric-ish string; empty → null.
  if ('meta_pixel_id' in body) {
    const raw = String(body.meta_pixel_id ?? '').trim();
    updates.meta_pixel_id = raw.length > 0 ? raw : null;
  }

  if ('tracking_consent_required' in body) {
    updates.tracking_consent_required = Boolean(body.tracking_consent_required);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
  }

  // Upsert the singleton: update if present, else insert a defaulted row.
  const { data: existing } = await db.from('site_settings').select('id').limit(1).maybeSingle();

  let saved: Record<string, any> | null = null;
  if (existing?.id) {
    const { data, error } = await db
      .from('site_settings')
      .update(updates)
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    saved = data as any;
  } else {
    const { data, error } = await db
      .from('site_settings')
      .insert({ checkout_type: 'crypto', ...updates })
      .select('*')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    saved = data as any;
  }

  await logAuditServer(db, { actor_id, actor_email }, {
    action: 'marketing.update',
    entity_type: 'site_settings',
    entity_id: saved?.id ?? null,
  });

  return NextResponse.json({ success: true, config: shapeSiteConfig(saved) });
}
