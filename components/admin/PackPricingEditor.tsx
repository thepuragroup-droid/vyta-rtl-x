'use client';

import React from 'react';
import { EyeOff, Tag } from 'lucide-react';
import {
  MAX_PACK_BADGE_LENGTH,
  MAX_PACK_OPTIONS,
  PACK_BADGE_PRESETS,
  PACK_SIZE_OPTIONS,
  normalizePackSizes,
  packLabel,
  round2,
} from '@/lib/pricing';

/**
 * The single product's pack switchboard: which quantities it is sold in, and
 * what each of those packs is called and costs.
 *
 * One row per pack, with an On switch and four boxes:
 *
 *   On          whether the pack is offered on the storefront. Off keeps the
 *               pack and everything typed into its row, but the product page,
 *               the purchase modal and the checkout stop selling it. The last
 *               pack that is on cannot be switched off.
 *   Label       what the storefront button says. Blank → "Single vial" /
 *               "Pack of 3", so most products never need to touch it.
 *   Tag         the merchandising chip pinned to the pack's corner on the PDP
 *               — "Most Popular", "Best Value". Blank → no chip. Free text, so
 *               a campaign can say something else without a code change.
 *   Price       what the pack costs. Blank → the vial price × the pack size,
 *               which keeps a product's packs repricing themselves whenever
 *               its price changes. Fill it in to sell a bigger pack cheaper.
 *   Compare at  the struck-through "was" price. Blank, on a pack priced below
 *               the undiscounted figure, falls back to that figure — so typing
 *               a discounted price is enough to put a saving on the PDP.
 *
 * Every row previews what the customer will see (per-vial price, and the
 * saving when there is one), because the arithmetic between a vial price, a
 * pack size and a discount is exactly where a pricing mistake hides.
 */

/** A row as the form holds it: money as raw strings, so a box can be empty. */
export interface PackOptionDraft {
  size: number;
  label: string;
  badge: string;
  price: string;
  compare_at: string;
  /** Offered on the storefront. Off keeps the row's settings but hides it. */
  enabled: boolean;
}

interface PackPricingEditorProps {
  /** Pack sizes the product is offered in. Empty = the default pair. */
  sizes: number[];
  rows: PackOptionDraft[];
  /** The product's per-vial price, for the derived figures. */
  vialPrice: number;
  /** Vials in one case, for the "default pair" explainer. */
  vialsPerBox: number;
  disabled?: boolean;
  onChange: (next: { sizes: number[]; rows: PackOptionDraft[] }) => void;
}

const boxClass =
  'w-full px-2.5 py-1.5 bg-white border border-line rounded-lg text-ink text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-teal/40 disabled:opacity-60';

/** A blank row — every override unset, i.e. "price it the usual way". */
export function emptyPackRow(size: number): PackOptionDraft {
  return { size, label: '', badge: '', price: '', compare_at: '', enabled: true };
}

/** Parse a money box. '' (and anything unusable) means "not set". */
function money(raw: string): number | null {
  const text = (raw ?? '').trim();
  if (text === '') return null;
  const n = Number(text.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? round2(n) : null;
}

/**
 * The form rows for `sizes`, in order, reusing anything already typed. Lets
 * the caller toggle a size off and back on without losing its pricing.
 */
export function rowsForSizes(sizes: number[], existing: PackOptionDraft[]): PackOptionDraft[] {
  const bySize = new Map(existing.map((row) => [row.size, row]));
  return sizes.map((size) => bySize.get(size) ?? emptyPackRow(size));
}

/**
 * The payload shape for `products.pack_options`, or null when nothing has been
 * overridden — an all-blank editor with every pack on stores NULL rather than
 * a document that merely restates the derived defaults. A pack switched off
 * counts as an override, since only this column can record it.
 */
export function packOptionsPayload(
  sizes: number[],
  rows: PackOptionDraft[],
): Array<{
  size: number;
  label: string | null;
  badge: string | null;
  price: number | null;
  compare_at: number | null;
  enabled: boolean;
}> | null {
  const wanted = rowsForSizes(normalizePackSizes(sizes), rows);
  const payload = wanted.map((row) => ({
    size: row.size,
    label: row.label.trim().length > 0 ? row.label.trim().slice(0, 60) : null,
    badge:
      row.badge.trim().length > 0 ? row.badge.trim().slice(0, MAX_PACK_BADGE_LENGTH) : null,
    price: money(row.price),
    compare_at: money(row.compare_at),
    enabled: row.enabled !== false,
  }));
  const overridden = payload.some(
    (row) =>
      row.label !== null ||
      row.badge !== null ||
      row.price !== null ||
      row.compare_at !== null ||
      !row.enabled,
  );
  return overridden ? payload : null;
}

export default function PackPricingEditor({
  sizes,
  rows,
  vialPrice,
  vialsPerBox,
  disabled = false,
  onChange,
}: PackPricingEditorProps) {
  const emit = (nextSizes: number[], nextRows: PackOptionDraft[]) => {
    const kept = rowsForSizes(nextSizes, nextRows);
    // Removing the last pack that was on would leave nothing on sale, so the
    // packs that remain go back on.
    const anyOn = kept.length === 0 || kept.some((row) => row.enabled !== false);
    onChange({
      sizes: nextSizes,
      rows: anyOn ? kept : kept.map((row) => ({ ...row, enabled: true })),
    });
  };

  const toggleSize = (size: number) => {
    const next = sizes.includes(size)
      ? sizes.filter((s) => s !== size)
      : normalizePackSizes([...sizes, size]);
    emit(next, rows);
  };

  const setRow = (size: number, patch: Partial<PackOptionDraft>) =>
    emit(sizes, rows.map((row) => (row.size === size ? { ...row, ...patch } : row)));

  const ordered = rowsForSizes(normalizePackSizes(sizes), rows);
  const enabledCount = ordered.filter((row) => row.enabled !== false).length;

  return (
    <div>
      <label className="block text-sm font-medium text-ink mb-2">Pack options &amp; pricing</label>

      {/* Which packs exist */}
      <div className="flex flex-wrap gap-2">
        {[...new Set([...PACK_SIZE_OPTIONS, ...sizes])]
          .sort((a, b) => a - b)
          .map((size) => {
            const on = sizes.includes(size);
            return (
              <button
                key={size}
                type="button"
                aria-pressed={on}
                disabled={disabled || (!on && sizes.length >= MAX_PACK_OPTIONS)}
                onClick={() => toggleSize(size)}
                className={`px-4 py-2 rounded-lg border text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  on
                    ? 'border-teal bg-teal/10 text-teal-dark'
                    : 'border-line bg-surface text-ink-muted hover:border-teal/40 hover:text-ink'
                }`}
              >
                {size === 1 ? '1 vial' : `${size}-pack`}
              </button>
            );
          })}
        {sizes.length > 0 && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => emit([], [])}
            className="px-3 py-2 rounded-lg border border-line bg-white text-xs font-medium text-ink-muted hover:text-ink hover:bg-surface disabled:opacity-40"
          >
            Use default
          </button>
        )}
      </div>

      {ordered.length === 0 ? (
        <p className="mt-2 text-[11px] text-ink-muted">
          No options set — the storefront offers the default pair: a single vial plus one full
          case of {vialsPerBox}, each priced at the vial price × its size.
        </p>
      ) : (
        <>
          <div className="mt-3 overflow-hidden rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface text-left text-[11px] uppercase tracking-wider text-ink-muted">
                  <th className="px-3 py-2 font-semibold">On</th>
                  <th className="px-3 py-2 font-semibold">Pack</th>
                  <th className="px-3 py-2 font-semibold">Button label</th>
                  <th className="px-3 py-2 font-semibold">Tag</th>
                  <th className="px-3 py-2 font-semibold">Price</th>
                  <th className="px-3 py-2 font-semibold">Compare at</th>
                  <th className="px-3 py-2 font-semibold">Customer sees</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {ordered.map((row) => {
                  const undiscounted = round2(vialPrice * row.size);
                  const price = money(row.price) ?? undiscounted;
                  const explicitCompare = money(row.compare_at);
                  const compareAt =
                    explicitCompare ?? (price < undiscounted ? undiscounted : null);
                  const savings = compareAt != null && compareAt > price
                    ? round2(compareAt - price)
                    : 0;
                  const perVial = round2(price / Math.max(1, row.size));
                  const on = row.enabled !== false;
                  // The last pack on sale stays on: a product with every pack
                  // off would have nothing to sell on its page.
                  const lockedOn = on && enabledCount <= 1;
                  return (
                    <tr key={row.size} className={`align-top ${on ? 'bg-white' : 'bg-surface/60'}`}>
                      <td className="px-3 py-2.5">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={on}
                          aria-label={`Offer the ${row.size === 1 ? 'single vial' : `${row.size}-pack`} on the storefront`}
                          disabled={disabled || lockedOn}
                          title={
                            lockedOn
                              ? 'At least one pack has to stay on'
                              : on
                                ? 'On sale. Click to hide this pack from the storefront'
                                : 'Hidden. Click to put this pack back on sale'
                          }
                          onClick={() => setRow(row.size, { enabled: !on })}
                          className={`relative mt-1 inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed ${
                            lockedOn ? '' : 'disabled:opacity-50'
                          } ${on ? 'bg-teal-dark' : 'bg-line'}`}
                        >
                          <span
                            className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                              on ? 'translate-x-[18px]' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      </td>
                      <td className={`px-3 py-2.5 font-semibold whitespace-nowrap ${on ? 'text-ink' : 'text-ink-muted'}`}>
                        {row.size === 1 ? '1 vial' : `${row.size} vials`}
                      </td>
                      <td className="px-3 py-2.5">
                        <input
                          type="text"
                          value={row.label}
                          disabled={disabled}
                          onChange={(e) => setRow(row.size, { label: e.target.value })}
                          placeholder={packLabel(row.size)}
                          className={boxClass}
                        />
                      </td>
                      {/* Merchandising chip. The presets are one click; the box
                          stays free text so a campaign can say anything. */}
                      <td className="px-3 py-2.5 w-40">
                        <input
                          type="text"
                          list="pack-badge-presets"
                          maxLength={MAX_PACK_BADGE_LENGTH}
                          value={row.badge}
                          disabled={disabled}
                          onChange={(e) => setRow(row.size, { badge: e.target.value })}
                          placeholder="No tag"
                          className={boxClass}
                        />
                        <div className="mt-1 flex flex-wrap gap-1">
                          {PACK_BADGE_PRESETS.map((preset) => {
                            const on = row.badge.trim().toLowerCase() === preset.toLowerCase();
                            return (
                              <button
                                key={preset}
                                type="button"
                                disabled={disabled}
                                onClick={() => setRow(row.size, { badge: on ? '' : preset })}
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors disabled:opacity-40 ${
                                  on
                                    ? 'border-teal bg-teal/10 text-teal-dark'
                                    : 'border-line bg-surface text-ink-muted hover:text-ink'
                                }`}
                              >
                                {preset}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 w-28">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.price}
                          disabled={disabled}
                          onChange={(e) => setRow(row.size, { price: e.target.value })}
                          placeholder={undiscounted.toFixed(2)}
                          className={boxClass}
                        />
                      </td>
                      <td className="px-3 py-2.5 w-28">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.compare_at}
                          disabled={disabled}
                          onChange={(e) => setRow(row.size, { compare_at: e.target.value })}
                          placeholder={savings > 0 && !explicitCompare ? undiscounted.toFixed(2) : '—'}
                          className={boxClass}
                        />
                      </td>
                      <td className={`px-3 py-2.5 text-[11px] leading-relaxed text-ink-muted tabular-nums ${on ? '' : 'opacity-60'}`}>
                        {!on && (
                          <span className="mb-1 flex items-center gap-1 font-semibold text-ink-muted">
                            <EyeOff className="h-3 w-3" />
                            Hidden from storefront
                          </span>
                        )}
                        {row.badge.trim().length > 0 && (
                          <span className="mb-1 inline-block rounded-full bg-teal-dark px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                            {row.badge.trim()}
                          </span>
                        )}
                        <span className="block font-semibold text-ink">
                          ${price.toFixed(2)}
                          {compareAt != null && (
                            <span className="ml-1.5 font-normal text-ink-muted line-through">
                              ${compareAt.toFixed(2)}
                            </span>
                          )}
                        </span>
                        <span className="block">${perVial.toFixed(2)} / vial</span>
                        {savings > 0 && (
                          <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700">
                            <Tag className="h-3 w-3" />
                            Save ${savings.toFixed(2)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <datalist id="pack-badge-presets">
            {PACK_BADGE_PRESETS.map((preset) => (
              <option key={preset} value={preset} />
            ))}
          </datalist>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
            Switch a pack <strong>off</strong> to stop selling it without losing its settings; at
            least one pack stays on. A <strong>Tag</strong> pins a chip to that pack&apos;s corner on the product page —
            use it to point customers at the pack you want them to buy. Leave <strong>Price</strong> blank to keep a pack at the vial price × its size
            (${vialPrice.toFixed(2)} each), so it follows the product price automatically. Type a
            lower price to discount the pack — the undiscounted figure becomes the struck-through
            &ldquo;was&rdquo; price on its own, unless you set <strong>Compare at</strong> yourself.
          </p>
        </>
      )}
    </div>
  );
}
