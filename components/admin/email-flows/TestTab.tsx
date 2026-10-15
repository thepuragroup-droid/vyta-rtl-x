'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Plus, RotateCcw, Send, X, XCircle } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { adminFetch, describeCode, type AdminDiscountCode } from '@/components/admin/affiliates/api';
import { FLOWS, FLOW_KEYS, type FlowKey } from '@/lib/email-flows/types';
import { parseRecipients } from '@/lib/email-flows/test-send';
import type { SavedCartLine } from '@/lib/email-flows/carts';
import type { TestDefaults, TestSendResult, TestSendSummary } from '@/lib/email-flows/test-runner';
import { inputCls, labelCls, Panel, primaryBtn, secondaryBtn } from './shared';

const API = '/api/admin/email-flows/test-send';
const key = (flow: FlowKey, step: number) => `${flow}:${step}`;

/**
 * Test send — any of the ten emails, to one or more addresses, with the name,
 * code, time zone and cart they're rendered with. Every field starts at its
 * default; only the addresses need filling in.
 */
export default function TestTab({ flow, editable, adminEmail }: { flow: FlowKey; editable: boolean; adminEmail: string }) {
  const toast = useToast();
  const [defaults, setDefaults] = useState<TestDefaults | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [codes, setCodes] = useState<AdminDiscountCode[]>([]);

  const [recipients, setRecipients] = useState(adminEmail);
  const [selected, setSelected] = useState<Set<string>>(() => new Set([1, 2, 3, 4, 5].map((n) => key(flow, n))));
  const [firstName, setFirstName] = useState('');
  const [code, setCode] = useState('');
  const [timezone, setTimezone] = useState('');
  const [subjectTag, setSubjectTag] = useState<string | null>(null);
  const [cart, setCart] = useState<SavedCartLine[]>([]);

  const [sending, setSending] = useState(false);
  const [summary, setSummary] = useState<TestSendSummary | null>(null);

  useEffect(() => {
    adminFetch<TestDefaults>(API).then((res) => {
      if (!res.ok) return setLoadError(res.data.error ?? 'Could not load the test defaults');
      setDefaults(res.data);
      setCart(res.data.cart);
    });
    adminFetch<{ codes?: AdminDiscountCode[] }>('/api/admin/discount-codes').then((res) => setCodes(res.ok ? res.data.codes ?? [] : []));
  }, []);

  useEffect(() => {
    if (!recipients && adminEmail) setRecipients(adminEmail);
  }, [adminEmail]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = useMemo(() => parseRecipients(recipients), [recipients]);
  const chosen = useMemo(() => (defaults?.emails ?? []).filter((e) => selected.has(key(e.flow, e.step))), [defaults, selected]);
  const anyCart = chosen.some((e) => e.flow === 'cart');
  const total = parsed.emails.length * chosen.length;
  const tag = subjectTag ?? defaults?.subjectTag ?? 'Test';
  const limits = defaults?.limits;
  const tooMany = !!limits && (parsed.emails.length > limits.recipients || chosen.length > limits.emails);

  const toggle = (k: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    return next;
  });
  const setFlowAll = (f: FlowKey, on: boolean) => setSelected((s) => {
    const next = new Set(s);
    for (const n of [1, 2, 3, 4, 5]) on ? next.add(key(f, n)) : next.delete(key(f, n));
    return next;
  });

  const productById = useMemo(() => new Map((defaults?.products ?? []).map((p) => [p.id, p])), [defaults]);
  const setLine = (i: number, patch: Partial<SavedCartLine>) => setCart((c) => c.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const send = async () => {
    if (!defaults) return;
    if (total > 20 && !confirm(`Send ${total} test emails?`)) return;
    setSending(true);
    setSummary(null);
    const res = await adminFetch<TestSendSummary>(API, {
      method: 'POST',
      body: {
        recipients: parsed.emails,
        emails: chosen.map((e) => ({ flow: e.flow, step: e.step })),
        firstName: firstName.trim() || undefined,
        code: code || undefined,
        timezone: timezone.trim() || undefined,
        cart: anyCart && cart.length ? cart : undefined,
        subjectTag: tag,
      },
    });
    setSending(false);
    if (!res.ok) return toast.error(res.data.error ?? 'The test could not be sent');
    setSummary(res.data);
    const s = res.data;
    const msg = `${s.sent} sent${s.skipped ? `, ${s.skipped} skipped` : ''}${s.failed ? `, ${s.failed} failed` : ''}`;
    if (s.failed || (!s.sent && s.skipped)) toast.error(msg);
    else toast.success(msg);
  };

  if (loadError) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {loadError}
      </div>
    );
  }
  if (!defaults) return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-ink-muted" /></div>;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <Panel title="Send to" description={`One or more addresses — commas or new lines. Each gets its own copy. Up to ${defaults.limits.recipients}.`}>
          <textarea
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            rows={3}
            className={`${inputCls} font-mono`}
            placeholder="you@example.com, teammate@example.com"
            disabled={!editable}
          />
          {parsed.invalid.length > 0 && (
            <p className="mt-1 text-xs text-red-600">Not an email address: {parsed.invalid.join(', ')}</p>
          )}
        </Panel>

        <Panel title="Emails" description="Sent from their saved settings — save any edits in the Emails tab first.">
          <div className="grid gap-4 sm:grid-cols-2">
            {FLOW_KEYS.map((f) => (
              <div key={f}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{FLOWS[f].label}</span>
                  <span className="flex gap-2 text-xs">
                    <button type="button" className="font-medium text-teal-dark hover:underline" onClick={() => setFlowAll(f, true)}>All</button>
                    <button type="button" className="font-medium text-ink-muted hover:underline" onClick={() => setFlowAll(f, false)}>None</button>
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {defaults.emails.filter((e) => e.flow === f).map((e) => {
                    const k = key(e.flow, e.step);
                    const needsCode = e.requiresCode && !e.code && !code;
                    return (
                      <li key={k}>
                        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line px-3 py-2 hover:bg-surface">
                          <input type="checkbox" className="mt-0.5" checked={selected.has(k)} onChange={() => toggle(k)} disabled={!editable} />
                          <span className="min-w-0 text-sm">
                            <span className="font-medium text-ink">{e.name}</span>
                            {!e.enabled && <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-ink-muted">off</span>}
                            <span className="block truncate text-xs text-ink-muted">{e.subject}</span>
                            {e.requiresCode && (
                              <span className={`mt-0.5 block font-mono text-[11px] ${needsCode ? 'text-amber-700' : 'text-ink-muted'}`}>
                                {needsCode ? 'No code — will be skipped' : `Code: ${code || e.code}`}
                              </span>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Details" description="Blank fields use the default shown.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>First name</label>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputCls} placeholder={defaults.firstName} disabled={!editable} />
            </div>
            <div>
              <label className={labelCls}>Discount code</label>
              <select value={code} onChange={(e) => setCode(e.target.value)} className={`${inputCls} font-mono`} disabled={!editable}>
                <option value="">Each email's own code</option>
                {codes.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} · {describeCode(c)}{c.active ? '' : ' (off)'}</option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-ink-muted">Only changes emails that offer a code.</p>
            </div>
            <div>
              <label className={labelCls}>Time zone</label>
              <input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className={`${inputCls} font-mono`}
                placeholder={defaults.timezones[flow]}
                disabled={!editable}
              />
              <p className="mt-1 text-[11px] text-ink-muted">For the countdown's "Ends …" time.</p>
            </div>
            <div>
              <label className={labelCls}>Subject tag</label>
              <input value={tag} onChange={(e) => setSubjectTag(e.target.value)} className={inputCls} placeholder="none" disabled={!editable} />
              <p className="mt-1 text-[11px] text-ink-muted">
                {tag ? <>Subjects read <span className="font-mono">[{tag} · Cart 3] …</span></> : 'Empty: the subject exactly as customers see it.'}
              </p>
            </div>
          </div>
        </Panel>

        {anyCart && (
          <Panel
            title="Sample cart"
            description="What the cart emails show. Its buttons open the store's cart page; they don't restore this cart."
            actions={
              <button type="button" className={secondaryBtn} onClick={() => setCart(defaults.cart)} disabled={!editable}>
                <RotateCcw className="h-4 w-4" /> Reset
              </button>
            }
          >
            <ul className="space-y-2">
              {cart.map((l, i) => {
                const p = productById.get(l.productId);
                return (
                  <li key={i} className="flex gap-2">
                    <select
                      value={l.productId}
                      onChange={(e) => {
                        const next = productById.get(e.target.value);
                        setLine(i, { productId: e.target.value, packSize: next?.packs[0]?.size ?? 1 });
                      }}
                      className={`${inputCls} min-w-0 flex-1`}
                      disabled={!editable}
                    >
                      {!p && <option value={l.productId}>Unknown product</option>}
                      {defaults.products.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                    <select
                      value={l.packSize}
                      onChange={(e) => setLine(i, { packSize: Number(e.target.value) })}
                      className={`${inputCls} w-36`}
                      disabled={!editable}
                    >
                      {(p?.packs ?? [{ size: l.packSize, label: `Pack of ${l.packSize}` }]).map((k) => <option key={k.size} value={k.size}>{k.label}</option>)}
                    </select>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={l.quantity}
                      onChange={(e) => setLine(i, { quantity: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })}
                      className={`${inputCls} w-20`}
                      aria-label="Quantity"
                      disabled={!editable}
                    />
                    <button
                      type="button"
                      onClick={() => setCart((c) => c.filter((_, j) => j !== i))}
                      disabled={!editable || cart.length <= 1}
                      className="rounded-lg px-2 text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-40"
                      aria-label="Remove"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
            {editable && defaults.products.length > 0 && (
              <button
                type="button"
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-teal-dark hover:underline"
                onClick={() => {
                  const p = defaults.products.find((o) => !cart.some((l) => l.productId === o.id)) ?? defaults.products[0];
                  setCart((c) => [...c, { productId: p.id, packSize: p.packs[0]?.size ?? 1, quantity: 1 }]);
                }}
              >
                <Plus className="h-4 w-4" /> Add a product
              </button>
            )}
          </Panel>
        )}
      </div>

      <div className="space-y-6">
        <Panel title="Send" description="Untracked: nobody is enrolled, and opens and clicks aren't counted.">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink">
              {chosen.length} email{chosen.length === 1 ? '' : 's'} × {parsed.emails.length} address{parsed.emails.length === 1 ? '' : 'es'} ={' '}
              <span className="font-semibold">{total}</span> to send
            </p>
            <button
              type="button"
              onClick={send}
              disabled={!editable || sending || !total || parsed.invalid.length > 0 || tooMany}
              title={!editable ? 'Only admins can send tests' : tooMany ? `At most ${limits?.recipients} addresses and ${limits?.emails} emails` : undefined}
              className={primaryBtn}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send test{total === 1 ? '' : 's'}
            </button>
          </div>
          {tooMany && <p className="mt-2 text-xs text-red-600">At most {limits?.recipients} addresses and {limits?.emails} emails at a time.</p>}
        </Panel>

        {summary && (
          <Panel title="Results" description={`${summary.sent} sent · ${summary.skipped} skipped · ${summary.failed} failed`}>
            <ul className="divide-y divide-line">
              {summary.results.map((r, i) => <ResultRow key={i} r={r} />)}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}

function ResultRow({ r }: { r: TestSendResult }) {
  const Icon = r.status === 'sent' ? CheckCircle2 : r.status === 'skipped' ? AlertTriangle : XCircle;
  const tone = r.status === 'sent' ? 'text-emerald-600' : r.status === 'skipped' ? 'text-amber-600' : 'text-red-600';
  return (
    <li className="flex items-start gap-2 py-2 text-sm">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} />
      <span className="min-w-0">
        <span className="font-medium text-ink">{r.name}</span>
        <span className="text-ink-muted"> → {r.to}</span>
        {r.detail && <span className={`block text-xs ${tone}`}>{r.detail}</span>}
      </span>
    </li>
  );
}
