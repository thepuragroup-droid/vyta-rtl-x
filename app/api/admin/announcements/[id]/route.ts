import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { logAuditServer } from '@/lib/admin/audit';
import { contentErrorMessage, requireContentEditor } from '@/lib/admin/content-auth';
import { announcementPatch, shapeAnnouncement } from '@/lib/content/announcements';

const db = getSupabase();

/** Update or delete one announcement. `enabled` is the storefront toggle. */

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

  const patch = announcementPatch(body);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }
  // A banner with no message would render as an empty bar on every page.
  if ('message' in patch && !patch.message) {
    return NextResponse.json({ error: 'A banner needs a message' }, { status: 400 });
  }

  const { data, error } = await db
    .from('announcements')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: contentErrorMessage(error.message, 'announcements') },
      { status: 500 },
    );
  }
  if (!data) return NextResponse.json({ error: 'Announcement not found' }, { status: 404 });

  await logAuditServer(db, actor, {
    // Toggling visibility is the action worth spotting in the audit log, so it
    // gets its own verb rather than hiding inside a generic update.
    action: 'enabled' in patch ? `announcement.${patch.enabled ? 'enable' : 'disable'}` : 'announcement.update',
    entity_type: 'announcement',
    entity_id: id,
  });

  return NextResponse.json({ announcement: shapeAnnouncement(data) });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await requireContentEditor(db, req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { id } = await params;
  const { error } = await db.from('announcements').delete().eq('id', id);

  if (error) {
    return NextResponse.json(
      { error: contentErrorMessage(error.message, 'announcements') },
      { status: 500 },
    );
  }

  await logAuditServer(db, actor, {
    action: 'announcement.delete',
    entity_type: 'announcement',
    entity_id: id,
  });

  return NextResponse.json({ success: true });
}
