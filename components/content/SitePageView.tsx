'use client';

import React from 'react';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import BlockRenderer from '@/components/content/BlockRenderer';
import type { SitePage } from '@/lib/content/pages';

/**
 * The storefront rendering of an editable page (About Us and anything created
 * under /p/…).
 *
 * The same `BlockRenderer` runs here and in the admin preview, so a page can
 * only ever look one way. The top padding matches the rest of the storefront's
 * static pages (terms, contact), which clear the fixed navigation.
 */
export default function SitePageView({ page }: { page: SitePage }) {
  return (
    <main className="min-h-screen bg-white">
      <Navigation />

      <article className="pt-32 pb-16 sm:pt-36 sm:pb-20 md:pt-44 md:pb-28">
        <div className="mx-auto max-w-3xl px-5 sm:px-8 lg:px-12">
          <header className="mb-10">
            <h1 className="font-display text-3xl font-bold leading-tight text-ink sm:text-4xl md:text-5xl">
              {page.title}
            </h1>
            {page.subtitle && (
              <p className="mt-4 text-lg leading-relaxed text-ink-muted sm:text-xl">
                {page.subtitle}
              </p>
            )}
            <div className="mt-7 h-px bg-brand-rule opacity-50" />
          </header>

          {page.hero_image_url && (
            <div className="mb-10 overflow-hidden rounded-2xl border border-line bg-surface lg:-mx-10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={page.hero_image_url}
                alt=""
                className="block h-auto w-full"
              />
            </div>
          )}

          <BlockRenderer blocks={page.blocks} />
        </div>
      </article>

      <Footer />
    </main>
  );
}
