/**
 * Email flows — the shared vocabulary.
 *
 * Two automated sequences run on the same machinery:
 *
 *   welcome  new consenting signups      → first purchase
 *   cart     abandoned carts / checkouts → complete the order
 *
 * Isomorphic (no server imports): the admin page validating a form and the
 * route saving it run the same rules. Default copy lives in ./defaults.ts.
 *
 * See email-flows-migration.sql and docs/changelog/2026-10-15-email-flows.md.
 */

export const FLOW_KEYS = ['welcome', 'cart'] as const;
export type FlowKey = (typeof FLOW_KEYS)[number];

export function isFlowKey(v: unknown): v is FlowKey {
  return typeof v === 'string' && (FLOW_KEYS as readonly string[]).includes(v);
}

export const STEP_NUMBERS = [1, 2, 3, 4, 5] as const;
export type StepNumber = (typeof STEP_NUMBERS)[number];

export function isStepNumber(n: unknown): n is StepNumber {
  return typeof n === 'number' && (STEP_NUMBERS as readonly number[]).includes(n);
}

/** Each email has a fixed layout; the admin edits its words, links and images. */
export type StepLayout =
  | 'welcome' | 'education' | 'trust' | 'offer' | 'reminder'
  | 'cart_reminder' | 'cart_educate' | 'cart_offer' | 'cart_questions' | 'cart_last_chance';

export interface FlowMeta {
  key: FlowKey;
  label: string;
  /** What starts the clock, for "1 hour after …". */
  trigger: string;
  /** Segmentation tag on every entry (and the Klaviyo profile property name). */
  tag: string;
  /** How the editor asks for delays. Stored as hours either way. */
  delayUnit: 'days' | 'hours';
  /** What a row in the people table is. */
  peopleLabel: string;
  description: string;
  steps: Record<StepNumber, { layout: StepLayout; label: string; theme: string; requiresCode?: boolean }>;
}

export const FLOWS: Record<FlowKey, FlowMeta> = {
  welcome: {
    key: 'welcome',
    label: 'Welcome Flow',
    trigger: 'signup',
    tag: 'Welcome Flow',
    delayUnit: 'days',
    peopleLabel: 'Subscribers',
    description:
      'Five emails that turn new subscribers into first-time customers — welcome, education, trust, offer and a last reminder.',
    steps: {
      1: { layout: 'welcome', label: 'Welcome', theme: 'Introduce the brand and the first-order code', requiresCode: true },
      2: { layout: 'education', label: 'Education', theme: 'The science and research behind the range' },
      3: { layout: 'trust', label: 'Trust', theme: 'Testing, transparency and quality' },
      4: { layout: 'offer', label: 'Offer', theme: 'The subscriber discount', requiresCode: true },
      5: { layout: 'reminder', label: 'Reminder', theme: 'Last call, with a deadline', requiresCode: true },
    },
  },
  cart: {
    key: 'cart',
    label: 'Cart Abandonment',
    trigger: 'the cart was abandoned',
    tag: 'Cart Abandonment',
    delayUnit: 'hours',
    peopleLabel: 'Abandoned carts',
    description:
      'Five emails that win back carts left behind — a reminder, education, an offer, answers to objections, and a last chance.',
    steps: {
      1: { layout: 'cart_reminder', label: 'Reminder', theme: 'Your cart is waiting' },
      2: { layout: 'cart_educate', label: 'Educate', theme: 'Why VYTA — research, quality, peace of mind' },
      3: { layout: 'cart_offer', label: 'Offer', theme: 'A time-limited discount on the cart', requiresCode: true },
      4: { layout: 'cart_questions', label: 'Address objections', theme: 'Answers and real support' },
      5: { layout: 'cart_last_chance', label: 'Last chance', theme: 'Final reminder, with a countdown' },
    },
  },
};

export const ENTRY_STATUSES = ['active', 'converted', 'completed', 'unsubscribed', 'exited'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const ENTRY_STATUS_META: Record<EntryStatus, { label: string; description: string }> = {
  active: { label: 'In flow', description: 'Still receiving the series' },
  converted: { label: 'Purchased', description: 'Placed an order — the flow stopped' },
  completed: { label: 'Completed', description: 'Received every email without purchasing' },
  unsubscribed: { label: 'Unsubscribed', description: 'Clicked unsubscribe' },
  exited: { label: 'Removed', description: 'Removed by an admin, cart emptied, or consent withdrawn' },
};

export type ConsentBasis = 'express' | 'implied' | 'manual';

export const CONSENT_LABELS: Record<ConsentBasis, string> = {
  express: 'Ticked the marketing box',
  implied: 'Started a checkout (implied, 6 months)',
  manual: 'Added by an admin',
};

export type SendStatus = 'sending' | 'sent' | 'failed' | 'skipped';

/** Failed sends are retried by later runs until this many attempts. */
export const MAX_SEND_ATTEMPTS = 3;

/** CASL: a checkout inquiry implies consent for this long. */
export const IMPLIED_CONSENT_DAYS = 180;

export interface FlowSettings {
  flow: FlowKey;
  enabled: boolean;
  enabled_at: string | null;
  send_window_start: number;
  send_window_end: number;
  default_timezone: string;
  min_gap_hours: number;
  reentry_days: number;
  footer_address: string;
  footer_disclaimer: string;
  updated_by_email?: string | null;
  updated_at?: string | null;
}

export interface FlowStep {
  flow: FlowKey;
  step: StepNumber;
  enabled: boolean;
  /** Hours after the trigger. */
  delay_hours: number;
  /** Per-recipient deadline this many hours after sending; null = none. */
  deadline_hours: number | null;
  show_cart: boolean;
  cart_title: string;
  cart_body: string;
  subject: string;
  preheader: string;
  eyebrow: string;
  headline: string;
  subheadline: string;
  body: string;
  /** Badges / benefit lines, each with the icon drawn beside it. */
  highlights: Highlight[];
  cta_label: string;
  cta_url: string;
  hero_image_url: string;
  /** Set the headline (and, on the reminder layouts, the countdown) over the main image. */
  hero_overlay: boolean;
  /** Text colour over the image: 'dark' (navy) for light skies, 'light' (white) for dark photos. */
  hero_text_tone: 'dark' | 'light';
  /** The main image's height ÷ width, so the cell it fills keeps its shape. */
  hero_image_ratio: number | null;
  card_title: string;
  card_body: string;
  card_link_label: string;
  card_link_url: string;
  card_image_url: string;
  promo_code: string | null;
  fine_print: string;
  updated_by_email?: string | null;
  updated_at?: string | null;
}

/**
 * Offer emails carry a discount, and no code is ever assumed: an admin must
 * choose one from Discount Codes before the email can be saved (while it is
 * switched on), before its flow can be switched on, and before it will send.
 */
export function requiresCode(flow: FlowKey, step: StepNumber): boolean {
  return FLOWS[flow].steps[step].requiresCode === true;
}

/** "Email 1, Email 4" — the switched-on offer emails still waiting for a code. */
export function stepsMissingCode(steps: Pick<FlowStep, 'flow' | 'step' | 'enabled' | 'promo_code'>[]): number[] {
  return steps.filter((s) => s.enabled && requiresCode(s.flow, s.step) && !s.promo_code).map((s) => s.step);
}

export const MISSING_CODE_MESSAGE = 'Choose the discount code this email offers.';

// ---------------------------------------------------------------------------
// Icons — the badges and benefit lines, each with its own icon
// ---------------------------------------------------------------------------

/**
 * The icon set the emails draw from, as 96px PNGs in public/images/email/icons
 * (`<key>-navy.png` for light grounds, `<key>-white.png` for dark). Line icons
 * from Lucide, plus the maple leaf. PNG rather than SVG: Gmail and Outlook
 * don't render SVG in email.
 */
export const ICONS = {
  'shield-check': 'Shield with check',
  'maple-leaf': 'Maple leaf',
  truck: 'Delivery truck',
  'flask-conical': 'Lab flask',
  'file-text': 'Document (COA)',
  snowflake: 'Snowflake (cold chain)',
  leaf: 'Leaf',
  'hand-heart': 'Hand with heart',
  'heart-pulse': 'Heart (recovery)',
  sun: 'Sun (vitality)',
  sprout: 'Sprout (growth)',
  'circle-help': 'Question mark',
  'credit-card': 'Credit card',
  'badge-check': 'Badge with check',
  headset: 'Support headset',
  check: 'Check mark',
} as const;
export type IconKey = keyof typeof ICONS;

export function isIconKey(v: unknown): v is IconKey {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(ICONS, v);
}

export interface Highlight {
  label: string;
  icon: IconKey;
}

/** First match wins — so "Shipping & delivery" is a truck, not a check. */
const ICON_KEYWORDS: Array<[RegExp, IconKey]> = [
  [/canad/i, 'maple-leaf'],
  [/ship|deliver/i, 'truck'],
  [/coa|certificate|batch/i, 'file-text'],
  [/cold|chain|temperature/i, 'snowflake'],
  [/lab|tested|testing|purity/i, 'shield-check'],
  [/sourc/i, 'leaf'],
  [/recover/i, 'heart-pulse'],
  [/vital|energ/i, 'sun'],
  [/feel|care|wellness/i, 'hand-heart'],
  [/stronger|grow|tomorrow/i, 'sprout'],
  [/question|information|faq/i, 'circle-help'],
  [/pay|order/i, 'credit-card'],
  [/support|help|contact/i, 'headset'],
  [/quality|trust|premium|secure/i, 'shield-check'],
];

/** A sensible icon for a label typed without one. */
export function iconForLabel(label: string): IconKey {
  return ICON_KEYWORDS.find(([re]) => re.test(label))?.[1] ?? 'check';
}

/**
 * Badges as stored or typed: `{ label, icon }` objects, or plain strings from
 * an older row (their icon is chosen from the wording). Empty labels dropped,
 * at most six kept.
 */
export function normalizeHighlights(raw: unknown): Highlight[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split('\n');
  return list
    .map((h): Highlight | null => {
      if (h && typeof h === 'object') {
        const o = h as Record<string, unknown>;
        const label = String(o.label ?? '').trim().slice(0, 60);
        if (!label) return null;
        return { label, icon: isIconKey(o.icon) ? o.icon : iconForLabel(label) };
      }
      const label = String(h ?? '').trim().slice(0, 60);
      return label ? { label, icon: iconForLabel(label) } : null;
    })
    .filter((h): h is Highlight => h !== null)
    .slice(0, 6);
}

// ---------------------------------------------------------------------------
// Merge tags
// ---------------------------------------------------------------------------

export const MERGE_TAGS = ['first_name', 'code', 'discount', 'offer_ends', 'cart_url', 'checkout_url'] as const;
/** Tags that only have a value in the cart flow. */
export const CART_ONLY_TAGS = ['cart_url', 'checkout_url'] as const;
/** Merge tags that may stand alone as a link. */
export const LINK_TAGS = ['{{cart_url}}', '{{checkout_url}}'] as const;

// ---------------------------------------------------------------------------
// Input shaping — the admin form and the PUT routes share these.
// ---------------------------------------------------------------------------

export type Shaped<T> = { ok: true; value: T } | { ok: false; error: string };

const str = (v: unknown, max = 2000) => String(v ?? '').trim().slice(0, max);

/** True for an IANA zone name this runtime recognises. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function intIn(v: unknown, lo: number, hi: number): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < lo || n > hi) return null;
  return n;
}

export type SettingsInput = Omit<FlowSettings, 'flow' | 'enabled_at' | 'updated_by_email' | 'updated_at'>;

export function shapeSettingsInput(raw: Record<string, unknown>): Shaped<SettingsInput> {
  const start = intIn(raw.send_window_start, 0, 23);
  const end = intIn(raw.send_window_end, 1, 24);
  if (start == null || end == null) return { ok: false, error: 'Send window hours must be whole hours between 0 and 24.' };
  if (start === end) return { ok: false, error: 'The send window must be at least one hour long.' };

  const tz = str(raw.default_timezone, 64);
  if (!isValidTimeZone(tz)) return { ok: false, error: `"${tz}" is not a time zone this server recognises (e.g. America/Toronto).` };

  const gap = intIn(raw.min_gap_hours, 0, 168);
  if (gap == null) return { ok: false, error: 'The minimum gap must be between 0 and 168 hours.' };

  const reentry = intIn(raw.reentry_days ?? 30, 0, 365);
  if (reentry == null) return { ok: false, error: 'Re-entry must be between 0 and 365 days.' };

  return {
    ok: true,
    value: {
      enabled: raw.enabled === true,
      send_window_start: start,
      send_window_end: end,
      default_timezone: tz,
      min_gap_hours: gap,
      reentry_days: reentry,
      footer_address: str(raw.footer_address, 300),
      footer_disclaimer: str(raw.footer_disclaimer, 500),
    },
  };
}

/**
 * Only http(s), a site-relative path, or a link merge tag may become a link or
 * image: the value is typed by an admin and lands in an href in many inboxes.
 */
export function isSafeLink(url: string): boolean {
  if (!url) return true;
  if ((LINK_TAGS as readonly string[]).includes(url)) return true;
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  return /^https?:\/\/[^\s]+$/i.test(url);
}

/** Uppercase and strip everything that is not [A-Z0-9] — the discount-code rule. */
export function normalizeCode(raw: unknown): string {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export type StepInput = Omit<FlowStep, 'updated_by_email' | 'updated_at'>;

export function shapeStepInput(
  flow: FlowKey,
  step: StepNumber,
  raw: Record<string, unknown>,
  /** Off for the live preview, which shows the missing code as a warning instead. */
  opts: { requireCode?: boolean } = {},
): Shaped<StepInput> {
  const delay = intIn(raw.delay_hours, 0, 2160);
  if (delay == null) return { ok: false, error: 'Delay must be a whole number of hours, up to 90 days.' };

  const deadlineRaw = raw.deadline_hours;
  const deadline = deadlineRaw === null || deadlineRaw === undefined || deadlineRaw === '' ? null : intIn(deadlineRaw, 1, 336);
  if (deadline === null && deadlineRaw !== null && deadlineRaw !== undefined && deadlineRaw !== '') {
    return { ok: false, error: 'The offer deadline must be between 1 and 336 hours, or blank.' };
  }

  const subject = str(raw.subject, 200);
  if (!subject) return { ok: false, error: 'Every email needs a subject line.' };

  const links: Array<[string, string]> = [
    ['Button link', str(raw.cta_url, 500)],
    ['Card link', str(raw.card_link_url, 500)],
    ['Main image', str(raw.hero_image_url, 500)],
    ['Card image', str(raw.card_image_url, 500)],
  ];
  for (const [label, url] of links) {
    if (!isSafeLink(url)) return { ok: false, error: `${label} must start with https://, / or be {{cart_url}} / {{checkout_url}}` };
  }

  const highlights = normalizeHighlights(raw.highlights);

  const code = normalizeCode(raw.promo_code);
  const enabled = raw.enabled !== false;
  const ratioRaw = Number(raw.hero_image_ratio);
  const heroRatio = Number.isFinite(ratioRaw) && ratioRaw >= 0.2 && ratioRaw <= 5 ? Math.round(ratioRaw * 10000) / 10000 : null;
  if (opts.requireCode !== false && enabled && requiresCode(flow, step) && !code) {
    return { ok: false, error: `${MISSING_CODE_MESSAGE} It's an offer email, so it needs one — pick it from Discount Codes, or switch this email off.` };
  }

  return {
    ok: true,
    value: {
      flow,
      step,
      enabled,
      delay_hours: delay,
      deadline_hours: deadline,
      show_cart: flow === 'cart' && raw.show_cart === true,
      cart_title: str(raw.cart_title, 120),
      cart_body: str(raw.cart_body, 400),
      subject,
      preheader: str(raw.preheader, 200),
      eyebrow: str(raw.eyebrow, 80),
      headline: str(raw.headline, 120),
      subheadline: str(raw.subheadline, 200),
      body: str(raw.body, 3000),
      highlights,
      cta_label: str(raw.cta_label, 60),
      cta_url: links[0][1],
      hero_image_url: links[2][1],
      hero_overlay: raw.hero_overlay === true,
      hero_text_tone: raw.hero_text_tone === 'light' ? 'light' : 'dark',
      hero_image_ratio: heroRatio,
      card_title: str(raw.card_title, 120),
      card_body: str(raw.card_body, 600),
      card_link_label: str(raw.card_link_label, 60),
      card_link_url: links[1][1],
      card_image_url: links[3][1],
      promo_code: code || null,
      fine_print: str(raw.fine_print, 300),
    },
  };
}

// ---------------------------------------------------------------------------
// Delays, as people say them
// ---------------------------------------------------------------------------

/** "Immediately", "1 hour later", "2 days later", "5 days later". */
export function delayLabel(hours: number, trigger: string): string {
  if (hours <= 0) return `Immediately after ${trigger}`;
  if (hours % 24 === 0) {
    const d = hours / 24;
    return `${d} day${d === 1 ? '' : 's'} later`;
  }
  return `${hours} hour${hours === 1 ? '' : 's'} later`;
}

// ---------------------------------------------------------------------------
// What the admin reads
// ---------------------------------------------------------------------------

/** A step's code, as checked against discount_codes. */
export interface CodeCheck {
  code: string;
  usable: boolean;
  /** "20%" / "$10" — what {{discount}} renders as. */
  label: string | null;
  problem: string | null;
}

export interface StepStats {
  step: StepNumber;
  sent: number;
  failed: number;
  skipped: number;
  opened: number;
  clicked: number;
  conversions: number;
  revenue: number;
}

export interface FlowOverview {
  enrolled: number;
  byStatus: Record<EntryStatus, number>;
  conversionRate: number | null;
  revenue: number;
  steps: StepStats[];
}

export interface EntrySendRow {
  id: string;
  step: StepNumber;
  status: SendStatus;
  attempts: number;
  subject: string | null;
  promo_code: string | null;
  offer_ends_at: string | null;
  error: string | null;
  sent_at: string | null;
  opened_at: string | null;
  open_count: number;
  clicked_at: string | null;
  click_count: number;
  created_at: string;
}

/** One cart line, resolved from `products` for display. */
export interface CartLineView {
  productId: string;
  name: string;
  packLabel: string;
  quantity: number;
  imageUrl: string | null;
}

export interface EntryRow {
  id: string;
  flow: FlowKey;
  customer_id: string | null;
  email: string;
  first_name: string | null;
  timezone: string;
  status: EntryStatus;
  source: string;
  consent_basis: ConsentBasis;
  tags: string[];
  enrolled_at: string;
  cart_id: string | null;
  last_step: number;
  last_sent_at: string | null;
  paused_reason: string | null;
  converted_at: string | null;
  converted_order_ref: string | null;
  converted_amount: number | null;
  converted_currency: string | null;
  attributed_step: number | null;
  exit_reason: string | null;
  exited_at: string | null;
  unsubscribed_at: string | null;
  sends: EntrySendRow[];
  next?: { step: StepNumber; at: string } | null;
  cart?: { lines: CartLineView[]; status: string; restoreUrl: string | null } | null;
}
