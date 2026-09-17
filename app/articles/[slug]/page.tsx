import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Clock } from 'lucide-react';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import BlockRenderer from '@/components/content/BlockRenderer';
import ArticleCard from '@/components/content/ArticleCard';
import { articleExcerpt, formatArticleDate } from '@/lib/content/articles';
import { getPublishedArticle, getRelatedArticles } from '@/lib/content/articles-server';

/**
 * One article.
 *
 * Beyond the usual title/description, this emits a JSON-LD `Article` object —
 * the thing that actually earns a rich result in search. It is built from the
 * same fields the page renders, so the structured data can never describe an
 * article different from the one on screen.
 */

export const revalidate = 60;

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const article = await getPublishedArticle(slug);
  if (!article) return { title: 'Article not found | VYTA' };

  const description = article.seo_description || articleExcerpt(article, 160);
  return {
    title: `${article.seo_title || article.title} | VYTA`,
    description,
    authors: article.author ? [{ name: article.author }] : undefined,
    alternates: { canonical: `/articles/${article.slug}` },
    openGraph: {
      title: article.seo_title || article.title,
      description,
      type: 'article',
      publishedTime: article.published_at ?? undefined,
      modifiedTime: article.updated_at || undefined,
      tags: article.tags,
      ...(article.cover_image_url ? { images: [article.cover_image_url] } : {}),
    },
    twitter: {
      card: article.cover_image_url ? 'summary_large_image' : 'summary',
      title: article.seo_title || article.title,
      description,
      ...(article.cover_image_url ? { images: [article.cover_image_url] } : {}),
    },
  };
}

export default async function ArticlePage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const article = await getPublishedArticle(slug);
  if (!article) notFound();

  const related = await getRelatedArticles(article, 3);
  const date = formatArticleDate(article.published_at || article.created_at);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.seo_description || articleExcerpt(article, 200),
    ...(article.cover_image_url ? { image: [article.cover_image_url] } : {}),
    ...(article.author ? { author: [{ '@type': 'Person', name: article.author }] } : {}),
    publisher: { '@type': 'Organization', name: 'VYTA Biosciences' },
    ...(article.published_at ? { datePublished: article.published_at } : {}),
    ...(article.updated_at ? { dateModified: article.updated_at } : {}),
    ...(article.tags.length > 0 ? { keywords: article.tags.join(', ') } : {}),
  };

  return (
    <main className="min-h-screen bg-white">
      <Navigation />

      {/* Structured data. Built from the rendered fields, so it can never
          describe a different article than the one on the page. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <article className="pt-32 pb-16 sm:pt-36 sm:pb-20 md:pt-44 md:pb-24">
        <div className="mx-auto max-w-3xl px-5 sm:px-8 lg:px-12">
          <Link
            href="/articles"
            className="mb-7 inline-flex items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
            All articles
          </Link>

          <header>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-ink-muted">
              {article.category && (
                <span className="rounded-full bg-teal-50 px-2.5 py-0.5 font-semibold uppercase tracking-wider text-teal-dark">
                  {article.category}
                </span>
              )}
              {date && <span>{date}</span>}
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {article.reading_minutes} min read
              </span>
              {article.author && <span>· {article.author}</span>}
            </div>

            <h1 className="mt-4 font-display text-3xl font-bold leading-tight text-ink sm:text-4xl md:text-5xl">
              {article.title}
            </h1>

            {article.excerpt && (
              <p className="mt-4 text-lg leading-relaxed text-ink-muted">{article.excerpt}</p>
            )}

            <div className="mt-7 h-px bg-brand-rule opacity-50" />
          </header>

          {article.cover_image_url && (
            <div className="mt-8 overflow-hidden rounded-2xl border border-line bg-surface lg:-mx-10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={article.cover_image_url} alt="" className="block h-auto w-full" />
            </div>
          )}

          <BlockRenderer blocks={article.blocks} className="mt-2" />

          {article.tags.length > 0 && (
            <div className="mt-12 flex flex-wrap gap-2 border-t border-line pt-6">
              {article.tags.map((tag) => (
                <Link
                  key={tag}
                  href={`/articles?tag=${encodeURIComponent(tag)}`}
                  className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-muted transition-colors hover:border-teal/40 hover:text-ink"
                >
                  {tag}
                </Link>
              ))}
            </div>
          )}
        </div>

        {related.length > 0 && (
          <aside className="mt-16 border-t border-line bg-surface/60 py-12">
            <div className="mx-auto max-w-6xl px-5 sm:px-8 lg:px-12">
              <h2 className="mb-6 font-display text-xl font-bold text-ink">Read next</h2>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {related.map((item) => (
                  <ArticleCard key={item.slug} article={item} />
                ))}
              </div>
            </div>
          </aside>
        )}
      </article>

      <Footer />
    </main>
  );
}
