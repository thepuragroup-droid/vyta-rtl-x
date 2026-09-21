'use client';

import React from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

/**
 * "Explore the VYTA Collection" — the full-bleed closing call to action, on the
 * landscape photograph the design called for.
 *
 * The copy is white, so the ink scrim over the image is load-bearing rather
 * than decorative: it is the only thing keeping the headline and body copy
 * readable over whatever the photograph does behind them. It is heaviest on the
 * left, where the copy sits, and thins to the right so the art still reads.
 * Lightening it means re-checking the contrast against the image.
 */
const BANNER_IMAGE =
  'https://xbpdqpmdecsoshzttthl.supabase.co/storage/v1/object/public/assets/Explore%20The%20Vyta%20Collection.png';

export default function CollectionBanner() {
  return (
    <section className="relative overflow-hidden bg-ink">
      <img
        src={BANNER_IMAGE}
        alt=""
        aria-hidden="true"
        loading="lazy"
        className="absolute inset-0 w-full h-full object-cover"
      />
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-r from-ink/90 via-ink/60 to-ink/25"
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        viewport={{ once: true }}
        className="relative max-w-7xl mx-auto px-5 sm:px-8 lg:px-12 py-16 sm:py-24"
      >
        <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold text-white leading-[1.1] mb-4 max-w-lg">
          Explore the
          <br />
          VYTA Collection
        </h2>
        <p className="text-sm sm:text-base text-white/75 mb-7 max-w-md">
          Premium peptides for your wellness journey.
        </p>
        <Link href="/products">
          <span className="inline-flex items-center gap-2 px-7 py-3.5 bg-aqua hover:bg-mist text-ink text-sm font-semibold rounded-full transition-colors">
            Shop All Products
            <ArrowRight className="w-4 h-4" />
          </span>
        </Link>
      </motion.div>
    </section>
  );
}
