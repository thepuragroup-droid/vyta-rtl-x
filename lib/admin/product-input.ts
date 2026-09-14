/**
 * Parsing/validation for the numeric product fields the admin catalog form
 * and its inline editors send. These arrive as JSON from the browser, so a
 * value can legitimately be a number, a numeric string, `null` (an override
 * being cleared) or absent (a partial PATCH that doesn't touch the field) —
 * and each of those means something different at the DB.
 */

/** A parsed field: `ok: false` means reject the request with a 400. */
export type ParsedField<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * Nullable price override (`price_usd`, `vial_price`).
 *
 * `null` / `''` clears the override so the column goes back to NULL and the
 * storefront falls back to its derived "auto" price (exchange rate for USD,
 * `price / vials_per_box` for a vial). Anything else must parse to a
 * non-negative, finite number.
 */
export function parsePriceOverride(raw: unknown, label: string): ParsedField<number | null> {
  if (raw === null || raw === '') return { ok: true, value: null };

  const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(num)) {
    return { ok: false, error: `${label} must be a number` };
  }
  if (num < 0) {
    return { ok: false, error: `${label} must be non-negative` };
  }
  return { ok: true, value: num };
}

/**
 * `vials_per_box` — how stock (counted in vials) converts to boxes. NOT
 * nullable: the column is `NOT NULL DEFAULT 10` with a `CHECK (> 0)`, so an
 * empty value falls back to 10 rather than clearing anything.
 */
export function parseVialsPerBox(raw: unknown): ParsedField<number> {
  if (raw === null || raw === '') return { ok: true, value: 10 };

  const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(num)) {
    return { ok: false, error: 'Vials per box must be a number' };
  }
  const int = Math.floor(num);
  if (int < 1) {
    return { ok: false, error: 'Vials per box must be at least 1' };
  }
  return { ok: true, value: int };
}
