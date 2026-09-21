/**
 * Homepage testimonials.
 *
 * Rows live in `testimonials` (see reviews-testimonials-migration.sql) and are
 * written by staff in Admin → Testimonials. They are marketing copy about the
 * shop, not product reviews: nothing on the storefront can create one, and
 * they carry no purchase behind them. Product reviews — the ones a verified
 * buyer writes — live in lib/reviews.ts.
 *
 * `enabled` IS the storefront toggle, so retiring a quote never means deleting
 * the copy you will want again next quarter.
 */

export interface Testimonial {
  id: string;
  quote: string;
  author_name: string;
  author_label: string | null;
  rating: number;
  /** The storefront toggle. */
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function cleanString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Normalise a raw DB row; every field is defaulted so the carousel can't crash. */
export function shapeTestimonial(row: Record<string, any>): Testimonial {
  const rating = Number(row.rating);
  const sort = Number(row.sort_order);
  return {
    id: String(row.id),
    quote: String(row.quote ?? ''),
    author_name: cleanString(row.author_name) ?? 'Verified Customer',
    author_label: cleanString(row.author_label),
    rating: Number.isFinite(rating) ? Math.min(5, Math.max(1, Math.round(rating))) : 5,
    enabled: row.enabled !== false,
    sort_order: Number.isFinite(sort) ? sort : 0,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

/**
 * The subset of a request body that may reach the table. Anything absent from
 * the body is absent from the patch, so a PATCH only touches what it names.
 */
export function testimonialPatch(body: Record<string, any>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if ('quote' in body) patch.quote = String(body.quote ?? '').trim();
  if ('author_name' in body) {
    patch.author_name = cleanString(body.author_name) ?? 'Verified Customer';
  }
  if ('author_label' in body) patch.author_label = cleanString(body.author_label);
  if ('rating' in body) {
    const rating = Number(body.rating);
    patch.rating = Number.isFinite(rating) ? Math.min(5, Math.max(1, Math.round(rating))) : 5;
  }
  if ('enabled' in body) patch.enabled = Boolean(body.enabled);
  if ('sort_order' in body) {
    const sort = Number(body.sort_order);
    patch.sort_order = Number.isFinite(sort) ? Math.round(sort) : 0;
  }

  return patch;
}

export const TESTIMONIAL_QUOTE_MAX = 600;
