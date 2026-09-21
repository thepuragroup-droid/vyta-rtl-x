'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { BadgeCheck, Loader2, MessageSquare, PenLine } from 'lucide-react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api-fetch';
import { RatingSummary, StarInput, StarRating } from '@/components/reviews/StarRating';
import {
  REVIEW_BODY_MAX,
  REVIEW_TITLE_MAX,
  type ProductReviewsResponse,
  type ProductReview,
} from '@/lib/reviews';

/**
 * Reviews on the product page: the rollup, the list, and — for someone who
 * has actually bought this product — the form.
 *
 * Who may write is decided by the server, not here: /api/reviews answers with
 * `viewer.canReview` after checking the customer's orders, and this component
 * only chooses which of the three states to draw (write, sign in, bought it
 * already / not yet). Hiding the form is a courtesy; the refusal is the API's.
 */

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** How many of each score there are — the 5/4/3/2/1 bars beside the average. */
function histogram(reviews: ProductReview[]): number[] {
  const counts = [0, 0, 0, 0, 0];
  for (const review of reviews) counts[5 - review.rating] += 1;
  return counts;
}

export default function ProductReviews({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  const [data, setData] = useState<ProductReviewsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await apiFetch<ProductReviewsResponse>(
        `/api/reviews?product_id=${encodeURIComponent(productId)}`,
      );
      setData(result);
      if (result.viewer.review) {
        setRating(result.viewer.review.rating);
        setTitle(result.viewer.review.title ?? '');
        setBody(result.viewer.review.body ?? '');
      }
    } catch {
      // A product page is not a review page: if reviews cannot be loaded the
      // section simply does not appear.
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({ product_id: productId, rating, title, body }),
      });
      setWriting(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your review');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mb-8 sm:mb-10 flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading reviews…
      </div>
    );
  }

  if (!data) return null;

  const { reviews, stats, viewer } = data;
  const counts = histogram(reviews);
  const mine = viewer.review;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="mb-8 sm:mb-10"
      aria-labelledby="product-reviews-heading"
    >
      <div className="bg-white border border-line rounded-xl sm:rounded-2xl overflow-hidden">
        <div className="p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
            <div>
              <h2 id="product-reviews-heading" className="text-lg sm:text-xl font-bold text-ink">
                Customer Reviews
              </h2>
              <p className="text-xs sm:text-sm text-ink-muted mt-0.5">
                From customers who ordered {productName}.
              </p>
            </div>

            {viewer.canReview && !writing && (
              <button
                onClick={() => setWriting(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink hover:bg-ocean text-white text-sm font-semibold rounded-lg transition-colors"
              >
                <PenLine className="w-4 h-4" />
                {mine ? 'Edit your review' : 'Write a review'}
              </button>
            )}
          </div>

          {/* Rollup */}
          {stats.review_count > 0 ? (
            <div className="grid sm:grid-cols-[auto,1fr] gap-6 sm:gap-10 items-center pb-6 border-b border-line">
              <div className="text-center sm:text-left">
                <p className="text-4xl font-bold text-ink tabular-nums leading-none">
                  {stats.average_rating.toFixed(1)}
                </p>
                <StarRating value={stats.average_rating} size="md" className="mt-2" />
                <p className="text-xs text-ink-muted mt-1.5">
                  {stats.review_count} review{stats.review_count === 1 ? '' : 's'}
                </p>
              </div>

              <ul className="space-y-1.5 max-w-sm w-full">
                {counts.map((count, i) => {
                  const star = 5 - i;
                  const pct = stats.review_count ? (count / stats.review_count) * 100 : 0;
                  return (
                    <li key={star} className="flex items-center gap-2.5 text-xs text-ink-muted">
                      <span className="w-3 tabular-nums text-right">{star}</span>
                      <span className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                        <span
                          className="block h-full rounded-full bg-amber-400"
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                      <span className="w-6 tabular-nums">{count}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div className="flex items-center gap-3 pb-6 border-b border-line text-sm text-ink-muted">
              <MessageSquare className="w-4 h-4 flex-shrink-0 text-ink-light" />
              No reviews yet — the first one comes from whoever orders it next.
            </div>
          )}

          {/* Write form */}
          {writing && (
            <form onSubmit={submit} className="py-6 border-b border-line space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-2">Your rating</label>
                <StarInput value={rating} onChange={setRating} disabled={saving} />
              </div>

              <div>
                <label htmlFor="review-title" className="block text-sm font-medium text-ink mb-1.5">
                  Headline <span className="font-normal text-ink-muted">(optional)</span>
                </label>
                <input
                  id="review-title"
                  type="text"
                  value={title}
                  maxLength={REVIEW_TITLE_MAX}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Arrived quickly, COA matched"
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
                />
              </div>

              <div>
                <label htmlFor="review-body" className="block text-sm font-medium text-ink mb-1.5">
                  Your review <span className="font-normal text-ink-muted">(optional)</span>
                </label>
                <textarea
                  id="review-body"
                  value={body}
                  rows={4}
                  maxLength={REVIEW_BODY_MAX}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="What you ordered, how it arrived, what the lab results showed."
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
                />
                <p className="text-[11px] text-ink-muted mt-1">
                  Posted publicly as your first name and last initial.
                </p>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink hover:bg-ocean disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {mine ? 'Update review' : 'Post review'}
                </button>
                <button
                  type="button"
                  onClick={() => setWriting(false)}
                  className="px-4 py-2.5 text-sm font-medium text-ink-muted hover:text-ink transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Why the form is not here */}
          {!writing && !viewer.canReview && (
            <p className="py-5 text-sm text-ink-muted border-b border-line">
              {viewer.signedIn ? (
                <>Reviews are open to customers who have ordered this product.</>
              ) : (
                <>
                  <Link href="/login" className="font-semibold text-teal-dark hover:underline">
                    Sign in
                  </Link>{' '}
                  to review a product you have ordered.
                </>
              )}
            </p>
          )}

          {/* The reviews themselves */}
          {reviews.length > 0 && (
            <ul className="divide-y divide-line">
              {reviews.map((review) => (
                <li key={review.id} className="py-5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1.5">
                    <StarRating value={review.rating} size="sm" />
                    <span className="text-sm font-semibold text-ink">{review.author_name}</span>
                    {review.verified && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-teal-dark bg-teal-50 border border-teal/20 px-2 py-0.5 rounded-full">
                        <BadgeCheck className="w-3 h-3" />
                        Verified purchase
                      </span>
                    )}
                    {review.mine && (
                      <span className="text-[10px] font-semibold text-ink-muted bg-surface-2 px-2 py-0.5 rounded-full">
                        Yours
                      </span>
                    )}
                    <span className="text-xs text-ink-light ml-auto">
                      {formatDate(review.created_at)}
                    </span>
                  </div>
                  {review.title && (
                    <p className="text-sm font-semibold text-ink mb-1">{review.title}</p>
                  )}
                  {review.body && (
                    <p className="text-sm text-ink-muted leading-relaxed whitespace-pre-line">
                      {review.body}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </motion.section>
  );
}

/** Re-exported so a product card can show the rollup without its own import. */
export { RatingSummary };
