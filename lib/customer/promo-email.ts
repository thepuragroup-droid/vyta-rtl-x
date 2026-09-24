/**
 * The customer outreach email builder.
 *
 * Deliberately isomorphic — no nodemailer, no Supabase, no `lib/email.ts`
 * import — so the admin composer can render the exact same HTML for its live
 * preview that the send route will put in the message. A preview built by
 * different code than the send is a preview you can't trust.
 *
 * PROMO CODES ARE NOT ISSUED HERE. They're created on the Stealth Health
 * platform (app.vytabio.com); this builder only ever *presents* a code the
 * admin has already generated there. See PROMO_SOURCE_NOTE.
 *
 * Three optional blocks ride on top of the plain message, all of them off
 * unless the caller fills them in, so the customer-desk composer is unchanged:
 *
 *   `cart`     — the line items the email is about (abandoned-checkout recovery
 *                restates the basket so the buyer recognises it).
 *   `discount` — a structured "15% off" / "$25 off", so the amount is stated
 *                once and rendered consistently in the promo box, the cart
 *                totals and the plain-text alternative.
 *   `checkout` — the call-to-action button carrying a payment link.
 */

/** Shown above the promo fields in the composer, so nobody goes looking for a generator. */
export const PROMO_SOURCE_NOTE =
  'Promo codes are generated in app.vytabio.com (the Stealth Health platform). ' +
  'Create the code there first, then paste it below to include it in this email.';

export type PromoTemplateKey =
  | 'promo'
  | 'new_product'
  | 'restock'
  | 'check_in'
  | 'custom'
  // Abandoned-checkout recovery. Kept in RECOVERY_TEMPLATES rather than
  // PROMO_TEMPLATES because they are only worth offering where there is a cart
  // to recover — /admin/stealth-health (Orders tab) always, and the customer
  // desk when that customer has a pending or expired Stealth Health checkout.
  | 'recovery_reminder'
  | 'recovery_discount'
  | 'recovery_last_chance';

export interface PromoTemplate {
  key: PromoTemplateKey;
  label: string;
  description: string;
  subject: string;
  /** Plain text. `{{first_name}}` and `{{discount}}` are the merge fields. */
  body: string;
  /** Whether the promo block is expected — drives the composer's hint. */
  expectsPromo: boolean;
}

export const PROMO_TEMPLATES: PromoTemplate[] = [
  {
    key: 'promo',
    label: 'Promo offer',
    description: 'A discount code with an expiry.',
    subject: 'A little something for you, {{first_name}}',
    body: [
      'Hi {{first_name}},',
      '',
      'We wanted to say thanks for being a customer — here is a discount you can use on your next order.',
      '',
      'Just apply the code at checkout. Let us know if you need a hand with anything.',
    ].join('\n'),
    expectsPromo: true,
  },
  {
    key: 'new_product',
    label: 'New product',
    description: 'Announce something new, optionally with a launch code.',
    subject: 'New in stock at VYTA',
    body: [
      'Hi {{first_name}},',
      '',
      'We have just added something new to the catalogue that we think fits what you have been looking at.',
      '',
      'Have a look and tell us what you think.',
    ].join('\n'),
    expectsPromo: false,
  },
  {
    key: 'restock',
    label: 'Back in stock',
    description: 'Tell them something they wanted is available again.',
    subject: 'Back in stock',
    body: [
      'Hi {{first_name}},',
      '',
      'Good news — something you were interested in is back in stock.',
      '',
      'Stock moves quickly, so grab it while it is there.',
    ].join('\n'),
    expectsPromo: false,
  },
  {
    key: 'check_in',
    label: 'Personal check-in',
    description: 'A plain, one-to-one note. No promo block.',
    subject: 'Checking in',
    body: [
      'Hi {{first_name}},',
      '',
      'Just checking in to see how you are getting on, and whether there is anything you need from us.',
      '',
      'Happy to answer any questions — just reply to this email.',
    ].join('\n'),
    expectsPromo: false,
  },
  {
    key: 'custom',
    label: 'Blank',
    description: 'Write the whole thing yourself.',
    subject: '',
    body: '',
    expectsPromo: false,
  },
];

export const PROMO_TEMPLATE_MAP: Record<string, PromoTemplate> = Object.fromEntries(
  PROMO_TEMPLATES.map((t) => [t.key, t]),
);

/**
 * The abandoned-checkout templates.
 *
 * None of them TYPE a figure, a cart line or a link into the prose. Where the
 * discount nudge names the amount — in its subject line and in the message —
 * it does so through `{{discount}}`, which is written from the same structured
 * discount as the promo box and the cart totals. So an admin editing the
 * wording still cannot leave the message saying "20% off" while the box says
 * 15%: there is one number, entered once, rendered everywhere.
 */
export const RECOVERY_TEMPLATES: PromoTemplate[] = [
  {
    key: 'recovery_discount',
    label: 'Discount nudge',
    description: 'The cart, the amount off in the subject line, and a link back to payment.',
    subject: 'Here is {{discount}} to finish your order, {{first_name}}',
    body: [
      'Hi {{first_name}},',
      '',
      'You were part-way through an order with us and did not quite make it to the end — no problem at all, it happens to the best of us.',
      '',
      'To help you finish your checkout, here is {{discount}}. Your cart is saved exactly as you left it, so it is waiting whenever you are ready.',
      '',
      'If something went wrong at checkout, or you just want to ask us about anything first, hit reply — we are always happy to help.',
    ].join('\n'),
    expectsPromo: true,
  },
  {
    key: 'recovery_reminder',
    label: 'Plain reminder',
    description: 'A nudge with the payment link, no discount.',
    subject: 'You left something in your cart',
    body: [
      'Hi {{first_name}},',
      '',
      'We noticed you did not finish checking out. Your cart is saved, so you can pick up exactly where you left off.',
      '',
      'If something went wrong at payment, just reply to this email and we will sort it out.',
    ].join('\n'),
    expectsPromo: false,
  },
  {
    key: 'recovery_last_chance',
    label: 'Last chance',
    description: 'A final nudge before the link expires.',
    subject: 'Last chance on your cart',
    body: [
      'Hi {{first_name}},',
      '',
      'This is the last reminder about the order you started — after this we will leave you alone.',
      '',
      'The link below still works, so if you want it, it is one click away.',
    ].join('\n'),
    expectsPromo: true,
  },
  {
    key: 'custom',
    label: 'Blank',
    description: 'Write the whole thing yourself.',
    subject: '',
    body: '',
    expectsPromo: false,
  },
];

export const RECOVERY_TEMPLATE_MAP: Record<string, PromoTemplate> = Object.fromEntries(
  RECOVERY_TEMPLATES.map((t) => [t.key, t]),
);

/**
 * One template list from several sets, first definition of a key winning.
 *
 * The customer desk offers the recovery templates AND the outreach ones when
 * the customer has a cart to recover, and both sets end with `custom` — two
 * buttons labelled "Blank", one of which would shadow the other in the lookup.
 */
export function mergeTemplates(...sets: PromoTemplate[][]): PromoTemplate[] {
  const seen = new Set<string>();
  const out: PromoTemplate[] = [];
  for (const set of sets) {
    for (const template of set) {
      if (seen.has(template.key)) continue;
      seen.add(template.key);
      out.push(template);
    }
  }
  return out;
}

/** How a discount is expressed. Anything else is not a discount we can state. */
export type DiscountType = 'percentage' | 'fixed';

export interface DiscountInput {
  type: DiscountType;
  /** Percent off (0–100] for 'percentage'; a money amount for 'fixed'. */
  value: number;
}

/** The two choices offered in the composer, with the copy that explains them. */
export const DISCOUNT_TYPES: { key: DiscountType; label: string; hint: string }[] = [
  { key: 'percentage', label: 'Percentage', hint: 'A share of the order — 15 means 15% off.' },
  { key: 'fixed', label: 'Fixed amount', hint: 'A flat sum off — 25 means $25.00 off.' },
];

export const isDiscountType = (v: unknown): v is DiscountType =>
  v === 'percentage' || v === 'fixed';

/**
 * Coerce a (type, value) pair from a form or a request body into a discount,
 * or null when it isn't one.
 *
 * A percentage above 100 or a negative amount is rejected rather than clamped:
 * both are typos, and quietly turning "150" into "100% off" would put a free
 * order in front of a customer.
 */
export function normalizeDiscount(type: unknown, value: unknown): DiscountInput | null {
  if (!isDiscountType(type)) return null;
  const n = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (type === 'percentage' && n > 100) return null;
  return { type, value: +n.toFixed(2) };
}

/** `$25.00` — the currency code is left to the caller's surrounding copy. */
export function formatMoneyAmount(value: number): string {
  return `$${Math.abs(value).toFixed(2)}`;
}

/** "15% off" / "$25.00 off" — the one phrasing used everywhere in the email. */
export function formatDiscount(discount: DiscountInput): string {
  return discount.type === 'percentage'
    ? `${+discount.value.toFixed(2)}% off`
    : `${formatMoneyAmount(discount.value)} off`;
}

/**
 * A money figure this email is willing to print, or null.
 *
 * **Zero means "we do not have this amount", not "free".** The Stealth Health ledger
 * carries `subtotal_cents: 0` on a hand-off it never priced, and printing that
 * put "Subtotal $0.00 · Total $0.00" under a real basket in a discount nudge —
 * an email offering 20% off nothing, sent to somebody who knows what they put
 * in the cart. A missing figure is far safer left out: the cart still lists
 * what they chose, and the checkout does the arithmetic when they arrive.
 *
 * A total that comes out at zero because the DISCOUNT took it there is a
 * different thing and is still shown — that one is true, and it is the number
 * the customer most wants to see.
 */
export function knownAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * What the discount takes off a given subtotal.
 *
 * Capped at the subtotal itself so a fixed amount larger than the basket shows
 * as "order free", never as a negative total the buyer will query.
 */
export function discountAmountOn(subtotal: number, discount: DiscountInput): number {
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0;
  const raw =
    discount.type === 'percentage'
      ? (subtotal * discount.value) / 100
      : discount.value;
  return +Math.min(subtotal, Math.max(0, raw)).toFixed(2);
}

/** The subtotal after the discount, or null when there's nothing to work from. */
export function applyDiscountTo(
  subtotal: number | null | undefined,
  discount: DiscountInput | null | undefined,
): number | null {
  if (typeof subtotal !== 'number' || !Number.isFinite(subtotal)) return null;
  if (!discount) return +subtotal.toFixed(2);
  return +(subtotal - discountAmountOn(subtotal, discount)).toFixed(2);
}

/**
 * Only http(s) links are ever put in an href.
 *
 * The URL reaches this module from a database column, so treating it as
 * trusted would make a stored `javascript:` value a click away from running in
 * whatever renders the preview.
 */
export function safeHttpUrl(url: unknown): string | null {
  const raw = String(url ?? '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** The button that carries a payment link back to the customer. */
export interface CheckoutCta {
  /** Must be http(s) — anything else is dropped rather than rendered. */
  url: string;
  /** Button text. Defaults to "Complete your order". */
  label?: string | null;
  /** Small print under the button — an expiry, a reassurance. */
  note?: string | null;
}

export interface CartLine {
  name: string;
  quantity: number;
  /** Line price in the cart currency; null when we only know the SKU. */
  lineTotal?: number | null;
}

/** The basket the email is about, restated so the buyer recognises it. */
export interface CartSummary {
  items: CartLine[];
  subtotal?: number | null;
  /** Display code only — 'USD'. Prices are always formatted as `$`. */
  currency?: string | null;
  /** Shown above the table: "Order amc_1234". */
  reference?: string | null;
}

export interface PromoEmailInput {
  /** Used for {{first_name}}; falls back to a neutral greeting when absent. */
  firstName?: string | null;
  /** Rendered by `renderSubject`, never by the caller. */
  subject: string;
  /** Plain text, as typed in the composer. Blank lines become paragraphs. */
  body: string;
  /** Generated on app.vytabio.com — presented here, never issued here. */
  promoCode?: string | null;
  /** What the code gets them ("15% off any order over $200"). */
  promoDetails?: string | null;
  /** Free text — "Valid until 30 September" — not parsed as a date. */
  promoExpires?: string | null;
  /** Sign-off, so the customer knows which human is writing. */
  senderName?: string | null;
  /**
   * Structured discount behind the code. When set it writes the promo box's
   * headline (unless `promoDetails` overrides it) and the cart's savings line,
   * so the same figure can't be stated two different ways in one email.
   */
  discount?: DiscountInput | null;
  /** Currency code shown beside the cart totals. Defaults to USD. */
  currency?: string | null;
  /** Call-to-action button — the payment link on a recovery email. */
  checkout?: CheckoutCta | null;
  /** The basket this email is about. Omitted from the message when absent. */
  cart?: CartSummary | null;
}

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The merge fields a subject or a body may carry. There are two — keep it that
 * way, and keep this string in front of whoever is writing the copy.
 */
export const MERGE_FIELD_HINT =
  'Use {{first_name}} for their first name and {{discount}} for the amount off.';

/**
 * Fill `{{first_name}}` and `{{discount}}`.
 *
 * `{{discount}}` is written from the structured discount rather than typed, so
 * a subject line can lead with the figure without an admin retyping a number
 * that then disagrees with the promo box.
 *
 * With no discount attached it falls back to the vague "a discount" instead of
 * an empty string: template copy is built around the field ("here is
 * {{discount}}"), and a hole leaves the sentence broken where a vaguer word
 * still reads.
 */
export function renderMergeFields(
  text: string,
  firstName?: string | null,
  discount?: DiscountInput | null,
): string {
  const name = (firstName ?? '').trim() || 'there';
  const off = discount ? formatDiscount(discount) : 'a discount';
  return String(text ?? '')
    .replace(/\{\{\s*first_name\s*\}\}/g, name)
    .replace(/\{\{\s*discount\s*\}\}/g, off);
}

/**
 * The subject line, merge fields filled.
 *
 * The subject is the one part of the email this module does not assemble, so
 * every send path and the composer's preview call this rather than reaching for
 * `renderMergeFields` themselves. A field left unrendered at one forgotten call
 * site reaches a customer as a literal `{{discount}}` in their inbox.
 */
export function renderSubject(input: PromoEmailInput): string {
  return renderMergeFields(input.subject, input.firstName, input.discount);
}

/**
 * The palette, the type and the metrics the whole message is drawn from.
 *
 * Stated once, here, because every block below is inline-styled — an email
 * cannot carry a stylesheet — and a hex code retyped in nine places is a
 * redesign that ends up half-applied. Anything that is a colour, a face, a
 * rule or a radius belongs in this object rather than in the markup.
 *
 * `display` is the reason the message reads as a brand rather than a receipt.
 * VYTA sets headings in Inter Display; email clients almost never have a
 * webfont, so the stack falls through to the platform UI sans — the same
 * shapes at a heavier weight and a wide letterspacing that echoes the lockup.
 *
 * The contrast pairs are deliberate: `muted` clears 4.5:1 on `card` and on
 * `paper`, and `heroText` / `champagne` clear it against `hero`. The faint
 * greys are only ever used at 10–12px on text that repeats something already
 * said in full elsewhere.
 */
const T = {
  font: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`,
  display: `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif`,
  mono: `'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace`,
  paper: '#EDF3F5',
  card: '#FFFFFF',
  hero: '#05182B',
  heroRule: '#1B5D83',
  heroText: '#C4DFE3',
  heroMuted: '#6E8898',
  champagne: '#C4DFE3',
  ink: '#05182B',
  body: '#0E3F5F',
  muted: '#56707F',
  faint: '#6E8898',
  hairline: '#EDF3F5',
  border: '#DCE7EB',
  cream: '#F1F8F9',
  creamLine: '#C4DFE3',
  gold: '#438B9E',
  goldSoft: '#6EB2B8',
  save: '#0F7A57',
  radius: '20px',
} as const;

/** Blank-line-separated plain text into escaped paragraphs. */
function paragraphs(text: string): string {
  return String(text ?? '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(
      (block) =>
        `<p style="font-size: 15px; line-height: 1.75; color: ${T.body}; margin: 0 0 18px;">${escapeHtml(
          block,
        ).replace(/\n/g, '<br />')}</p>`,
    )
    .join('');
}

/** The currency code shown beside every figure in one email. */
function currencyOf(input: PromoEmailInput): string {
  return (input.cart?.currency ?? input.currency ?? 'USD').toUpperCase();
}

/**
 * The figure the email leads with, or '' when there is nothing to lead with.
 *
 * Only a structured discount produces one: "15% off" is a number we computed
 * and can restate consistently, whereas a bare code is a string whose value we
 * do not know.
 */
function discountFigure(input: PromoEmailInput): string {
  return input.discount ? formatDiscount(input.discount) : '';
}

/**
 * The figure split for setting: the amount, and the word after it.
 *
 * The hero sets "15%" large and "off" small and italic beside it, which is the
 * whole reason the offer looks like a cover line rather than a total. Split
 * from the structured discount rather than by chopping up `formatDiscount`, so
 * the two can never disagree about what the number is.
 */
function discountParts(discount: DiscountInput): { amount: string; suffix: string } {
  return {
    amount:
      discount.type === 'percentage'
        ? `${+discount.value.toFixed(2)}%`
        : formatMoneyAmount(discount.value),
    suffix: 'off',
  };
}

/**
 * The line under the figure.
 *
 * `promoDetails` is the admin's own words and always wins. Failing that, and
 * only where we know the basket, the offer is restated as money off THIS cart:
 * "15% off" is an abstraction until it is "$30.00 off the $200.00 in front of
 * you", and the whole point of leading with it is that the customer sees what
 * they get.
 */
function promoSubline(input: PromoEmailInput): string {
  const details = (input.promoDetails ?? '').trim();
  if (details) return details;
  if (!input.discount) return '';
  const subtotal = knownAmount(input.cart?.subtotal);
  const saved = subtotal != null ? discountAmountOn(subtotal, input.discount) : 0;
  return saved > 0
    ? `That is ${formatMoneyAmount(saved)} ${currencyOf(input)} off this cart.`
    : 'Applies to your whole order.';
}

/**
 * A small letterspaced label above a section — the one device that separates
 * the blocks now that most of them no longer sit in boxes of their own.
 */
function eyebrow(text: string, color: string = T.faint, margin = '0 0 14px'): string {
  return `<p style="font-size: 10px; font-weight: 600; letter-spacing: 0.24em; text-transform: uppercase; color: ${color}; margin: ${margin};">${text}</p>`;
}

/** The short gold rule that sits under the wordmark. */
function goldRule(color: string = T.gold, margin = '18px auto 0'): string {
  return `<div style="width: 28px; height: 1px; line-height: 1px; font-size: 0; background: ${color}; margin: ${margin};">&nbsp;</div>`;
}

/**
 * The dark band at the top of the card: the wordmark, and — when there is a
 * figure — the offer itself.
 *
 * The offer leads the email rather than sitting two screens down past the
 * cart. A recovery email competes with an inbox, and the first thing in the
 * reading pane should be the reason to open it, set large in the display
 * serif on near-black. That is also why the figure moved out of the body: one
 * statement of it, at the top, instead of a box halfway down repeating what
 * the subject line already promised.
 *
 * With no figure the band is just the wordmark, so a check-in or a restock
 * gets the same masthead without a hole where an offer would have been.
 */
function heroBlock(input: PromoEmailInput): string {
  const wordmark = `
    <p style="font-family: ${T.display}; font-size: 26px; font-weight: 400; letter-spacing: 0.34em; text-indent: 0.34em; color: ${T.heroText}; margin: 0;">VYTA</p>
    <p style="font-size: 9px; font-weight: 600; letter-spacing: 0.3em; text-indent: 0.3em; text-transform: uppercase; color: ${T.goldSoft}; margin: 10px 0 0;">Canadian Peptides</p>`;

  if (!input.discount) {
    return `
        <td style="background: ${T.hero}; border-radius: ${T.radius} ${T.radius} 0 0; padding: 38px 32px 34px; text-align: center;">
          ${wordmark}
        </td>`;
  }

  const { amount, suffix } = discountParts(input.discount);
  const subline = promoSubline(input);
  // The expiry rides in the hero only when there is no code block to carry it.
  const expires = (input.promoCode ?? '').trim() ? '' : (input.promoExpires ?? '').trim();

  return `
        <td style="background: ${T.hero}; border-radius: ${T.radius} ${T.radius} 0 0; padding: 38px 32px 40px; text-align: center;">
          ${wordmark}
          ${goldRule(T.heroRule, '26px auto 30px')}
          ${eyebrow('Your discount', T.goldSoft, '0 0 12px')}
          <p style="font-family: ${T.display}; font-size: 58px; line-height: 1; font-weight: 400; letter-spacing: -0.01em; color: ${T.champagne}; margin: 0;">${escapeHtml(
            amount,
          )}<span style="font-size: 30px; font-style: italic; letter-spacing: 0;"> ${escapeHtml(
            suffix,
          )}</span></p>
          ${
            subline
              ? `<p style="font-size: 13px; line-height: 1.6; color: ${T.heroMuted}; margin: 16px 0 0;">${escapeHtml(subline)}</p>`
              : ''
          }
          ${
            expires
              ? `<p style="font-size: 11px; color: ${T.heroMuted}; margin: 8px 0 0;">${escapeHtml(expires)}</p>`
              : ''
          }
        </td>`;
}

/**
 * The code, on its own cream field.
 *
 * Only ever the code — the figure is the hero's job now. It sits low in the
 * message, next to the button, because that is the order the customer works
 * in: read the offer, check the cart, copy the code, click through.
 *
 * A code-only email (no figure to hoist into the hero) carries the offer's
 * one-line description here instead, so nothing is lost when we can't put a
 * number on what the code is worth.
 */
function promoBlock(input: PromoEmailInput): string {
  const code = (input.promoCode ?? '').trim();
  if (!code) return '';

  const expires = (input.promoExpires ?? '').trim();
  // Said in the hero already whenever there is a figure up there.
  const subline = input.discount ? '' : promoSubline(input);
  const footnote = [expires && `Valid ${expires.replace(/^valid\s+/i, '')}`]
    .filter(Boolean)
    .join('');

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 12px 0 28px; border-collapse: separate;">
      <tr>
        <td align="center" style="padding: 26px 24px; background: ${T.cream}; border: 1px solid ${T.creamLine}; border-radius: 16px;">
          ${eyebrow('Your code', T.gold, '0 0 12px')}
          ${
            subline
              ? `<p style="font-size: 14px; line-height: 1.6; color: ${T.muted}; margin: 0 0 14px;">${escapeHtml(subline)}</p>`
              : ''
          }
          <p style="font-family: ${T.mono}; font-size: 20px; font-weight: 600; letter-spacing: 0.24em; text-indent: 0.24em; color: ${T.ink}; margin: 0;">${escapeHtml(
            code,
          )}</p>
          <p style="font-size: 11px; line-height: 1.6; color: ${T.faint}; margin: 12px 0 0;">Enter at checkout${
            footnote ? ` · ${escapeHtml(footnote)}` : ''
          }</p>
        </td>
      </tr>
    </table>
  `;
}

/**
 * The basket, restated.
 *
 * A "come back and finish your order" email that doesn't say what the order was
 * reads like spam, so the lines and the totals are spelled out. When a discount
 * is attached the savings line and the new total are shown alongside the
 * original — but labelled "estimated", because the checkout does the real
 * arithmetic once the code is entered.
 *
 * Drawn as ruled lines rather than a bordered box: the message is already
 * inside a card, and a second frame around the cart made the middle of the
 * email look like a form.
 */
function cartBlock(input: PromoEmailInput): string {
  const cart = input.cart;
  if (!cart || cart.items.length === 0) return '';

  const currency = currencyOf(input);
  const money = (v: number) => `${formatMoneyAmount(v)} ${escapeHtml(currency)}`;

  const rows = cart.items
    .map((item) => {
      // Same rule as the totals: a line we have no price for shows the item and
      // an empty price cell, never "$0.00".
      const price = knownAmount(item.lineTotal);
      return `
      <tr>
        <td style="padding: 13px 0; border-top: 1px solid ${T.hairline}; font-size: 14px; line-height: 1.45; color: ${T.ink};">${escapeHtml(item.name)}<span style="color: ${T.faint};"> ×${escapeHtml(
          String(item.quantity),
        )}</span></td>
        <td style="padding: 13px 0; border-top: 1px solid ${T.hairline}; font-size: 14px; color: ${T.ink}; text-align: right; white-space: nowrap;">${
          price != null ? money(price) : ''
        }</td>
      </tr>`;
    })
    .join('');

  // A figure we do not have is left out entirely rather than printed as zero —
  // see `knownAmount`. With no subtotal there is nothing to take a discount off
  // either, so `applyDiscountTo(null, …)` drops the whole totals block and the
  // cart is just the list of what they chose.
  const subtotal = knownAmount(cart.subtotal);
  const saved = subtotal != null && input.discount ? discountAmountOn(subtotal, input.discount) : 0;
  const total = applyDiscountTo(subtotal, input.discount);

  /**
   * One totals row. `save` is the money coming off — set in green on both
   * sides, because it is the line the email exists to draw the eye to;
   * `strong` is the final total, ruled off above and set in the display serif
   * so the number the customer actually cares about is the one that looks
   * composed rather than tabulated.
   */
  const totalRow = (label: string, value: string, kind: 'line' | 'save' | 'strong' = 'line') => {
    const pad = kind === 'strong' ? '16px 0 0' : '8px 0 0';
    const size = kind === 'strong' ? '19px' : '13px';
    const weight = kind === 'line' ? '400' : '600';
    const face = kind === 'strong' ? ` font-family: ${T.display}; font-weight: 400;` : '';
    const rule = kind === 'strong' ? ` border-top: 1px solid ${T.border};` : '';
    const labelColor = kind === 'save' ? T.save : kind === 'strong' ? T.ink : T.muted;
    const valueColor = kind === 'save' ? T.save : T.ink;
    return `
      <tr>
        <td style="padding: ${pad}; font-size: ${size}; font-weight: ${weight}; color: ${labelColor};${face}${rule}">${escapeHtml(label)}</td>
        <td style="padding: ${pad}; font-size: ${size}; font-weight: ${weight}; color: ${valueColor}; text-align: right; white-space: nowrap;${face}${rule}">${value}</td>
      </tr>`;
  };

  const totals: string[] = [];
  if (subtotal != null) totals.push(totalRow('Subtotal', money(subtotal)));
  if (saved > 0) {
    totals.push(totalRow(`Discount (${formatDiscount(input.discount!)})`, `−${money(saved)}`, 'save'));
  }
  if (total != null) {
    totals.push(totalRow(saved > 0 ? 'Estimated total' : 'Total', money(total), 'strong'));
  }

  return `
    <div style="margin: 14px 0 28px;">
      ${eyebrow(`Your cart${cart.reference ? ` · ${escapeHtml(cart.reference)}` : ''}`)}
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse;">
        <tbody>${rows}${totals.join('')}</tbody>
      </table>
      ${
        saved > 0
          ? `<p style="font-size: 11px; line-height: 1.5; color: ${T.faint}; margin: 14px 0 0;">The discount is applied at checkout${
              (input.promoCode ?? '').trim() ? ' once you enter the code' : ''
            }.</p>`
          : ''
      }
    </div>
  `;
}

/**
 * The call-to-action button. Dropped silently when the link isn't http(s).
 *
 * Small letterspaced caps in a near-black pill: the label is short and known,
 * so it can be set as a mark rather than as a sentence, and it echoes the
 * eyebrows above it instead of shouting in 15px bold.
 */
function checkoutBlock(input: PromoEmailInput): string {
  const url = safeHttpUrl(input.checkout?.url);
  if (!url) return '';
  const label = (input.checkout?.label ?? '').trim() || 'Complete your order';
  const note = (input.checkout?.note ?? '').trim();

  return `
    <div style="margin: 4px 0 28px; text-align: center;">
      <a href="${escapeHtml(url)}" style="display: inline-block; padding: 17px 40px; background: ${T.hero}; color: ${T.champagne}; font-size: 12px; font-weight: 600; line-height: 1; letter-spacing: 0.16em; text-transform: uppercase; text-decoration: none; border-radius: 999px;">${escapeHtml(label)}</a>
      ${note ? `<p style="font-size: 12px; line-height: 1.5; color: ${T.faint}; margin: 16px 0 0;">${escapeHtml(note)}</p>` : ''}
    </div>
  `;
}

/**
 * The full HTML message: a dark masthead carrying the offer, over a white card.
 *
 * Table-built so Outlook honours the 600px measure instead of laying the
 * message out full-bleed at whatever width the reading pane happens to be —
 * hence the `width` attribute beside the `max-width`, and the radius split
 * across the two cells to keep the card's corners round where they meet.
 *
 * Mirrors `vytaShell` from lib/email.ts, restated here so this module stays
 * free of server-only imports; the two are meant to look alike, so a change to
 * one belongs in the other.
 */
export function renderPromoEmail(input: PromoEmailInput): string {
  const body = paragraphs(renderMergeFields(input.body, input.firstName, input.discount));
  const signature = (input.senderName ?? '').trim();

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; background: ${T.paper};">
      <tr>
        <td align="center" style="padding: 36px 12px; font-family: ${T.font};">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 600px; border-collapse: separate;">
            <tr>
${heroBlock(input)}
            </tr>
            <tr>
              <td style="background: ${T.card}; border: 1px solid ${T.border}; border-top: 0; border-radius: 0 0 ${T.radius} ${T.radius}; padding: 34px 32px 36px;">
                ${body}
                ${cartBlock(input)}
                ${promoBlock(input)}
                ${checkoutBlock(input)}
                ${
                  signature
                    ? `<p style="font-family: ${T.display}; font-size: 17px; font-style: italic; line-height: 1.5; color: ${T.ink}; margin: 28px 0 0;">— ${escapeHtml(
                        signature,
                      )}</p>
                       <p style="font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: ${T.faint}; margin: 6px 0 0;">VYTA Biosciences</p>`
                    : ''
                }
              </td>
            </tr>
            <tr>
              <td style="padding: 22px 12px 4px; text-align: center;">
                <p style="font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: ${T.faint}; margin: 0;">VYTA · Canadian research peptides</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Plain-text alternative, for clients that won't render HTML.
 *
 * Carries the same blocks in the same order as the HTML — most importantly the
 * payment link as a bare URL, so a text-only client still gets a way back to
 * the checkout rather than a dead reference to a button it never drew.
 */
export function renderPromoEmailText(input: PromoEmailInput): string {
  const parts = [renderMergeFields(input.body, input.firstName, input.discount).trim()];

  const cart = input.cart;
  if (cart && cart.items.length > 0) {
    const currency = (cart.currency ?? input.currency ?? 'USD').toUpperCase();
    const money = (v: number) => `${formatMoneyAmount(v)} ${currency}`;
    const lines = [cart.reference ? `Your cart (${cart.reference}):` : 'Your cart:'];
    for (const item of cart.items) {
      const amount = knownAmount(item.lineTotal);
      const price = amount != null ? ` — ${money(amount)}` : '';
      lines.push(`  ${item.name} ×${item.quantity}${price}`);
    }
    const subtotal = knownAmount(cart.subtotal);
    const saved = subtotal != null && input.discount ? discountAmountOn(subtotal, input.discount) : 0;
    const total = applyDiscountTo(subtotal, input.discount);
    if (subtotal != null) lines.push(`  Subtotal: ${money(subtotal)}`);
    if (saved > 0) lines.push(`  Discount (${formatDiscount(input.discount!)}): -${money(saved)}`);
    if (total != null) lines.push(`  ${saved > 0 ? 'Estimated total' : 'Total'}: ${money(total)}`);
    parts.push(lines.join('\n'));
  }

  const code = (input.promoCode ?? '').trim();
  if (code || input.discount) {
    const figure = discountFigure(input);
    const expires = (input.promoExpires ?? '').trim();
    parts.push(
      [
        // The box's eyebrow and its 40px figure, in the only emphasis plain
        // text has.
        ...(figure ? [`YOUR DISCOUNT: ${figure.toUpperCase()}`] : []),
        promoSubline(input),
        code ? `Code: ${code}` : '',
        code ? 'Enter this code at checkout.' : '',
        expires,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  const url = safeHttpUrl(input.checkout?.url);
  if (url) {
    const label = (input.checkout?.label ?? '').trim() || 'Complete your order';
    const note = (input.checkout?.note ?? '').trim();
    parts.push([`${label}: ${url}`, note].filter(Boolean).join('\n'));
  }

  const signature = (input.senderName ?? '').trim();
  if (signature) parts.push(`— ${signature}\nVYTA Biosciences`);
  return parts.join('\n\n');
}

/** Basic shape check — the mail server should never see an obvious non-address. */
export const looksLikeEmail = (value: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/** Split a comma/semicolon/newline separated CC field into addresses. */
export function parseAddressList(raw: string): string[] {
  return String(raw ?? '')
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
