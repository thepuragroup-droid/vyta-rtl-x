import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import {
  ARTICLE_SUMMARY_COLUMNS,
  isArticleLive,
  shapeArticleSummary,
  sortArticles,
} from '@/lib/content/articles';

const db = getSupabase();

/**
 * GET /api/articles — the published article index.
 *
 * Summaries only (no block documents): the index renders cards, and shipping
 * every article's full body to build a list of titles would be the single
 * heaviest request on the storefront.
 *
 * Query params: `tag`, `category`, `limit`. Drafts and future-dated articles
 * are filtered server-side, so a scheduled post is never readable early.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tag = searchParams.get('tag')?.trim() ?? '';
  const category = searchParams.get('category')?.trim() ?? '';
  const limitParam = Number(searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(100, limitParam) : 50;

  try {
    let query = db
      .from('articles')
      .select(ARTICLE_SUMMARY_COLUMNS)
      .eq('status', 'published')
      .limit(limit);

    if (category) query = query.eq('category', category);
    if (tag) query = query.contains('tags', [tag]);

    const { data, error } = await query;
    if (error) return NextResponse.json({ articles: [] });

    const rows = (data ?? []).map(shapeArticleSummary).filter((a) => isArticleLive(a));
    return NextResponse.json({ articles: sortArticles(rows) });
  } catch {
    return NextResponse.json({ articles: [] });
  }
}
