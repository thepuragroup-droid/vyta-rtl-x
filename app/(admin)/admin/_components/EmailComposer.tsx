'use client';

import React, { useMemo, useState } from 'react';
import {
  X, Send, Loader2, Info, Eye, Pencil, Tag, Percent, DollarSign, ShoppingCart, Users,
} from 'lucide-react';
import {
  DISCOUNT_TYPES,
  MERGE_FIELD_HINT,
  PROMO_SOURCE_NOTE,
  PROMO_TEMPLATES,
  looksLikeEmail,
  normalizeDiscount,
  parseAddressList,
  renderPromoEmail,
  renderSubject,
  safeHttpUrl,
  type CartSummary,
  type CheckoutCta,
  type DiscountType,
  type PromoEmailInput,
  type PromoTemplate,
  type PromoTemplateKey,
} from '@/lib/customer/promo-email';
import { MAX_BULK_RECIPIENTS, type OutreachRecipient } from '@/lib/customer/outreach-types';
import ToggleSwitch from '@/components/admin/ToggleSwitch';
import RecipientPicker from './RecipientPicker';
import RecentContactNotice from './RecentContactNotice';

/**
 * The "send this to other customers too" tool.
 *
 * Everyone picked here gets a SEPARATE email addressed only to them — their
 * greeting, their cart, their payment link. It is not CC and it is not BCC, and
 * the composer says so in as many places as it takes.
 */
export interface BulkOutreachProps {
  /** Runs the recipient search. The picker debounces the calls. */
  search: (query: string, opts: { abandonedOnly: boolean }) => Promise<OutreachRecipient[]>;
  /** Ids already on this email (the customer whose page this is). */
  excludeIds: string[];
  /** Extras chosen before the composer opened — a bulk entry point's selection. */
  initial?: OutreachRecipient[];
  /** Start the picker on its cart-only filter. */
  defaultAbandonedOnly?: boolean;
  /** Open with the tool already switched on. */
  defaultOn?: boolean;
}

interface Props {
  /** Recipient — shown read-only; the route resolves the real address itself. */
  toEmail: string;
  /** "customer" / "affiliate" — only used in the heading. */
  recipientLabel?: string;
  firstName: string | null;
  /** Signs the email, so the customer knows who wrote to them. */
  senderName: string | null;
  sending: boolean;
  onClose: () => void;
  onSend: (payload: {
    templateKey: PromoTemplateKey;
    subject: string;
    body: string;
    promoCode: string;
    promoDetails: string;
    promoExpires: string;
    cc: string[];
    /** Null when the admin left the discount fields blank. */
    discountType: DiscountType | null;
    discountValue: number | null;
    /** False when an attachable cart + payment link was switched off. */
    attachCheckout: boolean;
    /** The other customers to send their own copy to. Empty unless `bulk` is set. */
    extraRecipients: OutreachRecipient[];
  }) => Promise<void>;

  // ---- Optional extras. Everything below is off unless supplied, so the
  // customer and affiliate desks get exactly the composer they had. ----

  /** Template set to offer. Defaults to the outreach/promo templates. */
  templates?: PromoTemplate[];
  /** Dialog heading. Defaults to "Email this {recipientLabel}". */
  heading?: string;
  /** A line of context under the heading — which order this is about. */
  subheading?: React.ReactNode;
  /** Replaces PROMO_SOURCE_NOTE above the promo fields. */
  promoNote?: string;
  /**
   * Show the structured discount controls (percentage / fixed + amount).
   * The figure drives the promo headline and the cart's savings line, so the
   * offer can only ever be stated one way in the message.
   */
  showDiscount?: boolean;
  /** Call-to-action button carried in the email — a payment link. */
  checkout?: CheckoutCta | null;
  /** The basket the email is about, restated in the message. */
  cart?: CartSummary | null;
  /**
   * Puts the cart + payment link behind a switch instead of always sending
   * them.
   *
   * The ledger's own recovery dialog leaves this unset: there, the cart IS the
   * email. On the customer desk the admin arrived to write something else and
   * merely *may* want to attach an abandoned checkout, so it is opt-in and
   * labelled with which cart it would attach.
   */
  attachable?: {
    label: string;
    description?: React.ReactNode;
    defaultOn?: boolean;
  } | null;
  /** Enables the "also send to other customers" tool. */
  bulk?: BulkOutreachProps | null;
  /**
   * The recipient this composer opened on, as a full record.
   *
   * Used for one thing: counting them into the "already emailed recently"
   * warning alongside whoever is picked below. Only the desks that resolved
   * their recipient through the outreach endpoint have one to hand; where it is
   * left out the warning still covers the extras, so no caller has to supply it
   * to be safe.
   */
  primaryRecipient?: OutreachRecipient | null;
  /** Send-button label. Defaults to "Send email". */
  sendLabel?: string;
}

/**
 * The outreach / promo email builder.
 *
 * The preview is rendered by `renderPromoEmail` — the same function the send
 * route calls — so what the admin approves is exactly what gets sent, rather
 * than an approximation that can drift.
 */
export default function EmailComposer({
  toEmail, firstName, senderName, sending, recipientLabel = 'customer', onClose, onSend,
  templates = PROMO_TEMPLATES,
  heading,
  subheading,
  promoNote = PROMO_SOURCE_NOTE,
  showDiscount = false,
  checkout = null,
  cart = null,
  attachable = null,
  bulk = null,
  primaryRecipient = null,
  sendLabel = 'Send email',
}: Props) {
  // The map is derived from whichever set was passed in, so a caller can offer
  // its own templates without this component knowing about them.
  const templateMap = useMemo(
    () => Object.fromEntries(templates.map((t) => [t.key, t])) as Record<string, PromoTemplate>,
    [templates],
  );
  const initial = templates[0];

  const [templateKey, setTemplateKey] = useState<PromoTemplateKey>(initial.key);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [promoCode, setPromoCode] = useState('');
  const [promoDetails, setPromoDetails] = useState('');
  const [promoExpires, setPromoExpires] = useState('');
  const [discountType, setDiscountType] = useState<DiscountType>('percentage');
  // Kept as a string so the field can be empty ("no discount") rather than 0.
  const [discountValue, setDiscountValue] = useState('');
  const [cc, setCc] = useState('');
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [touched, setTouched] = useState(false);
  // Whether the attachable cart + payment link ride along. Ignored (and always
  // on) when the caller passed a cart without making it attachable.
  const [attachCheckout, setAttachCheckout] = useState(attachable?.defaultOn ?? true);
  // The "also send to other customers" tool.
  const [sendToMore, setSendToMore] = useState(Boolean(bulk?.defaultOn));
  const [extraRecipients, setExtraRecipients] = useState<OutreachRecipient[]>(bulk?.initial ?? []);

  // What this draft actually carries. An attachable cart the admin switched off
  // must vanish from the PREVIEW too — a preview that shows blocks the send
  // will not include is exactly the drift this composer exists to avoid.
  const attached = !attachable || attachCheckout;
  const activeCart = attached ? cart : null;
  const activeCheckout = attached ? checkout : null;

  // Extras only count while the tool is on, so switching it off un-addresses
  // them rather than silently keeping them on the send.
  const activeExtras = sendToMore ? extraRecipients : [];
  const totalRecipients = 1 + activeExtras.length;

  // Everyone this send will actually address, for the recent-contact warning.
  // Rebuilt from `activeExtras` rather than `extraRecipients` so switching the
  // bulk tool off drops those people from the warning as well as from the send.
  const addressed = useMemo(
    () => (primaryRecipient ? [primaryRecipient, ...activeExtras] : activeExtras),
    [primaryRecipient, activeExtras],
  );

  const template = templateMap[templateKey];

  // Switching template replaces the draft — unless the admin has already
  // written something, in which case their words win.
  const applyTemplate = (key: PromoTemplateKey) => {
    setTemplateKey(key);
    const next = templateMap[key];
    if (!touched && next) {
      setSubject(next.subject);
      setBody(next.body);
    }
  };

  const ccList = useMemo(() => parseAddressList(cc), [cc]);
  const badCc = ccList.filter((a) => !looksLikeEmail(a));

  // A blank amount is "no discount"; a filled-in one that doesn't parse is a
  // typo, and blocks the send rather than being dropped on the way out.
  const discountEntered = showDiscount && discountValue.trim().length > 0;
  const discount = discountEntered ? normalizeDiscount(discountType, discountValue) : null;
  const discountError =
    discountEntered && !discount
      ? discountType === 'percentage'
        ? 'Enter a percentage between 0 and 100.'
        : 'Enter an amount greater than zero.'
      : null;
  // An amount with nothing to type at checkout leaves the customer stuck.
  const missingCode =
    !!discount && !promoCode.trim() && !promoDetails.trim()
      ? 'Add the promo code this discount belongs to, or describe how to claim it.'
      : null;

  // One input for the whole preview: the subject and the message are rendered
  // from the same object the send route builds, so neither can drift.
  const previewInput = useMemo<PromoEmailInput>(
    () => ({
      firstName,
      subject,
      body,
      promoCode,
      promoDetails,
      promoExpires,
      senderName,
      discount,
      cart: activeCart,
      checkout: activeCheckout,
      currency: activeCart?.currency ?? null,
    }),
    [
      firstName, subject, body, promoCode, promoDetails, promoExpires, senderName, discount,
      activeCart, activeCheckout,
    ],
  );
  const previewHtml = useMemo(() => renderPromoEmail(previewInput), [previewInput]);

  // Copy that asks for a figure the admin has not entered still sends — it
  // just goes out saying "a discount" instead of "15% off", which is worth
  // seeing before the send rather than after.
  const vagueDiscount =
    /\{\{\s*discount\s*\}\}/.test(`${subject} ${body}`) && !discount
      ? showDiscount
        ? 'No amount entered, so {{discount}} will read "a discount". Fill in the amount below to name the figure.'
        : 'No discount is attached, so {{discount}} will read "a discount".'
      : null;

  // The route enforces the same ceiling; blocking here is what stops an admin
  // writing a whole draft and losing it to a 400.
  const overCap = totalRecipients > MAX_BULK_RECIPIENTS;

  const canSend =
    subject.trim().length > 0 &&
    body.trim().length > 0 &&
    badCc.length === 0 &&
    !discountError &&
    !missingCode &&
    !overCap &&
    !sending;

  const submit = async () => {
    if (!canSend) return;
    await onSend({
      templateKey,
      subject: subject.trim(),
      body: body.trim(),
      promoCode: promoCode.trim(),
      promoDetails: promoDetails.trim(),
      promoExpires: promoExpires.trim(),
      cc: ccList,
      discountType: discount?.type ?? null,
      discountValue: discount?.value ?? null,
      attachCheckout: attached,
      extraRecipients: activeExtras,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6">
      <div className="my-4 w-full max-w-3xl overflow-hidden rounded-xl border border-line bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-ink">{heading ?? `Email this ${recipientLabel}`}</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              To <span className="font-medium text-ink">{toEmail}</span>
              {activeExtras.length > 0 && (
                <span className="font-medium text-ink">
                  {' '}and {activeExtras.length} other customer{activeExtras.length === 1 ? '' : 's'},
                  separately
                </span>
              )}
              {senderName ? ` · signed by ${senderName}` : ''}
            </p>
            {subheading && <div className="mt-1 text-xs text-ink-muted">{subheading}</div>}
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface hover:text-ink"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {/* Anybody on this send who has just had an email from us. Above the
              draft, not beside the send button: the point is to be read while
              the list can still be changed. Renders nothing when the send is
              clean. */}
          <RecentContactNotice recipients={addressed} className="mb-4" />

          {/* Template */}
          <Field label="Template">
            <div className="flex flex-wrap gap-1.5">
              {templates.map((t) => (
                <button
                  key={t.key}
                  onClick={() => applyTemplate(t.key)}
                  title={t.description}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    t.key === templateKey
                      ? 'bg-ink text-white'
                      : 'border border-line text-ink-muted hover:bg-surface hover:text-ink'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink-muted">{template?.description}</p>
          </Field>

          {/* Write / preview */}
          <div className="mb-3 mt-5 flex items-center gap-1 border-b border-line">
            {(['write', 'preview'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
                  tab === t ? 'border-teal text-ink' : 'border-transparent text-ink-muted hover:text-ink'
                }`}
              >
                {t === 'write' ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {t === 'write' ? 'Write' : 'Preview'}
              </button>
            ))}
          </div>

          {tab === 'write' ? (
            <>
              <Field
                label="Subject"
                hint={
                  showDiscount
                    ? 'Merge fields work here too — {{discount}} puts the amount off in the inbox.'
                    : undefined
                }
              >
                <input
                  value={subject}
                  onChange={(e) => { setSubject(e.target.value); setTouched(true); }}
                  placeholder="Subject line"
                  className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-teal/40"
                />
                {vagueDiscount && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700">
                    <Info className="mt-0.5 h-3 w-3 flex-shrink-0" />
                    {vagueDiscount}
                  </p>
                )}
              </Field>

              <Field
                label="Message"
                hint={
                  showDiscount
                    ? MERGE_FIELD_HINT
                    : 'Use {{first_name}} anywhere to drop in their first name.'
                }
              >
                <textarea
                  value={body}
                  onChange={(e) => { setBody(e.target.value); setTouched(true); }}
                  rows={9}
                  placeholder="Write the message…"
                  className="w-full resize-y rounded-lg border border-line bg-white px-3 py-2 text-sm leading-relaxed text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-teal/40"
                />
              </Field>

              {/* Promo block */}
              <div className="mt-5 rounded-xl border border-teal/30 bg-teal/5 p-4">
                <div className="mb-3 flex items-start gap-2">
                  <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-teal-dark" />
                  <p className="text-xs leading-relaxed text-ink">{promoNote}</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Promo code" compact>
                    <input
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                      placeholder="SUMMER15"
                      className="w-full rounded-lg border border-line bg-white px-3 py-2 font-mono text-sm tracking-wide text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-teal/40"
                    />
                  </Field>
                  <Field label="Valid until" compact hint="Free text — shown as written.">
                    <input
                      value={promoExpires}
                      onChange={(e) => setPromoExpires(e.target.value)}
                      placeholder="Valid until 30 September"
                      className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-teal/40"
                    />
                  </Field>
                </div>

                {showDiscount && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Discount type" compact>
                      <div className="flex gap-1.5">
                        {DISCOUNT_TYPES.map((d) => (
                          <button
                            key={d.key}
                            type="button"
                            onClick={() => setDiscountType(d.key)}
                            title={d.hint}
                            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                              discountType === d.key
                                ? 'border-ink bg-ink text-white'
                                : 'border-line bg-white text-ink-muted hover:text-ink'
                            }`}
                          >
                            {d.key === 'percentage' ? (
                              <Percent className="h-3.5 w-3.5" />
                            ) : (
                              <DollarSign className="h-3.5 w-3.5" />
                            )}
                            {d.label}
                          </button>
                        ))}
                      </div>
                    </Field>
                    <Field
                      label="Amount"
                      compact
                      hint={
                        discountType === 'percentage'
                          ? 'Percent off the order — 15 means 15% off.'
                          : 'A flat sum off — 25 means $25.00 off.'
                      }
                    >
                      <div className="relative">
                        {discountType === 'fixed' && (
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted">
                            $
                          </span>
                        )}
                        <input
                          value={discountValue}
                          onChange={(e) => setDiscountValue(e.target.value.replace(/[^0-9.]/g, ''))}
                          inputMode="decimal"
                          placeholder={discountType === 'percentage' ? '15' : '25'}
                          aria-label={discountType === 'percentage' ? 'Percent off' : 'Amount off'}
                          className={`w-full rounded-lg border bg-white py-2 pr-8 text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 ${
                            discountType === 'fixed' ? 'pl-7' : 'pl-3'
                          } ${
                            discountError
                              ? 'border-red-300 focus:ring-red-200'
                              : 'border-line focus:ring-teal/40'
                          }`}
                        />
                        {discountType === 'percentage' && (
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted">
                            %
                          </span>
                        )}
                      </div>
                      {discountError && <p className="mt-1 text-xs text-red-600">{discountError}</p>}
                    </Field>
                  </div>
                )}

                <Field
                  label="What the code gets them"
                  compact
                  hint={
                    showDiscount
                      ? 'Optional — leave blank and the box works out what the amount saves on this cart.'
                      : undefined
                  }
                >
                  <input
                    value={promoDetails}
                    onChange={(e) => setPromoDetails(e.target.value)}
                    placeholder={
                      // Not the figure again — the box already sets that in 40px
                      // type. This line is for the condition beside it.
                      showDiscount && discount ? 'No minimum spend' : '15% off any order over $200'
                    }
                    className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-teal/40"
                  />
                </Field>

                {missingCode && <p className="mt-2 text-xs text-red-600">{missingCode}</p>}

                {!promoCode.trim() && !discount && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted">
                    <Tag className="h-3 w-3" />
                    Leave the code blank and the promo box is left out of the email entirely.
                  </p>
                )}
              </div>

              {/* The abandoned cart + its payment link. */}
              {attachable ? (
                <div className="mt-5">
                  <ToggleSwitch
                    checked={attachCheckout}
                    onChange={setAttachCheckout}
                    label={attachable.label}
                    description={attachable.description}
                    icon={<ShoppingCart className="h-4 w-4" />}
                  />
                  {attachCheckout && (
                    <div className="mt-2 rounded-xl border border-line bg-surface p-4">
                      <CheckoutDetail checkout={checkout} cart={cart} bulk={Boolean(bulk)} />
                    </div>
                  )}
                </div>
              ) : (
                checkout && (
                  <div className="mt-5 rounded-xl border border-line bg-surface p-4">
                    <CheckoutDetail checkout={checkout} cart={cart} bulk={false} />
                  </div>
                )
              )}

              {/* Send the same message to more customers — one email each. */}
              {bulk && (
                <div className="mt-5">
                  <ToggleSwitch
                    checked={sendToMore}
                    onChange={setSendToMore}
                    label="Also send this to other customers"
                    description={
                      <>
                        Each one gets their <strong>own</strong> email — their name, their cart and
                        their own payment link. Not CC, not BCC: nobody sees anyone else&rsquo;s
                        address.
                      </>
                    }
                    icon={<Users className="h-4 w-4" />}
                  />
                  {sendToMore && (
                    <RecipientPicker
                      search={bulk.search}
                      selected={extraRecipients}
                      onChange={setExtraRecipients}
                      excludeIds={bulk.excludeIds}
                      totalRecipients={totalRecipients}
                      defaultAbandonedOnly={bulk.defaultAbandonedOnly ?? true}
                      disabled={sending}
                    />
                  )}
                </div>
              )}

              <Field
                label="CC"
                hint={
                  activeExtras.length > 0
                    ? `Optional. Copied on ${toEmail}'s email only — the other ${activeExtras.length} go out uncopied.`
                    : 'Optional. Separate several addresses with commas.'
                }
              >
                <input
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="colleague@aminocan.com"
                  className={`w-full rounded-lg border bg-white px-3 py-2 text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 ${
                    badCc.length > 0
                      ? 'border-red-300 focus:ring-red-200'
                      : 'border-line focus:ring-teal/40'
                  }`}
                />
                {badCc.length > 0 && (
                  <p className="mt-1 text-xs text-red-600">
                    Not a valid address: {badCc.join(', ')}
                  </p>
                )}
              </Field>
            </>
          ) : (
            <div>
              <p className="mb-2 text-xs text-ink-muted">
                Subject:{' '}
                <span className="font-medium text-ink">
                  {renderSubject(previewInput) || '(no subject)'}
                </span>
              </p>
              <div className="overflow-hidden rounded-lg border border-line bg-surface p-4">
                {/* Built entirely by renderPromoEmail from escaped inputs. */}
                <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
              </div>
              {activeExtras.length > 0 && (
                <p className="mt-2 text-xs text-ink-muted">
                  This is {toEmail}&rsquo;s copy. The other {activeExtras.length} customer
                  {activeExtras.length === 1 ? '' : 's'} get the same words with their own name
                  {attached ? ', cart and payment link' : ''}.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-4">
          <p className="text-xs text-ink-muted">
            {activeExtras.length > 0 && (
              <span className={overCap ? 'font-medium text-red-600' : 'font-medium text-ink'}>
                {totalRecipients} separate emails, one per customer ·{' '}
              </span>
            )}
            {ccList.length > 0 ? `CC ${ccList.length} · ` : ''}
            {overCap
              ? `That is over the ${MAX_BULK_RECIPIENTS}-customer limit for one send.`
              : 'Replies go to you, not the noreply mailbox.'}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={sending}
              className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!canSend}
              className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink/90 disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {activeExtras.length > 0 ? `Send ${totalRecipients} emails` : sendLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * What the attached cart and payment link will actually put in the message.
 *
 * Shows the real URL rather than "a payment link": the link is what takes the
 * money, and an admin about to mail forty of them should be able to see one.
 * In bulk the URL shown is the primary recipient's — every other recipient's is
 * resolved from their own ledger row at send time, which the copy says.
 */
function CheckoutDetail({
  checkout, cart, bulk,
}: {
  checkout: CheckoutCta | null;
  cart: CartSummary | null;
  bulk: boolean;
}) {
  const url = safeHttpUrl(checkout?.url);
  return (
    <>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-muted">
        Payment link in this email
      </p>
      {url ? (
        <>
          <p className="break-all font-mono text-xs text-ink">{url}</p>
          <p className="mt-1.5 text-xs text-ink-muted">
            Sent as a “{(checkout?.label ?? '').trim() || 'Complete your order'}” button. The
            customer picks up their checkout exactly where they left it.
            {cart?.reference ? ` This one is ${cart.reference}.` : ''}
          </p>
        </>
      ) : (
        <p className="text-xs text-red-600">
          This hand-off has no usable payment link, so the email goes out without a button. Say how
          to reorder in the message, or ask them to reply.
        </p>
      )}
      {bulk && (
        <p className="mt-1.5 text-xs text-ink-muted">
          Every other customer on this send gets <strong>their own</strong> cart and link, read from
          the Stealth Health ledger when the email goes out — never this one.
        </p>
      )}
    </>
  );
}

function Field({
  label, hint, children, compact,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'mt-3' : 'mt-4'}>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}
