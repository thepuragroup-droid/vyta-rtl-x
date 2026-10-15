'use client';

import React, { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { adminFetch } from '@/components/admin/affiliates/api';
import type { FlowKey, FlowSettings } from '@/lib/email-flows/types';
import { apiBase, fmtDateTime, inputCls, labelCls, Panel, primaryBtn } from './shared';

const ZONES = [
  'America/Vancouver', 'America/Edmonton', 'America/Regina', 'America/Winnipeg', 'America/Toronto',
  'America/Halifax', 'America/St_Johns', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
];

const hours = Array.from({ length: 25 }, (_, h) => h);
const hourLabel = (h: number) => (h === 24 ? 'Midnight (end of day)' : `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`);

export default function SettingsTab({ flow, settings, editable, onSaved }: {
  flow: FlowKey;
  settings: FlowSettings;
  editable: boolean;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(settings), [settings]);

  const set = <K extends keyof FlowSettings>(k: K, v: FlowSettings[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await adminFetch(apiBase(flow), { method: 'PUT', body: form });
    setSaving(false);
    if (!res.ok) return toast.error(res.data.error ?? 'Could not save');
    toast.success('Settings saved');
    onSaved();
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <fieldset disabled={!editable} className="space-y-4">
        <Panel
          title="Sending window"
          description={`Email 1 is never held for the window. Emails 2–5 wait for it, in the recipient's own time zone.`}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className={labelCls}>From</label>
              <select value={form.send_window_start} onChange={(e) => set('send_window_start', Number(e.target.value))} className={inputCls}>
                {hours.slice(0, 24).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Until</label>
              <select value={form.send_window_end} onChange={(e) => set('send_window_end', Number(e.target.value))} className={inputCls}>
                {hours.slice(1).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Fallback time zone</label>
              <input list="wf-zones" value={form.default_timezone} onChange={(e) => set('default_timezone', e.target.value)} className={inputCls} />
              <datalist id="wf-zones">{ZONES.map((z) => <option key={z} value={z} />)}</datalist>
              <p className="mt-1 text-[11px] text-ink-muted">Used when the account has no province/state.</p>
            </div>
            <div>
              <label className={labelCls}>Minimum gap <span className="font-normal text-ink-muted">— after any flow's email</span></label>
              <div className="flex items-center gap-2">
                <input type="number" min={0} max={168} value={form.min_gap_hours} onChange={(e) => set('min_gap_hours', Number(e.target.value))} className={`${inputCls} w-24`} />
                <span className="text-xs text-ink-muted">hours</span>
              </div>
            </div>
          </div>
        </Panel>

        {flow === 'cart' && (
          <Panel title="Re-entry" description="How often one person can get the cart series. A new abandonment inside this window is ignored.">
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-muted">At most once every</span>
              <input type="number" min={0} max={365} value={form.reentry_days} onChange={(e) => set('reentry_days', Number(e.target.value))} className={`${inputCls} w-24`} />
              <span className="text-xs text-ink-muted">days</span>
            </div>
            <p className="mt-2 text-[11px] text-ink-muted">
              Offer deadlines and countdowns are set per email, in the Emails tab.
            </p>
          </Panel>
        )}

        <Panel title="Footer" description="Printed at the bottom of every email, above the unsubscribe link. Shared by all flows.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Mailing address <span className="font-normal text-ink-muted">— required by CASL</span></label>
              <input value={form.footer_address} onChange={(e) => set('footer_address', e.target.value)} className={inputCls} placeholder="123 Example St, Toronto, ON M5V 1A1" />
            </div>
            <div>
              <label className={labelCls}>Disclaimer</label>
              <input value={form.footer_disclaimer} onChange={(e) => set('footer_disclaimer', e.target.value)} className={inputCls} />
            </div>
          </div>
        </Panel>
      </fieldset>

      {editable && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-ink-muted">
            {settings.updated_by_email ? `Last changed by ${settings.updated_by_email}, ${fmtDateTime(settings.updated_at)}` : ''}
          </p>
          <button type="submit" disabled={saving} className={primaryBtn}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save settings
          </button>
        </div>
      )}
    </form>
  );
}
