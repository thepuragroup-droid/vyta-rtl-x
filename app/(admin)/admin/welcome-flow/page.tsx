'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, Loader2, Play } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { useUserRole } from '../layout';
import { canEdit } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { adminFetch } from '@/components/admin/affiliates/api';
import OverviewTab from '@/components/admin/welcome-flow/OverviewTab';
import SubscribersTab from '@/components/admin/welcome-flow/SubscribersTab';
import EmailsTab from '@/components/admin/welcome-flow/EmailsTab';
import SettingsTab from '@/components/admin/welcome-flow/SettingsTab';
import { fmtDateTime, primaryBtn, secondaryBtn, type FlowResponse } from '@/components/admin/welcome-flow/shared';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'subscribers', label: 'Subscribers' },
  { key: 'emails', label: 'Emails' },
  { key: 'settings', label: 'Settings' },
] as const;
type Tab = (typeof TABS)[number]['key'];

const RANGES = [
  { days: 0, label: 'All time' },
  { days: 90, label: '90 days' },
  { days: 30, label: '30 days' },
  { days: 7, label: '7 days' },
];

/**
 * Admin → Welcome Flow.
 *
 * The 5-email welcome series for new consenting signups: the funnel, every
 * subscriber's progress, the emails themselves, and the switch. See
 * docs/changelog/2026-10-15-welcome-email-flow.md.
 */
export default function WelcomeFlowPage() {
  const toast = useToast();
  const editable = canEdit(useUserRole());
  const [tab, setTab] = useState<Tab>('overview');
  const [emailStep, setEmailStep] = useState(1);
  const [days, setDays] = useState(0);
  const [data, setData] = useState<FlowResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'toggle' | 'run' | null>(null);
  const [adminEmail, setAdminEmail] = useState('');

  const load = useCallback(async () => {
    const res = await adminFetch<FlowResponse>(`/api/admin/welcome-flow${days ? `?days=${days}` : ''}`);
    setLoading(false);
    if (!res.ok) return toast.error(res.data.error ?? 'Could not load the welcome flow');
    setData(res.data);
  }, [days, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setAdminEmail(user?.email ?? ''));
  }, []);

  const settings = data?.settings;

  const toggle = async () => {
    if (!settings) return;
    const turningOn = !settings.enabled;
    if (turningOn && !confirm('Switch the welcome flow on? New consenting signups from now on will start receiving the series. Existing customers are not emailed.')) return;
    setBusy('toggle');
    const res = await adminFetch('/api/admin/welcome-flow', { method: 'PUT', body: { ...settings, enabled: turningOn } });
    setBusy(null);
    if (!res.ok) return toast.error(res.data.error ?? 'Could not update');
    toast.success(turningOn ? 'Welcome flow is on' : 'Welcome flow is off — nothing more will send');
    load();
  };

  const runNow = async () => {
    setBusy('run');
    const res = await adminFetch<{ skipped?: string; enrolled: number; sent: number; failed: number; converted: number; completed: number }>(
      '/api/admin/welcome-flow/run',
      { method: 'POST' },
    );
    setBusy(null);
    if (!res.ok) return toast.error(res.data.error ?? 'Run failed');
    const r = res.data;
    if (r.skipped) return toast.info(r.skipped === 'disabled' ? 'The flow is off — switch it on first.' : `Skipped: ${r.skipped}`);
    toast.success(`Run complete — ${r.sent} sent, ${r.enrolled} enrolled, ${r.converted} purchased${r.failed ? `, ${r.failed} failed` : ''}`);
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-ink">Welcome Flow</h1>
            {settings && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${settings.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-ink-muted'}`}>
                {settings.enabled ? `On since ${fmtDateTime(settings.enabled_at)}` : 'Off'}
              </span>
            )}
          </div>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Five emails that turn new subscribers into first-time customers — welcome, education, trust, offer and a
            last reminder. The series stops the moment someone buys.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tab === 'overview' && (
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-line bg-white px-3 py-2 text-sm" aria-label="Enrolled within">
              {RANGES.map((r) => <option key={r.days} value={r.days}>{r.label}</option>)}
            </select>
          )}
          {editable && settings && (
            <>
              <button type="button" onClick={runNow} disabled={!!busy || !settings.enabled} className={secondaryBtn} title="Send whatever is due now instead of waiting for the next 15-minute run">
                {busy === 'run' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run now
              </button>
              <button type="button" onClick={toggle} disabled={!!busy} className={settings.enabled ? secondaryBtn : primaryBtn}>
                {busy === 'toggle' && <Loader2 className="h-4 w-4 animate-spin" />}
                {settings.enabled ? 'Switch off' : 'Switch on'}
              </button>
            </>
          )}
        </div>
      </div>

      {data?.migrationNeeded && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Run <span className="font-mono">{data.migrationFile}</span> in the Supabase SQL editor, then{' '}
            <span className="font-mono">supabase-cron-welcome-flow.sql</span> to schedule the sender.
          </span>
        </div>
      )}

      {!!data?.warnings?.length && (
        <ul className="space-y-1.5">
          {data.warnings.map((w) => (
            <li key={w} className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {w}
            </li>
          ))}
        </ul>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-ink-muted" /></div>
      ) : data && settings && data.steps && data.overview ? (
        <>
          <div className="flex gap-1 border-b border-line" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  tab === t.key ? 'border-ink text-ink' : 'border-transparent text-ink-muted hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <OverviewTab
              overview={data.overview}
              steps={data.steps}
              settings={settings}
              onOpenEmail={(n) => { setEmailStep(n); setTab('emails'); }}
            />
          )}
          {tab === 'subscribers' && <SubscribersTab editable={editable} overview={data.overview} onChanged={load} />}
          {tab === 'emails' && (
            <EmailsTab steps={data.steps} editable={editable} initialStep={emailStep} adminEmail={adminEmail} onSaved={load} />
          )}
          {tab === 'settings' && <SettingsTab settings={settings} editable={editable} onSaved={load} />}
        </>
      ) : null}
    </div>
  );
}
