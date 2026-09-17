import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { logAuditServer } from '@/lib/admin/audit';
import { contentErrorMessage, requireContentEditor } from '@/lib/admin/content-auth';
import { normalizeTags, shapeArticle } from '@/lib/content/articles';
import {
  normalizeBlocks, pruneEmptyBlocks, readingMinutes, slugify,
} from '@/lib/content/blocks';

const db = getSupabase();

/** Read, update or delete ONE article. `status` is the storefront toggle. */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await requireContentEditor(db, req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { id } = await params;
  const { data, error } = await db.from('articles').select('*').eq('id', id).maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: contentErrorMessage(error.message, 'articles') },
      { status: 500 },
    );
  }
  if (!data) return NextResponse.json({ error: 'Article not found' }, { status: 404 });
  return NextResponse.json({ article: shapeArticle(data) });
}

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

  const { data: existing } = await db
    .from('articles')
    .select('id, slug, status, published_at')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Article not found' }, { status: 404 });

  const patch: Record<string, any> = { updated_at: new Date().toISOString() };

  if ('title' in body) {
    const title = String(body.title ?? '').trim();
    if (!title) return NextResponse.json({ error: 'An article needs a title' }, { status: 400 });
    patch.title = title;
  }

  if ('slug' in body) {
    const slug = slugify(String(body.slug ?? '').trim());
    if (!slug) return NextResponse.json({ error: 'The URL can’t be empty' }, { status: 400 });
    if (slug !== existing.slug) {
      const { data: clash } = await db
        .from('articles')
        .select('id')
        .eq('slug', slug)
        .neq('id', id)
        .maybeSingle();
      if (clash) {
        return NextResponse.json({ error: `Another article already uses /${slug}` }, { status: 409 });
      }
    }
    patch.slug = slug;
  }

  for (const key of ['excerpt', 'cover_image_url', 'author', 'category', 'seo_title', 'seo_description'] as const) {
    if (key in body) {
      const value = String(body[key] ?? '').trim();
      patch[key] = value.length > 0 ? value : null;
    }
  }

  if ('tags' in body) patch.tags = normalizeTags(body.tags);
  if ('featured' in body) patch.featured = Boolean(body.featured);

  if ('blocks' in body) {
    // Half-finished blocks are fine while writing but must never reach the
    // storefront, so empties are dropped on the way in. Reading time is derived
    // from the saved document rather than trusted from the client.
    const blocks = pruneEmptyBlocks(normalizeBlocks(body.blocks));
    patch.blocks = blocks;
    patch.reading_minutes = readingMinutes(blocks);
  }

  if ('status' in body) {
    const status = body.status === 'published' ? 'published' : 'draft';
    patch.status = status;
    // Stamp the publish date the first time it goes live, and keep that date
    // through later edits so an article doesn't jump to the top of the index
    // every time a typo is fixed.
    if (status === 'published' && !existing.published_at) {
      patch.published_at = new Date().toISOString();
    }
  }
  // An explicit date always wins — that is how backdating and scheduling work.
  if ('published_at' in body) {
    const value = String(body.published_at ?? '').trim();
    patch.published_at = value ? new Date(value).toISOString() : null;
  }

  const { data, error } = await db
    .from('articles')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: contentErrorMessage(error.message, 'articles') },
      { status: 500 },
    );
  }

  await logAuditServer(db, actor, {
    action:
      'status' in patch
        ? `article.${patch.status === 'published' ? 'publish' : 'unpublish'}`
        : 'article.update',
    entity_type: 'article',
    entity_id: id,
  });

  return NextResponse.json({ article: shapeArticle(data) });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await requireContentEditor(db, req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { id } = await params;
  const { error } = await db.from('articles').delete().eq('id', id);

  if (error) {
    return NextResponse.json(
      { error: contentErrorMessage(error.message, 'articles') },
      { status: 500 },
    );
  }

  await logAuditServer(db, actor, {
    action: 'article.delete',
    entity_type: 'article',
    entity_id: id,
  });

  return NextResponse.json({ success: true });
}
