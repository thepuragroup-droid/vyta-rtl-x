'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { StarRating } from '@/components/reviews/StarRating';
import type { Testimonial } from '@/lib/content/testimonials';

/**
 * "What Our Customers Say" — one quote at a time, stepped through by hand.
 *
 * The quotes are written in Admin → Testimonials, so this renders whatever is
 * enabled there and nothing at all when the list is empty. That is the right
 * default: an empty carousel of placeholder praise is worse than no carousel,
 * and a shop with no testimonials yet should not look like it lost them.
 *
 * It does not rotate on a timer. A testimonial is something you read; moving
 * it out from under someone mid-sentence to prove there are others is a
 * carousel serving itself.
 */
export default function Testimonials() {
  const [quotes, setQuotes] = useState<Testimonial[]>([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/testimonials', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        const rows = Array.isArray(data?.testimonials) ? data.testimonials : [];
        if (alive) setQuotes(rows);
      } catch {
        /* no testimonials this render */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (quotes.length === 0) return null;

  const current = quotes[index] ?? quotes[0];
  const step = (delta: number) =>
    setIndex((i) => (i + delta + quotes.length) % quotes.length);

  return (
    <section className="py-14 sm:py-20 bg-white" aria-labelledby="testimonials-heading">
      <div className="max-w-3xl mx-auto px-5 sm:px-8 text-center">
        <h2 id="testimonials-heading" className="font-display text-2xl sm:text-3xl font-bold text-ink mb-4">
          What Our Customers Say
        </h2>

        <StarRating value={current.rating} size="lg" className="justify-center mb-5" />

        <div className="flex items-center gap-3 sm:gap-6">
          {quotes.length > 1 && (
            <button
              onClick={() => step(-1)}
              aria-label="Previous testimonial"
              className="flex-shrink-0 w-9 h-9 rounded-full border border-line text-ink-muted hover:text-ink hover:border-ink/30 flex items-center justify-center transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}

          <motion.blockquote
            // Keyed on the row so each quote animates in rather than the text
            // swapping under the reader.
            key={current.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="flex-1 min-w-0"
          >
            <p className="text-base sm:text-lg text-ink leading-relaxed text-balance">
              &ldquo;{current.quote}&rdquo;
            </p>
            <footer className="text-xs sm:text-sm text-ink-muted mt-3">
              — {current.author_name}
              {current.author_label && <span className="text-ink-light">, {current.author_label}</span>}
            </footer>
          </motion.blockquote>

          {quotes.length > 1 && (
            <button
              onClick={() => step(1)}
              aria-label="Next testimonial"
              className="flex-shrink-0 w-9 h-9 rounded-full border border-line text-ink-muted hover:text-ink hover:border-ink/30 flex items-center justify-center transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {quotes.length > 1 && (
          <div className="flex items-center justify-center gap-1.5 mt-6">
            {quotes.map((quote, i) => (
              <button
                key={quote.id}
                onClick={() => setIndex(i)}
                aria-label={`Testimonial ${i + 1} of ${quotes.length}`}
                aria-current={i === index}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? 'w-5 bg-ink' : 'w-1.5 bg-line hover:bg-ink-light'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
