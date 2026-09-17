import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { logAuditServer } from '@/lib/admin/audit';
import { contentErrorMessage, requireContentEditor } from '@/lib/admin/content-auth';
import { announcementPatch, shapeAnnouncement } from '@/lib/content/announcements';

const db = getSupabase();

/**
 * Announcement bar CRUD (list + create). Editing and deleting a single row
 * live in ./[id]/route.ts.
 *
 * Unlike the public feed, this returns EVERY row including disabled and
 * scheduled ones — `enabled` is a toggle in the admin UI, not a filter on what
 * an editor can see.
 */

// GET /api/admin/announcements — every banner, newest ordering first by
// sort_order then creation.
export async function GET(req: NextRequest) {
  const actor = await requireContentEditor(db, req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { data, error } = await db
    .from('announcements')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: contentErrorMessage(error.message, 'announcements') },
      { status: 500 },
    );
  }
  return NextResponse.json({ announcements: (data ?? []).map(shapeAnnouncement) });
}

// POST /api/admin/announcements — create one. Banners are created DISABLED
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

  const patch = announcementPatch(body);
  if (!patch.message) {
    return NextResponse.json({ error: 'A banner needs a message' }, { status: 400 });
  }

  const { data, error } = await db
    .from('announcements')
    .insert({ enabled: false, ...patch })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: contentErrorMessage(error.message, 'announcements') },
      { status: 500 },
    );
  }

  await logAuditServer(db, actor, {
    action: 'announcement.create',
    entity_type: 'announcement',
    entity_id: data?.id ?? null,
  });

  return NextResponse.json({ announcement: shapeAnnouncement(data) }, { status: 201 });
}
