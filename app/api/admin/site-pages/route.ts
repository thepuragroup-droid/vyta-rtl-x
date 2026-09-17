import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { logAuditServer } from '@/lib/admin/audit';
import { contentErrorMessage, requireContentEditor } from '@/lib/admin/content-auth';
import { shapeSitePage } from '@/lib/content/pages';
import { normalizeBlocks, pruneEmptyBlocks, slugify } from '@/lib/content/blocks';

const db = getSupabase();

/**
 * Editable marketing pages — list + create. About Us is seeded by the
 * migration; this is how any additional page gets made.
 *
 * Returns drafts as well as published pages: `published` is a toggle in the
 * admin UI, not a filter on what an editor can see.
 */

// GET /api/admin/site-pages — every page, alphabetical by slug.
export async function GET(req: NextRequest) {
  const actor = await requireContentEditor(db, req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { data, error } = await db
    .from('site_pages')
    .select('*')
    .order('slug', { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: contentErrorMessage(error.message, 'site_pages') },
      { status: 500 },
    );
  }
  return NextResponse.json({ pages: (data ?? []).map(shapeSitePage) });
}

// POST /api/admin/site-pages — create a page. Starts unpublished so it can be
// written and previewed before anyone can reach it.
export async function POST(req: NextRequest) {
  const actor = await requireContentEditor(db, req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const title = String(body.title ?? '').trim();
  if (!title) return NextResponse.json({ error: 'A page needs a title' }, { status: 400 });

  const slug = slugify(String(body.slug ?? '').trim() || title);
  if (!slug) {
    return NextResponse.json(
      { error: 'That title has no letters or numbers to build a URL from' },
      { status: 400 },
    );
  }

  const { data: clash } = await db.from('site_pages').select('id').eq('slug', slug).maybeSingle();
  if (clash) {
    return NextResponse.json({ error: `A page already uses /${slug}` }, { status: 409 });
  }

  const { data, error } = await db
    .from('site_pages')
    .insert({
      slug,
      title,
      subtitle: String(body.subtitle ?? '').trim() || null,
      blocks: pruneEmptyBlocks(normalizeBlocks(body.blocks)),
      published: false,
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: contentErrorMessage(error.message, 'site_pages') },
      { status: 500 },
    );
  }

  await logAuditServer(db, actor, {
    action: 'site_page.create',
    entity_type: 'site_page',
    entity_id: slug,
  });

  return NextResponse.json({ page: shapeSitePage(data) }, { status: 201 });
}
