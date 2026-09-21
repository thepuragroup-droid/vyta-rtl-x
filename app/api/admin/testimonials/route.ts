import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { logAuditServer } from '@/lib/admin/audit';
import { contentErrorMessage, requireContentEditor } from '@/lib/admin/content-auth';
import { shapeTestimonial, testimonialPatch } from '@/lib/content/testimonials';

const db = getSupabase();

/**
 * Testimonial CRUD (list + create). Editing and deleting a single row live in
 * ./[id]/route.ts.
 *
 * Unlike the public feed, this returns EVERY row including disabled ones —
 * `enabled` is a toggle in the admin UI, not a filter on what an editor can
 * see.
 */

// GET /api/admin/testimonials — every quote, in storefront order.
export async function GET(req: NextRequest) {
  const actor = await requireContentEditor(db, req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { data, error } = await db
    .from('testimonials')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: contentErrorMessage(error.message, 'testimonials') },
      { status: 500 },
    );
  }
  return NextResponse.json({ testimonials: (data ?? []).map(shapeTestimonial) });
}

// POST /api/admin/testimonials — create one. Quotes are created DISABLED
// unless the caller explicitly asks otherwise, so nothing reaches the
// storefront before it has been read back.
export async function POST(req: NextRequest) {
  const actor = await requireContentEditor(db, req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const patch = testimonialPatch(body);
  if (!patch.quote) {
    return NextResponse.json({ error: 'A testimonial needs a quote' }, { status: 400 });
  }

  const { data, error } = await db
    .from('testimonials')
    .insert({ enabled: false, ...patch })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: contentErrorMessage(error.message, 'testimonials') },
      { status: 500 },
    );
  }

  await logAuditServer(db, actor, {
    action: 'testimonial.create',
    entity_type: 'testimonial',
    entity_id: data?.id ?? null,
  });

  return NextResponse.json({ testimonial: shapeTestimonial(data) }, { status: 201 });
}
