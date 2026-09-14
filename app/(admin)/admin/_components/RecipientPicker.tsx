'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Search, ShoppingCart, Users, X } from 'lucide-react';
import {
  cartAmount,
  cartStatusLabel,
  recipientLabel,
  timeAgo,
  MAX_BULK_RECIPIENTS,
  type OutreachRecipient,
} from '@/lib/customer/outreach-types';
import { emailTypeLabel, isRecentlyNudged } from '@/lib/customer/audience';

/**
 * "Send this to other customers too" — the recipient picker.
 *
 * Every person added here gets their OWN email: their name in the greeting,
 * their own abandoned cart, their own payment link. They are not CC'd or BCC'd
 * on anyone else's message and cannot see who else was written to. The copy
 * says so out loud, because a list of addresses in an email composer looks
 * exactly like a CC field and getting that wrong once leaks a customer list.
 *
 * Rows that have already heard from us inside RECENT_NUDGE_DAYS say so, in
 * amber, before they are ticked — the composer warns about the finished list,
 * but this is where the list gets made.
 *
 * Two modes. "With an abandoned cart" is the default — it lists only buyers who
 * have a pending or expired Stealth Health checkout, which is who a recovery
 * email is actually for. "Everyone" widens it to the whole customer desk for
 * ordinary outreach.
 */

interface Props {
  /** Runs the server search. Debounced by this component. */
  search: (query: string, opts: { abandonedOnly: boolean }) => Promise<OutreachRecipient[]>;
  selected: OutreachRecipient[];
  onChange: (next: OutreachRecipient[]) => void;
  /** Already receiving this email (the customer whose page this is). Hidden from results. */
  excludeIds: string[];
  /** Total including the primary recipient, so the cap is the real one. */
  totalRecipients: number;
  /** Start on the cart-only filter. True wherever the draft carries a payment link. */
  defaultAbandonedOnly?: boolean;
  disabled?: boolean;
}

export default function RecipientPicker({
  search,
  selected,
  onChange,
  excludeIds,
  totalRecipients,
  defaultAbandonedOnly = true,
  disabled = false,
}: Props) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [abandonedOnly, setAbandonedOnly] = useState(defaultAbandonedOnly);
  const [results, setResults] = useState<OutreachRecipient[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against a slow early search landing after a later one.
  const requestRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);
  const selectedIds = useMemo(() => new Set(selected.map((r) => r.id)), [selected]);

  const run = useCallback(async () => {
    const ticket = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const found = await search(debounced, { abandonedOnly });
      if (requestRef.current !== ticket) return;
      setResults(found);
    } catch (e: any) {
      if (requestRef.current !== ticket) return;
      setError(e?.message ?? 'Could not load customers.');
      setResults([]);
    } finally {
      if (requestRef.current === ticket) setLoading(false);
    }
  }, [search, debounced, abandonedOnly]);

  useEffect(() => { run(); }, [run]);

  // The primary recipient is already on the email, so a result that is them
  // would silently become a duplicate send.
  const visible = useMemo(
    () => results.filter((r) => !excluded.has(r.id)),
    [results, excluded],
  );

  const room = Math.max(0, MAX_BULK_RECIPIENTS - totalRecipients);
  const atCap = room === 0;

  const toggle = (recipient: OutreachRecipient) => {
    if (disabled) return;
    if (selectedIds.has(recipient.id)) {
      onChange(selected.filter((r) => r.id !== recipient.id));
      return;
    }
    if (atCap) return;
    onChange([...selected, recipient]);
  };

  const addAllShown = () => {
    if (disabled) return;
    const additions = visible.filter((r) => !selectedIds.has(r.id)).slice(0, room);
    if (additions.length > 0) onChange([...selected, ...additions]);
  };

  const unselectedShown = visible.filter((r) => !selectedIds.has(r.id)).length;

  return (
    <div className="mt-3 rounded-xl border border-line bg-white p-4">
      {/* Filter + search */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { key: true, label: 'With an abandoned cart', icon: ShoppingCart },
          { key: false, label: 'Everyone', icon: Users },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={String(key)}
            type="button"
            onClick={() => setAbandonedOnly(key)}
            disabled={disabled}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              abandonedOnly === key
                ? 'bg-ink text-white'
                : 'border border-line text-ink-muted hover:bg-surface hover:text-ink'
            }`}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled}
          placeholder="Search by name or email…"
          className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-9 text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-teal/40 disabled:opacity-50"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-ink-muted" />
        )}
      </div>

      {/* Chosen so far */}
      {selected.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {selected.map((r) => (
            <span
              key={r.id}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-teal/40 bg-teal/5 py-1 pl-2.5 pr-1.5 text-xs text-ink"
            >
              <span className="truncate">{recipientLabel(r)}</span>
              <button
                type="button"
                onClick={() => toggle(r)}
                disabled={disabled}
                aria-label={`Remove ${recipientLabel(r)}`}
                className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-teal/20 hover:text-ink"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Results */}
      <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-line divide-y divide-line/50">
        {error ? (
          <p className="px-3 py-6 text-center text-sm text-red-600">{error}</p>
        ) : loading && visible.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-muted">Searching…</p>
        ) : visible.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-muted">
            {abandonedOnly
              ? 'Nobody else has a pending or expired checkout right now.'
              : 'No customers match that search.'}
          </p>
        ) : (
          visible.map((r) => {
            const checked = selectedIds.has(r.id);
            const blocked = !checked && atCap;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => toggle(r)}
                disabled={disabled || blocked}
                title={blocked ? `One send can address at most ${MAX_BULK_RECIPIENTS} customers.` : undefined}
                className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface ${
                  checked ? 'bg-teal/5' : ''
                } ${blocked ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                    checked ? 'border-teal bg-teal-dark text-white' : 'border-line'
                  }`}
                >
                  {checked && <Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="truncate text-sm font-medium text-ink">{recipientLabel(r)}</span>
                    {r.name && (
                      <span className="truncate text-xs text-ink-muted">{r.email}</span>
                    )}
                    {r.source === 'puramass' && (
                      <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                        Stealth Health
                      </span>
                    )}
                  </span>
                  {r.abandoned ? (
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted">
                      <span className="font-mono text-ink-light">{r.abandoned.reference}</span>
                      <span>·</span>
                      <span
                        className={
                          r.abandoned.status === 'payment_pending'
                            ? 'text-amber-700'
                            : 'text-ink-muted'
                        }
                      >
                        {cartStatusLabel(r.abandoned.status)}
                      </span>
                      {cartAmount(r.abandoned) && (
                        <>
                          <span>·</span>
                          <span>{cartAmount(r.abandoned)}</span>
                        </>
                      )}
                      <span>·</span>
                      <span>{timeAgo(r.abandoned.createdAt)}</span>
                      {!r.abandoned.hasPaymentLink && (
                        <>
                          <span>·</span>
                          <span className="text-red-600">no payment link</span>
                        </>
                      )}
                      {r.abandoned.chased > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-amber-700">chased {r.abandoned.chased}×</span>
                        </>
                      )}
                    </span>
                  ) : (
                    <span className="mt-0.5 block text-xs text-ink-light">
                      No open checkout — they get the message without a cart or a payment link.
                    </span>
                  )}
                  {/* Said on the row itself, not only in the warning above the
                      draft: this is where the person is actually added, and a
                      repeat is cheapest to avoid before the tick. */}
                  {isRecentlyNudged(r.nudge) && (
                    <span className="mt-0.5 block text-xs font-medium text-amber-700">
                      Already emailed {timeAgo(r.nudge!.sentAt)} · {emailTypeLabel(r.nudge!.template)}
                    </span>
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">
          {atCap
            ? `That is the ${MAX_BULK_RECIPIENTS}-customer limit for one send. Send this batch, then pick the rest.`
            : `${selected.length} added · room for ${room} more`}
        </p>
        {unselectedShown > 0 && !atCap && (
          <button
            type="button"
            onClick={addAllShown}
            disabled={disabled}
            className="text-xs font-medium text-teal-dark hover:text-teal-dark"
          >
            Add all {Math.min(unselectedShown, room)} shown
          </button>
        )}
      </div>
    </div>
  );
}
