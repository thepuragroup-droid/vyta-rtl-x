'use client';

/**
 * "Where should we send it?" — the page the missing-address email links to.
 *
 * A Stealth Health hand-off sometimes arrives with no shipping address, which leaves
 * a paid order unshippable. The email at /api/admin/puramass/orders/request-address
 * sends the buyer here with a one-order token in the URL; whatever they type is
 * written straight onto that order.
 *
 * The order summary is shown first, deliberately: someone who receives an
 * unexpected "enter your address" link should be able to recognise their own
 * order — invoice number, items, totals, transaction — before typing anything.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Lock,
  MapPin,
  Package,
  PencilLine,
  Truck,
} from 'lucide-react';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import {
  formatAddressLines,
  validateShippingAddress,
  type ShippingAddressErrors,
  type ShippingAddressInput,
  type ShippingAddressLike,
} from '@/lib/payments/puramass-address';
import {
  SHIPPING_COUNTRIES,
  postalLabel,
  regionLabel,
  regionsFor,
} from '@/lib/shipping/regions';

interface SummaryItem {
  name: string;
  sku: string | null;
  quantity: number;
  unit_price: number | null;
  line_total: number | null;
}

interface OrderView {
  reference: string;
  transaction_id: string | null;
  transaction_link: string | null;
  invoice_number: string | null;
  status: string;
  placed_at: string;
  paid_at: string | null;
  currency: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email_masked: string | null;
  items: SummaryItem[];
  subtotal: number | null;
  shipping: number | null;
  total: number | null;
  shipping_address: ShippingAddressLike | null;
}

interface LoadedData {
  order: OrderView;
  request: { submitted_at: string | null; expires_at: string };
}

const EMPTY_FORM: ShippingAddressInput = {
  full_name: '',
  phone: '',
  address: '',
  address2: '',
  city: '',
  state: '',
  zip: '',
  // Canada is the only destination we ship to.
  country: 'CA',
};

function money(value: number | null, currency: string): string {
  if (value == null) return '—';
  return `$${value.toFixed(2)} ${currency}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** The order, restated so the customer can recognise it before typing. */
function OrderCard({ order }: { order: OrderView }) {
  return (
    <div className="rounded-2xl border border-line bg-white overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-5 py-3">
        <Package className="h-4 w-4 text-teal-dark" />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink">Your order</h2>
        {order.status === 'paid' && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
            <CheckCircle2 className="h-3 w-3" /> Paid
          </span>
        )}
      </div>

      <div className="divide-y divide-line/60">
        {order.items.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-muted">Your order items</p>
        ) : (
          order.items.map((item, i) => (
            <div key={i} className="flex items-start justify-between gap-4 px-5 py-3">
              <div className="min-w-0">
                <p className="text-sm text-ink">{item.name}</p>
                {item.sku && (
                  <p className="font-mono text-[11px] text-ink-light">{item.sku}</p>
                )}
              </div>
              <div className="flex shrink-0 items-baseline gap-4">
                <span className="text-sm text-ink-muted">×{item.quantity}</span>
                {(item.line_total != null || item.unit_price != null) && (
                  <span className="w-20 text-right text-sm tabular-nums text-ink">
                    $
                    {(item.line_total ?? (item.unit_price ?? 0) * item.quantity).toFixed(2)}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {(order.subtotal != null || order.total != null) && (
        <div className="space-y-1.5 border-t border-line px-5 py-4">
          {order.subtotal != null && (
            <div className="flex justify-between text-sm">
              <span className="text-ink-muted">Subtotal</span>
              <span className="tabular-nums text-ink">{money(order.subtotal, order.currency)}</span>
            </div>
          )}
          {order.shipping != null && (
            <div className="flex justify-between text-sm">
              <span className="text-ink-muted">Shipping</span>
              <span className="tabular-nums text-ink">{money(order.shipping, order.currency)}</span>
            </div>
          )}
          {order.total != null && (
            <div className="mt-2 flex justify-between border-t border-ink/80 pt-2 text-base font-bold">
              <span className="text-ink">Total paid</span>
              <span className="tabular-nums text-ink">{money(order.total, order.currency)}</span>
            </div>
          )}
        </div>
      )}

      <dl className="space-y-2 border-t border-line bg-surface/60 px-5 py-4 text-xs">
        {order.invoice_number && (
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Invoice</dt>
            <dd className="font-mono text-ink">{order.invoice_number}</dd>
          </div>
        )}
        {order.transaction_id && (
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Transaction</dt>
            <dd className="min-w-0 break-all text-right font-mono text-ink">
              {order.transaction_link ? (
                <a
                  href={order.transaction_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-teal-dark hover:text-teal-dark hover:underline"
                >
                  {order.transaction_id}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              ) : (
                order.transaction_id
              )}
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">Order reference</dt>
          <dd className="min-w-0 break-all text-right font-mono text-ink">{order.reference}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">Placed</dt>
          <dd className="text-ink">{formatDate(order.placed_at)}</dd>
        </div>
        {order.customer_email_masked && (
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Confirmation sent to</dt>
            <dd className="min-w-0 break-all text-right text-ink">{order.customer_email_masked}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/** Shell for the states that have nothing to fill in (loading, error, thanks). */
function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-white">
      <Navigation />
      <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-20">{children}</div>
      <Footer />
    </main>
  );
}

function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className = '',
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
        {required && <span className="ml-0.5 text-teal-dark">*</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-red-600">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-ink-light">{hint}</p>
      ) : null}
    </div>
  );
}

const inputClass =
  'w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink placeholder-ink-light focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/30';

export default function ShippingAddressPage() {
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === 'string' ? params.token : '';

  const [data, setData] = useState<LoadedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ kind: string; message: string } | null>(null);

  const [form, setForm] = useState<ShippingAddressInput>(EMPTY_FORM);
  const [errors, setErrors] = useState<ShippingAddressErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Set once the address is stored — drives the thank-you view.
  const [saved, setSaved] = useState<{ lines: string[]; name: string } | null>(null);
  // "It's already on file, but I want to change it" — reopens the form.
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/shipping-address/${encodeURIComponent(token)}`, {
          cache: 'no-store',
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLoadError({
            kind: json.error ?? 'not_found',
            message: json.message ?? 'We could not open this link.',
          });
          return;
        }
        setData(json as LoadedData);
        const addr = (json as LoadedData).order.shipping_address;
        setForm({
          ...EMPTY_FORM,
          full_name: (json as LoadedData).order.customer_name ?? '',
          phone: (json as LoadedData).order.customer_phone ?? '',
          address: addr?.address ?? '',
          address2: addr?.address2 ?? '',
          city: addr?.city ?? '',
          // A region code only carries over when it is already a Canadian one.
          state: (addr?.country ?? '').toUpperCase() === 'CA' ? addr?.state ?? '' : '',
          zip: addr?.zip ?? '',
          country: 'CA',
        });
      } catch {
        if (!cancelled) {
          setLoadError({
            kind: 'network',
            message: 'We could not reach the server. Please check your connection and try again.',
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const set = useCallback((key: keyof ShippingAddressInput, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  }, []);

  const regions = useMemo(() => regionsFor(form.country), [form.country]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    // Same validator the server runs, so the customer sees the problem before
    // a round trip rather than after one.
    const check = validateShippingAddress(form);
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/shipping-address/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.errors) setErrors(json.errors as ShippingAddressErrors);
        setSubmitError(json.message ?? 'We could not save that. Please try again.');
        return;
      }
      setSaved({
        lines: formatAddressLines(json.address ?? check.value.address),
        name: json.full_name ?? check.value.full_name,
      });
      setEditing(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setSubmitError('We could not reach the server. Please try again in a moment.');
    } finally {
      setSubmitting(false);
    }
  };

  // ---- States without a form ----------------------------------------------

  if (loading) {
    return (
      <Centered>
        <Loader2 className="h-6 w-6 animate-spin text-teal-dark" />
        <p className="mt-4 text-sm text-ink-muted">Opening your order…</p>
      </Centered>
    );
  }

  if (loadError || !data) {
    const expired = loadError?.kind === 'expired';
    return (
      <Centered>
        <div className="w-full rounded-2xl border border-line bg-white p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
            {expired ? (
              <Clock className="h-6 w-6 text-amber-600" />
            ) : (
              <AlertCircle className="h-6 w-6 text-amber-600" />
            )}
          </div>
          <h1 className="mb-2 text-xl font-bold text-ink">
            {expired ? 'This link has expired' : "We couldn't open this link"}
          </h1>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-ink-muted">
            {loadError?.message}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ink/90"
            >
              Contact us <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/products"
              className="inline-flex items-center gap-2 rounded-lg border border-line px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:border-ink/30"
            >
              Browse products
            </Link>
          </div>
        </div>
      </Centered>
    );
  }

  const { order, request } = data;
  const alreadyOnFile = !saved && !!request.submitted_at && !editing;
  const onFileLines = formatAddressLines(order.shipping_address);

  // ---- Thank you / already submitted --------------------------------------

  if (saved || alreadyOnFile) {
    const lines = saved ? saved.lines : onFileLines;
    const name = saved ? saved.name : (order.customer_name ?? '');
    return (
      <main className="min-h-screen bg-white">
        <Navigation />
        <div className="mx-auto max-w-2xl px-4 py-14">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
              <CheckCircle2 className="h-7 w-7 text-emerald-600" />
            </div>
            <h1 className="mb-2 text-2xl font-bold text-ink">
              {saved ? 'Thank you — we’ve got it!' : 'Your address is already on file'}
            </h1>
            <p className="mx-auto max-w-lg text-sm leading-relaxed text-ink-muted">
              {saved
                ? 'Your shipping address is saved to your order. Our team will pack and process it within the next business day, and you’ll get a tracking email the moment it ships.'
                : 'We already have a shipping address for this order. If anything below looks wrong, you can update it right here.'}
            </p>
          </div>

          <div className="mb-6 rounded-2xl border border-line bg-white p-6">
            <div className="mb-3 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-teal-dark" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-ink">Shipping to</h2>
            </div>
            <address className="not-italic text-sm leading-relaxed text-ink">
              {name && <div className="font-semibold">{name}</div>}
              {lines.map((line, i) => (
                <div key={i} className="text-ink-muted">
                  {line}
                </div>
              ))}
            </address>
            <button
              onClick={() => {
                setSaved(null);
                setEditing(true);
              }}
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-teal-dark transition-colors hover:text-teal-dark"
            >
              <PencilLine className="h-3.5 w-3.5" />
              Spotted a typo? Update the address
            </button>
          </div>

          {/* What happens next — sets expectations so nobody has to email us. */}
          <div className="mb-6 rounded-2xl border border-line bg-surface/60 p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-ink">
              What happens next
            </h2>
            <ol className="space-y-4">
              {[
                {
                  icon: CheckCircle2,
                  title: 'Address received',
                  body: 'It is attached to your order now — nothing else is needed from you.',
                  done: true,
                },
                {
                  icon: Package,
                  title: 'Packed and processed',
                  body: 'Our team prepares your order within the next business day. Everything ships in plain, discreet packaging.',
                },
                {
                  icon: Truck,
                  title: 'Tracking on its way',
                  body: 'As soon as it leaves us, your tracking number lands in your inbox.',
                },
              ].map((step) => (
                <li key={step.title} className="flex gap-3">
                  <div
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                      step.done ? 'bg-emerald-100 text-emerald-600' : 'bg-white text-teal-dark border border-line'
                    }`}
                  >
                    <step.icon className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-ink">{step.title}</p>
                    <p className="text-sm leading-relaxed text-ink-muted">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="mb-8">
            <OrderCard order={order} />
          </div>

          <div className="rounded-2xl border border-line bg-white p-6 text-center">
            <p className="text-sm text-ink-muted">
              Questions about this order? Reply to the email we sent you, or{' '}
              <Link href="/contact" className="font-semibold text-teal-dark hover:underline">
                get in touch
              </Link>
              . A real person answers.
            </p>
            <Link
              href="/products"
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ink/90"
            >
              Continue shopping <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
        <Footer />
      </main>
    );
  }

  // ---- The form -----------------------------------------------------------

  return (
    <main className="min-h-screen bg-white">
      <Navigation />
      <div className="mx-auto max-w-2xl px-4 py-14">
        <div className="mb-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-teal/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-teal-dark">
            <MapPin className="h-3.5 w-3.5" />
            One quick step
          </div>
          <h1 className="mb-3 text-2xl font-bold text-ink sm:text-3xl">
            Where should we send your order?
          </h1>
          <p className="max-w-xl text-sm leading-relaxed text-ink-muted">
            Thanks for ordering with us! Everything went through on our side — we just didn&apos;t
            catch a shipping address with your order. Fill it in below and we&apos;ll have your
            order processed and on its way{' '}
            <span className="font-semibold text-ink">within the next business day</span>.
          </p>
        </div>

        <div className="mb-8">
          <OrderCard order={order} />
        </div>

        {onFileLines.length > 0 && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-semibold">We have this on file — update it if it&apos;s not right:</p>
            <p className="mt-1 leading-relaxed">{onFileLines.join(', ')}</p>
          </div>
        )}

        <form onSubmit={submit} className="rounded-2xl border border-line bg-white p-6 sm:p-8">
          <h2 className="mb-1 text-lg font-bold text-ink">Shipping address</h2>
          <p className="mb-6 text-sm text-ink-muted">
            Please give us the address the courier should deliver to.
          </p>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Full name" htmlFor="full_name" error={errors.full_name} required className="sm:col-span-2">
              <input
                id="full_name"
                name="name"
                autoComplete="name"
                value={form.full_name}
                onChange={(e) => set('full_name', e.target.value)}
                placeholder="Who is the parcel addressed to?"
                className={inputClass}
              />
            </Field>

            <Field
              label="Country"
              htmlFor="country"
              error={errors.country}
              required
              className="sm:col-span-2"
            >
              <select
                id="country"
                name="country"
                autoComplete="country"
                value={form.country}
                onChange={(e) => {
                  set('country', e.target.value);
                  // A region code only means something within its country.
                  set('state', '');
                }}
                className={inputClass}
              >
                {SHIPPING_COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Street address"
              htmlFor="address"
              error={errors.address}
              required
              className="sm:col-span-2"
            >
              <input
                id="address"
                name="address-line1"
                autoComplete="address-line1"
                value={form.address}
                onChange={(e) => set('address', e.target.value)}
                placeholder="123 Main Street"
                className={inputClass}
              />
            </Field>

            <Field
              label="Apartment, suite, unit"
              htmlFor="address2"
              hint="Optional — but it helps the courier find you."
              className="sm:col-span-2"
            >
              <input
                id="address2"
                name="address-line2"
                autoComplete="address-line2"
                value={form.address2}
                onChange={(e) => set('address2', e.target.value)}
                placeholder="Apt 4B"
                className={inputClass}
              />
            </Field>

            <Field label="City" htmlFor="city" error={errors.city} required>
              <input
                id="city"
                name="city"
                autoComplete="address-level2"
                value={form.city}
                onChange={(e) => set('city', e.target.value)}
                className={inputClass}
              />
            </Field>

            <Field
              label={regionLabel(form.country)}
              htmlFor="state"
              error={errors.state}
              required={form.country === 'US' || form.country === 'CA'}
            >
              {regions ? (
                <select
                  id="state"
                  name="state"
                  autoComplete="address-level1"
                  value={form.state}
                  onChange={(e) => set('state', e.target.value)}
                  className={inputClass}
                >
                  <option value="">Select…</option>
                  {regions.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="state"
                  name="state"
                  autoComplete="address-level1"
                  value={form.state}
                  onChange={(e) => set('state', e.target.value)}
                  className={inputClass}
                />
              )}
            </Field>

            <Field label={postalLabel(form.country)} htmlFor="zip" error={errors.zip} required>
              <input
                id="zip"
                name="postal-code"
                autoComplete="postal-code"
                value={form.zip}
                onChange={(e) => set('zip', e.target.value)}
                className={inputClass}
              />
            </Field>

            <Field
              label="Phone"
              htmlFor="phone"
              error={errors.phone}
              hint="Optional — couriers use it for delivery issues only."
            >
              <input
                id="phone"
                name="tel"
                type="tel"
                autoComplete="tel"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          {submitError && (
            <div className="mt-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-ink/90 disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Saving…
              </>
            ) : (
              <>
                Save address &amp; process my order <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-ink-light">
            <Lock className="h-3 w-3" />
            Used only to ship this order. Every parcel goes out in plain, discreet packaging.
          </p>
        </form>

        <p className="mt-6 text-center text-sm text-ink-muted">
          Would rather just tell us?{' '}
          <Link href="/contact" className="font-semibold text-teal-dark hover:underline">
            Message our team
          </Link>{' '}
          — or simply reply to the email we sent you.
        </p>
      </div>
      <Footer />
    </main>
  );
}
