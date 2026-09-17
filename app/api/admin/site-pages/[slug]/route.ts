import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { logAuditServer } from '@/lib/admin/audit';
import { contentErrorMessage, requireContentEditor } from '@/lib/admin/content-auth';
import { isSystemPage, shapeSitePage, FALLBACK_ABOUT_PAGE } from '@/lib/content/pages';
import { normalizeBlocks, pruneEmptyBlocks } from '@/lib/content/blocks';

const db = getSupabase();

/** Read, update or delete ONE editable page. `published` is the storefront toggle. */

// GET — the page as the editor should load it, drafts included.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const actor = await requireContentEditor(db, req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { slug } = await params;
  const { data, error } = await db.from('site_pages').select('*').eq('slug', slug).maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: contentErrorMessage(error.message, 'site_pages') },
      { status: 500 },
    );
  }
  if (!data) {
    // A system page (About) that was never seeded still has to be editable —
    // hand back the starter document so the editor opens on real copy and the
    // first save creates the row.
    if (isSystemPage(slug)) {
      return NextResponse.json({ page: { ...FALLBACK_ABOUT_PAGE, slug }, missing: true });
    }
    return NextResponse.json({ error: 'Page not found' }, { status: 404 });
  }
  return NextResponse.json({ page: shapeSitePage(data) });
}

// PUT — save the whole page. Upserts on slug so the first save of a
// never-seeded system page creates it rather than 404ing.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const actor = await requireContentEditor(db, req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { slug } = await params;

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const title = String(body.title ?? '').trim();
  if (!title) return NextResponse.json({ error: 'A page needs a title' }, { status: 400 });

  const record = {
    slug,
    title,
    subtitle: String(body.subtitle ?? '').trim() || null,
    hero_image_url: String(body.hero_image_url ?? '').trim() || null,
    // Half-finished blocks are fine while writing but must never reach the
    // storefront, so empties are dropped on the way in.
    blocks: pruneEmptyBlocks(normalizeBlocks(body.blocks)),
    seo_title: String(body.seo_title ?? '').trim() || null,
    seo_description: String(body.seo_description ?? '').trim() || null,
    published: body.published === true,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db
    .from('site_pages')
    .upsert(record, { onConflict: 'slug' })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: contentErrorMessage(error.message, 'site_pages') },
      { status: 500 },
    );
  }

  await logAuditServer(db, actor, {
    action: `site_page.${record.published ? 'publish' : 'save_draft'}`,
    entity_type: 'site_page',
    entity_id: slug,
  });

  return NextResponse.json({ page: shapeSitePage(data) });
}

// DELETE — remove a page. System pages (the ones the storefront routes to
// directly) are refused: deleting /about would 404 a live URL. Unpublish it
// instead.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const actor = await requireContentEditor(db, req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { slug } = await params;
  if (isSystemPage(slug)) {
    return NextResponse.json(
      { error: `/${slug} is a built-in page — switch it off instead of deleting it.` },
      { status: 400 },
    );
  }

  const { error } = await db.from('site_pages').delete().eq('slug', slug);
  if (error) {
    return NextResponse.json(
      { error: contentErrorMessage(error.message, 'site_pages') },
      { status: 500 },
    );
  }

  await logAuditServer(db, actor, {
    action: 'site_page.delete',
    entity_type: 'site_page',
    entity_id: slug,
  });

  return NextResponse.json({ success: true });
}
