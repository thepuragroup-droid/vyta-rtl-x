'use client';

/**
 * Promotions — customer-facing offers, kept out of Site Settings.
 *
 * Site Settings is where the store's plumbing lives (API keys, origin
 * addresses, parcel dimensions). A promo is something a marketer turns on and
 * off, so it gets its own page rather than another card buried down that one.
 *
 * Today that is the free-shipping threshold and the paid-ads welcome discount.
 * The values are stored on the same `site_settings` row and saved through
 * /api/admin/settings, which is also what normalises them — above all, forcing
 * the free-shipping promo off unless live courier rates are on, and forcing the
 * discount off at zero percent. This page mirrors those rules in the UI so the
 * reason is visible rather than just enforced.
 */
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowRight,
  BadgePercent,
  Check,
  Gift,
  Loader2,
  Megaphone,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Truck,
} from 'lucide-react';
import { supabase, type SiteSettings } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import { useUserRole } from '../layout';

const INPUT =
  'px-4 py-2.5 bg-surface rounded-lg border border-line text-sm text-ink ' +
  'placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-teal/40 ' +
  'disabled:opacity-50';

/**
 * A stored UTC timestamp as a `datetime-local` input value.
 *
 * The input speaks local wall-clock with no zone, so the offsets are applied
 * here rather than sliced off the ISO string — an operator in Vancouver typing
 * "5pm" must get 5pm their time, not 5pm UTC.
 */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const when = new Date(iso);
  if (!Number.isFinite(when.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}` +
    `T${pad(when.getHours())}:${pad(when.getMinutes())}`
  );
}

/** The same value on its way back out: local wall-clock → ISO, or null. */
function fromLocalInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const when = new Date(trimmed);
  return Number.isFinite(when.getTime()) ? when.toISOString() : null;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export default function PromosPage() {
  const userRole = useUserRole();
  const isReadOnly = userRole === 'assistant';
  const toast = useToast();

  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [thresholdInput, setThresholdInput] = useState('');
  const [percentInput, setPercentInput] = useState('');
  // Limited-time cart offer. `endsAtInput` is a <input type="datetime-local">
  // value, i.e. local wall-clock with no zone — converted on save.
  const [offerPercentInput, setOfferPercentInput] = useState('');
  const [offerMinItemsInput, setOfferMinItemsInput] = useState('');
  const [endsAtInput, setEndsAtInput] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/settings', { cache: 'no-store' });
      const json = await res.json();
      const s: SiteSettings = json.settings;
      setSettings(s);
      setThresholdInput(
        s.puramass_free_shipping_threshold ? String(s.puramass_free_shipping_threshold) : '',
      );
      setPercentInput(s.ad_discount_percent ? String(s.ad_discount_percent) : '');
      setOfferPercentInput(s.cart_offer_percent ? String(s.cart_offer_percent) : '');
      setOfferMinItemsInput(
        s.cart_offer_min_items ? String(s.cart_offer_min_items) : '',
      );
      setEndsAtInput(toLocalInput(s.cart_offer_ends_at));
    } catch {
      toast.error('Failed to load promotions');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(
    async (updates: Record<string, any>) => {
      setSaving(true);
      try {
        const res = await fetch('/api/admin/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify(updates),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Save failed');
        setSettings(json.settings);
        toast.success('Promotions saved');
        return json.settings as SiteSettings;
      } catch (e: any) {
        toast.error(e.message ?? 'Save failed');
        return null;
      } finally {
        setSaving(false);
      }
    },
    [toast],
  );

  if (loading || !settings) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading promotions…
      </div>
    );
  }

  // The promo has nothing to zero out without a courier quote behind it, so the
  // control is locked until live rates are on.
  const ratesEnabled = settings.puramass_shipping_rates_enabled;
  const locked = isReadOnly || !ratesEnabled;
  const enabled = settings.puramass_free_shipping_enabled;

  const toggle = (next: boolean) => {
    if (locked) return;
    if (next && !(Number(thresholdInput) > 0)) {
      toast.error('Set a spend threshold above zero first.');
      return;
    }
    save({
      puramass_free_shipping_enabled: next,
      ...(next ? { puramass_free_shipping_threshold: Number(thresholdInput) } : {}),
    });
  };

  const saveThreshold = () => {
    if (locked) return;
    const amount = Number(thresholdInput);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error('Enter a threshold of zero or more.');
      return;
    }
    save({ puramass_free_shipping_threshold: amount });
  };

  // ---- Paid-ads welcome discount ----
  //
  // Applied by lowering the line prices on the PuraMass hand-off, so like the
  // free-shipping promo it has nowhere to land unless the hosted checkout is
  // the live one. The control is locked until it is, for the same reason.
  const hostedLive = settings.puramass_checkout_enabled;
  const adLocked = isReadOnly || !hostedLive;
  const adEnabled = settings.ad_discount_enabled;
  const adPercent = Number(settings.ad_discount_percent) || 0;

  const toggleAd = (next: boolean) => {
    if (adLocked) return;
    const percent = Number(percentInput);
    if (next && !(percent > 0)) {
      toast.error('Set a discount above zero first.');
      return;
    }
    save({
      ad_discount_enabled: next,
      ...(next ? { ad_discount_percent: percent } : {}),
    });
  };

  const savePercent = () => {
    if (adLocked) return;
    const percent = Number(percentInput);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      toast.error('Enter a discount between 0 and 100 percent.');
      return;
    }
    save({ ad_discount_percent: percent });
  };

  // ---- Limited-time cart offer ----
  //
  // Locked behind the same hosted-checkout toggle as the welcome discount, and
  // for the same reason: the saving is taken off the line prices sent to
  // PuraMass, so there is nowhere to apply it when that isn't the live
  // checkout. It stacks with the welcome discount — the two percentages
  // compose (25% then 10% = 32.5% off), never add.
  const offerLocked = isReadOnly || !hostedLive;
  const offerEnabled = settings.cart_offer_enabled;
  const offerPercent = Number(settings.cart_offer_percent) || 0;
  const offerMinItems = Number(settings.cart_offer_min_items) || 1;
  const offerEnded =
    !!settings.cart_offer_ends_at && new Date(settings.cart_offer_ends_at).getTime() <= Date.now();

  const toggleOffer = (next: boolean) => {
    if (offerLocked) return;
    const percent = Number(offerPercentInput);
    if (next && !(percent > 0)) {
      toast.error('Set a discount above zero first.');
      return;
    }
    save({
      cart_offer_enabled: next,
      ...(next
        ? {
            cart_offer_percent: percent,
            cart_offer_min_items: Math.max(1, Math.floor(Number(offerMinItemsInput) || 1)),
          }
        : {}),
    });
  };

  const saveOffer = () => {
    if (offerLocked) return;
    const percent = Number(offerPercentInput);
    if (!Number.isFinite(percent) || percent < 0 || percent > 99) {
      toast.error('Enter a discount between 0 and 99 percent.');
      return;
    }
    const minItems = Math.floor(Number(offerMinItemsInput));
    if (!Number.isFinite(minItems) || minItems < 1) {
      toast.error('Enter a minimum of at least one item.');
      return;
    }
    if (endsAtInput.trim() && !fromLocalInput(endsAtInput)) {
      toast.error('That end date could not be read.');
      return;
    }
    save({
      cart_offer_percent: percent,
      cart_offer_min_items: minItems,
      cart_offer_ends_at: fromLocalInput(endsAtInput),
    });
  };

  // The two merchandising blocks on the cart. Nothing is discounted by either,
  // so they are plain on/off with no lock behind a checkout.
  const toggleBlock = (key: 'cart_fbt_enabled' | 'cart_similar_enabled', next: boolean) => {
    if (isReadOnly) return;
    save({ [key]: next });
  };

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal/10">
          <Sparkles className="h-5 w-5 text-teal-dark" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-ink sm:text-3xl">Promotions</h1>
          <p className="text-sm text-ink-muted">
            Customer-facing offers on the storefront and hosted checkout.
          </p>
        </div>
      </div>

      {/* Free shipping */}
      <div className="rounded-xl border border-line bg-white p-5">
        <div className="mb-1 flex items-center gap-2">
          <Truck className="h-4 w-4 text-teal-dark" />
          <h2 className="font-semibold text-ink">Free shipping over a spend</h2>
        </div>
        <p className="mb-4 text-xs text-ink-muted">
          Once a cart&apos;s subtotal reaches the threshold, shipping is free — whichever
          courier the buyer picks at checkout. Their cart shows a progress bar with how
          much more they need to add. The subtotal is re-checked against the catalog when
          the order is placed, so the offer can&apos;t be claimed from the browser.
        </p>

        {!ratesEnabled && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>
              Live courier rates are switched off, so every order pays the flat shipping
              fee and there is nothing for this promo to waive. Turn on{' '}
              <span className="font-medium">PuraMass Checkout → Shipping → Live courier rates</span>{' '}
              first.{' '}
              <Link
                href="/admin/settings"
                className="inline-flex items-center gap-1 font-medium underline underline-offset-2"
              >
                Open Site Settings <ArrowRight className="h-3 w-3" />
              </Link>
            </span>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => toggle(true)}
            disabled={locked}
            className={`relative rounded-lg border p-4 text-left transition-colors disabled:opacity-50 ${
              enabled ? 'border-teal bg-teal/5' : 'border-line bg-surface hover:border-teal/40'
            }`}
          >
            {enabled && (
              <div className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-teal">
                <Check className="h-3 w-3 text-white" />
              </div>
            )}
            <div className={`mb-2 ${enabled ? 'text-teal-dark' : 'text-ink-muted'}`}>
              <ToggleRight className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-ink">Running</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Carts over the threshold ship free.
            </p>
          </button>

          <button
            type="button"
            onClick={() => toggle(false)}
            disabled={locked}
            className={`relative rounded-lg border p-4 text-left transition-colors disabled:opacity-50 ${
              !enabled ? 'border-teal bg-teal/5' : 'border-line bg-surface hover:border-teal/40'
            }`}
          >
            {!enabled && (
              <div className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-teal">
                <Check className="h-3 w-3 text-white" />
              </div>
            )}
            <div className={`mb-2 ${!enabled ? 'text-teal-dark' : 'text-ink-muted'}`}>
              <ToggleLeft className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-ink">Off</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Everyone pays for shipping as quoted.
            </p>
          </button>
        </div>

        <div className="mt-4 border-t border-line pt-4">
          <label
            htmlFor="free-shipping-threshold"
            className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-ink-muted"
          >
            Spend threshold (CAD)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="free-shipping-threshold"
              type="number"
              min="0"
              step="0.01"
              disabled={locked}
              value={thresholdInput}
              onChange={(e) => setThresholdInput(e.target.value)}
              placeholder="e.g. 300"
              className={`${INPUT} max-w-[12rem]`}
            />
            <button
              type="button"
              onClick={saveThreshold}
              disabled={locked || saving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink hover:border-teal/40 disabled:opacity-50"
            >
              <Check className="h-4 w-4" /> Save threshold
            </button>
          </div>
          <p className="mt-1.5 text-xs text-ink-muted">
            Goods only — shipping and taxes don&apos;t count toward it.
          </p>
        </div>

        {enabled && settings.puramass_free_shipping_threshold > 0 && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Live: carts of{' '}
            <span className="font-semibold">
              ${Number(settings.puramass_free_shipping_threshold).toFixed(2)}
            </span>{' '}
            or more ship free.
          </div>
        )}
      </div>

      {/* Paid-ads welcome discount */}
      <div className="rounded-xl border border-line bg-white p-5">
        <div className="mb-1 flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-teal-dark" />
          <h2 className="font-semibold text-ink">Paid-ads welcome discount</h2>
        </div>
        <p className="mb-4 text-xs text-ink-muted">
          Visitors who arrive on a Google, Meta, Microsoft, TikTok or LinkedIn ad see a
          strip under the nav bar offering this much off if they create an account. Once
          they have one it applies to their order automatically — no code to enter. The
          saving is taken off the line prices sent to the hosted checkout, and who
          qualifies is re-decided server-side from the attribution already being
          collected, so it can&apos;t be claimed from the browser.
        </p>

        {!hostedLive && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>
              The PuraMass hosted checkout is switched off, and it is the only checkout
              that carries our own line prices — so there is nowhere for this discount to
              be applied. Turn on{' '}
              <span className="font-medium">PuraMass Checkout</span> first.{' '}
              <Link
                href="/admin/settings"
                className="inline-flex items-center gap-1 font-medium underline underline-offset-2"
              >
                Open Site Settings <ArrowRight className="h-3 w-3" />
              </Link>
            </span>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => toggleAd(true)}
            disabled={adLocked}
            className={`relative rounded-lg border p-4 text-left transition-colors disabled:opacity-50 ${
              adEnabled ? 'border-teal bg-teal/5' : 'border-line bg-surface hover:border-teal/40'
            }`}
          >
            {adEnabled && (
              <div className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-teal">
                <Check className="h-3 w-3 text-white" />
              </div>
            )}
            <div className={`mb-2 ${adEnabled ? 'text-teal-dark' : 'text-ink-muted'}`}>
              <ToggleRight className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-ink">Running</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Signed-in ad visitors get the discount.
            </p>
          </button>

          <button
            type="button"
            onClick={() => toggleAd(false)}
            disabled={adLocked}
            className={`relative rounded-lg border p-4 text-left transition-colors disabled:opacity-50 ${
              !adEnabled ? 'border-teal bg-teal/5' : 'border-line bg-surface hover:border-teal/40'
            }`}
          >
            {!adEnabled && (
              <div className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-teal">
                <Check className="h-3 w-3 text-white" />
              </div>
            )}
            <div className={`mb-2 ${!adEnabled ? 'text-teal-dark' : 'text-ink-muted'}`}>
              <ToggleLeft className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-ink">Off</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              No strip, and everyone pays list price.
            </p>
          </button>
        </div>

        <div className="mt-4 border-t border-line pt-4">
          <label
            htmlFor="ad-discount-percent"
            className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-ink-muted"
          >
            Discount (% off the subtotal)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="ad-discount-percent"
              type="number"
              min="0"
              max="100"
              step="0.01"
              disabled={adLocked}
              value={percentInput}
              onChange={(e) => setPercentInput(e.target.value)}
              placeholder="e.g. 25"
              className={`${INPUT} max-w-[12rem]`}
            />
            <button
              type="button"
              onClick={savePercent}
              disabled={adLocked || saving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink hover:border-teal/40 disabled:opacity-50"
            >
              <Check className="h-4 w-4" /> Save discount
            </button>
          </div>
          <p className="mt-1.5 text-xs text-ink-muted">
            Goods only — taken off before shipping and taxes. Zero switches the offer off.
          </p>
        </div>

        {adEnabled && adPercent > 0 && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <BadgePercent className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>
              Live: signed-in visitors who arrived on a paid ad get{' '}
              <span className="font-semibold">{adPercent}% off</span> their order.
            </span>
          </div>
        )}
      </div>

      {/* Limited-time cart offer */}
      <div className="rounded-xl border border-line bg-white p-5">
        <div className="mb-1 flex items-center gap-2">
          <Gift className="h-4 w-4 text-teal-dark" />
          <h2 className="font-semibold text-ink">Limited-time cart offer</h2>
        </div>
        <p className="mb-4 text-xs text-ink-muted">
          A strip at the top of the cart summary: once the cart carries the minimum number
          of items, this much comes off the order. Below that minimum it tells the shopper
          how many more to add. Open to everyone — what earns it is the cart, not the
          buyer — and it stacks with the welcome discount above, the two composing rather
          than adding (25% then 10% is 32.5% off, never 35%).
        </p>

        {!hostedLive && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>
              The PuraMass hosted checkout is switched off, and it is the only checkout
              that carries our own line prices — so there is nowhere for this discount to
              be applied. Turn on <span className="font-medium">PuraMass Checkout</span>{' '}
              first.{' '}
              <Link
                href="/admin/settings"
                className="inline-flex items-center gap-1 font-medium underline underline-offset-2"
              >
                Open Site Settings <ArrowRight className="h-3 w-3" />
              </Link>
            </span>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => toggleOffer(true)}
            disabled={offerLocked}
            className={`relative rounded-lg border p-4 text-left transition-colors disabled:opacity-50 ${
              offerEnabled ? 'border-teal bg-teal/5' : 'border-line bg-surface hover:border-teal/40'
            }`}
          >
            {offerEnabled && (
              <div className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-teal">
                <Check className="h-3 w-3 text-white" />
              </div>
            )}
            <div className={`mb-2 ${offerEnabled ? 'text-teal-dark' : 'text-ink-muted'}`}>
              <ToggleRight className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-ink">Running</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Carts at the minimum get the discount.
            </p>
          </button>

          <button
            type="button"
            onClick={() => toggleOffer(false)}
            disabled={offerLocked}
            className={`relative rounded-lg border p-4 text-left transition-colors disabled:opacity-50 ${
              !offerEnabled ? 'border-teal bg-teal/5' : 'border-line bg-surface hover:border-teal/40'
            }`}
          >
            {!offerEnabled && (
              <div className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-teal">
                <Check className="h-3 w-3 text-white" />
              </div>
            )}
            <div className={`mb-2 ${!offerEnabled ? 'text-teal-dark' : 'text-ink-muted'}`}>
              <ToggleLeft className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-ink">Off</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              No strip, and everyone pays list price.
            </p>
          </button>
        </div>

        <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="cart-offer-percent"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-ink-muted"
            >
              Discount (% off the subtotal)
            </label>
            <input
              id="cart-offer-percent"
              type="number"
              min="0"
              max="99"
              step="0.01"
              disabled={offerLocked}
              value={offerPercentInput}
              onChange={(e) => setOfferPercentInput(e.target.value)}
              placeholder="e.g. 10"
              className={`${INPUT} w-full`}
            />
          </div>

          <div>
            <label
              htmlFor="cart-offer-min-items"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-ink-muted"
            >
              Minimum items to unlock
            </label>
            <input
              id="cart-offer-min-items"
              type="number"
              min="1"
              step="1"
              disabled={offerLocked}
              value={offerMinItemsInput}
              onChange={(e) => setOfferMinItemsInput(e.target.value)}
              placeholder="e.g. 2"
              className={`${INPUT} w-full`}
            />
            <p className="mt-1.5 text-xs text-ink-muted">
              Counted as cart lines × quantity — a pack of 5 is one item, the way the
              shopper counts it.
            </p>
          </div>

          <div className="sm:col-span-2">
            <label
              htmlFor="cart-offer-ends-at"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-ink-muted"
            >
              Ends (optional)
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="cart-offer-ends-at"
                type="datetime-local"
                disabled={offerLocked}
                value={endsAtInput}
                onChange={(e) => setEndsAtInput(e.target.value)}
                className={`${INPUT} max-w-[16rem]`}
              />
              {endsAtInput && !offerLocked && (
                <button
                  type="button"
                  onClick={() => setEndsAtInput('')}
                  className="text-xs font-medium text-ink-muted underline underline-offset-2 hover:text-ink"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={saveOffer}
                disabled={offerLocked || saving}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink hover:border-teal/40 disabled:opacity-50"
              >
                <Check className="h-4 w-4" /> Save offer
              </button>
            </div>
            <p className="mt-1.5 text-xs text-ink-muted">
              Your local time. The cart counts down to it and the checkout stops honouring
              the discount at it, so the clock never promises something the order then
              refuses. Leave it empty and the offer runs with no countdown until you
              switch it off.
            </p>
          </div>
        </div>

        {offerEnabled && offerPercent > 0 && !offerEnded && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <Gift className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>
              Live: carts with {offerMinItems} item{offerMinItems === 1 ? '' : 's'} or more
              get <span className="font-semibold">{offerPercent}% off</span>
              {settings.cart_offer_ends_at
                ? `, until ${new Date(settings.cart_offer_ends_at).toLocaleString()}.`
                : '.'}
            </span>
          </div>
        )}

        {offerEnabled && offerEnded && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>
              This offer&apos;s end date has passed, so nothing is being discounted and the
              cart shows no strip. Give it a new end date (or clear the field) to run it
              again.
            </span>
          </div>
        )}
      </div>

      {/* Cart merchandising blocks */}
      <div className="rounded-xl border border-line bg-white p-5">
        <div className="mb-1 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-teal-dark" />
          <h2 className="font-semibold text-ink">Cart suggestions</h2>
        </div>
        <p className="mb-4 text-xs text-ink-muted">
          The two blocks under the cart&apos;s line items. Neither discounts anything —
          they only decide what gets suggested.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => toggleBlock('cart_fbt_enabled', !settings.cart_fbt_enabled)}
            disabled={isReadOnly}
            className={`relative rounded-lg border p-4 text-left transition-colors disabled:opacity-50 ${
              settings.cart_fbt_enabled
                ? 'border-teal bg-teal/5'
                : 'border-line bg-surface hover:border-teal/40'
            }`}
          >
            <div
              className={`mb-2 ${settings.cart_fbt_enabled ? 'text-teal-dark' : 'text-ink-muted'}`}
            >
              {settings.cart_fbt_enabled ? (
                <ToggleRight className="h-5 w-5" />
              ) : (
                <ToggleLeft className="h-5 w-5" />
              )}
            </div>
            <p className="text-sm font-medium text-ink">Frequently bought together</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Your own pairings, set per product in{' '}
              <span className="font-medium">Cart Upsells</span>.
            </p>
          </button>

          <button
            type="button"
            onClick={() => toggleBlock('cart_similar_enabled', !settings.cart_similar_enabled)}
            disabled={isReadOnly}
            className={`relative rounded-lg border p-4 text-left transition-colors disabled:opacity-50 ${
              settings.cart_similar_enabled
                ? 'border-teal bg-teal/5'
                : 'border-line bg-surface hover:border-teal/40'
            }`}
          >
            <div
              className={`mb-2 ${
                settings.cart_similar_enabled ? 'text-teal-dark' : 'text-ink-muted'
              }`}
            >
              {settings.cart_similar_enabled ? (
                <ToggleRight className="h-5 w-5" />
              ) : (
                <ToggleLeft className="h-5 w-5" />
              )}
            </div>
            <p className="text-sm font-medium text-ink">You may also like</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Ranked automatically from what customers buy together — nothing to
              configure.
            </p>
          </button>
        </div>

        <Link
          href="/admin/cart-upsells"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-teal-dark underline underline-offset-2"
        >
          Edit the pairings <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
