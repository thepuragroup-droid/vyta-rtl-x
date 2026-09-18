/**
 * Product benefits — the bullet list under a product's description.
 *
 * `products.benefits` is a single text column, and the storefront used to
 * split it on commas. That quietly made the field unusable for anything real:
 * "Supports repair, recovery and sleep" became three bullets, a point could
 * never contain a comma, and there was no way to tell the field "here is
 * another point" other than typing one more comma. Pasting `<li>` markup did
 * nothing either, because the text is rendered as text, never as HTML.
 *
 * So the column is now read as ONE POINT PER LINE, with commas kept only as
 * the fallback for rows written before that — which is every existing product.
 * Nothing needs migrating: a legacy comma row keeps parsing exactly as it did,
 * and the moment someone edits it in the admin it is rewritten one per line.
 *
 * Each point still carries the site's inline syntax (`**bold**`, `*italic*`,
 * `[label](url)`), parsed into React nodes by components/content/RichText.tsx.
 */

/** Bullet characters and list numbering an editor may have typed or pasted. */
const LEADING_BULLET = /^\s*(?:[-–—•*·‣▪]|\d{1,3}[.)])\s+/;

/**
 * Strip the HTML an editor may have pasted in from a word processor or from
 * trying to hand-write a list.
 *
 * `<br>`, `</li>`, `</p>` and `</div>` become line breaks (they ARE the point
 * separators in that markup); every other tag is dropped, and the handful of
 * entities that survive a copy-paste are decoded. The result is plain text,
 * which is what the storefront renders — this is what makes pasted markup
 * behave the way the editor meant rather than showing up as literal `<li>`.
 */
function htmlToLines(raw: string): string {
  return raw
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(?:li|p|div|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'");
}

/**
 * The points a product's `benefits` column describes, in order.
 *
 * A line break ANYWHERE in the value means the value is a list of lines. Only
 * a value with no line break at all falls back to splitting on commas, which
 * is how every product written before this behaved — and how they keep
 * behaving until someone edits them.
 *
 * "Any line break", rather than "more than one non-empty line", is what lets a
 * single point legitimately contain a comma: `formatBenefits` ends such a
 * value with a newline, and this reads it back whole.
 */
export function parseBenefits(raw: string | null | undefined): string[] {
  const text = htmlToLines(raw ?? '');
  if (text.trim().length === 0) return [];

  const parts = /\r?\n/.test(text) ? text.split(/\r?\n/) : text.split(',');

  return parts
    .map((part) => part.replace(LEADING_BULLET, '').trim())
    .filter((part) => part.length > 0);
}

/**
 * How a list of points is stored back into the column: one per line.
 *
 * A single point with a comma in it gets a trailing newline, which is the
 * signal `parseBenefits` reads as "these are lines, not a comma list" — without
 * it, saving one point would read back as two.
 */
export function formatBenefits(points: string[]): string {
  const cleaned = points.map((point) => point.trim()).filter(Boolean);
  const text = cleaned.join('\n');
  return cleaned.length === 1 && text.includes(',') ? `${text}\n` : text;
}
