import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyWarehouse } from '@/lib/warehouse/server';
import { logAuditServer } from '@/lib/admin/audit';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Packing photos can capture shipping labels / customer addresses, so they must
// NOT live in a world-readable bucket. Default to a private `packing-photos`
// bucket and serve via short-lived signed URLs. (Overridable, but the override
// must also be a PRIVATE bucket.)
const BUCKET = process.env.WAREHOUSE_PHOTOS_BUCKET || 'packing-photos';
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_BYTES = 20 * 1024 * 1024;
// Signed-URL lifetime for the stored `url`. The queue read serves this value
// directly, so it is intentionally long-lived (a warehouse item may sit in the
// queue for days). Re-signing on read would be the fully robust design.
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year

interface PackedPhoto {
  url: string;
  path: string;
  uploaded_at: string;
}

function extFromContentType(type: string): string {
  if (type.includes('jpeg')) return 'jpg';
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  if (type.includes('heif')) return 'heif';
  if (type.includes('heic')) return 'heic';
  return 'bin';
}

// Ensure the private bucket exists so this works without a separate migration.
// Best-effort and idempotent — a pre-existing bucket or a racing create is fine.
let bucketReady = false;
async function ensurePrivateBucket() {
  if (bucketReady) return;
  try {
    const { data } = await db.storage.getBucket(BUCKET);
    if (!data) {
      await db.storage.createBucket(BUCKET, { public: false });
    }
  } catch {
    // If we can't create it, the upload below surfaces the real error.
  }
  bucketReady = true;
}

// POST /api/warehouse/queue/[id]/photo  (multipart 'photo')
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await verifyWarehouse(db, req);
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get('photo');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'photo file required' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'photo too large (max 20MB)' }, { status: 413 });
  }
  if (file.type && !ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: `unsupported type ${file.type}` },
      { status: 415 },
    );
  }

  await ensurePrivateBucket();

  const ext = extFromContentType(file.type || 'image/jpeg');
  const path = `packing/${params.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const buf = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await db.storage
    .from(BUCKET)
    .upload(path, buf, { contentType: file.type || 'image/jpeg', upsert: false });
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }
  // Private bucket → signed URL (not getPublicUrl) so the label/address image
  // isn't served to anyone who guesses the path.
  const { data: signed, error: signErr } = await db.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signErr || !signed?.signedUrl) {
    await db.storage.from(BUCKET).remove([path]).catch(() => {});
    return NextResponse.json(
      { error: signErr?.message ?? 'could not sign photo url' },
      { status: 500 },
    );
  }
  const url = signed.signedUrl;

  const photo: PackedPhoto = { url, path, uploaded_at: new Date().toISOString() };

  // Append to invoices.packed_photos jsonb. There is no atomic jsonb-append
  // primitive available here (no RPC), so re-read immediately before the write
  // and merge by `path` to shrink the read-modify-write window, then verify our
  // photo survived — a concurrent upload that clobbered us triggers a retry.
  // This makes simultaneous uploads safe in practice without a schema change.
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: inv } = await db
      .from('invoices')
      .select('packed_photos')
      .eq('id', params.id)
      .single();
    const existing: PackedPhoto[] = Array.isArray(inv?.packed_photos)
      ? (inv!.packed_photos as PackedPhoto[])
      : [];
    if (existing.some((p) => p.path === photo.path)) break; // already persisted
    await db
      .from('invoices')
      .update({ packed_photos: [...existing, photo] })
      .eq('id', params.id);

    const { data: check } = await db
      .from('invoices')
      .select('packed_photos')
      .eq('id', params.id)
      .single();
    const saved: PackedPhoto[] = Array.isArray(check?.packed_photos)
      ? (check!.packed_photos as PackedPhoto[])
      : [];
    if (saved.some((p) => p.path === photo.path)) break;
  }

  await logAuditServer(
    db,
    { actor_id: auth.actorId, actor_email: auth.actorEmail },
    { action: 'invoice.packed_photo_add', entity_type: 'invoice', entity_id: params.id },
  );

  return NextResponse.json({ ok: true, photo });
}

// DELETE /api/warehouse/queue/[id]/photo?path=...
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await verifyWarehouse(db, req);
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const url = new URL(req.url);
  const path = url.searchParams.get('path');
  if (!path) return NextResponse.json({ error: 'path is required' }, { status: 400 });
  if (!path.startsWith(`packing/${params.id}/`)) {
    return NextResponse.json({ error: 'path does not belong to invoice' }, { status: 400 });
  }

  await db.storage.from(BUCKET).remove([path]);

  const { data: inv } = await db
    .from('invoices')
    .select('packed_photos')
    .eq('id', params.id)
    .single();
  const existing: Array<{ url: string; path: string; uploaded_at: string }> =
    (inv?.packed_photos as any) ?? [];
  await db
    .from('invoices')
    .update({ packed_photos: existing.filter((p) => p.path !== path) })
    .eq('id', params.id);

  await logAuditServer(
    db,
    { actor_id: auth.actorId, actor_email: auth.actorEmail },
    { action: 'invoice.packed_photo_remove', entity_type: 'invoice', entity_id: params.id },
  );

  return NextResponse.json({ ok: true });
}
