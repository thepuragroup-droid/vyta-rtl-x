'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ImageUp, Loader2, RotateCcw, Save, Send } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { supabase } from '@/lib/supabase';
import { adminFetch } from '@/components/admin/affiliates/api';
import { FLOWS, type FlowKey, type FlowStep, type StepLayout } from '@/lib/email-flows/types';
import { defaultStep } from '@/lib/email-flows/defaults';
import { apiBase, inputCls, labelCls, Panel, primaryBtn, secondaryBtn, stepTitle, whenLabel, type AdminStep } from './shared';

type Field = keyof FlowStep;

/** Which fields each layout actually draws — nothing in the editor that the email ignores. */
const LAYOUT_FIELDS: Record<StepLayout, Field[]> = {
  welcome: ['headline', 'subheadline', 'hero_image_url', 'highlights', 'body', 'cta_label', 'cta_url', 'card_title', 'card_body', 'card_image_url'],
  education: ['headline', 'subheadline', 'hero_image_url', 'highlights', 'body', 'cta_label', 'cta_url', 'card_title', 'card_body', 'card_link_label', 'card_link_url', 'card_image_url'],
  trust: ['headline', 'subheadline', 'hero_image_url', 'highlights', 'body', 'cta_label', 'cta_url', 'card_title', 'card_body', 'card_link_label', 'card_link_url', 'card_image_url'],
  offer: ['eyebrow', 'headline', 'subheadline', 'body', 'hero_image_url', 'highlights', 'cta_label', 'cta_url', 'fine_print'],
  reminder: ['headline', 'body', 'cta_label', 'cta_url', 'hero_image_url', 'highlights', 'fine_print'],
  cart_reminder: ['headline', 'subheadline', 'hero_image_url', 'body', 'cta_label', 'cta_url', 'highlights', 'card_image_url'],
  cart_educate: ['headline', 'subheadline', 'hero_image_url', 'highlights', 'body', 'cta_label', 'cta_url', 'card_title', 'card_body', 'card_link_label', 'card_link_url', 'card_image_url'],
  cart_offer: ['eyebrow', 'headline', 'subheadline', 'body', 'hero_image_url', 'highlights', 'cta_label', 'cta_url', 'fine_print'],
  cart_questions: ['headline', 'subheadline', 'hero_image_url', 'highlights', 'body', 'cta_label', 'cta_url', 'card_title', 'card_body', 'card_link_label', 'card_link_url', 'card_image_url'],
  cart_last_chance: ['eyebrow', 'headline', 'body', 'cta_label', 'cta_url', 'hero_image_url', 'highlights', 'fine_print'],
};

/** Label overrides where a cart layout uses a field differently. */
const CART_LABELS: Partial<Record<StepLayout, Partial<Record<Field, { label: string; hint?: string }>>>> = {
  cart_reminder: { card_image_url: { label: 'Product image', hint: 'Shown at the bottom' } },
  cart_questions: { highlights: { label: 'Topics we can help with', hint: 'One per line' } },
  cart_last_chance: { eyebrow: { label: 'Red banner', hint: 'e.g. Final reminder' } },
};

const LABELS: Partial<Record<Field, { label: string; hint?: string; multiline?: boolean }>> = {
  eyebrow: { label: 'Eyebrow', hint: 'Small capitals above the headline' },
  headline: { label: 'Headline' },
  subheadline: { label: 'Subheadline' },
  body: { label: 'Body', hint: 'Blank line between paragraphs', multiline: true },
  highlights: { label: 'Badges / benefits', hint: 'One per line (up to 4 shown as badges)', multiline: true },
  cta_label: { label: 'Button text' },
  cta_url: { label: 'Button link', hint: '/products, https://…, {{cart_url}} or {{checkout_url}}' },
  hero_image_url: { label: 'Main image' },
  card_title: { label: 'Card title' },
  card_body: { label: 'Card text', multiline: true },
  card_link_label: { label: 'Card link text' },
  card_link_url: { label: 'Card link', hint: '/lab-results or https://…' },
  card_image_url: { label: 'Card image' },
  fine_print: { label: 'Fine print' },
};

const IMAGE_FIELDS: Field[] = ['hero_image_url', 'card_image_url'];

function ImageField({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled: boolean }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/admin/content/upload', {
        method: 'POST',
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error ?? 'Upload failed');
      onChange(data.url);
      toast.success('Image uploaded — save the email to keep it');
    } catch (e: any) {
      toast.error(e?.message ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex items-start gap-3">
      <div className="h-14 w-20 flex-shrink-0 overflow-hidden rounded-md border border-line bg-surface">
        {value && <img src={value} alt="" className="h-full w-full object-cover" />}
      </div>
      <div className="flex-1 space-y-1.5">
        <input value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={inputCls} placeholder="/images/… or https://…" />
        {!disabled && (
          <>
            <button type="button" onClick={() => input.current?.click()} disabled={uploading} className={`${secondaryBtn} py-1 text-xs`}>
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageUp className="h-3.5 w-3.5" />} Upload image
            </button>
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                e.target.value = '';
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default function EmailsTab({ flow, steps, editable, initialStep, adminEmail, onSaved }: {
  flow: FlowKey;
  steps: AdminStep[];
  editable: boolean;
  initialStep: number;
  adminEmail: string;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [selected, setSelected] = useState(initialStep);
  const saved = steps.find((s) => s.step === selected) ?? steps[0];
  const [draft, setDraft] = useState<FlowStep>(saved);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ html: string; subject: string; preheader: string; problems: string[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [testTo, setTestTo] = useState(adminEmail);
  const [testing, setTesting] = useState(false);

  useEffect(() => setSelected(initialStep), [initialStep]);
  useEffect(() => setDraft(saved), [saved]);

  const layout = FLOWS[flow].steps[draft.step].layout;
  const inDays = FLOWS[flow].delayUnit === 'days';
  const dirty = useMemo(() => JSON.stringify(stripMeta(draft)) !== JSON.stringify(stripMeta(saved)), [draft, saved]);

  // Live preview: rendered on the server by the function that sends, debounced.
  useEffect(() => {
    let cancelled = false;
    setPreviewing(true);
    const t = setTimeout(async () => {
      const res = await adminFetch<{ html: string; subject: string; preheader: string; problems: string[] }>(
        `${apiBase(flow)}/preview`,
        { method: 'POST', body: { draft } },
      );
      if (cancelled) return;
      setPreviewing(false);
      if (res.ok) setPreview(res.data);
      else setPreview({ html: '', subject: '', preheader: '', problems: [res.data.error ?? 'Preview failed'] });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [draft, flow]);

  const set = <K extends Field>(key: K, value: FlowStep[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const switchTo = (n: number) => {
    if (dirty && !confirm('Discard unsaved changes to this email?')) return;
    setSelected(n);
  };

  const save = async () => {
    setSaving(true);
    const res = await adminFetch(`${apiBase(flow)}/steps/${draft.step}`, { method: 'PUT', body: draft });
    setSaving(false);
    if (!res.ok) return toast.error(res.data.error ?? 'Could not save');
    toast.success(`${stepTitle(flow, draft.step)} saved`);
    onSaved();
  };

  const sendTest = async () => {
    setTesting(true);
    const res = await adminFetch(`${apiBase(flow)}/preview`, { method: 'POST', body: { draft, sendTo: testTo } });
    setTesting(false);
    if (!res.ok) return toast.error(res.data.error ?? 'Could not send the test');
    toast.success(`Test sent to ${testTo}`);
  };

  const resetToDefault = () => {
    if (!confirm('Replace this email’s content with the original design copy? Nothing is saved until you click Save.')) return;
    const d = defaultStep(flow, draft.step);
    setDraft({ ...d, delay_hours: draft.delay_hours, enabled: draft.enabled });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {steps.map((s) => (
          <button
            key={s.step}
            type="button"
            onClick={() => switchTo(s.step)}
            className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
              s.step === selected ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:border-ink/30'
            }`}
          >
            <span className="block font-semibold">{stepTitle(flow, s.step)}</span>
            <span className={s.step === selected ? 'text-white/70' : 'text-ink-muted'}>
              {s.enabled ? whenLabel(flow, s.delay_hours) : 'Switched off'}
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,620px)]">
        <Panel
          title={stepTitle(flow, draft.step)}
          description={FLOWS[flow].steps[draft.step].theme}
          actions={
            editable && (
              <div className="flex gap-2">
                <button type="button" onClick={resetToDefault} className={secondaryBtn} title="Restore the original copy">
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button type="button" onClick={save} disabled={!dirty || saving} className={primaryBtn}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
                </button>
              </div>
            )
          }
        >
          <fieldset disabled={!editable} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex items-center gap-2 text-sm text-ink sm:col-span-1">
                <input type="checkbox" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} />
                Send this email
              </label>
              <div className="sm:col-span-2">
                <label className={labelCls}>{inDays ? 'Send on day' : 'Send after'}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={inDays ? 90 : 2160}
                    value={inDays ? Math.round(draft.delay_hours / 24) : draft.delay_hours}
                    onChange={(e) => {
                      const v = Math.max(0, Math.floor(Number(e.target.value) || 0));
                      set('delay_hours', inDays ? v * 24 : v);
                    }}
                    className={`${inputCls} w-24`}
                  />
                  <span className="text-xs text-ink-muted">
                    {draft.delay_hours === 0
                      ? `Immediately after ${FLOWS[flow].trigger}`
                      : `${inDays ? 'days' : 'hours'} after ${FLOWS[flow].trigger}${draft.step > 1 || flow === 'cart' ? ', if no purchase yet' : ''}`}
                  </span>
                </div>
                {flow === 'cart' && draft.step === 1 && (
                  <p className="mt-1 text-[11px] text-ink-muted">This is also how long a cart must sit unchanged to count as abandoned.</p>
                )}
              </div>
            </div>

            <div>
              <label className={labelCls}>Subject line</label>
              <input value={draft.subject} onChange={(e) => set('subject', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Preview text <span className="font-normal text-ink-muted">— shown after the subject in the inbox</span></label>
              <input value={draft.preheader} onChange={(e) => set('preheader', e.target.value)} className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Offer deadline <span className="font-normal text-ink-muted">— hours after this email is sent; powers {'{{offer_ends}}'} and the countdown</span></label>
              <input
                type="number"
                min={1}
                max={336}
                value={draft.deadline_hours ?? ''}
                onChange={(e) => set('deadline_hours', e.target.value === '' ? null : Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                className={`${inputCls} w-32`}
                placeholder="None"
              />
            </div>

            {flow === 'cart' && (
              <div className="space-y-3 rounded-lg border border-line p-3">
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={draft.show_cart} onChange={(e) => set('show_cart', e.target.checked)} />
                  Show what's in their cart
                </label>
                {draft.show_cart && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className={labelCls}>Cart heading</label>
                      <input value={draft.cart_title} onChange={(e) => set('cart_title', e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Cart text</label>
                      <input value={draft.cart_body} onChange={(e) => set('cart_body', e.target.value)} className={inputCls} />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className={labelCls}>Discount code</label>
              <input
                value={draft.promo_code ?? ''}
                onChange={(e) => set('promo_code', e.target.value.toUpperCase() || null)}
                className={`${inputCls} font-mono uppercase`}
                placeholder="None"
              />
              <p className="mt-1 text-[11px] text-ink-muted">
                Must exist in Discount Codes. {'{{discount}}'} prints its real value, so the copy can't promise more than the code gives.
              </p>
            </div>

            {LAYOUT_FIELDS[layout].map((field) => {
              const meta = { ...(LABELS[field] ?? { label: field }), ...(CART_LABELS[layout]?.[field] ?? {}) } as { label: string; hint?: string; multiline?: boolean };
              return (
                <div key={field}>
                  <label className={labelCls}>
                    {meta.label}
                    {meta.hint && <span className="font-normal text-ink-muted"> — {meta.hint}</span>}
                  </label>
                  {IMAGE_FIELDS.includes(field) ? (
                    <ImageField value={String(draft[field] ?? '')} onChange={(v) => set(field, v as never)} disabled={!editable} />
                  ) : field === 'highlights' ? (
                    <textarea
                      rows={4}
                      value={draft.highlights.join('\n')}
                      onChange={(e) => set('highlights', e.target.value.split('\n'))}
                      className={inputCls}
                    />
                  ) : meta.multiline ? (
                    <textarea rows={4} value={String(draft[field] ?? '')} onChange={(e) => set(field, e.target.value as never)} className={inputCls} />
                  ) : (
                    <input value={String(draft[field] ?? '')} onChange={(e) => set(field, e.target.value as never)} className={inputCls} />
                  )}
                </div>
              );
            })}

            <p className="rounded-lg bg-surface px-3 py-2 text-[11px] text-ink-muted">
              Merge tags: <code>{'{{first_name}}'}</code> (falls back to “there”), <code>{'{{code}}'}</code>,{' '}
              <code>{'{{discount}}'}</code> (e.g. 20%), <code>{'{{offer_ends}}'}</code> (this email’s deadline)
              {flow === 'cart' && (
                <>
                  , <code>{'{{cart_url}}'}</code> (restores their cart) and <code>{'{{checkout_url}}'}</code> (restores
                  it and goes to checkout with this email’s code)
                </>
              )}
              .
            </p>
          </fieldset>
        </Panel>

        <div className="space-y-3 xl:sticky xl:top-4 xl:self-start">
          <Panel
            title="Preview"
            description={preview?.subject ? <><span className="font-medium text-ink">{preview.subject}</span>{preview.preheader ? ` — ${preview.preheader}` : ''}</> : `Rendered exactly as it will be sent, with a sample name${flow === 'cart' ? ' and cart' : ''}.`}
            actions={previewing ? <Loader2 className="h-4 w-4 animate-spin text-ink-muted" /> : null}
          >
            {preview?.problems?.length ? (
              <ul className="mb-3 space-y-1">
                {preview.problems.map((p) => (
                  <li key={p} className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /> {p}
                  </li>
                ))}
              </ul>
            ) : preview ? (
              <p className="mb-3 flex items-center gap-1.5 text-xs text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> No problems found
              </p>
            ) : null}
            <iframe
              title="Email preview"
              srcDoc={preview?.html ?? ''}
              sandbox=""
              className="h-[720px] w-full rounded-lg border border-line bg-[#EDF3F5]"
            />
          </Panel>
          {editable && (
            <Panel title="Send a test" description="Sends this draft (saved or not), marked [Test]. Links are untracked.">
              <div className="flex gap-2">
                <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} className={inputCls} placeholder="you@example.com" />
                <button type="button" onClick={sendTest} disabled={testing || !testTo} className={primaryBtn}>
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
                </button>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function stripMeta(s: Partial<AdminStep>) {
  const { code: _c, problems: _p, updated_at: _u, updated_by_email: _e, ...rest } = s as AdminStep;
  return { ...rest, highlights: (rest.highlights ?? []).map((h) => h.trim()).filter(Boolean) };
}
