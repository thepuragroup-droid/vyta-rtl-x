'use client';

/**
 * Column configuration for the PuraMass orders table.
 *
 * The ledger carries far more per order than an admin needs at a glance, so the
 * table ships with the core set visible and keeps the reconciliation
 * identifiers (transaction id, partner reference) one click away. The choice is
 * per-browser — it is a view preference, not shared state — so it lives in
 * localStorage.
 */
import { useCallback, useEffect, useState } from 'react';

export type ColumnKey =
  | 'date'
  | 'customer'
  | 'address'
  | 'items'
  | 'total'
  | 'status'
  | 'recovery'
  | 'invoice'
  | 'account'
  | 'transaction'
  | 'reference'
  | 'referral'
  | 'updated';

export interface ColumnMeta {
  key: ColumnKey;
  label: string;
  /** Shown under the label in the column picker. */
  hint: string;
  /** Core columns can't be hidden — without them the table says nothing. */
  locked?: boolean;
}

/** Display order of the table, whatever the visibility choices are. */
export const COLUMNS: ColumnMeta[] = [
  { key: 'date', label: 'Date', hint: 'When the hand-off was created', locked: true },
  { key: 'customer', label: 'Customer', hint: 'Name, email and phone', locked: true },
  { key: 'address', label: 'Ship to', hint: 'Shipping address from PuraMass' },
  { key: 'items', label: 'Items', hint: 'SKUs and quantities' },
  { key: 'total', label: 'Subtotal', hint: 'Order subtotal and currency' },
  { key: 'status', label: 'Status', hint: 'Payment status', locked: true },
  { key: 'recovery', label: 'Recovery', hint: 'Abandoned-cart chases: how many, when, and the code offered' },
  { key: 'invoice', label: 'Invoice', hint: 'Linked invoice, its status and fulfilment' },
  { key: 'account', label: 'Customer view', hint: 'Whether the buyer sees this order' },
  { key: 'transaction', label: 'Transaction', hint: 'PuraMass transaction id' },
  { key: 'reference', label: 'Reference', hint: 'Our partner_reference' },
  { key: 'referral', label: 'Affiliate', hint: 'Affiliate code captured at checkout, and whose it is' },
  { key: 'updated', label: 'Updated', hint: 'Last change to the ledger row' },
];

/** Visible out of the box: what you need to answer "who, what, paid, shipped?". */
export const DEFAULT_COLUMNS: ColumnKey[] = [
  'date',
  'customer',
  'address',
  'items',
  'total',
  'status',
  'invoice',
  // An order placed through an affiliate link earns someone money. That is not
  // a reconciliation identifier to go hunting for in the column picker — it
  // belongs on the table by default.
  'referral',
];

const LOCKED = COLUMNS.filter((c) => c.locked).map((c) => c.key);
const STORAGE_KEY = 'aminocan:puramass-orders:columns:v2';
const LEGACY_STORAGE_KEY = 'aminocan:puramass-orders:columns';

/**
 * Columns added to the defaults after preferences were already being saved.
 *
 * An admin who picked their columns before one of these existed never chose to
 * hide it — it was not on offer — so a stored v1 selection would silently keep
 * them from ever seeing it. They are merged in once, during the v1 → v2
 * migration, which preserves every choice that WAS deliberate.
 */
const ADDED_SINCE_V1: ColumnKey[] = ['referral'];

function sanitize(keys: unknown): ColumnKey[] | null {
  if (!Array.isArray(keys)) return null;
  const valid = new Set(COLUMNS.map((c) => c.key) as string[]);
  const picked = keys.filter((k): k is ColumnKey => typeof k === 'string' && valid.has(k));
  if (picked.length === 0) return null;
  // Locked columns are always present, and order always follows COLUMNS.
  const set = new Set<ColumnKey>([...picked, ...LOCKED]);
  return COLUMNS.map((c) => c.key).filter((k) => set.has(k));
}

/**
 * Visible columns, persisted per browser. Starts from the defaults on the first
 * render so the server and client markup agree, then adopts the stored choice.
 */
export function useColumnPreferences() {
  const [visible, setVisible] = useState<ColumnKey[]>(DEFAULT_COLUMNS);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      let stored = raw ? sanitize(JSON.parse(raw)) : null;

      if (!stored) {
        const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
        const legacy = legacyRaw ? sanitize(JSON.parse(legacyRaw)) : null;
        if (legacy) {
          stored = sanitize([...legacy, ...ADDED_SINCE_V1]);
          if (stored) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
        }
      }

      if (stored) setVisible(stored);
    } catch {
      // Unreadable or disabled storage — the defaults are a fine fallback.
    }
  }, []);

  const persist = useCallback((next: ColumnKey[]) => {
    setVisible(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Preference is best-effort; the table still works for this session.
    }
  }, []);

  const toggle = useCallback(
    (key: ColumnKey) => {
      if (LOCKED.includes(key)) return;
      setVisible((cur) => {
        const set = new Set(cur);
        if (set.has(key)) set.delete(key);
        else set.add(key);
        const next = COLUMNS.map((c) => c.key).filter((k) => set.has(k));
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* best-effort */
        }
        return next;
      });
    },
    [],
  );

  const reset = useCallback(() => persist(DEFAULT_COLUMNS), [persist]);

  return { visible, toggle, reset, isDefault: sameKeys(visible, DEFAULT_COLUMNS) };
}

function sameKeys(a: ColumnKey[], b: ColumnKey[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}
