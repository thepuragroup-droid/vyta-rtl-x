/**
 * Browser-side half of marketing attribution.
 *
 * `middleware.ts` writes the first- and last-touch cookies; this reads them
 * back in the browser so the storefront can tell an ad visitor from an organic
 * one WITHOUT a round trip. That matters for the paid-ads welcome discount:
 * the offer strip has to be right on the first paint, before any fetch lands.
 *
 * The cookies are not httpOnly by design (GA4 / the conversion linker read the
 * same signals from the URL), so nothing secret is being exposed here — and
 * nothing decided here is trusted for money either. The checkout re-reads the
 * same cookies server-side and settles the discount itself; this is a display
 * decision only.
 *
 * ## Why reading them is not just `decodeTouch`
 *
 * The touch cookies arrive DOUBLY percent-encoded. `encodeTouch` encodes the
 * compact JSON, and `NextResponse.cookies.set` then encodes what it is handed
 * a second time on the way out:
 *
 *     aminocan_attr=%257B%2522c%2522%253A%2522google_ads%2522…
 *
 * The server never sees this, which is why it went unnoticed: `req.cookies.get`
 * strips the transport layer and `decodeTouch` strips the other. `document.cookie`
 * does no decoding at all, so the browser has to undo both levels itself.
 */
import {
  decodeTouch,
  isPaidChannel,
  ATTRIBUTION_COOKIE,
  ATTRIBUTION_LAST_COOKIE,
  type AttributionTouch,
} from './attribution';

function cookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  const row = document.cookie.split('; ').find((r) => r.startsWith(prefix));
  return row ? row.slice(prefix.length) : null;
}

/** `decodeURIComponent` that yields null on a malformed sequence instead of throwing. */
function peel(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Read one touch cookie out of `document.cookie`.
 *
 * `decodeTouch` already undoes one level of encoding, so this tries it on the
 * raw value first and only strips the transport level when that comes back
 * empty. Doing it in that order rather than always peeling means the reader
 * keeps working either way — if Next stops double-encoding, or if a touch is
 * ever written by something that encodes it once.
 */
export function readTouchCookie(name: string): AttributionTouch | null {
  const raw = cookie(name);
  if (!raw) return null;
  const once = decodeTouch(raw);
  if (once) return once;
  const peeled = peel(raw);
  return peeled ? decodeTouch(peeled) : null;
}

/** The campaign that earned this visit, or null when it was never recorded. */
export function readFirstTouch(): AttributionTouch | null {
  return readTouchCookie(ATTRIBUTION_COOKIE);
}

/** The most recent meaningful touch — what brought them back this time. */
export function readLastTouch(): AttributionTouch | null {
  return readTouchCookie(ATTRIBUTION_LAST_COOKIE);
}

/**
 * Did this visitor arrive on a paid ad?
 *
 * Either touch counts. First touch is the campaign that won them, which is what
 * the offer is for; last touch catches the case where they first found the site
 * organically and came back through an ad.
 *
 * Returns false during SSR and on the very first client render, so callers must
 * read it in an effect rather than during render or the two will disagree and
 * React will report a hydration mismatch.
 */
export function isAdVisitor(): boolean {
  return (
    isPaidChannel(readFirstTouch()?.channel) || isPaidChannel(readLastTouch()?.channel)
  );
}

/** Every channel recorded for this visitor, for eligibility checks. */
export function visitorChannels(): (string | null)[] {
  return [readFirstTouch()?.channel ?? null, readLastTouch()?.channel ?? null];
}
