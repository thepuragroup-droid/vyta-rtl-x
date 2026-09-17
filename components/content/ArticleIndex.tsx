'use client';

import React, { useMemo, useState } from 'react';
import { Newspaper, Search } from 'lucide-react';
import ArticleCard from '@/components/content/ArticleCard';
import type { ArticleSummary } from '@/lib/content/articles';

/**
 * The article index body: search, tag chips and the card grid.
 *
 * Filtering runs on the client over the already-fetched summaries. That is
 * deliberate — a content library is small, and instant filtering beats a
 * round-trip per chip. If the library ever outgrows a few hundred posts, the
 * public /api/articles endpoint already supports `tag`/`category` server-side.
 */
export default function ArticleIndex({ articles }: { articles: ArticleSummary[] }) {
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const article of articles) {
      for (const t of article.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [articles]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return articles.filter((article) => {
      if (tag && !article.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return false;
      if (!q) return true;
      return (
        article.title.toLowerCase().includes(q) ||
        (article.excerpt ?? '').toLowerCase().includes(q) ||
        (article.category ?? '').toLowerCase().includes(q) ||
        article.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [articles, query, tag]);

  // The lead card is only earned on an unfiltered view — once someone is
  // searching, every result deserves the same weight.
  const showLead = !query && !tag && filtered.length > 2 && filtered[0].featured;
  const lead = showLead ? filtered[0] : null;
  const rest = showLead ? filtered.slice(1) : filtered;

  if (articles.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-surface p-12 text-center">
        <Newspaper className="mx-auto mb-3 h-7 w-7 text-ink-muted" />
        <p className="text-sm font-medium text-ink">No articles yet</p>
        <p className="mt-1 text-sm text-ink-muted">Check back soon — we’re writing.</p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search articles…"
            aria-label="Search articles"
            className="w-full rounded-xl border border-line bg-surface py-3 pl-11 pr-4 text-sm text-ink placeholder-ink-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-teal/40"
          />
        </div>
      </div>

      {tags.length > 0 && (
        <div className="mb-8 flex flex-wrap gap-2">
          <button
            onClick={() => setTag('')}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              tag === ''
                ? 'border-ink bg-ink text-white'
                : 'border-line bg-white text-ink-muted hover:border-teal/40 hover:text-ink'
            }`}
          >
            All
          </button>
          {tags.map(([name, count]) => (
            <button
              key={name}
              onClick={() => setTag(tag === name ? '' : name)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                tag === name
                  ? 'border-ink bg-ink text-white'
                  : 'border-line bg-white text-ink-muted hover:border-teal/40 hover:text-ink'
              }`}
            >
              {name}
              <span className="ml-1.5 opacity-60">{count}</span>
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface p-12 text-center">
          <p className="text-sm text-ink-muted">
            Nothing matches that. Try a different search or clear the filters.
          </p>
        </div>
      ) : (
        <>
          {lead && (
            <div className="mb-6">
              <ArticleCard article={lead} featured />
            </div>
          )}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((article) => (
              <ArticleCard key={article.slug} article={article} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
