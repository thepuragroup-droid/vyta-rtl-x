import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { logAuditServer } from '@/lib/admin/audit';
import { contentErrorMessage, requireContentEditor } from '@/lib/admin/content-auth';
import { shapeTestimonial, testimonialPatch } from '@/lib/content/testimonials';

const db = getSupabase();

/** Update or delete one testimonial. `enabled` is the storefront toggle. */

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await requireContentEditor(db, req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { id } = await params;

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const patch = testimonialPatch(body);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }
  if ('quote' in patch && !patch.quote) {
    return NextResponse.json({ error: 'A testimonial needs a quote' }, { status: 400 });
  }

  const { data, error } = await db
    .from('testimonials')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: contentErrorMessage(error.message, 'testimonials') },
      { status: 500 },
    );
  }
  if (!data) return NextResponse.json({ error: 'Testimonial not found' }, { status: 404 });

  await logAuditServer(db, actor, {
    // Toggling visibility is the action worth spotting in the audit log, so it
    // gets its own verb rather than hiding inside a generic update.
    action: 'enabled' in patch
      ? `testimonial.${patch.enabled ? 'enable' : 'disable'}`
      : 'testimonial.update',
    entity_type: 'testimonial',
    entity_id: id,
  });

  return NextResponse.json({ testimonial: shapeTestimonial(data) });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await requireContentEditor(db, req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { id } = await params;
  const { error } = await db.from('testimonials').delete().eq('id', id);

  if (error) {
    return NextResponse.json(
      { error: contentErrorMessage(error.message, 'testimonials') },
      { status: 500 },
    );
  }

  await logAuditServer(db, actor, {
    action: 'testimonial.delete',
    entity_type: 'testimonial',
    entity_id: id,
  });

  return NextResponse.json({ success: true });
}
