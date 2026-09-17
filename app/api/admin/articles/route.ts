import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { logAuditServer } from '@/lib/admin/audit';
import { contentErrorMessage, requireContentEditor } from '@/lib/admin/content-auth';
import { ARTICLE_SUMMARY_COLUMNS, shapeArticleSummary } from '@/lib/content/articles';
import { slugify } from '@/lib/content/blocks';

const db = getSupabase();

/**
 * Article list + create.
 *
 * The list returns summaries (no block documents) for the same reason the
 * public index does — the admin list renders rows, not bodies — but unlike the
 * public feed it includes drafts and scheduled posts, because `status` is a
 * toggle in the UI rather than a filter on what an editor may see.
 */

// GET /api/admin/articles — every article, newest first.
export async function GET(req: NextRequest) {
  const actor = await requireContentEditor(db, req);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { data, error } = await db
    .from('articles')
    .select(ARTICLE_SUMMARY_COLUMNS)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: contentErrorMessage(error.message, 'articles') },
      { status: 500 },
    );
  }
  return NextResponse.json({ articles: (data ?? []).map(shapeArticleSummary) });
}

// POST /api/admin/articles — create a draft. Never publishes on create: an
// article is written first and switched on when it reads right.
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
  if (!title) return NextResponse.json({ error: 'An article needs a title' }, { status: 400 });

  // A slug is the article's permanent URL, so uniqueness is settled here
  // rather than letting the DB's unique index surface as a 500.
  const base = slugify(String(body.slug ?? '').trim() || title);
  if (!base) {
    return NextResponse.json(
      { error: 'That title has no letters or numbers to build a URL from' },
      { status: 400 },
    );
  }

  const { data: taken } = await db.from('articles').select('slug').like('slug', `${base}%`);
  const used = new Set((taken ?? []).map((row: any) => row.slug));
  let slug = base;
  for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;

  const { data, error } = await db
    .from('articles')
    .insert({
      slug,
      title,
      author: String(body.author ?? '').trim() || actor.actor_email,
      status: 'draft',
      blocks: [],
    })
    .select(ARTICLE_SUMMARY_COLUMNS)
    .single();

  if (error) {
    return NextResponse.json(
      { error: contentErrorMessage(error.message, 'articles') },
      { status: 500 },
    );
  }

  await logAuditServer(db, actor, {
    action: 'article.create',
    entity_type: 'article',
    entity_id: data?.id ?? slug,
  });

  return NextResponse.json({ article: shapeArticleSummary(data) }, { status: 201 });
}
