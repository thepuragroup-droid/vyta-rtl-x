'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, Loader2, Mail, Play, ShoppingCart } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { useUserRole } from '../layout';
import { canEdit } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { adminFetch } from '@/components/admin/affiliates/api';
import OverviewTab from '@/components/admin/email-flows/OverviewTab';
import PeopleTab from '@/components/admin/email-flows/PeopleTab';
import EmailsTab from '@/components/admin/email-flows/EmailsTab';
import SettingsTab from '@/components/admin/email-flows/SettingsTab';
import { apiBase, fmtDateTime, primaryBtn, secondaryBtn, type FlowResponse } from '@/components/admin/email-flows/shared';
import { FLOWS, FLOW_KEYS, isFlowKey, stepsMissingCode, type FlowKey } from '@/lib/email-flows/types';

type Tab = 'overview' | 'people' | 'emails' | 'settings';

const RANGES = [
  { days: 0, label: 'All time' },
  { days: 90, label: '90 days' },
  { days: 30, label: '30 days' },
  { days: 7, label: '7 days' },
];

const FLOW_ICONS: Record<FlowKey, React.ElementType> = { welcome: Mail, cart: ShoppingCart };

/**
 * Admin → Email Flows.
 *
 * The automated email sequences — the welcome series and cart abandonment —
 * each with its funnel, everyone in it, its five emails, and its switch. One
 * engine runs both (lib/email-flows); see docs/changelog/2026-10-15-email-flows.md.
 */
export default function EmailFlowsPage() {
  const toast = useToast();
  const editable = canEdit(useUserRole());
  const [flow, setFlow] = useState<FlowKey>('welcome');
  const [tab, setTab] = useState<Tab>('overview');
  const [emailStep, setEmailStep] = useState(1);
  const [days, setDays] = useState(0);
  const [data, setData] = useState<FlowResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'toggle' | 'run' | null>(null);
  const [adminEmail, setAdminEmail] = useState('');

  // ?flow=cart deep-links straight to a flow. Read once, from the URL itself,
  // so the page needs no Suspense boundary.
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get('flow');
    if (isFlowKey(f)) setFlow(f);
  }, []);

  const chooseFlow = (f: FlowKey) => {
    if (f === flow) return;
    setFlow(f);
    setTab('overview');
    setEmailStep(1);
    setData(null);
    setLoading(true);
    const url = new URL(window.location.href);
    url.searchParams.set('flow', f);
    window.history.replaceState(null, '', url.toString());
  };

  const load = useCallback(async () => {
    const res = await adminFetch<FlowResponse>(`${apiBase(flow)}${days ? `?days=${days}` : ''}`);
    setLoading(false);
    if (!res.ok) return toast.error(res.data.error ?? 'Could not load the flow');
    setData(res.data);
  }, [flow, days, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setAdminEmail(user?.email ?? ''));
  }, []);

  const settings = data?.settings;
  const meta = FLOWS[flow];
  // Offer emails with no code chosen keep the flow from being switched on.
  const missingCodes = data?.steps ? stepsMissingCode(data.steps) : [];
  const blockedOn = !!settings && !settings.enabled && missingCodes.length > 0;

  const toggle = async () => {
    if (!settings) return;
    const turningOn = !settings.enabled;
    const what =
      flow === 'cart'
        ? 'Carts abandoned from now on will start receiving the series. Carts left before now are not emailed.'
        : 'New consenting signups from now on will start receiving the series. Existing customers are not emailed.';
    if (turningOn && !confirm(`Switch the ${meta.label.toLowerCase()} on? ${what}`)) return;
    setBusy('toggle');
    const res = await adminFetch(apiBase(flow), { method: 'PUT', body: { ...settings, enabled: turningOn } });
    setBusy(null);
    if (!res.ok) return toast.error(res.data.error ?? 'Could not update');
    toast.success(turningOn ? `${meta.label} is on` : `${meta.label} is off — nothing more will send`);
    load();
  };

  const runNow = async () => {
    setBusy('run');
    const res = await adminFetch<{ skipped?: string; enrolled: number; sent: number; failed: number; converted: number }>(
      `${apiBase(flow)}/run`,
      { method: 'POST' },
    );
    setBusy(null);
    if (!res.ok) return toast.error(res.data.error ?? 'Run failed');
    const r = res.data;
    if (r.skipped) return toast.info(r.skipped === 'disabled' ? 'The flow is off — switch it on first.' : `Skipped: ${r.skipped}`);
    toast.success(`Run complete — ${r.sent} sent, ${r.enrolled} enrolled, ${r.converted} purchased${r.failed ? `, ${r.failed} failed` : ''}`);
    load();
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'people', label: meta.peopleLabel },
    { key: 'emails', label: 'Emails' },
    { key: 'settings', label: 'Settings' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Email Flows</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          Automated email sequences. Every email after the first only goes if the person still hasn't bought — and
          each series stops the moment they do.
        </p>
      </div>

      {/* Flow switcher */}
      <div className="grid gap-3 sm:grid-cols-2" role="tablist" aria-label="Flow">
        {FLOW_KEYS.map((f) => {
          const Icon = FLOW_ICONS[f];
          const on = data?.flows?.[f];
          const active = f === flow;
          return (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => chooseFlow(f)}
              className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
                active ? 'border-ink bg-white shadow-sm' : 'border-line bg-white/60 hover:border-ink/30'
              }`}
            >
              <span className={`grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg ${active ? 'bg-ink text-white' : 'bg-surface text-ink'}`}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                  {FLOWS[f].label}
                  {on !== undefined && (
                    <span className={`h-2 w-2 rounded-full ${on ? 'bg-emerald-500' : 'bg-gray-300'}`} title={on ? 'On' : 'Off'} />
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-ink-muted">{FLOWS[f].description}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-ink">{meta.label}</h2>
          {settings && (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${settings.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-ink-muted'}`}>
              {settings.enabled ? `On since ${fmtDateTime(settings.enabled_at)}` : 'Off'}
            </span>
          )}
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
              <button
                type="button"
                onClick={toggle}
                disabled={!!busy || blockedOn}
                title={blockedOn ? `Choose a discount code for ${missingCodes.map((n) => `Email ${n}`).join(', ')} first (Emails tab)` : undefined}
                className={settings.enabled ? secondaryBtn : primaryBtn}
              >
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
            <span className="font-mono">supabase-cron-email-flows.sql</span> to schedule the sender.
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
            {tabs.map((t) => (
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
              key={flow}
              flow={flow}
              overview={data.overview}
              steps={data.steps}
              settings={settings}
              onOpenEmail={(n) => { setEmailStep(n); setTab('emails'); }}
            />
          )}
          {tab === 'people' && <PeopleTab key={flow} flow={flow} editable={editable} overview={data.overview} onChanged={load} />}
          {tab === 'emails' && (
            <EmailsTab key={flow} flow={flow} steps={data.steps} editable={editable} initialStep={emailStep} adminEmail={adminEmail} onSaved={load} />
          )}
          {tab === 'settings' && <SettingsTab key={flow} flow={flow} settings={settings} editable={editable} onSaved={load} />}
        </>
      ) : null}
    </div>
  );
}
