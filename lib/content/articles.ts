/**
 * Articles — the SEO content surface (`articles`).
 *
 * Same block document as site_pages, plus the metadata an index page and a
 * search engine need: excerpt, cover image, author, category, tags, reading
 * time and the SEO title/description overrides.
 *
 * `status` IS the storefront toggle: only 'published' rows are served publicly,
 * and only once `published_at` has passed. A draft stays fully editable and
 * previewable in the admin panel.
 */

import {
  excerptFromBlocks,
  normalizeBlocks,
  readingMinutes,
  type ContentBlock,
} from '@/lib/content/blocks';

export type ArticleStatus = 'draft' | 'published';

export interface Article {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_image_url: string | null;
  author: string | null;
  category: string | null;
  tags: string[];
  blocks: ContentBlock[];
  status: ArticleStatus;
  featured: boolean;
  reading_minutes: number;
  seo_title: string | null;
  seo_description: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/** List rows don't carry the block document — the index never renders bodies. */
export type ArticleSummary = Omit<Article, 'blocks'>;

function cleanString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeTags(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',')
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of list) {
    const tag = String(entry ?? '').trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 12) break;
  }
  return out;
}

export function shapeArticle(row: Record<string, any>): Article {
  const blocks = normalizeBlocks(row.blocks);
  const minutes = Number(row.reading_minutes);
  return {
    id: String(row.id),
    slug: String(row.slug ?? ''),
    title: String(row.title ?? ''),
    excerpt: cleanString(row.excerpt),
    cover_image_url: cleanString(row.cover_image_url),
    author: cleanString(row.author),
    category: cleanString(row.category),
    tags: normalizeTags(row.tags),
    blocks,
    status: row.status === 'published' ? 'published' : 'draft',
    featured: row.featured === true,
    reading_minutes:
      Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : readingMinutes(blocks),
    seo_title: cleanString(row.seo_title),
    seo_description: cleanString(row.seo_description),
    published_at: cleanString(row.published_at),
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

/** Summary shape for list endpoints — same normalisation, minus the body. */
export function shapeArticleSummary(row: Record<string, any>): ArticleSummary {
  const { blocks: _blocks, ...summary } = shapeArticle(row);
  return summary;
}

/** Columns a list query selects — everything except the (large) block document. */
export const ARTICLE_SUMMARY_COLUMNS =
  'id, slug, title, excerpt, cover_image_url, author, category, tags, status, featured, reading_minutes, seo_title, seo_description, published_at, created_at, updated_at';

/** Is this article visible to the public right now? */
export function isArticleLive(
  article: Pick<Article, 'status' | 'published_at'>,
  now: Date = new Date(),
): boolean {
  if (article.status !== 'published') return false;
  if (!article.published_at) return true; // published with no stamp = live now
  return new Date(article.published_at).getTime() <= now.getTime();
}

/** The blurb shown on cards and in meta tags — explicit excerpt, else derived. */
export function articleExcerpt(article: Article, max = 180): string {
  return article.excerpt?.trim() || excerptFromBlocks(article.blocks, max);
}

/** Newest first, with featured articles promoted to the top. */
export function sortArticles<T extends Pick<ArticleSummary, 'featured' | 'published_at' | 'created_at'>>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    const aDate = a.published_at || a.created_at;
    const bDate = b.published_at || b.created_at;
    return bDate.localeCompare(aDate);
  });
}

/** "12 September 2026" — one date format across the index, cards and detail. */
export function formatArticleDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}
