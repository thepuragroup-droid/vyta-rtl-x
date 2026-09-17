'use client';

/**
 * Cell-style update mode for the admin products screen — a spreadsheet grid
 * for the two things that get bulk-edited constantly: **prices** and
 * **stock**. Everything else about a product (copy, images, status, SKU) is
 * still edited from the normal table / product modal.
 *
 * ── Columns ────────────────────────────────────────────────────────────────
 *   SKU · Product name · Stock (vials) · Stock (cases) · Case price · Vial price
 *   · Pack options
 *
 * SKU and product name are read-only identity columns (still selectable so
 * they can be copied out). The other five are editable; four of them come in
 * two linked pairs, and Pack options stands on its own.
 *
 * ── How the case ⇄ vial columns interact ───────────────────────────────────
 *
 * STOCK — one stored number, two views.
 *   `products.stock_quantity` is counted in VIALS and is the only stock value
 *   the database holds. Cases are a projection of it through
 *   `products.vials_per_box` (the per-product "vials per case" factor, default
 *   10, shown under each product name):
 *
 *       cases = floor(vials / per)        loose = vials % per
 *
 *   - Editing **Stock (vials)** writes that number straight to
 *     `stock_quantity`.
 *   - Editing **Stock (cases)** with a whole number writes
 *     `cases * per + loose` — the loose vials already on the shelf are kept,
 *     because "make it 5 cases" shouldn't silently destroy the 3 odd vials
 *     sitting next to them. Typing a decimal (e.g. `2.5`) means the operator
 *     is describing the whole quantity, so it writes `round(cases * per)`
 *     with no remainder carried over.
 *   - Either edit repaints both stock cells, since they are the same field.
 *
 * PRICE — one rule, no pack discount.
 *   The storefront charges `case price = vial price × vials per case` (see
 *   `lib/pricing.ts`). `products.price` IS the case price; `products.vial_price`
 *   is an OPTIONAL override — when it is NULL the vial price is derived as
 *   `price / per` and the cell is badged "auto".
 *
 *   - Editing **Case price** writes `price`. If the row carries an explicit
 *     vial override, it is rescaled to `price / per` so the pair stays
 *     consistent; a row on "auto" needs no write — it re-derives itself.
 *   - Editing **Vial price** writes the override AND rewrites
 *     `price = vial × per`, so the case cell updates in the same keystroke.
 *   - Clearing **Vial price** (Delete, or committing an empty cell) sets the
 *     override back to NULL — "auto" — and leaves the case price alone.
 *   - Money is rounded to 2 decimals on every write, so a division that
 *     doesn't land evenly (e.g. $100 over 3 vials) can move the partner cell
 *     by a cent. The grid shows the rounded result before you save.
 *   - Pasting BOTH price columns at once applies them left to right, so the
 *     vial price lands last and wins. A consistent pair (the case price really
 *     is vial × per) agrees either way; an inconsistent pair resolves to
 *     `vial × per`, which is the number the storefront would have charged.
 *
 * PACK OPTIONS — which quantities a product is sold in.
 *   `products.pack_sizes` is a list of pack quantities, typed here as a plain
 *   comma-separated list: `1, 3, 5, 10`. Commas, spaces, slashes and pipes all
 *   parse, so a column pasted out of a spreadsheet lands as-is.
 *
 *   - An EMPTY cell means the product has not been opted in, and the
 *     storefront falls back to the historical pair — a single vial plus one
 *     full case of `vials_per_box`. The cell shows that fallback greyed out
 *     and badged "default", so what a customer sees is never a mystery.
 *   - Delete/Backspace clears a cell back to that default.
 *   - Pack pricing stays derived: a pack of N costs `vial price × N`, so
 *     editing the price columns reprices every pack at once and there is
 *     nothing extra to keep in sync.
 *   - Select a block of cells and use **Set pack options** in the toolbar to
 *     stage the same options across every selected row at once — the fastest
 *     way to opt a whole category in.
 *
 * Prices in this grid are the CAD base. USD is derived from the exchange rate
 * (or its own `price_usd` override) and is edited from the standard table.
 *
 * ── Editing model ──────────────────────────────────────────────────────────
 * Edits are staged locally as "drafts" keyed by product id and only hit the
 * API when Save is pressed (Excel-ish: type freely, commit deliberately).
 * Each dirty row is PATCHed to `/api/admin/products/[id]` with just the
 * columns that actually changed, so the server's history/audit/low-stock and
 * back-in-stock waitlist hooks all fire exactly as they do for a single
 * inline edit. Rows whose stock crosses 0 → positive are checked for
 * waitlisted customers first and confirmed before anything is written.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, Bell, Boxes, Check, ChevronDown, Info, Keyboard, RotateCcw, Save, X,
} from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import type { Product } from '@/lib/supabase';
import {
  PACK_SIZE_OPTIONS, casePriceFromVial, formatMoney, formatPackSizes,
  normalizePackSizes, packSizesFor, parsePackSizesInput, round2, samePackSizes,
  vialPriceFor, vialsPerBoxOf,
} from '@/lib/pricing';

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

type ColKey =
  | 'sku' | 'name' | 'stock_vials' | 'stock_cases' | 'price_case' | 'price_vial'
  | 'pack_options';

interface ColumnDef {
  key: ColKey;
  label: string;
  sub?: string;
  width: number;
  editable: boolean;
  numeric: boolean;
  /** Sticky (frozen) columns pin to the left like Excel's frozen panes. */
  frozen?: boolean;
}

const GUTTER_WIDTH = 44;

const COLUMNS: ColumnDef[] = [
  { key: 'sku',         label: 'SKU',          width: 150, editable: false, numeric: false, frozen: true },
  { key: 'name',        label: 'Product name', width: 260, editable: false, numeric: false, frozen: true },
  { key: 'stock_vials', label: 'Stock',        sub: 'vials',      width: 130, editable: true, numeric: true },
  { key: 'stock_cases', label: 'Stock',        sub: 'cases',      width: 130, editable: true, numeric: true },
  { key: 'price_case',  label: 'Case price',   sub: 'CAD',        width: 150, editable: true, numeric: true },
  { key: 'price_vial',  label: 'Vial price',   sub: 'CAD',        width: 150, editable: true, numeric: true },
  { key: 'pack_options', label: 'Pack options', sub: 'vials per pack', width: 190, editable: true, numeric: false },
];

const FIRST_EDITABLE_COL = COLUMNS.findIndex((c) => c.editable);
const LAST_COL = COLUMNS.length - 1;

/** Left offset of each frozen column, in px (gutter first, then SKU, name). */
const FROZEN_LEFT: number[] = (() => {
  const offsets: number[] = [];
  let x = GUTTER_WIDTH;
  for (const col of COLUMNS) {
    offsets.push(col.frozen ? x : 0);
    if (col.frozen) x += col.width;
  }
  return offsets;
})();

// ---------------------------------------------------------------------------
// Draft / row model
// ---------------------------------------------------------------------------

/**
 * A staged change for one product. Only the three DB columns this grid can
 * write appear here; a key being absent means "not touched". `vial_price`
 * is explicitly nullable (null = clear the override back to auto), so
 * presence has to be tested with `in` rather than `!== undefined`.
 */
interface Draft {
  stock_quantity?: number;
  price?: number;
  vial_price?: number | null;
  /** null = clear the opt-in (back to single vial + full case). */
  pack_sizes?: number[] | null;
}

type Drafts = Record<string, Draft>;

type RowStatus = 'saving' | 'saved' | 'error';

interface RowView {
  product: Product;
  /** Vials per case for this product (>= 1). */
  per: number;
  stock: number;
  cases: number;
  loose: number;
  price: number;
  /** Explicit per-vial override, or null when the row derives it. */
  vialOverride: number | null;
  /** Effective vial price (override, else case price ÷ per). */
  vialPrice: number;
  /** Explicit pack options, or null when the row is on the default pair. */
  packOverride: number[] | null;
  /** What the storefront actually offers — the override, else [1, per]. */
  packSizes: number[];
  dirty: Set<ColKey>;
}

interface CellRef {
  row: number;
  col: number;
}

interface EditState extends CellRef {
  value: string;
  /** True when the edit was opened by typing a character (Excel "enter mode":
   *  arrow keys commit and move instead of moving the text caret). */
  typed: boolean;
}

interface RestockPrompt {
  rows: Array<{ id: string; name: string; emails: string[] }>;
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

/** Parse a pasted / typed number, tolerating `$`, thousands commas and spaces. */
function parseNumeric(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.\-]/g, '').trim();
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Frozen panes are desktop-only: 454px of pinned columns would leave a phone
 * with nothing to scroll into. Header and body cells must agree on this, so
 * both read the same hook rather than a `md:` class on one and not the other.
 */
function useFrozenPanes(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const sync = () => setEnabled(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return enabled;
}

/** Null-safe compare for the nullable `vial_price` override. */
function sameOverride(a: number | null | undefined, b: number | null | undefined): boolean {
  const na = a == null ? null : round2(Number(a));
  const nb = b == null ? null : round2(Number(b));
  return na === nb;
}

/** Build the visible state of one row from its product + staged draft. */
function buildRowView(product: Product, draft: Draft | undefined): RowView {
  const per = vialsPerBoxOf(product.vials_per_box);
  const stock = Math.max(0, Math.floor(draft?.stock_quantity ?? product.stock_quantity ?? 0));
  const price = round2(draft?.price ?? product.price ?? 0);
  const vialOverride = draft && 'vial_price' in draft
    ? (draft.vial_price ?? null)
    : (product.vial_price ?? null);
  const vialPrice = vialPriceFor({ price, vial_price: vialOverride, vials_per_box: per });

  const rawPacks = draft && 'pack_sizes' in draft
    ? (draft.pack_sizes ?? null)
    : (product.pack_sizes ?? null);
  const explicitPacks = normalizePackSizes(rawPacks);
  const packOverride = explicitPacks.length > 0 ? explicitPacks : null;
  const packSizes = packSizesFor({ price, vials_per_box: per, pack_sizes: packOverride });

  const dirty = new Set<ColKey>();
  if (draft) {
    if (draft.stock_quantity !== undefined && draft.stock_quantity !== product.stock_quantity) {
      // One stored field behind two cells — light both so the link is visible.
      dirty.add('stock_vials');
      dirty.add('stock_cases');
    }
    if (draft.price !== undefined && round2(draft.price) !== round2(product.price)) {
      dirty.add('price_case');
    }
    if ('vial_price' in draft && !sameOverride(draft.vial_price, product.vial_price)) {
      dirty.add('price_vial');
    }
    if ('pack_sizes' in draft && !samePackSizes(draft.pack_sizes, product.pack_sizes)) {
      dirty.add('pack_options');
    }
  }

  return {
    product, per, stock,
    cases: Math.floor(stock / per),
    loose: stock % per,
    price, vialOverride, vialPrice, packOverride, packSizes, dirty,
  };
}

/** Text shown in a cell when it is NOT being edited. */
function displayValue(view: RowView, key: ColKey): string {
  switch (key) {
    case 'sku':         return view.product.sku || '—';
    case 'name':        return view.product.name;
    case 'stock_vials': return String(view.stock);
    case 'stock_cases': return String(view.cases);
    case 'price_case':  return formatMoney(view.price, 'CAD');
    case 'price_vial':  return formatMoney(view.vialPrice, 'CAD');
    // An empty override still shows what the storefront offers — the cell is
    // badged "default" so the greyed value reads as inherited, not as a value.
    case 'pack_options': return formatPackSizes(view.packSizes);
  }
}

/** Raw text seeded into the editor / written to the clipboard. */
function rawValue(view: RowView, key: ColKey): string {
  switch (key) {
    case 'sku':         return view.product.sku || '';
    case 'name':        return view.product.name;
    case 'stock_vials': return String(view.stock);
    case 'stock_cases': return String(view.cases);
    case 'price_case':  return view.price.toFixed(2);
    // Blank when the row is on "auto" — an empty cell IS how you say "derive it".
    case 'price_vial':  return view.vialOverride != null ? view.vialOverride.toFixed(2) : '';
    // Blank when the row is on the default pair — an empty cell IS how you
    // say "not opted in".
    case 'pack_options': return view.packOverride ? formatPackSizes(view.packOverride) : '';
  }
}

/**
 * Fold one committed cell edit into the row's draft. This is where the whole
 * case ⇄ vial relationship lives; see the file header for the rules it
 * implements. Returns the next draft, or null when the input is unusable
 * (blank/negative/NaN in a column that has no "empty" meaning).
 */
function applyCellEdit(
  view: RowView,
  key: ColKey,
  raw: string,
  current: Draft | undefined,
): Draft | null {
  const draft: Draft = { ...(current ?? {}) };
  const per = view.per;
  const text = raw.trim();

  switch (key) {
    case 'stock_vials': {
      const n = parseNumeric(text);
      if (n == null || n < 0) return null;
      draft.stock_quantity = Math.floor(n);
      return draft;
    }

    case 'stock_cases': {
      const n = parseNumeric(text);
      if (n == null || n < 0) return null;
      // Whole cases keep the loose vials already on hand; a fractional case
      // count describes the total quantity outright.
      draft.stock_quantity = Number.isInteger(n)
        ? n * per + view.loose
        : Math.max(0, Math.round(n * per));
      return draft;
    }

    case 'price_case': {
      const n = parseNumeric(text);
      if (n == null || n < 0) return null;
      const casePrice = round2(n);
      draft.price = casePrice;
      // Only a row with an explicit override needs rescaling — an "auto" row
      // re-derives `price / per` on its own and must stay NULL.
      if (view.vialOverride != null) {
        draft.vial_price = round2(casePrice / per);
      }
      return draft;
    }

    case 'pack_options': {
      // Empty clears the opt-in; anything else is parsed leniently so a pasted
      // `1/3/5/10` or `1 3 5 10` lands the same as `1, 3, 5, 10`.
      const sizes = parsePackSizesInput(text);
      draft.pack_sizes = sizes.length > 0 ? sizes : null;
      return draft;
    }

    case 'price_vial': {
      // Empty clears the override back to auto; the case price is untouched.
      if (text === '') {
        draft.vial_price = null;
        return draft;
      }
      const n = parseNumeric(text);
      if (n == null || n < 0) return null;
      const vial = round2(n);
      draft.vial_price = vial;
      draft.price = casePriceFromVial(vial, per);
      return draft;
    }

    default:
      return null; // read-only column
  }
}

/** Drop keys that ended up matching the saved product again (a no-op edit). */
function pruneDraft(product: Product, draft: Draft): Draft | null {
  const next: Draft = {};
  if (draft.stock_quantity !== undefined && draft.stock_quantity !== product.stock_quantity) {
    next.stock_quantity = draft.stock_quantity;
  }
  if (draft.price !== undefined && round2(draft.price) !== round2(product.price)) {
    next.price = round2(draft.price);
  }
  if ('vial_price' in draft && !sameOverride(draft.vial_price, product.vial_price)) {
    next.vial_price = draft.vial_price ?? null;
  }
  if ('pack_sizes' in draft && !samePackSizes(draft.pack_sizes, product.pack_sizes)) {
    next.pack_sizes = draft.pack_sizes ?? null;
  }
  return Object.keys(next).length > 0 ? next : null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface CellEditGridProps {
  /** Rows to show — already searched/filtered by the parent screen. */
  products: Product[];
  /** Admin-only. When false the grid is a read-only, copyable spreadsheet. */
  canEdit: boolean;
  /** Fresh product rows returned by the API after a successful save. */
  onSaved: (updated: Product[]) => void;
  /** Lets the parent warn before navigating away with staged edits. */
  onDirtyCountChange?: (count: number) => void;
}

export default function CellEditGrid({
  products, canEdit, onSaved, onDirtyCountChange,
}: CellEditGridProps) {
  const [drafts, setDrafts] = useState<Drafts>({});
  const [anchor, setAnchor] = useState<CellRef>({ row: 0, col: FIRST_EDITABLE_COL });
  const [extent, setExtent] = useState<CellRef>({ row: 0, col: FIRST_EDITABLE_COL });
  const [editing, setEditing] = useState<EditState | null>(null);
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [notice, setNotice] = useState('');
  const [restockPrompt, setRestockPrompt] = useState<RestockPrompt | null>(null);
  // Toolbar pack-options picker: which sizes are ticked, and whether it's open.
  const [packPickerOpen, setPackPickerOpen] = useState(false);
  const [packPicked, setPackPicked] = useState<number[]>([1, 10]);
  const frozen = useFrozenPanes();

  const gridRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());
  const undoStack = useRef<Drafts[]>([]);
  const editInputRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(
    () => products.map((p) => buildRowView(p, drafts[p.id])),
    [products, drafts],
  );

  const dirtyIds = useMemo(
    () => products.map((p) => p.id).filter((id) => drafts[id]),
    [products, drafts],
  );
  const dirtyCount = Object.keys(drafts).length;

  useEffect(() => { onDirtyCountChange?.(dirtyCount); }, [dirtyCount, onDirtyCountChange]);

  // Guard a browser reload/close while edits are only staged locally.
  useEffect(() => {
    if (dirtyCount === 0) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirtyCount]);

  // Keep the selection inside the grid when the filtered row set shrinks.
  useEffect(() => {
    const max = Math.max(0, products.length - 1);
    setAnchor((a) => (a.row > max ? { ...a, row: max } : a));
    setExtent((e) => (e.row > max ? { ...e, row: max } : e));
  }, [products.length]);

  const selection = useMemo(() => ({
    r1: Math.min(anchor.row, extent.row),
    r2: Math.max(anchor.row, extent.row),
    c1: Math.min(anchor.col, extent.col),
    c2: Math.max(anchor.col, extent.col),
  }), [anchor, extent]);

  const inSelection = (row: number, col: number) =>
    row >= selection.r1 && row <= selection.r2 && col >= selection.c1 && col <= selection.c2;

  // ---- selection / navigation -------------------------------------------

  const focusGrid = useCallback(() => {
    // Defer so the editor input has finished unmounting before we steal focus.
    requestAnimationFrame(() => gridRef.current?.focus());
  }, []);

  const scrollCellIntoView = useCallback((row: number, col: number) => {
    const el = cellRefs.current.get(`${row}:${col}`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, []);

  const selectCell = useCallback((row: number, col: number, extend = false) => {
    const r = Math.max(0, Math.min(row, products.length - 1));
    const c = Math.max(0, Math.min(col, LAST_COL));
    if (extend) {
      setExtent({ row: r, col: c });
    } else {
      setAnchor({ row: r, col: c });
      setExtent({ row: r, col: c });
    }
    scrollCellIntoView(r, c);
  }, [products.length, scrollCellIntoView]);

  /** Move the active cell by a delta, wrapping across row ends for Tab/Enter. */
  const moveBy = useCallback((dr: number, dc: number, opts: { extend?: boolean; wrap?: boolean } = {}) => {
    const base = opts.extend ? extent : anchor;
    let row = base.row + dr;
    let col = base.col + dc;

    if (opts.wrap && dc !== 0) {
      if (col > LAST_COL) { col = 0; row += 1; }
      else if (col < 0) { col = LAST_COL; row -= 1; }
    }
    if (row < 0 || row > products.length - 1) {
      row = Math.max(0, Math.min(row, products.length - 1));
    }
    selectCell(row, col, opts.extend);
  }, [anchor, extent, products.length, selectCell]);

  // ---- draft mutation ----------------------------------------------------

  const pushUndo = useCallback((snapshot: Drafts) => {
    undoStack.current.push(snapshot);
    if (undoStack.current.length > 60) undoStack.current.shift();
  }, []);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (prev) setDrafts(prev);
  }, []);

  /**
   * Write a batch of cells. Batching matters: a paste or a fill-down is one
   * user action and must cost exactly one undo step. The next draft map is
   * built eagerly (rather than inside a setState updater) so the undo stack
   * — a ref — is only ever touched from an effectful code path.
   */
  const commitEdits = useCallback((
    edits: Array<{ row: number; col: number; raw: string }>,
  ) => {
    if (!canEdit || edits.length === 0) return;
    const next: Drafts = { ...drafts };
    let changed = false;

    for (const { row, col, raw } of edits) {
      const product = products[row];
      const column = COLUMNS[col];
      if (!product || !column?.editable) continue;
      // Rebuild the view against the in-progress draft so two edits landing on
      // the same row (a pasted case+vial pair) compose instead of clobbering.
      const view = buildRowView(product, next[product.id]);
      const result = applyCellEdit(view, column.key, raw, next[product.id]);
      if (!result) continue;
      const pruned = pruneDraft(product, result);
      if (pruned) next[product.id] = pruned;
      else delete next[product.id];
      changed = true;
    }
    if (!changed) return;

    pushUndo(drafts);
    setDrafts(next);
    // A row edited after a failed save should stop showing the stale error.
    setRowStatus((prev) => {
      const cleaned = { ...prev };
      for (const { row } of edits) {
        const id = products[row]?.id;
        if (id && cleaned[id] !== 'saving') delete cleaned[id];
      }
      return cleaned;
    });
  }, [canEdit, drafts, products, pushUndo]);

  // ---- editor ------------------------------------------------------------

  const beginEdit = useCallback((row: number, col: number, seed?: string) => {
    if (!canEdit) return;
    const column = COLUMNS[col];
    const view = rows[row];
    if (!column?.editable || !view) return;
    setEditing({
      row, col,
      value: seed !== undefined ? seed : rawValue(view, column.key),
      typed: seed !== undefined,
    });
  }, [canEdit, rows]);

  const cancelEdit = useCallback(() => { setEditing(null); focusGrid(); }, [focusGrid]);

  const commitEdit = useCallback((dr: number, dc: number, wrap = false, refocus = true) => {
    const cur = editing;
    if (!cur) return;
    setEditing(null);
    commitEdits([{ row: cur.row, col: cur.col, raw: cur.value }]);
    if (dr !== 0 || dc !== 0) {
      // Step off the editor's own position, not the selection, so a
      // click-away mid-edit can't send the cursor somewhere unexpected.
      let row = cur.row + dr;
      let col = cur.col + dc;
      if (wrap && dc !== 0) {
        if (col > LAST_COL) { col = 0; row += 1; }
        else if (col < 0) { col = LAST_COL; row -= 1; }
      }
      selectCell(row, col);
    }
    if (refocus) focusGrid();
  }, [editing, commitEdits, selectCell, focusGrid]);

  /**
   * Blur commits, like a spreadsheet — but only pull focus back into the grid
   * when the click stayed inside it. Clicking Save or Discard must keep its
   * own focus, or the button loses the click that just committed the cell.
   */
  const handleEditBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    const next = e.relatedTarget as Node | null;
    const leftTheGrid = !!next && !gridRef.current?.contains(next);
    commitEdit(0, 0, false, !leftTheGrid);
  }, [commitEdit]);

  // ---- clipboard ---------------------------------------------------------

  const handleCopy = useCallback((e: React.ClipboardEvent) => {
    if (editing) return;
    const lines: string[] = [];
    for (let r = selection.r1; r <= selection.r2; r++) {
      const view = rows[r];
      if (!view) continue;
      const cells: string[] = [];
      for (let c = selection.c1; c <= selection.c2; c++) {
        cells.push(rawValue(view, COLUMNS[c].key));
      }
      lines.push(cells.join('\t'));
    }
    e.clipboardData.setData('text/plain', lines.join('\n'));
    e.preventDefault();
    const cellCount = (selection.r2 - selection.r1 + 1) * (selection.c2 - selection.c1 + 1);
    setNotice(`Copied ${cellCount} cell${cellCount === 1 ? '' : 's'}`);
  }, [editing, rows, selection]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (editing || !canEdit) return;
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();

    // Excel and Sheets both hand over TSV; a trailing newline is normal.
    const matrix = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    const edits: Array<{ row: number; col: number; raw: string }> = [];
    let skippedReadOnly = 0;

    for (let r = 0; r < matrix.length; r++) {
      const targetRow = selection.r1 + r;
      if (targetRow > products.length - 1) break;
      for (let c = 0; c < matrix[r].length; c++) {
        const targetCol = selection.c1 + c;
        if (targetCol > LAST_COL) break;
        if (!COLUMNS[targetCol].editable) { skippedReadOnly++; continue; }
        edits.push({ row: targetRow, col: targetCol, raw: matrix[r][c] });
      }
    }
    commitEdits(edits);
    // Mirror the pasted block as the new selection, like a spreadsheet does.
    const lastRow = Math.min(products.length - 1, selection.r1 + matrix.length - 1);
    const lastCol = Math.min(LAST_COL, selection.c1 + Math.max(...matrix.map((m) => m.length)) - 1);
    setAnchor({ row: selection.r1, col: selection.c1 });
    setExtent({ row: lastRow, col: lastCol });
    setNotice(
      `Pasted ${edits.length} cell${edits.length === 1 ? '' : 's'}` +
      (skippedReadOnly > 0 ? ` (${skippedReadOnly} read-only cell${skippedReadOnly === 1 ? '' : 's'} skipped)` : ''),
    );
  }, [editing, canEdit, selection, products.length, commitEdits]);

  /** Ctrl/Cmd+D — copy the top row of the selection down through it. */
  const fillDown = useCallback(() => {
    if (!canEdit) return;
    const sourceRow = rows[selection.r1];
    if (!sourceRow || selection.r2 === selection.r1) return;
    const edits: Array<{ row: number; col: number; raw: string }> = [];
    for (let r = selection.r1 + 1; r <= selection.r2; r++) {
      for (let c = selection.c1; c <= selection.c2; c++) {
        if (!COLUMNS[c].editable) continue;
        edits.push({ row: r, col: c, raw: rawValue(sourceRow, COLUMNS[c].key) });
      }
    }
    commitEdits(edits);
    setNotice(`Filled ${edits.length} cell${edits.length === 1 ? '' : 's'} down`);
  }, [canEdit, rows, selection, commitEdits]);

  /**
   * Delete/Backspace — only the two "inherited" columns have a meaningful
   * empty: a vial price falls back to auto, pack options to the default pair.
   */
  const clearSelection = useCallback(() => {
    if (!canEdit) return;
    const edits: Array<{ row: number; col: number; raw: string }> = [];
    const cleared = new Set<ColKey>();
    let blocked = 0;
    for (let r = selection.r1; r <= selection.r2; r++) {
      for (let c = selection.c1; c <= selection.c2; c++) {
        const key = COLUMNS[c].key;
        if (!COLUMNS[c].editable) continue;
        if (key === 'price_vial' || key === 'pack_options') {
          edits.push({ row: r, col: c, raw: '' });
          cleared.add(key);
        } else blocked++;
      }
    }
    if (edits.length > 0) {
      commitEdits(edits);
      const parts: string[] = [];
      if (cleared.has('price_vial')) parts.push('Vial price reset to auto');
      if (cleared.has('pack_options')) parts.push('Pack options reset to default');
      setNotice(parts.join(' · '));
    } else if (blocked > 0) {
      setNotice('Stock and case price can’t be blank — type a number instead');
    }
  }, [canEdit, selection, commitEdits]);

  /**
   * Stage one set of pack options across every row in the selection. This is
   * the bulk path the products screen points at: select a block of rows, pick
   * the pack sizes once, Save. `null` clears them back to the default pair.
   */
  const applyPackOptionsToSelection = useCallback((sizes: number[] | null) => {
    if (!canEdit) return;
    const col = COLUMNS.findIndex((c) => c.key === 'pack_options');
    if (col < 0) return;
    const raw = sizes && sizes.length > 0 ? formatPackSizes(sizes) : '';
    const edits: Array<{ row: number; col: number; raw: string }> = [];
    for (let r = selection.r1; r <= selection.r2; r++) edits.push({ row: r, col, raw });
    commitEdits(edits);
    const rowCount = selection.r2 - selection.r1 + 1;
    setNotice(
      raw
        ? `Pack options ${raw} staged on ${rowCount} row${rowCount === 1 ? '' : 's'}`
        : `Pack options reset to default on ${rowCount} row${rowCount === 1 ? '' : 's'}`,
    );
  }, [canEdit, selection, commitEdits]);

  // ---- grid key handling -------------------------------------------------

  const handleGridKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return; // the editor input owns the keyboard while it is open
    const mod = e.metaKey || e.ctrlKey;
    const { key, shiftKey } = e;

    if (mod && (key === 's' || key === 'S')) { e.preventDefault(); void saveAll(); return; }
    if (mod && (key === 'z' || key === 'Z')) { e.preventDefault(); undo(); return; }
    if (mod && (key === 'd' || key === 'D')) { e.preventDefault(); fillDown(); return; }
    if (mod && (key === 'a' || key === 'A')) {
      e.preventDefault();
      setAnchor({ row: 0, col: 0 });
      setExtent({ row: products.length - 1, col: LAST_COL });
      return;
    }

    switch (key) {
      case 'ArrowUp':    e.preventDefault(); moveBy(-1, 0, { extend: shiftKey }); return;
      case 'ArrowDown':  e.preventDefault(); moveBy(1, 0, { extend: shiftKey }); return;
      case 'ArrowLeft':  e.preventDefault(); moveBy(0, -1, { extend: shiftKey }); return;
      case 'ArrowRight': e.preventDefault(); moveBy(0, 1, { extend: shiftKey }); return;
      case 'Tab':        e.preventDefault(); moveBy(0, shiftKey ? -1 : 1, { wrap: true }); return;
      case 'PageUp':     e.preventDefault(); moveBy(-10, 0, { extend: shiftKey }); return;
      case 'PageDown':   e.preventDefault(); moveBy(10, 0, { extend: shiftKey }); return;
      case 'Home':
        e.preventDefault();
        selectCell(mod ? 0 : anchor.row, 0, shiftKey);
        return;
      case 'End':
        e.preventDefault();
        selectCell(mod ? products.length - 1 : anchor.row, LAST_COL, shiftKey);
        return;
      case 'Enter':
      case 'F2':
        e.preventDefault();
        beginEdit(anchor.row, anchor.col);
        return;
      case 'Escape':
        e.preventDefault();
        setExtent(anchor);
        return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        clearSelection();
        return;
    }

    // Typing a digit (or `-`/`.`/`,`) over a cell replaces it, exactly like
    // Excel. The comma is what lets a pack-options list be typed straight in.
    if (!mod && !e.altKey && key.length === 1 && /[0-9.,\-]/.test(key)) {
      e.preventDefault();
      beginEdit(anchor.row, anchor.col, key);
    }
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!editing) return;
    const { key, shiftKey } = e;
    if (key === 'Escape') { e.preventDefault(); cancelEdit(); return; }
    if (key === 'Enter')  { e.preventDefault(); commitEdit(shiftKey ? -1 : 1, 0); return; }
    if (key === 'Tab')    { e.preventDefault(); commitEdit(0, shiftKey ? -1 : 1, true); return; }
    // Arrows commit only in "enter mode" (opened by typing); an edit opened
    // with Enter/F2/double-click keeps arrows for moving the text caret.
    if (editing.typed && (key === 'ArrowUp' || key === 'ArrowDown')) {
      e.preventDefault();
      commitEdit(key === 'ArrowUp' ? -1 : 1, 0);
      return;
    }
    if (editing.typed && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      e.preventDefault();
      commitEdit(0, key === 'ArrowLeft' ? -1 : 1);
    }
  };

  // Transient toast for copy/paste/fill feedback.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 2600);
    return () => clearTimeout(t);
  }, [notice]);

  // ---- saving ------------------------------------------------------------

  const buildPayload = (product: Product, draft: Draft) => {
    const payload: Record<string, unknown> = { change_source: 'cell-grid' };
    if (draft.stock_quantity !== undefined && draft.stock_quantity !== product.stock_quantity) {
      payload.stock_quantity = draft.stock_quantity;
    }
    if (draft.price !== undefined && round2(draft.price) !== round2(product.price)) {
      payload.price = round2(draft.price);
    }
    if ('vial_price' in draft && !sameOverride(draft.vial_price, product.vial_price)) {
      payload.vial_price = draft.vial_price ?? null;
    }
    if ('pack_sizes' in draft && !samePackSizes(draft.pack_sizes, product.pack_sizes)) {
      payload.pack_sizes = draft.pack_sizes ?? null;
    }
    return payload;
  };

  const persist = useCallback(async () => {
    setSaving(true);
    setNotice('');
    const targets = products.filter((p) => drafts[p.id]);
    setRowStatus(Object.fromEntries(targets.map((p) => [p.id, 'saving' as RowStatus])));
    setRowErrors({});

    const updated: Product[] = [];
    const savedIds: string[] = [];
    const failures: Record<string, string> = {};

    // Small concurrency window: fast enough for a full page of edits without
    // hammering the API (each PATCH also runs history + low-stock hooks).
    const BATCH = 4;
    for (let i = 0; i < targets.length; i += BATCH) {
      const slice = targets.slice(i, i + BATCH);
      await Promise.all(slice.map(async (product) => {
        const draft = drafts[product.id];
        if (!draft) return;
        try {
          const res = await apiFetch<{ product: Product }>(`/api/admin/products/${product.id}`, {
            method: 'PATCH',
            body: JSON.stringify(buildPayload(product, draft)),
          });
          if (res?.product) updated.push(res.product);
          savedIds.push(product.id);
        } catch (err: any) {
          failures[product.id] = err?.message || 'Save failed';
        }
      }));
    }

    // Only clear the drafts that actually landed — a failed row keeps its
    // staged value so the operator can retry without retyping.
    setDrafts((prev) => {
      const next = { ...prev };
      for (const id of savedIds) delete next[id];
      return next;
    });
    setRowErrors(failures);
    setRowStatus({
      ...Object.fromEntries(savedIds.map((id) => [id, 'saved' as RowStatus])),
      ...Object.fromEntries(Object.keys(failures).map((id) => [id, 'error' as RowStatus])),
    });
    if (updated.length > 0) onSaved(updated);
    setSaving(false);

    const failCount = Object.keys(failures).length;
    setNotice(
      failCount === 0
        ? `Saved ${savedIds.length} product${savedIds.length === 1 ? '' : 's'}`
        : `Saved ${savedIds.length}, ${failCount} failed`,
    );
    if (failCount === 0) {
      setTimeout(() => setRowStatus({}), 2500);
    }
  }, [products, drafts, onSaved]);

  /**
   * Save entry point. Any row crossing 0 → positive stock will make the API
   * email that product's waitlist, so surface who gets mailed and get an
   * explicit OK first — same guarantee the single-cell inline editor gives.
   */
  const saveAll = useCallback(async () => {
    if (!canEdit || saving || dirtyIds.length === 0) return;

    const restocked = products.filter((p) => {
      const d = drafts[p.id];
      return d?.stock_quantity !== undefined && (p.stock_quantity ?? 0) <= 0 && d.stock_quantity > 0;
    });

    if (restocked.length > 0) {
      const waitlists = await Promise.all(restocked.map(async (p) => {
        try {
          const data = await apiFetch<{ emails?: string[] }>(
            `/api/admin/stock-notifications?product_id=${p.id}`,
          );
          return { id: p.id, name: p.name, emails: data.emails ?? [] };
        } catch {
          return { id: p.id, name: p.name, emails: [] };
        }
      }));
      const withWaiters = waitlists.filter((w) => w.emails.length > 0);
      if (withWaiters.length > 0) {
        setRestockPrompt({ rows: withWaiters });
        return;
      }
    }
    await persist();
  }, [canEdit, saving, dirtyIds.length, products, drafts, persist]);

  const discardAll = () => {
    if (dirtyCount === 0) return;
    pushUndo(drafts);
    setDrafts({});
    setRowStatus({});
    setRowErrors({});
    setNotice('Changes discarded');
  };

  // ---- render ------------------------------------------------------------

  const totalWidth = GUTTER_WIDTH + COLUMNS.reduce((acc, c) => acc + c.width, 0);
  const sum = selectionSum(rows, selection);

  return (
    <div className="bg-white rounded-xl border border-line overflow-hidden">
      {/* Grid toolbar */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line bg-surface">
        <div className="flex items-center gap-2 text-sm text-ink">
          <span className="font-semibold">Cell edit</span>
          <span className="text-ink-muted">·</span>
          <span className="text-ink-muted">
            {products.length} row{products.length === 1 ? '' : 's'}
          </span>
          {dirtyCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-xs font-medium">
              {dirtyCount} unsaved
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {notice && <span className="text-xs text-ink-muted">{notice}</span>}
          <button
            type="button"
            onClick={() => setShowHelp((s) => !s)}
            className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-line bg-white text-ink-muted hover:text-ink hover:bg-surface text-sm"
            title="How this grid works"
            aria-expanded={showHelp}
          >
            <Keyboard className="w-4 h-4" />
            Shortcuts
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showHelp ? 'rotate-180' : ''}`} />
          </button>
          {canEdit && (
            <PackOptionsMenu
              open={packPickerOpen}
              onOpenChange={setPackPickerOpen}
              picked={packPicked}
              onPickedChange={setPackPicked}
              rowCount={selection.r2 - selection.r1 + 1}
              onApply={(sizes) => {
                applyPackOptionsToSelection(sizes);
                setPackPickerOpen(false);
              }}
            />
          )}
          {canEdit && (
            <>
              <button
                type="button"
                onClick={discardAll}
                disabled={dirtyCount === 0 || saving}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line bg-white text-ink text-sm hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-4 h-4" />
                Discard
              </button>
              <button
                type="button"
                onClick={() => void saveAll()}
                disabled={dirtyCount === 0 || saving}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-ink text-white text-sm font-medium hover:bg-ink/90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving
                  ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  : <Save className="w-4 h-4" />}
                {saving ? 'Saving…' : `Save${dirtyCount > 0 ? ` (${dirtyCount})` : ''}`}
              </button>
            </>
          )}
        </div>
      </div>

      {!canEdit && (
        <div className="flex items-start gap-2 px-4 py-2.5 bg-surface/60 border-b border-line text-xs text-ink-muted">
          <Info className="w-4 h-4 flex-shrink-0 mt-px" />
          <span>Read-only — your role can’t change prices or stock. You can still select and copy cells.</span>
        </div>
      )}

      {showHelp && <HelpPanel />}

      {/* The spreadsheet itself */}
      <div
        ref={gridRef}
        tabIndex={0}
        role="grid"
        aria-label="Product price and stock grid"
        aria-rowcount={products.length + 1}
        aria-colcount={COLUMNS.length}
        onKeyDown={handleGridKeyDown}
        onCopy={handleCopy}
        onPaste={handlePaste}
        className="overflow-auto max-h-[70vh] outline-none focus:ring-2 focus:ring-inset focus:ring-teal/30"
      >
        {/* `table-fixed` + explicit widths keeps the frozen-pane pixel offsets
            exact. The last column is left auto so a wide screen absorbs the
            slack there instead of stretching (and desynchronising) the
            pinned columns. */}
        <table
          className="table-fixed w-full border-separate border-spacing-0 text-sm"
          style={{ minWidth: totalWidth }}
        >
          <colgroup>
            <col style={{ width: GUTTER_WIDTH }} />
            {COLUMNS.map((c, i) => (
              <col key={c.key} style={i === LAST_COL ? undefined : { width: c.width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {/* Corner box — pinned on both axes, above everything else */}
              <th
                scope="col"
                className="sticky top-0 z-40 bg-surface-2 border-b border-r border-line px-0 py-2"
                style={frozen ? { left: 0 } : undefined}
              />
              {COLUMNS.map((col, ci) => {
                const highlighted = ci >= selection.c1 && ci <= selection.c2;
                const pinned = col.frozen && frozen;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    className={`sticky top-0 ${pinned ? 'z-30' : 'z-20'} border-b border-r border-line px-3 py-2 text-left align-bottom ${
                      highlighted ? 'bg-teal/15' : 'bg-surface-2'
                    }`}
                    style={pinned ? { left: FROZEN_LEFT[ci] } : undefined}
                  >
                    <div className="text-[11px] font-semibold text-ink uppercase tracking-wider leading-tight">
                      {col.label}
                    </div>
                    {col.sub && (
                      <div className="text-[10px] font-medium text-ink-muted lowercase tracking-wide">
                        {col.sub}
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-5 py-12 text-center text-ink-muted text-sm">
                  No products found
                </td>
              </tr>
            ) : rows.map((view, ri) => {
              const status = rowStatus[view.product.id];
              const rowSelected = ri >= selection.r1 && ri <= selection.r2;
              return (
                <tr key={view.product.id} className="group">
                  {/* Row-number gutter, doubling as the per-row save indicator */}
                  <th
                    scope="row"
                    onClick={() => selectCell(ri, 0)}
                    title={rowErrors[view.product.id] || `Row ${ri + 1}`}
                    className={`${frozen ? 'sticky z-10' : ''} border-b border-r border-line text-center align-middle cursor-pointer select-none text-[11px] tabular-nums ${
                      rowSelected ? 'bg-teal/15 text-ink font-semibold' : 'bg-surface-2 text-ink-muted font-normal'
                    }`}
                    style={frozen ? { left: 0 } : undefined}
                  >
                    {status === 'saving' ? (
                      <div className="mx-auto animate-spin rounded-full h-3 w-3 border-b-2 border-teal" />
                    ) : status === 'saved' ? (
                      <Check className="w-3.5 h-3.5 mx-auto text-emerald-600" />
                    ) : status === 'error' ? (
                      <AlertCircle className="w-3.5 h-3.5 mx-auto text-red-600" />
                    ) : (
                      ri + 1
                    )}
                  </th>

                  {COLUMNS.map((col, ci) => (
                    <GridCell
                      key={col.key}
                      col={col}
                      colIndex={ci}
                      rowIndex={ri}
                      view={view}
                      isActive={anchor.row === ri && anchor.col === ci}
                      isSelected={inSelection(ri, ci)}
                      isDirty={view.dirty.has(col.key)}
                      isSaving={status === 'saving'}
                      hasError={status === 'error'}
                      pinned={!!col.frozen && frozen}
                      editing={editing?.row === ri && editing.col === ci ? editing : null}
                      editInputRef={editInputRef}
                      canEdit={canEdit}
                      onMouseDown={(shift) => {
                        if (editing) commitEdit(0, 0);
                        selectCell(ri, ci, shift);
                        gridRef.current?.focus();
                      }}
                      onDoubleClick={() => beginEdit(ri, ci)}
                      onEditChange={(value) => setEditing((cur) => (cur ? { ...cur, value } : cur))}
                      onEditKeyDown={handleEditorKeyDown}
                      onEditBlur={handleEditBlur}
                      registerRef={(el) => {
                        const key = `${ri}:${ci}`;
                        if (el) cellRefs.current.set(key, el);
                        else cellRefs.current.delete(key);
                      }}
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Status bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 border-t border-line bg-surface text-[11px] text-ink-muted">
        <span>
          {selection.r1 === selection.r2 && selection.c1 === selection.c2
            ? `${COLUMNS[anchor.col].label}${COLUMNS[anchor.col].sub ? ` (${COLUMNS[anchor.col].sub})` : ''} · row ${anchor.row + 1}`
            : `${selection.r2 - selection.r1 + 1} × ${selection.c2 - selection.c1 + 1} cells selected`}
        </span>
        {sum !== null && <span className="tabular-nums">Sum {sum}</span>}
        <span className="ml-auto hidden sm:inline">
          Arrows move · Enter edits · Tab next · Ctrl/⌘+V paste · Ctrl/⌘+D fill down · Ctrl/⌘+S save
        </span>
      </div>

      {Object.keys(rowErrors).length > 0 && (
        <div className="px-4 py-3 border-t border-red-200 bg-red-50">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-red-800 space-y-0.5">
              {Object.entries(rowErrors).map(([id, message]) => (
                <div key={id}>
                  <strong>{products.find((p) => p.id === id)?.name ?? id}</strong>: {message}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {restockPrompt && (
        <RestockDialog
          prompt={restockPrompt}
          saving={saving}
          onCancel={() => setRestockPrompt(null)}
          onConfirm={async () => { setRestockPrompt(null); await persist(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cell
// ---------------------------------------------------------------------------

interface GridCellProps {
  col: ColumnDef;
  colIndex: number;
  rowIndex: number;
  view: RowView;
  isActive: boolean;
  isSelected: boolean;
  isDirty: boolean;
  isSaving: boolean;
  hasError: boolean;
  /** True when this column is currently a frozen (pinned) pane. */
  pinned: boolean;
  editing: EditState | null;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  canEdit: boolean;
  onMouseDown: (shift: boolean) => void;
  onDoubleClick: () => void;
  onEditChange: (value: string) => void;
  onEditKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onEditBlur: (e: React.FocusEvent<HTMLInputElement>) => void;
  registerRef: (el: HTMLTableCellElement | null) => void;
}

function GridCell({
  col, colIndex, rowIndex, view, isActive, isSelected, isDirty, isSaving, hasError,
  pinned, editing, editInputRef, canEdit, onMouseDown, onDoubleClick, onEditChange,
  onEditKeyDown, onEditBlur, registerRef,
}: GridCellProps) {
  const editable = col.editable && canEdit;
  // "auto" rows derive their vial price from the case price — worth calling
  // out, since typing a number there converts the row to an explicit override.
  const isAuto = col.key === 'price_vial' && view.vialOverride == null;

  // Frozen cells must stay opaque as the grid scrolls under them, so every
  // state resolves to a solid background rather than falling through to none.
  const background = isDirty
    ? (isSelected && !isActive ? 'bg-amber-100' : 'bg-amber-50')
    : isSelected && !isActive
      ? 'bg-teal/10'
      : 'bg-white';

  return (
    <td
      ref={registerRef}
      role="gridcell"
      aria-selected={isSelected}
      aria-readonly={!editable}
      data-row={rowIndex}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault(); // don't start a text-selection drag
        onMouseDown(e.shiftKey);
      }}
      onDoubleClick={() => { if (editable) onDoubleClick(); }}
      className={`relative border-b border-r border-line px-3 py-2 h-9 align-middle ${
        pinned ? 'sticky' : ''
      } ${background} ${
        isActive ? 'ring-2 ring-inset ring-teal z-20' : pinned ? 'z-10' : ''
      } ${col.numeric ? 'text-right tabular-nums' : 'text-left'} ${
        editable ? 'cursor-cell' : 'cursor-default'
      } ${isSaving ? 'opacity-60' : ''} ${hasError && isDirty ? 'ring-1 ring-inset ring-red-400' : ''}`}
      style={pinned ? { left: FROZEN_LEFT[colIndex] } : undefined}
      title={col.key === 'name' ? view.product.name : undefined}
    >
      {editing ? (
        <input
          ref={editInputRef}
          autoFocus
          type="text"
          inputMode={col.key === 'pack_options' ? 'text' : 'decimal'}
          placeholder={col.key === 'pack_options' ? '1, 3, 5, 10' : undefined}
          value={editing.value}
          onChange={(e) => onEditChange(e.target.value)}
          onKeyDown={onEditKeyDown}
          onBlur={onEditBlur}
          onFocus={(e) => {
            // Typing into a cell replaces it (caret at the end); Enter/F2 or a
            // double-click opens it for amending, with everything selected.
            if (editing.typed) e.currentTarget.setSelectionRange(editing.value.length, editing.value.length);
            else e.currentTarget.select();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className={`absolute inset-0 w-full h-full px-3 bg-white text-sm text-ink outline-none ring-2 ring-inset ring-teal ${
            col.numeric ? 'text-right tabular-nums' : 'text-left'
          }`}
        />
      ) : (
        <>
          {col.key === 'name' ? (
            <div className="min-w-0">
              <div className="truncate text-ink">{view.product.name}</div>
              <div className="text-[10px] text-ink-muted leading-tight">
                {view.per} vial{view.per === 1 ? '' : 's'} / case
              </div>
            </div>
          ) : col.key === 'sku' ? (
            <span className={`block truncate font-mono text-xs ${view.product.sku ? 'text-ink' : 'text-ink-muted'}`}>
              {displayValue(view, col.key)}
            </span>
          ) : col.key === 'stock_cases' ? (
            <span className="text-ink">
              {view.cases}
              {view.loose > 0 && (
                <span className="ml-1 text-[10px] text-ink-muted">+{view.loose}v</span>
              )}
            </span>
          ) : col.key === 'pack_options' ? (
            <span className="flex items-center gap-1 min-w-0">
              <span className={`truncate tabular-nums ${view.packOverride ? 'text-ink' : 'text-ink-muted'}`}>
                {displayValue(view, col.key)}
              </span>
              {!view.packOverride && (
                <span className="flex-shrink-0 text-[9px] font-medium text-ink-muted uppercase tracking-wide">
                  default
                </span>
              )}
            </span>
          ) : col.key === 'stock_vials' ? (
            <span className={
              view.stock <= 0 ? 'text-red-600 font-medium'
                : view.stock <= (view.product.low_stock_threshold ?? 0) ? 'text-amber-600 font-medium'
                : 'text-ink'
            }>
              {view.stock}
            </span>
          ) : (
            <span className="text-ink">
              {displayValue(view, col.key)}
              {isAuto && (
                <span className="ml-1 text-[9px] font-medium text-ink-muted uppercase tracking-wide align-middle">
                  auto
                </span>
              )}
            </span>
          )}
          {/* Excel-style corner marker on an unsaved cell */}
          {isDirty && (
            <span className="absolute top-0 right-0 w-0 h-0 border-t-[6px] border-l-[6px] border-t-amber-500 border-l-transparent pointer-events-none" />
          )}
        </>
      )}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Status-bar sum — only meaningful for a single numeric column.
// ---------------------------------------------------------------------------

function selectionSum(
  rows: RowView[],
  sel: { r1: number; r2: number; c1: number; c2: number },
): string | null {
  if (sel.c1 !== sel.c2) return null;
  const col = COLUMNS[sel.c1];
  if (!col?.numeric) return null;
  if (sel.r1 === sel.r2) return null;
  let total = 0;
  for (let r = sel.r1; r <= sel.r2; r++) {
    const view = rows[r];
    if (!view) continue;
    switch (col.key) {
      case 'stock_vials': total += view.stock; break;
      case 'stock_cases': total += view.cases; break;
      case 'price_case':  total += view.price; break;
      case 'price_vial':  total += view.vialPrice; break;
    }
  }
  const isMoney = col.key === 'price_case' || col.key === 'price_vial';
  return isMoney ? formatMoney(round2(total), 'CAD') : round2(total).toLocaleString();
}

// ---------------------------------------------------------------------------
// Help panel — the case ⇄ vial rules, in the UI as well as the file header.
// ---------------------------------------------------------------------------

function HelpPanel() {
  return (
    <div className="grid gap-6 md:grid-cols-2 px-4 py-4 border-b border-line bg-teal-50/60 text-xs text-ink-muted">
      <div>
        <h3 className="text-[11px] font-semibold text-ink uppercase tracking-wider mb-2">
          How cases &amp; vials interact
        </h3>
        <ul className="space-y-1.5 leading-relaxed">
          <li>
            <strong className="text-ink">Stock is stored once, in vials.</strong> The cases
            column is a view of it — <code className="text-ink">cases = vials ÷ vials-per-case</code>,
            using the per-product factor shown under each name.
          </li>
          <li>
            Typing in <strong className="text-ink">Stock (vials)</strong> sets the count exactly.
            Typing whole cases sets <code className="text-ink">cases × per</code> and keeps any loose
            vials already on hand (the small <span className="text-ink">+3v</span> tag). A decimal
            like <code className="text-ink">2.5</code> sets the exact total instead.
          </li>
          <li>
            <strong className="text-ink">Case price = vial price × vials-per-case.</strong> There
            is no pack discount, so the two price cells always convert into each other.
          </li>
          <li>
            Typing a <strong className="text-ink">vial price</strong> saves it as an override and
            rewrites the case price. Typing a <strong className="text-ink">case price</strong> keeps
            an existing override in step; an <em>auto</em> row just re-derives itself.
          </li>
          <li>
            Pasting <strong className="text-ink">both</strong> price columns applies them left to
            right, so the vial price lands last and wins — an inconsistent pair resolves to
            <code className="text-ink"> vial × per</code>.
          </li>
          <li>
            <strong className="text-ink">Pack options</strong> lists the quantities a product is
            sold in — type <code className="text-ink">1, 3, 5, 10</code>. A pack of N costs
            <code className="text-ink"> vial price × N</code>, so the price columns still drive
            everything. An empty cell reads <em>default</em>: single vial plus one full case.
          </li>
          <li>
            Select rows and use <strong className="text-ink">Set pack options</strong> in the
            toolbar to stage the same options across all of them at once.
          </li>
          <li>
            <strong className="text-ink">Delete</strong> clears a vial price back to <em>auto</em>
            and pack options back to <em>default</em>. Prices here are the CAD base — USD is set
            from the table view.
          </li>
        </ul>
      </div>
      <div>
        <h3 className="text-[11px] font-semibold text-ink uppercase tracking-wider mb-2">
          Keyboard
        </h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 leading-relaxed">
          {([
            ['↑ ↓ ← →', 'Move between cells'],
            ['Shift + arrows', 'Extend the selection'],
            ['Tab / Shift+Tab', 'Next / previous cell (wraps rows)'],
            ['Enter or F2', 'Edit the active cell'],
            ['Type a number', 'Replace the cell and start editing'],
            ['Enter while editing', 'Commit and move down'],
            ['Esc', 'Cancel the edit'],
            ['Delete', 'Reset a vial price to auto / pack options to default'],
            ['Ctrl/⌘ + C · V', 'Copy · paste a block (TSV, works with Excel/Sheets)'],
            ['Ctrl/⌘ + D', 'Fill the top row of the selection down'],
            ['Ctrl/⌘ + Z', 'Undo a staged edit'],
            ['Ctrl/⌘ + A', 'Select every cell'],
            ['Home / End', 'First / last column (with Ctrl: first / last row)'],
            ['Ctrl/⌘ + S', 'Save all staged changes'],
          ] as const).map(([keys, what]) => (
            <React.Fragment key={keys}>
              <dt className="font-medium text-ink whitespace-nowrap">{keys}</dt>
              <dd>{what}</dd>
            </React.Fragment>
          ))}
        </dl>
        <p className="mt-3 leading-relaxed">
          Edits stay local (amber corner = unsaved) until you press{' '}
          <strong className="text-ink">Save</strong>, which writes each changed row through the
          normal product API — so history, low-stock alerts and the back-in-stock waitlist all
          behave exactly as they do for a single edit.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Restock confirmation — mirrors the single-cell inline editor's guard.
// ---------------------------------------------------------------------------

function RestockDialog({
  prompt, saving, onCancel, onConfirm,
}: {
  prompt: RestockPrompt;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const total = prompt.rows.reduce((sum, r) => sum + r.emails.length, 0);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-xl max-w-md w-full p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-teal/10 flex items-center justify-center">
            <Bell className="w-4 h-4 text-teal-dark" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-ink">Notify waitlists?</h2>
            <p className="text-xs text-ink-muted">
              {prompt.rows.length} product{prompt.rows.length === 1 ? '' : 's'} going back in stock
            </p>
          </div>
          <button onClick={onCancel} className="ml-auto text-ink-muted hover:text-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-ink-muted mb-3">
          Saving will email <strong>{total}</strong> waitlisted customer{total === 1 ? '' : 's'}:
        </p>
        <ul className="max-h-48 overflow-y-auto border border-line rounded-lg divide-y divide-line/50 mb-6">
          {prompt.rows.map((row) => (
            <li key={row.id} className="px-3 py-2 text-sm text-ink flex items-center justify-between gap-3">
              <span className="truncate">{row.name}</span>
              <span className="text-xs text-ink-muted whitespace-nowrap">
                {row.emails.length} waiting
              </span>
            </li>
          ))}
        </ul>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg hover:bg-line/50 transition-all font-medium text-sm"
          >
            Cancel
          </button>
          <button
            onClick={() => void onConfirm()}
            disabled={saving}
            className="flex-1 px-4 py-2.5 bg-ink text-white rounded-lg hover:bg-ink/90 transition-all font-medium text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {saving
              ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              : <Bell className="w-4 h-4" />}
            Save &amp; notify
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pack options — the bulk path.
//
// Editing one cell at a time is fine for a handful of rows; opting a whole
// category in is not. Select the rows, tick the sizes once, Apply. The result
// is staged like any other edit (amber corners, one Save), so a mis-click is
// undone with Ctrl+Z or Discard rather than a second round-trip to the API.
// ---------------------------------------------------------------------------

function PackOptionsMenu({
  open, onOpenChange, picked, onPickedChange, rowCount, onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  picked: number[];
  onPickedChange: (sizes: number[]) => void;
  rowCount: number;
  onApply: (sizes: number[] | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape — a toolbar popover that traps focus
  // would fight the grid's own keyboard handling.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  const toggle = (size: number) => {
    onPickedChange(
      picked.includes(size)
        ? picked.filter((s) => s !== size)
        : normalizePackSizes([...picked, size]),
    );
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-line bg-white text-ink-muted hover:text-ink hover:bg-surface text-sm"
        title="Apply pack options to the selected rows"
      >
        <Boxes className="w-4 h-4" />
        <span className="hidden sm:inline">Set pack options</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 z-50 rounded-xl border border-line bg-white shadow-card p-4">
          <p className="text-xs text-ink-muted mb-3">
            Apply to the <strong className="text-ink">{rowCount}</strong> selected
            row{rowCount === 1 ? '' : 's'}. Changes stage locally until you press Save.
          </p>

          <div className="grid grid-cols-4 gap-2 mb-3">
            {PACK_SIZE_OPTIONS.map((size) => {
              const on = picked.includes(size);
              return (
                <button
                  key={size}
                  type="button"
                  onClick={() => toggle(size)}
                  aria-pressed={on}
                  className={`py-2 rounded-lg border text-sm font-semibold transition-colors ${
                    on
                      ? 'border-teal bg-teal/10 text-teal-dark'
                      : 'border-line bg-white text-ink-muted hover:border-teal/40 hover:text-ink'
                  }`}
                >
                  {size}
                </button>
              );
            })}
          </div>

          <p className="text-[11px] text-ink-muted mb-3">
            {picked.length > 0
              ? <>Sold as {formatPackSizes(picked)} vials per pack. A pack of N costs the vial price × N.</>
              : 'Pick at least one size, or reset these rows to the default pair.'}
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onApply(null)}
              className="flex-1 px-3 py-2 rounded-lg border border-line bg-white text-ink text-xs font-medium hover:bg-surface"
              title="Single vial plus one full case"
            >
              Reset to default
            </button>
            <button
              type="button"
              onClick={() => onApply(picked)}
              disabled={picked.length === 0}
              className="flex-1 px-3 py-2 rounded-lg bg-ink text-white text-xs font-medium hover:bg-ink/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
