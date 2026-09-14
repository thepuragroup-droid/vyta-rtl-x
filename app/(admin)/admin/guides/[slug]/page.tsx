'use client';

import React from 'react';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { ArrowLeft, Clock } from 'lucide-react';
import { getGuide, GUIDES, GuideBody } from '../_content';

export default function GuideDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const guide = slug ? getGuide(slug) : undefined;

  if (!guide) return notFound();

  const Icon = guide.icon;
  const related = GUIDES.filter((g) => g.category === guide.category && g.slug !== guide.slug);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/admin/guides"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> All guides
      </Link>

      <div className="rounded-2xl border border-line bg-white p-6 sm:p-8">
        <div className="mb-6 flex items-start gap-4 border-b border-line pb-6">
          <div className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-xl bg-bronze/10">
            <Icon className="h-6 w-6 text-bronze" />
          </div>
          <div className="min-w-0">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bronze">
                {guide.category}
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-ink-light">
                <Clock className="h-3.5 w-3.5" /> {guide.minutes} min read
              </span>
            </div>
            <h1 className="text-2xl font-bold text-ink">{guide.title}</h1>
          </div>
        </div>

        <GuideBody blocks={guide.body} />
      </div>

      {related.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
            More in {guide.category}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {related.map((g) => {
              const RIcon = g.icon;
              return (
                <Link
                  key={g.slug}
                  href={`/admin/guides/${g.slug}`}
                  className="group flex items-center gap-3 rounded-xl border border-line bg-white p-4 transition-colors hover:border-bronze/40"
                >
                  <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg bg-bronze/10">
                    <RIcon className="h-4 w-4 text-bronze" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink group-hover:text-bronze">
                      {g.title}
                    </p>
                    <p className="truncate text-xs text-ink-muted">{g.summary}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
