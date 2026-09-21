'use client';

import React from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';

/**
 * "We Show Our Work" — the transparency band between the best sellers and the
 * value props. Half claim, half proof: the claim is copy, the proof is the
 * link to the published lab results.
 *
 * The right half is a placeholder gradient with a purity card over it, for the
 * same reason the category tiles are: the design calls for a photograph of a
 * bench that has not been shot yet.
 */

const PROMISES = [
  'View certificates of analysis',
  'Confirm purity results',
  'Access detailed testing data',
];

export default function ShowOurWork() {
  return (
    <section className="py-14 sm:py-20 bg-white">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          viewport={{ once: true }}
          className="relative grid lg:grid-cols-2 rounded-2xl sm:rounded-3xl overflow-hidden bg-brand-gradient-soft border border-line"
        >
          {/* Copy */}
          <div className="p-7 sm:p-10 lg:p-12">
            <p className="text-eyebrow !text-teal-dark mb-3">Transparency you can trust</p>
            <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold text-ink mb-3">
              We Show Our Work
            </h2>
            <p className="text-sm sm:text-base text-ink/80 leading-relaxed max-w-md mb-6">
              Every batch is independently tested by a third-party lab, so you can verify exactly
              what you&rsquo;re purchasing.
            </p>

            <ul className="space-y-2.5 mb-7">
              {PROMISES.map((promise) => (
                <li key={promise} className="flex items-center gap-2.5 text-sm text-ink">
                  <CheckCircle2 className="w-4 h-4 text-teal-dark flex-shrink-0" />
                  {promise}
                </li>
              ))}
            </ul>

            <Link href="/lab-results">
              <span className="inline-flex items-center gap-2 px-6 py-3 bg-ink hover:bg-ocean text-white text-sm font-semibold rounded-full shadow-card transition-colors">
                View Lab Results
                <ArrowRight className="w-4 h-4" />
              </span>
            </Link>
          </div>

          {/* Placeholder bench imagery + the purity card that sits over it */}
          <div className="relative min-h-[260px] lg:min-h-full">
            <span
              aria-hidden="true"
              className="absolute inset-0 bg-brand-gradient"
            />
            <span aria-hidden="true" className="absolute inset-0 molecular-grid opacity-30" />

            <div className="relative h-full flex items-center justify-center p-7 sm:p-10">
              <div className="w-full max-w-xs rounded-2xl bg-ink/70 backdrop-blur-md border border-white/15 p-5 sm:p-6 text-white">
                <p className="text-[11px] uppercase tracking-[0.14em] text-white/60 mb-1.5">
                  Purity verified
                </p>
                <p className="font-display text-4xl font-bold leading-none mb-3">99%+</p>
                <p className="text-xs text-white/70">Third-Party Tested</p>
                <p className="text-xs text-white/70">COA Available</p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
