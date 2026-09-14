'use client';

/**
 * The commercial terms with Stealth Health — the deal that turns "they
 * collected $X" into "they owe us $Y".
 *
 * Editing these changes what every FUTURE invoice claims. Invoices already
 * raised carry their own snapshot of the terms, so nothing already sent is
 * silently restated; the form says so plainly.
 */
import React, { useEffect, useState } from 'react';
import { Loader2, Save, Settings2, Info } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { formatMoney } from '@/lib/currency';
import { DEFAULT_TERMS, toCents, toAmount, type SettlementTerms } from '@/lib/admin/stealth-health';
import { getSettlementTerms, saveSettlementTerms } from '@/lib/admin/stealth-health-client';

export default function TermsTab({ isAdmin, onSaved }: { isAdmin: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [terms, setTerms] = useState<SettlementTerms>(DEFAULT_TERMS);
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Money is edited as decimal strings and only converted on save, so typing
  // "35." or "0.5" doesn't get rounded out from under the cursor.
  const [flatFee, setFlatFee] = useState('0');
  const [shippingFee, setShippingFee] = useState('0');

  useEffect(() => {
    getSettlementTerms().then((r) => {
      if (r) {
        setTerms(r.terms);
        setSummary(r.summary);
        setFlatFee(String(toAmount(r.terms.flat_fee_cents)));
        setShippingFee(String(toAmount(r.terms.shipping_fee_cents)));
      }
      setLoading(false);
    });
  }, []);

  const set = <K extends keyof SettlementTerms>(key: K, value: SettlementTerms[K]) =>
    setTerms((t) => ({ ...t, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      const r = await saveSettlementTerms({
        partner_name: terms.partner_name,
        partner_email: terms.partner_email,
        partner_address: terms.partner_address,
        commission_pct: terms.commission_pct,
        flat_fee_cents: toCents(flatFee),
        shipping_fee_cents: toCents(shippingFee),
        shipping_remitted: terms.shipping_remitted,
        payment_terms_days: terms.payment_terms_days,
        currency: terms.currency,
        notes: terms.notes,
      });
      setTerms(r.terms);
      setSummary(r.summary);
      toast.success('Settlement terms saved');
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the terms');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-ink-muted" />
      </div>
    );
  }

  // Worked example on a $200 order, so the effect of a change is visible
  // before it is saved.
  const exampleGross = 20000;
  const exampleFee = Math.round((exampleGross * terms.commission_pct) / 100) + toCents(flatFee);
  const exampleShipping = terms.shipping_remitted ? toCents(shippingFee) : 0;
  const exampleDue = Math.max(0, exampleGross + exampleShipping - exampleFee);
  const fmt = (c: number) => formatMoney(toAmount(c), terms.currency);

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 bg-white rounded-xl border border-line p-5 space-y-5">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-teal-dark" /> Settlement terms
        </h3>

        <fieldset disabled={!isAdmin} className="space-y-5 disabled:opacity-60">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Partner name">
              <input value={terms.partner_name} onChange={(e) => set('partner_name', e.target.value)}
                className="w-full px-3 py-2 border border-line rounded-lg text-sm" />
            </Field>
            <Field label="Partner email" hint="Who the settlement invoice is addressed to.">
              <input type="email" value={terms.partner_email ?? ''}
                onChange={(e) => set('partner_email', e.target.value || null)}
                placeholder="accounts@…"
                className="w-full px-3 py-2 border border-line rounded-lg text-sm" />
            </Field>
          </div>

          <Field label="Partner billing address">
            <textarea value={terms.partner_address ?? ''} rows={2}
              onChange={(e) => set('partner_address', e.target.value || null)}
              className="w-full px-3 py-2 border border-line rounded-lg text-sm resize-none" />
          </Field>

          <div className="border-t border-line pt-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-3">
              What Stealth Health keeps
            </p>
            <div className="grid sm:grid-cols-3 gap-4">
              <Field label="Commission %" hint="Taken off net goods revenue, after refunds.">
                <input type="number" min="0" max="100" step="0.1" value={terms.commission_pct}
                  onChange={(e) => set('commission_pct', Number(e.target.value))}
                  className="w-full px-3 py-2 border border-line rounded-lg text-sm tabular-nums" />
              </Field>
              <Field label={`Flat fee per order (${terms.currency})`}>
                <input type="number" min="0" step="0.01" value={flatFee} inputMode="decimal"
                  onChange={(e) => setFlatFee(e.target.value)}
                  className="w-full px-3 py-2 border border-line rounded-lg text-sm tabular-nums" />
              </Field>
              <Field label="Settlement currency">
                <select value={terms.currency} onChange={(e) => set('currency', e.target.value === 'CAD' ? 'CAD' : 'USD')}
                  className="w-full px-3 py-2 border border-line rounded-lg text-sm bg-white">
                  <option value="USD">USD</option>
                  <option value="CAD">CAD</option>
                </select>
              </Field>
            </div>
          </div>

          <div className="border-t border-line pt-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-3">Shipment fee</p>
            <div className="grid sm:grid-cols-2 gap-4 items-end">
              <Field label={`Flat shipment fee (${terms.currency})`}
                hint="The fee booked on every PuraMass sale.">
                <input type="number" min="0" step="0.01" value={shippingFee} inputMode="decimal"
                  onChange={(e) => setShippingFee(e.target.value)}
                  className="w-full px-3 py-2 border border-line rounded-lg text-sm tabular-nums" />
              </Field>
              <label className="flex items-start gap-2 pb-2 cursor-pointer">
                <input type="checkbox" checked={terms.shipping_remitted}
                  onChange={(e) => set('shipping_remitted', e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-line text-teal-dark" />
                <span className="text-sm text-ink leading-snug">
                  Remitted to us
                  <span className="block text-[11px] text-ink-muted">
                    Uncheck if Stealth Health keeps it to cover the parcel.
                  </span>
                </span>
              </label>
            </div>
          </div>

          <div className="border-t border-line pt-5 grid sm:grid-cols-2 gap-4">
            <Field label="Payment terms (days)" hint="Sets the due date on a new invoice.">
              <input type="number" min="0" step="1" value={terms.payment_terms_days}
                onChange={(e) => set('payment_terms_days', Number(e.target.value))}
                className="w-full px-3 py-2 border border-line rounded-lg text-sm tabular-nums" />
            </Field>
            <Field label="Notes">
              <input value={terms.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)}
                placeholder="Anything to print on the invoice"
                className="w-full px-3 py-2 border border-line rounded-lg text-sm" />
            </Field>
          </div>
        </fieldset>

        {isAdmin ? (
          <div className="flex items-center justify-end pt-2 border-t border-line">
            <button onClick={save} disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-teal-dark text-white rounded-lg text-sm font-medium hover:bg-teal/90 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save terms
            </button>
          </div>
        ) : (
          <p className="text-xs text-ink-muted pt-2 border-t border-line">
            Read-only — only an admin can change the settlement terms.
          </p>
        )}
      </div>

      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-line p-5">
          <h3 className="text-sm font-semibold text-ink mb-2">In plain English</h3>
          <p className="text-sm text-ink-muted leading-relaxed">{summary}</p>
        </div>

        <div className="bg-white rounded-xl border border-line p-5">
          <h3 className="text-sm font-semibold text-ink mb-3">On a {fmt(exampleGross)} order</h3>
          <Row label="Buyer pays Stealth Health" value={fmt(exampleGross)} />
          {exampleShipping > 0 && <Row label="Shipment fee remitted" value={`+ ${fmt(exampleShipping)}`} />}
          {exampleFee > 0 && <Row label="They retain" value={`− ${fmt(exampleFee)}`} />}
          <div className="flex items-baseline justify-between gap-3 pt-2.5 mt-1.5 border-t border-line">
            <span className="text-sm font-semibold text-ink">They owe us</span>
            <span className="text-base font-bold tabular-nums text-ink">{fmt(exampleDue)}</span>
          </div>
        </div>

        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 flex gap-2.5">
          <Info className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-900 leading-relaxed">
            Changing these terms only affects what future invoices claim, and re-values earnings not
            yet billed. Invoices already raised keep the terms they were created with.
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="text-sm tabular-nums text-ink">{value}</span>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-ink-muted font-semibold mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-ink-muted mt-1">{hint}</span>}
    </label>
  );
}
