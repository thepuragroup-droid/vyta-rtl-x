/**
 * Customer product reviews.
 *
 * Rows live in `product_reviews` (see reviews-testimonials-migration.sql) and
 * only ever get there through /api/reviews, which checks the writer actually
 * bought the product. Everything in this file is shared by that route, the
 * product page and the storefront cards, so the shape of a review is defined
 * once.
 */

/** Order statuses that count as "they bought it". */
export const PURCHASED_ORDER_STATUSES = [
  'received',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'completed',
  'paid',
] as const;

export interface ProductReview {
  id: string;
  product_id: string;
  rating: number;
  title: string | null;
  body: string | null;
  author_name: string;
  verified: boolean;
  created_at: string;
  /** Set only on the signed-in reader's own review, so the UI can offer an edit. */
  mine?: boolean;
}

/** The rollup a product card shows: "4.8 (128)". */
export interface ReviewStats {
  product_id: string;
  review_count: number;
  average_rating: number;
}

/** What the product page needs to decide between "write" and "why not". */
export interface ReviewViewer {
  signedIn: boolean;
  /** They bought it and may post (or edit what they already posted). */
  canReview: boolean;
  /** Their existing review, if any. */
  review: ProductReview | null;
}

export interface ProductReviewsResponse {
  reviews: ProductReview[];
  stats: ReviewStats;
  viewer: ReviewViewer;
}

function cleanString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Normalise a raw DB row; every field is defaulted so a card can't crash. */
export function shapeReview(row: Record<string, any>): ProductReview {
  const rating = Number(row.rating);
  return {
    id: String(row.id),
    product_id: String(row.product_id),
    rating: Number.isFinite(rating) ? Math.min(5, Math.max(1, Math.round(rating))) : 5,
    title: cleanString(row.title),
    body: cleanString(row.body),
    author_name: cleanString(row.author_name) ?? 'Verified Customer',
    verified: row.verified !== false,
    created_at: String(row.created_at ?? new Date().toISOString()),
  };
}

export function shapeStats(row: Record<string, any> | null, productId: string): ReviewStats {
  const count = Number(row?.review_count);
  const average = Number(row?.average_rating);
  return {
    product_id: productId,
    review_count: Number.isFinite(count) ? count : 0,
    average_rating: Number.isFinite(average) ? average : 0,
  };
}

/**
 * "Sarah M." — a first name and a last initial. Reviews are public, and a full
 * name beside a list of peptides someone bought is more than they agreed to
 * when they created an account.
 */
export function displayNameFor(firstName?: string | null, lastName?: string | null): string {
  const first = cleanString(firstName);
  if (!first) return 'Verified Customer';
  const initial = cleanString(lastName)?.[0];
  return initial ? `${first} ${initial.toUpperCase()}.` : first;
}

/** The rating a submitted form is allowed to carry. */
export function normaliseRating(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  return rounded >= 1 && rounded <= 5 ? rounded : null;
}

/** Reviews are public writing, so cap what one submission can be. */
export const REVIEW_TITLE_MAX = 120;
export const REVIEW_BODY_MAX = 2000;
