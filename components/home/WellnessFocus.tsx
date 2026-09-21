'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { ArrowRight, type LucideIcon } from 'lucide-react';
import { getCategoryIcon, getStoreCategories } from '@/lib/categories';

/**
 * "Shop by Wellness Focus" — the six category tiles under the hero.
 *
 * The tiles are the controlled store categories (Admin → Categories, featured
 * ones first), so adding a category to the storefront never means editing this
 * file. The built-in six below are the fallback for a store whose taxonomy has
 * not been set up yet, and for the moment before the fetch lands.
 *
 * ## Placeholder art
 *
 * The design calls for a photograph behind each tile. None have been shot, so
 * each tile renders a brand-gradient placeholder with its category icon —
 * deliberately not a stock photo, so nobody ships a lifestyle image the shop
 * has no licence to. Give a category an `image_url` and swap
 * `PLACEHOLDER_GRADIENTS` for it when the photography exists.
 */

interface FocusTile {
  name: string;
  slug: string;
  description: string;
  icon: LucideIcon;
}

const FALLBACK_TILES: FocusTile[] = [
  { name: 'Metabolic Support', slug: 'Weight Loss / Metabolic', description: 'GLP-1 agonists', icon: getCategoryIcon('TestTube') },
  { name: 'Recovery & Performance', slug: 'Bodybuilding / Fitness', description: 'Growth factors', icon: getCategoryIcon('Dna') },
  { name: 'Healthy Aging & Longevity', slug: 'Anti-Aging / Beauty', description: 'Cellular health', icon: getCategoryIcon('Sparkles') },
  { name: 'Cognitive Wellness', slug: 'Cognitive / Focus', description: 'Neuropeptides', icon: getCategoryIcon('Brain') },
  { name: 'Joint & Tissue Support', slug: 'Healing / Recovery', description: 'Tissue repair', icon: getCategoryIcon('Heart') },
  { name: 'General Wellness', slug: 'General Health', description: 'Clinical peptides', icon: getCategoryIcon('Leaf') },
];

/**
 * Stand-ins for the photography, one per tile position. Each is a distinct
 * navy→teal sweep so the grid reads as six things rather than one repeated
 * swatch, and every one holds white type at AA.
 */
const PLACEHOLDER_GRADIENTS = [
  'linear-gradient(135deg, #07203A 0%, #0E3F5F 55%, #1B5D83 100%)',
  'linear-gradient(135deg, #0E3F5F 0%, #1B5D83 55%, #438B9E 100%)',
  'linear-gradient(135deg, #1B5D83 0%, #438B9E 60%, #6EB2B8 100%)',
  'linear-gradient(135deg, #05182B 0%, #07203A 50%, #0E3F5F 100%)',
  'linear-gradient(135deg, #0E3F5F 0%, #438B9E 100%)',
  'linear-gradient(135deg, #07203A 0%, #1B5D83 40%, #6EB2B8 100%)',
];

export default function WellnessFocus() {
  const [tiles, setTiles] = useState<FocusTile[]>(FALLBACK_TILES);

  useEffect(() => {
    let alive = true;
    getStoreCategories({ featuredOnly: true }).then((rows) => {
      if (!alive || rows.length === 0) return;
      setTiles(
        rows.slice(0, 6).map((row) => ({
          name: row.name,
          slug: row.slug,
          description: row.description ?? '',
          icon: getCategoryIcon(row.icon),
        })),
      );
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="py-14 sm:py-20 bg-white">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
        <div className="flex items-end justify-between gap-4 mb-8">
          <div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-ink">
              Shop by Wellness Focus
            </h2>
            <p className="text-sm text-ink-muted mt-1.5">Explore our most popular categories.</p>
          </div>
          <Link
            href="/products"
            className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium text-ink hover:text-ink-muted whitespace-nowrap"
          >
            View All Compounds
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {tiles.map((tile, index) => (
            <motion.div
              key={tile.slug}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: index * 0.05 }}
              viewport={{ once: true }}
            >
              <Link
                href={`/products?category=${encodeURIComponent(tile.slug)}`}
                className="group relative block aspect-[16/9] rounded-2xl overflow-hidden shadow-card hover:shadow-card-hover transition-shadow"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-0 transition-transform duration-500 group-hover:scale-105"
                  style={{
                    backgroundImage: PLACEHOLDER_GRADIENTS[index % PLACEHOLDER_GRADIENTS.length],
                  }}
                />
                {/* Molecular texture, so a placeholder still looks made rather
                    than unfinished. */}
                <span
                  aria-hidden="true"
                  className="absolute inset-0 molecular-grid opacity-40"
                />
                <span
                  aria-hidden="true"
                  className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/20 to-transparent"
                />

                <span className="absolute inset-0 p-5 flex items-end gap-3.5">
                  <span className="w-11 h-11 rounded-full border border-white/40 bg-white/10 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
                    <tile.icon className="w-5 h-5 text-white" strokeWidth={1.5} />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-white leading-tight text-balance">
                      {tile.name}
                    </span>
                    <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-white/75 group-hover:text-white transition-colors">
                      Explore
                      <ArrowRight className="w-3 h-3 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </span>
                </span>
              </Link>
            </motion.div>
          ))}
        </div>

        <Link
          href="/products"
          className="sm:hidden mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-ink"
        >
          View All Compounds
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </section>
  );
}
