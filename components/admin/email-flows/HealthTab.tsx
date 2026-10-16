'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, RotateCcw, XCircle } from 'lucide-react';
import { adminFetch } from '@/components/admin/affiliates/api';
import { CHECK_GROUPS, type CheckStatus, type HealthReport } from '@/lib/email-flows/health-rules';
import { fmtDateTime, Panel, secondaryBtn } from './shared';

const API = '/api/admin/email-flows/health';

const STATUS: Record<CheckStatus, { icon: React.ElementType; cls: string; label: string }> = {
  pass: { icon: CheckCircle2, cls: 'text-emerald-600', label: 'OK' },
  warn: { icon: AlertTriangle, cls: 'text-amber-600', label: 'Warning' },
  fail: { icon: XCircle, cls: 'text-red-600', label: 'Problem' },
  info: { icon: Info, cls: 'text-sky-600', label: 'Info' },
};

/**
 * Setup check — is everything the flows need configured and working? Runs
 * when the tab opens: SMTP (a real sign-in, nothing sent), the database, the
 * scheduler, the link secret, both flows' codes and copy, and recent failures.
 * Covers both flows, whichever is selected above.
 */
export default function HealthTab() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [onlyIssues, setOnlyIssues] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    const res = await adminFetch<HealthReport>(API);
    setRunning(false);
    if (!res.ok) return setError(res.data.error ?? 'The check could not run');
    setReport(res.data);
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  if (!report) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-sm text-ink-muted">
        {error ? (
          <>
            <span className="text-red-600">{error}</span>
            <button type="button" onClick={run} className={secondaryBtn}><RotateCcw className="h-4 w-4" /> Try again</button>
          </>
        ) : (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Checking SMTP, the database and the scheduler…
          </>
        )}
      </div>
    );
  }

  const { counts } = report;
  const shown = report.checks.filter((c) => !onlyIssues || c.status === 'fail' || c.status === 'warn');

  return (
    <div className="space-y-4">
      <div
        className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
          counts.fail ? 'border-red-200 bg-red-50' : counts.warn ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'
        }`}
      >
        <div className="flex items-start gap-2 text-sm">
          {counts.fail ? (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          ) : counts.warn ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          )}
          <span className="text-ink">
            <span className="font-semibold">
              {counts.fail
                ? `${counts.fail} problem${counts.fail === 1 ? '' : 's'} to fix`
                : counts.warn
                  ? 'Working, with warnings'
                  : 'Everything is configured correctly'}
            </span>
            <span className="text-ink-muted">
              {' '}· {counts.pass} passed{counts.warn ? `, ${counts.warn} warning${counts.warn === 1 ? '' : 's'}` : ''} · checked {fmtDateTime(report.checkedAt)}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
            Only problems and warnings
          </label>
          <button type="button" onClick={run} disabled={running} className={secondaryBtn}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Check again
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {CHECK_GROUPS.map((group) => {
        const rows = shown.filter((c) => c.group === group);
        if (!rows.length) return null;
        return (
          <Panel key={group} title={group}>
            <ul className="divide-y divide-line">
              {rows.map((c) => {
                const s = STATUS[c.status];
                const Icon = s.icon;
                return (
                  <li key={c.id} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${s.cls}`} aria-label={s.label} />
                    <div className="min-w-0 text-sm">
                      <p className="font-medium text-ink">{c.label}</p>
                      <p className="break-words text-ink-muted">{c.detail}</p>
                      {c.fix && (
                        <p className="mt-1 break-words text-xs text-ink">
                          <span className="font-semibold">Fix: </span>
                          {c.fix}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        );
      })}

      <p className="text-[11px] text-ink-muted">
        The SMTP check signs in to the mail server without sending anything. To see a real email arrive, use the Test
        send tab.
      </p>
    </div>
  );
}
