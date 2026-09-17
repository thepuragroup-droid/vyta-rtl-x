'use client';

import React from 'react';
import Link from 'next/link';
import { Clock } from 'lucide-react';
import { formatArticleDate, type ArticleSummary } from '@/lib/content/articles';

/**
 * One article card, used by the index grid and the "read next" row.
 *
 * `featured` gives the lead article a wider, image-left layout; everything else
 * is the standard portrait card.
 */
export default function ArticleCard({
  article,
  featured = false,
}: {
  article: ArticleSummary;
  featured?: boolean;
}) {
  const date = formatArticleDate(article.published_at || article.created_at);

  const meta = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-muted">
      {article.category && (
        <span className="rounded-full bg-teal-50 px-2 py-0.5 font-semibold uppercase tracking-wider text-teal-dark">
          {article.category}
        </span>
      )}
      {date && <span>{date}</span>}
      {date && <span aria-hidden>·</span>}
      <span className="inline-flex items-center gap-1">
        <Clock className="h-3 w-3" />
        {article.reading_minutes} min read
      </span>
    </div>
  );

  const cover = article.cover_image_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={article.cover_image_url}
      alt=""
      loading="lazy"
      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
    />
  ) : (
    <div className="flex h-full w-full items-center justify-center bg-brand-gradient-soft">
      <span className="font-display text-2xl font-bold text-teal-dark/30">VYTA</span>
    </div>
  );

  if (featured) {
    return (
      <Link
        href={`/articles/${article.slug}`}
        className="group grid overflow-hidden rounded-2xl border border-line bg-white shadow-card transition-shadow hover:shadow-card-hover sm:grid-cols-2"
      >
        <div className="aspect-[16/10] overflow-hidden sm:aspect-auto sm:h-full">{cover}</div>
        <div className="flex flex-col justify-center p-6 sm:p-8">
          {meta}
          <h2 className="mt-3 font-display text-xl font-bold leading-snug text-ink transition-colors group-hover:text-teal-dark sm:text-2xl">
            {article.title}
          </h2>
          {article.excerpt && (
            <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-ink-muted">
              {article.excerpt}
            </p>
          )}
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={`/articles/${article.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-card transition-shadow hover:shadow-card-hover"
    >
      <div className="aspect-[16/10] overflow-hidden">{cover}</div>
      <div className="flex flex-1 flex-col p-5">
        {meta}
        <h3 className="mt-2.5 font-display text-base font-bold leading-snug text-ink transition-colors group-hover:text-teal-dark">
          {article.title}
        </h3>
        {article.excerpt && (
          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-muted">
            {article.excerpt}
          </p>
        )}
      </div>
    </Link>
  );
}
