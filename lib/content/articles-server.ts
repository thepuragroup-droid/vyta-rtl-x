import { cache } from 'react';
import { getSupabase } from '@/lib/supabase';
import {
  ARTICLE_SUMMARY_COLUMNS,
  isArticleLive,
  shapeArticle,
  shapeArticleSummary,
  sortArticles,
  type Article,
  type ArticleSummary,
} from '@/lib/content/articles';

/**
 * Server-side article reads for the storefront, deduped per request (the same
 * `cache` pattern the branding config and editable pages use, so
 * `generateMetadata` and the page body share one round-trip).
 *
 * Every function is non-throwing: a missing table (migration not run) resolves
 * to an empty index or a 404, never a broken route.
 */

/** Published articles for the index, newest first with featured promoted. */
export const getPublishedArticles = cache(async (): Promise<ArticleSummary[]> => {
  try {
    const { data, error } = await getSupabase()
      .from('articles')
      .select(ARTICLE_SUMMARY_COLUMNS)
      .eq('status', 'published')
      .limit(200);
    if (error || !data) return [];
    return sortArticles(data.map(shapeArticleSummary).filter((a) => isArticleLive(a)));
  } catch {
    return [];
  }
});

/** One published article by slug, or null when it is missing or still a draft. */
export const getPublishedArticle = cache(async (slug: string): Promise<Article | null> => {
  try {
    const { data, error } = await getSupabase()
      .from('articles')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'published')
      .maybeSingle();
    if (error || !data) return null;
    const article = shapeArticle(data);
    // A future `published_at` is a scheduled post: published in the admin
    // panel, not yet public.
    return isArticleLive(article) ? article : null;
  } catch {
    return null;
  }
});

/**
 * Up to `limit` other published articles to read next. Prefers ones sharing a
 * category or a tag with `article`, then falls back to the newest, so a small
 * catalog still fills the row.
 */
export const getRelatedArticles = cache(
  async (article: Article, limit = 3): Promise<ArticleSummary[]> => {
    const all = (await getPublishedArticles()).filter((a) => a.slug !== article.slug);
    const tags = new Set(article.tags.map((t) => t.toLowerCase()));
    const related = all.filter(
      (a) =>
        (article.category && a.category === article.category) ||
        a.tags.some((t) => tags.has(t.toLowerCase())),
    );
    const rest = all.filter((a) => !related.includes(a));
    return [...related, ...rest].slice(0, limit);
  },
);
