import type { Metadata } from 'next';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import ArticleIndex from '@/components/content/ArticleIndex';
import { getPublishedArticles } from '@/lib/content/articles-server';

/**
 * The article index — the SEO surface. Articles are written in
 * Admin → Content → Articles and appear here the moment they're published.
 */

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Articles | VYTA Biosciences',
  description:
    'Research notes, handling guides and analysis from VYTA Biosciences — written for the people actually running the experiments.',
  openGraph: {
    title: 'Articles | VYTA Biosciences',
    description:
      'Research notes, handling guides and analysis from VYTA Biosciences.',
    type: 'website',
  },
};

export default async function ArticlesPage() {
  const articles = await getPublishedArticles();

  return (
    <main className="min-h-screen bg-white">
      <Navigation />

      <div className="pt-32 pb-16 sm:pt-36 sm:pb-20 md:pt-44 md:pb-28">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 lg:px-12">
          <header className="mb-10">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-teal-dark">
              VYTA Biosciences
            </p>
            <h1 className="font-display text-3xl font-bold leading-tight text-ink sm:text-4xl md:text-5xl">
              Articles
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-muted sm:text-lg">
              Research notes, handling guides and analysis — written for the people actually
              running the experiments.
            </p>
            <div className="mt-7 h-px bg-brand-rule opacity-50" />
          </header>

          <ArticleIndex articles={articles} />
        </div>
      </div>

      <Footer />
    </main>
  );
}
