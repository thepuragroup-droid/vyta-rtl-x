'use client';

import React from 'react';
import { CalendarRange, Loader2, MailX, SlidersHorizontal, X } from 'lucide-react';
import {
  EMAIL_TYPE_OPTIONS,
  SUPPRESSION_WINDOWS,
  activeConditionCount,
  EMPTY_AUDIENCE,
  type AudienceFilters as Filters,
} from '@/lib/customer/audience';

/**
 * "Who gets this email" — the conditions panel above the customer table.
 *
 * The desk's bulk send has always been tick-then-click, which is fine for five
 * people and hopeless for a campaign: nobody hand-picks "everyone who joined in
 * the last quarter and has not already had the restock note" out of a list of
 * four hundred. So the conditions come first and the ticks come second — narrow
 * the table, then send to whoever is left.
 *
 * Two kinds of condition, because they answer different questions:
 *
 *   Dates      — WHEN somebody joined, and when they were last seen. A promo
 *                aimed at lapsed buyers is a different list from one aimed at
 *                this month's signups.
 *   Already
 *   emailed    — WHAT they have already been sent. This is the one that keeps
 *                the sender list clean: a buyer who got the restock note on
 *                Tuesday must not get it again on Thursday because a second
 *                admin built a batch without knowing.
 *
 * Collapsed by default with a count on the button, so the panel never costs
 * anything to the admin who just wants to look somebody up.
 */
interface Props {
  value: Filters;
  onChange: (next: Filters) => void;
  open: boolean;
  onToggleOpen: () => void;
  /** How many rows survive the conditions, for the summary line. */
  matched: number;
  /** How many were held back by the "already emailed" rule. */
  suppressed: number;
  /** The outreach log is still loading, so the held-back count is not final. */
  loading?: boolean;
  /**
   * The outreach log could not be read (the CRM migration has not run). The
   * rule is then unenforceable, and saying so beats quietly emailing everybody.
   */
  historyUnavailable?: boolean;
}

export default function AudienceFilters({
  value,
  onChange,
  open,
  onToggleOpen,
  matched,
  suppressed,
  loading = false,
  historyUnavailable = false,
}: Props) {
  const active = activeConditionCount(value);
  const set = (patch: Partial<Filters>) => onChange({ ...value, ...patch });

  const toggleTemplate = (key: string) => {
    const has = value.excludeTemplates.includes(key);
    set({
      excludeTemplates: has
        ? value.excludeTemplates.filter((t) => t !== key)
        : [...value.excludeTemplates, key],
    });
  };

  return (
    <div className="mb-4 rounded-xl border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <button
          onClick={onToggleOpen}
          className="inline-flex items-center gap-2 text-sm font-semibold text-ink transition-colors hover:text-teal-dark"
          aria-expanded={open}
        >
          <SlidersHorizontal className="h-4 w-4 text-teal-dark" />
          Email conditions
          {active > 0 && (
            <span className="rounded-full bg-teal/10 px-2 py-0.5 text-[11px] font-semibold text-teal-dark">
              {active} on
            </span>
          )}
        </button>

        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          {loading ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking who has already been emailed…
            </span>
          ) : (
            <span>
              <span className="font-semibold text-ink tabular-nums">{matched}</span> match
              {suppressed > 0 && (
                <span className="text-amber-700">
                  {' '}· {suppressed} held back — already emailed
                </span>
              )}
            </span>
          )}
          {active > 0 && (
            <button
              onClick={() => onChange({ ...EMPTY_AUDIENCE })}
              className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 font-medium text-ink-muted transition-colors hover:border-ink/20 hover:text-ink"
            >
              <X className="h-3 w-3" />
              Clear conditions
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="grid gap-5 border-t border-line px-4 py-4 lg:grid-cols-2">
          {/* ---- Dates ---------------------------------------------------- */}
          <div className="space-y-3">
            <Legend icon={<CalendarRange className="h-3.5 w-3.5" />}>Dates</Legend>

            <DateRange
              label="Joined"
              hint="When the account was created, or when we first saw the Stealth Health buyer."
              from={value.joinedFrom}
              to={value.joinedTo}
              onFrom={(joinedFrom) => set({ joinedFrom })}
              onTo={(joinedTo) => set({ joinedTo })}
            />
            <DateRange
              label="Last active"
              hint="Last sign-in, or the last Stealth Health order for a buyer with no account."
              from={value.activeFrom}
              to={value.activeTo}
              onFrom={(activeFrom) => set({ activeFrom })}
              onTo={(activeTo) => set({ activeTo })}
            />
            <p className="text-[11px] leading-relaxed text-ink-muted">
              Both ends are inclusive whole days. A customer whose date we do not have is
              left out of a range rather than quietly kept in it.
            </p>
          </div>

          {/* ---- Already emailed ------------------------------------------ */}
          <div className="space-y-3">
            <Legend icon={<MailX className="h-3.5 w-3.5" />}>Skip anyone already sent</Legend>

            <div className="flex flex-wrap gap-1.5">
              {EMAIL_TYPE_OPTIONS.map((t) => {
                const on = value.excludeTemplates.includes(t.key);
                return (
                  <button
                    key={t.key}
                    onClick={() => toggleTemplate(t.key)}
                    title={t.description}
                    aria-pressed={on}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      on
                        ? 'border-teal bg-teal-dark text-white'
                        : 'border-line bg-white text-ink-muted hover:border-ink/20 hover:text-ink'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                Looking back
              </span>
              <div className="flex flex-wrap items-center gap-0.5 rounded-full border border-line bg-white p-0.5">
                {SUPPRESSION_WINDOWS.map((w) => {
                  const on = value.excludeWithinDays === w.days;
                  return (
                    <button
                      key={w.key}
                      onClick={() => set({ excludeWithinDays: w.days })}
                      disabled={value.excludeTemplates.length === 0}
                      className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        on ? 'bg-ink text-white' : 'text-ink-muted hover:bg-surface hover:text-ink'
                      }`}
                    >
                      {w.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {historyUnavailable ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
                The outreach log could not be read, so nobody can be held back on it. Run{' '}
                <code className="font-mono">customer-crm-migration.sql</code> to enable it. Until
                then a send with this condition set is refused rather than sent to everyone.
              </p>
            ) : (
              <p className="text-[11px] leading-relaxed text-ink-muted">
                Counts successful sends only, matched on email address, and re-checked when the
                batch actually goes out — so somebody another admin emailed while you were
                writing is still skipped.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Legend({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
      {icon}
      {children}
    </div>
  );
}

function DateRange({
  label, hint, from, to, onFrom, onTo,
}: {
  label: string;
  hint: string;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-20 flex-shrink-0 text-xs font-medium text-ink" title={hint}>
          {label}
        </span>
        <input
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) => onFrom(e.target.value)}
          aria-label={`${label} from`}
          className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
        />
        <span className="text-xs text-ink-muted">→</span>
        <input
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => onTo(e.target.value)}
          aria-label={`${label} to`}
          className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
        />
        {(from || to) && (
          <button
            onClick={() => { onFrom(''); onTo(''); }}
            aria-label={`Clear the ${label.toLowerCase()} dates`}
            className="rounded-lg p-1 text-ink-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
