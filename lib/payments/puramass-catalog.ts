/**
 * PuraMass catalog snapshot + SKU matcher.
 *
 * Pure module — no I/O. Used two ways:
 *   1. `matchProductToPuramass` auto-fills `products.puramass_sku` from the
 *      store's product name + strength (see the admin sync-skus route).
 *   2. `PURAMASS_CATALOG_SNAPSHOT` is a bundled copy of the live catalog used
 *      as a matcher fallback when the live API call fails, and by the tests.
 *
 * The matcher is dose-anchored: a store product never crosses to a catalog
 * entry with a different dose (10mg is never matched to 20mg). When the dose
 * matches but several catalog entries are equally plausible, the result is
 * `ambiguous` and left for a human — nothing is auto-written.
 */

export interface PuramassCatalogEntry {
  sku: string;
  name: string;
}

export type PuramassMatchStatus = 'exact' | 'matched' | 'ambiguous' | 'unmatched';

export interface PuramassMatchResult {
  status: PuramassMatchStatus;
  /** Resolved SKU for `exact`/`matched`; null for `ambiguous`/`unmatched`. */
  sku: string | null;
  /** The winning catalog entry for `exact`/`matched`; null otherwise. */
  entry: PuramassCatalogEntry | null;
  /** Tied entries for `ambiguous` (for a human to pick); [] otherwise. */
  candidates: PuramassCatalogEntry[];
}

/**
 * Bundled copy of the PuraMass catalog.
 *
 * ⚠️  SEED DATA — derived from the SKU/name examples in the build spec, NOT a
 * live export. Refresh from `GET /partner/store/products` (see the admin
 * "Sync SKUs from catalog" button, which prefers the live call and only falls
 * back to this snapshot when the API is unreachable). Names are stored in
 * their natural display form so hyphen/space folding lines up with store
 * product names. Every peptide SKU is a 10-pack.
 */
export const PURAMASS_CATALOG_SNAPSHOT: PuramassCatalogEntry[] = [
  // 10-pack SKUs (…-10-pack). Matched to products.puramass_sku.
  { sku: 'puramass-bpc-157-10mg-10-pack', name: 'BPC-157 10mg' },
  { sku: 'puramass-tb-500-5mg-10-pack', name: 'TB-500 5mg' },
  { sku: 'puramass-5-amino-1mq-10mg-10-pack', name: '5-Amino-1MQ 10mg' },
  { sku: 'puramass-ghrp-2-10mg-10-pack', name: 'GHRP-2 10mg' },
  { sku: 'puramass-ghrp-6-10mg-10-pack', name: 'GHRP-6 10mg' },
  { sku: 'puramass-cjc-1295-no-dac-5mg-10-pack', name: 'CJC-1295 no DAC 5mg' },
  { sku: 'puramass-ipamorelin-5mg-10-pack', name: 'Ipamorelin 5mg' },
  { sku: 'puramass-semaglutide-5mg-10-pack', name: 'Semaglutide 5mg' },
  { sku: 'puramass-tirzepatide-10mg-10-pack', name: 'Tirzepatide 10mg' },
  { sku: 'puramass-melanotan-ii-10mg-10-pack', name: 'Melanotan II 10mg' },
  { sku: 'puramass-hgh-10iu-10-pack', name: 'HGH 10 IU' },
  // Single-vial SKUs (…-vial). Matched to products.puramass_sku_vial.
  { sku: 'puramass-bpc-157-10mg-vial', name: 'BPC-157 10mg' },
  { sku: 'puramass-tb-500-5mg-vial', name: 'TB-500 5mg' },
  { sku: 'puramass-5-amino-1mq-10mg-vial', name: '5-Amino-1MQ 10mg' },
  { sku: 'puramass-ghrp-2-10mg-vial', name: 'GHRP-2 10mg' },
  { sku: 'puramass-ghrp-6-10mg-vial', name: 'GHRP-6 10mg' },
  { sku: 'puramass-cjc-1295-no-dac-5mg-vial', name: 'CJC-1295 no DAC 5mg' },
  { sku: 'puramass-ipamorelin-5mg-vial', name: 'Ipamorelin 5mg' },
  { sku: 'puramass-semaglutide-5mg-vial', name: 'Semaglutide 5mg' },
  { sku: 'puramass-tirzepatide-10mg-vial', name: 'Tirzepatide 10mg' },
  { sku: 'puramass-melanotan-ii-10mg-vial', name: 'Melanotan II 10mg' },
  { sku: 'puramass-hgh-10iu-vial', name: 'HGH 10 IU' },
];

// Dose units recognised for the dose signature. `mcg` must be able to win over
// `g`; the anchored test below handles that regardless of alternation order.
const DOSE_TOKEN_RE = /^\d+(mcg|mg|ml|iu|kg|g)$/;
const DOSE_GLUE_RE = /\b(\d+)\s+(mcg|mg|ml|iu|kg|g)\b/g;

/**
 * Normalise a product/catalog name for comparison:
 *   - lowercase
 *   - strip punctuation (incl. `-`, `®`, `™`) to spaces
 *   - collapse whitespace
 *   - glue a bare number to a following unit so "10 IU"/"10 mg" become one
 *     dose token (`10iu`, `10mg`)
 */
export function normalizeName(raw: string): string {
  return String(raw ?? '')
    .toLowerCase()
    // Anything that isn't a latin letter or digit becomes a space — this folds
    // away hyphens, ®, ™, parentheses, slashes, etc.
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(DOSE_GLUE_RE, '$1$2');
}

function tokensOf(normalized: string): string[] {
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

function doseSet(tokens: string[]): Set<string> {
  return new Set(tokens.filter((t) => DOSE_TOKEN_RE.test(t)));
}

function wordSet(tokens: string[]): Set<string> {
  return new Set(tokens.filter((t) => !DOSE_TOKEN_RE.test(t)));
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function isSubset(sub: Set<string>, sup: Set<string>): boolean {
  for (const v of sub) if (!sup.has(v)) return false;
  return true;
}

/**
 * Match a store product to a PuraMass catalog SKU. Tiers, most-confident first:
 *
 *   1. `exact`     — normalised names equal (tries `name`, then `name strength`).
 *   2. `matched`   — dose signatures equal AND every non-dose word of the
 *                    product is present in the candidate; the candidate adding
 *                    the fewest extra words wins when that minimum is unique.
 *   3. `ambiguous` — several candidates tie on minimal extra words → for a human.
 *   4. `unmatched` — nothing shares dose + words.
 */
export function matchProductToPuramass(
  productName: string,
  strength?: string | null,
  catalog: PuramassCatalogEntry[] = PURAMASS_CATALOG_SNAPSHOT,
): PuramassMatchResult {
  const nameNorm = normalizeName(productName);
  const strengthNorm = strength
    ? normalizeName(`${productName} ${strength}`)
    : nameNorm;

  // Tier 1 — exact.
  for (const entry of catalog) {
    const en = normalizeName(entry.name);
    if (en && (en === nameNorm || en === strengthNorm)) {
      return { status: 'exact', sku: entry.sku, entry, candidates: [entry] };
    }
  }

  // Prefer whichever form actually carries a dose: a bare "GHRP" gains its
  // "10mg" dose from the strength column.
  const baseTokens = tokensOf(nameNorm);
  const productTokens =
    doseSet(baseTokens).size > 0 ? baseTokens : tokensOf(strengthNorm);
  const productDose = doseSet(productTokens);
  const productWords = wordSet(productTokens);

  // Tiers 2/3 — dose-anchored.
  const qualifying: { entry: PuramassCatalogEntry; extra: number }[] = [];
  for (const entry of catalog) {
    const et = tokensOf(normalizeName(entry.name));
    const eDose = doseSet(et);
    if (!setsEqual(productDose, eDose)) continue;
    const eWords = wordSet(et);
    if (!isSubset(productWords, eWords)) continue;
    let extra = 0;
    for (const w of eWords) if (!productWords.has(w)) extra += 1;
    qualifying.push({ entry, extra });
  }

  if (qualifying.length === 0) {
    return { status: 'unmatched', sku: null, entry: null, candidates: [] };
  }

  const minExtra = Math.min(...qualifying.map((q) => q.extra));
  const winners = qualifying.filter((q) => q.extra === minExtra);
  if (winners.length === 1) {
    const { entry } = winners[0];
    return { status: 'matched', sku: entry.sku, entry, candidates: [entry] };
  }
  return {
    status: 'ambiguous',
    sku: null,
    entry: null,
    candidates: winners.map((w) => w.entry),
  };
}
