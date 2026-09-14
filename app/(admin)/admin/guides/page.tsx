import React from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, Clock } from 'lucide-react';
import { GUIDES } from './_content';

export const metadata = {
  title: 'Guides & How-Tos',
};

export default function GuidesIndexPage() {
  // Group by category, preserving first-seen order.
  const categories: string[] = [];
  for (const g of GUIDES) if (!categories.includes(g.category)) categories.push(g.category);

  return (
    <>
      <div className="mb-8 flex items-start gap-3">
        <div className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-xl bg-bronze/10">
          <BookOpen className="h-5 w-5 text-bronze" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-ink">Guides &amp; How-Tos</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Short walkthroughs for the parts of the admin that trip people up.
          </p>
        </div>
      </div>

      <div className="space-y-8">
        {categories.map((category) => (
          <section key={category}>
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              {category}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {GUIDES.filter((g) => g.category === category).map((guide) => {
                const Icon = guide.icon;
                return (
                  <Link
                    key={guide.slug}
                    href={`/admin/guides/${guide.slug}`}
                    className="group flex flex-col rounded-xl border border-line bg-white p-5 transition-colors hover:border-bronze/40"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <div className="grid h-9 w-9 place-items-center rounded-lg bg-bronze/10">
                        <Icon className="h-5 w-5 text-bronze" />
                      </div>
                      <ArrowRight className="h-4 w-4 text-ink-light transition-colors group-hover:text-bronze" />
                    </div>
                    <h3 className="text-sm font-bold text-ink">{guide.title}</h3>
                    <p className="mt-1 flex-1 text-sm leading-relaxed text-ink-muted">
                      {guide.summary}
                    </p>
                    <div className="mt-4 inline-flex items-center gap-1.5 text-xs text-ink-light">
                      <Clock className="h-3.5 w-3.5" />
                      {guide.minutes} min read
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
