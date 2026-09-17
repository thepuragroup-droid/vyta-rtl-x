import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { logAuditServer } from '@/lib/admin/audit';
import { requireContentEditor } from '@/lib/admin/content-auth';

const db = getSupabase();

/**
 * Image uploads for storefront content — page blocks, article covers and
 * in-article images.
 *
 * Files go into the EXISTING `products` storage bucket under a `content/`
 * prefix rather than a new bucket: the bucket is already created and public on
 * every deployment of this app, so content images work the moment this ships
 * with no extra Supabase setup. The prefix keeps them from mixing in with
 * product photography.
 */

const BUCKET = 'products';
const PREFIX = 'content';
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB — same ceiling as product images
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

/** Keep a recognisable, URL-safe trace of the original filename. */
function safeExtension(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return /^[a-z0-9]{2,5}$/.test(ext) ? ext : 'jpg';
}

export async function POST(request: NextRequest) {
  const actor = await requireContentEditor(db, request);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Images only — JPEG, PNG, WebP, GIF or AVIF.' },
        { status: 400 },
      );
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'That image is larger than 20MB.' }, { status: 400 });
    }

    const path = `${PREFIX}/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${safeExtension(file.name)}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { data, error } = await db.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: file.type, cacheControl: '31536000', upsert: false });

    if (error) {
      if (/bucket not found/i.test(error.message)) {
        return NextResponse.json(
          { error: `The "${BUCKET}" storage bucket doesn't exist — create it in Supabase Storage.` },
          { status: 500 },
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data: { publicUrl } } = db.storage.from(BUCKET).getPublicUrl(data.path);

    await logAuditServer(db, actor, {
      action: 'content.image_upload',
      entity_type: 'content_image',
      entity_id: data.path,
    });

    return NextResponse.json({ url: publicUrl, path: data.path });
  } catch (err) {
    console.error('Content image upload failed:', err);
    return NextResponse.json({ error: 'Could not upload that image' }, { status: 500 });
  }
}

/** Remove an uploaded content image. `path` is what POST returned. */
export async function DELETE(request: NextRequest) {
  const actor = await requireContentEditor(db, request);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const path = new URL(request.url).searchParams.get('path');
  if (!path) return NextResponse.json({ error: 'No file path provided' }, { status: 400 });
  // Confine deletes to the content prefix — this route must never be a way to
  // remove product photography.
  if (!path.startsWith(`${PREFIX}/`)) {
    return NextResponse.json({ error: 'That file is not a content image' }, { status: 400 });
  }

  const { error } = await db.storage.from(BUCKET).remove([path]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAuditServer(db, actor, {
    action: 'content.image_delete',
    entity_type: 'content_image',
    entity_id: path,
  });

  return NextResponse.json({ success: true });
}
