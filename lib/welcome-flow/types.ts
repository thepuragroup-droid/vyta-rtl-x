/**
 * Welcome email flow — the shared vocabulary.
 *
 * Isomorphic (no server imports), so the admin page validating a form and the
 * route saving it run the same rules, and the default copy is stated once:
 * the first load of /admin/welcome-flow seeds `welcome_flow_steps` from
 * DEFAULT_STEPS below.
 *
 * See welcome-flow-migration.sql for the tables and
 * docs/changelog/2026-10-15-welcome-email-flow.md for how it fits together.
 */

export const STEP_NUMBERS = [1, 2, 3, 4, 5] as const;
export type StepNumber = (typeof STEP_NUMBERS)[number];

/** Each email has a fixed layout; the admin edits its words, links and images. */
export type StepLayout = 'welcome' | 'education' | 'trust' | 'offer' | 'reminder';

export const STEP_META: Record<StepNumber, { layout: StepLayout; label: string; theme: string }> = {
  1: { layout: 'welcome', label: 'Welcome', theme: 'Introduce the brand and the first-order code' },
  2: { layout: 'education', label: 'Education', theme: 'The science and research behind the range' },
  3: { layout: 'trust', label: 'Trust', theme: 'Testing, transparency and quality' },
  4: { layout: 'offer', label: 'Offer', theme: 'The subscriber discount' },
  5: { layout: 'reminder', label: 'Reminder', theme: 'Last call, with a deadline' },
};

export const SUBSCRIBER_STATUSES = ['active', 'converted', 'completed', 'unsubscribed', 'exited'] as const;
export type SubscriberStatus = (typeof SUBSCRIBER_STATUSES)[number];

export const SUBSCRIBER_STATUS_META: Record<SubscriberStatus, { label: string; description: string }> = {
  active: { label: 'In flow', description: 'Still receiving the series' },
  converted: { label: 'Purchased', description: 'Placed an order — the flow stopped' },
  completed: { label: 'Completed', description: 'Received every email without purchasing' },
  unsubscribed: { label: 'Unsubscribed', description: 'Clicked unsubscribe' },
  exited: { label: 'Removed', description: 'Removed by an admin, or consent withdrawn' },
};

export type SendStatus = 'sending' | 'sent' | 'failed' | 'skipped';

/** Failed sends are retried by later runs until this many attempts. */
export const MAX_SEND_ATTEMPTS = 3;

/** The tag every subscriber carries, for segmentation (here and in Klaviyo). */
export const WELCOME_FLOW_TAG = 'Welcome Flow';

export interface WelcomeFlowSettings {
  enabled: boolean;
  enabled_at: string | null;
  send_window_start: number;
  send_window_end: number;
  default_timezone: string;
  final_offer_hours: number;
  min_gap_hours: number;
  footer_address: string;
  footer_disclaimer: string;
  updated_by_email?: string | null;
  updated_at?: string | null;
}

export interface WelcomeFlowStep {
  step: StepNumber;
  enabled: boolean;
  delay_days: number;
  subject: string;
  preheader: string;
  eyebrow: string;
  headline: string;
  subheadline: string;
  body: string;
  highlights: string[];
  cta_label: string;
  cta_url: string;
  hero_image_url: string;
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

export const DEFAULT_SETTINGS: WelcomeFlowSettings = {
  enabled: false,
  enabled_at: null,
  send_window_start: 9,
  send_window_end: 11,
  default_timezone: 'America/Toronto',
  final_offer_hours: 24,
  min_gap_hours: 20,
  footer_address: '',
  footer_disclaimer: 'For research use only. Not for human consumption.',
};

/**
 * Placeholder artwork shipped in public/images/email/welcome/. Relative paths
 * are resolved against the site origin at send time, so swapping in the real
 * photography is a matter of uploading it in the admin (or replacing the file).
 */
export const PLACEHOLDER_IMAGES = {
  welcomeHero: '/images/email/welcome/welcome-hero.png',
  welcomeCard: '/images/email/welcome/welcome-card.png',
  educationHero: '/images/email/welcome/education-hero.png',
  educationCard: '/images/email/welcome/education-card.png',
  trustHero: '/images/email/welcome/trust-hero.png',
  trustCard: '/images/email/welcome/trust-card.png',
  offerHero: '/images/email/welcome/offer-hero.png',
  reminderHero: '/images/email/welcome/reminder-hero.png',
} as const;

const blankStep = (step: StepNumber): WelcomeFlowStep => ({
  step,
  enabled: true,
  delay_days: 0,
  subject: '',
  preheader: '',
  eyebrow: '',
  headline: '',
  subheadline: '',
  body: '',
  highlights: [],
  cta_label: '',
  cta_url: '',
  hero_image_url: '',
  card_title: '',
  card_body: '',
  card_link_label: '',
  card_link_url: '',
  card_image_url: '',
  promo_code: null,
  fine_print: '',
});

/**
 * The series as designed. Merge tags: {{first_name}}, {{code}}, {{discount}}
 * (the code's real value, e.g. "20%"), {{offer_ends}} (email 5's deadline).
 */
export const DEFAULT_STEPS: WelcomeFlowStep[] = [
  {
    ...blankStep(1),
    delay_days: 0,
    subject: 'Welcome to VYTA, {{first_name}}',
    preheader: 'Your journey to better wellness starts here — plus {{discount}} off your first order.',
    headline: 'Welcome to VYTA',
    subheadline: 'Your journey to better wellness starts here.',
    body: "Thanks for joining the VYTA community. You'll be the first to know about new products, exclusive offers, and wellness insights.",
    highlights: ['Premium Quality', 'Canadian Owned', 'Third-Party Tested', 'Fast & Discreet Shipping'],
    cta_label: 'Shop Now',
    cta_url: '/products',
    hero_image_url: PLACEHOLDER_IMAGES.welcomeHero,
    card_title: 'Enjoy {{discount}} Off Your First Order',
    card_body: 'Use code {{code}} at checkout.',
    card_image_url: PLACEHOLDER_IMAGES.welcomeCard,
    promo_code: 'WELCOME10',
  },
  {
    ...blankStep(2),
    delay_days: 2,
    subject: 'Modern wellness starts with knowledge',
    preheader: 'Explore the science, research, and possibilities behind peptide support.',
    headline: 'Modern Wellness Starts with Knowledge',
    subheadline: 'Explore the science, research, and possibilities behind peptide support.',
    highlights: ['Supports Recovery', 'Promotes Vitality', 'Helps You Feel Your Best', 'Builds a Stronger Tomorrow'],
    cta_label: 'Explore the Collection',
    cta_url: '/products',
    hero_image_url: PLACEHOLDER_IMAGES.educationHero,
    card_title: 'We Show Our Work',
    card_body: 'Every batch is third-party tested for identity, purity and quality.',
    card_link_label: 'Learn More',
    card_link_url: '/lab-results',
    card_image_url: PLACEHOLDER_IMAGES.educationCard,
  },
  {
    ...blankStep(3),
    delay_days: 4,
    subject: 'Quality you can trust',
    preheader: 'Transparency. Testing. Peace of mind.',
    headline: 'Quality You Can Trust',
    subheadline: 'Transparency. Testing. Peace of mind.',
    body: 'We partner with independent laboratories to ensure every batch meets strict quality standards. Because your wellness journey deserves nothing less.',
    highlights: ['Third-Party Tested', 'Batch-Specific COA', 'Cold-Chain Handling', 'Premium Sourcing'],
    cta_label: 'Our Testing Process',
    cta_url: '/lab-results',
    hero_image_url: PLACEHOLDER_IMAGES.trustHero,
    card_title: 'Research. Quality. Wellness.',
    card_body: "A higher standard for what's next.",
    card_image_url: PLACEHOLDER_IMAGES.trustCard,
  },
  {
    ...blankStep(4),
    delay_days: 6,
    subject: '{{discount}} off your order — just for subscribers',
    preheader: 'Premium wellness. Trusted quality. Delivered to your door.',
    eyebrow: 'Exclusive for our subscribers',
    headline: '{{discount}} OFF',
    subheadline: 'Your Order Today',
    body: 'Premium wellness. Trusted quality. Delivered to your door.',
    highlights: ['Premium Quality', 'Canadian Owned', 'Fast & Discreet Shipping', 'Trusted Source'],
    cta_label: 'Shop Now',
    cta_url: '/products',
    hero_image_url: PLACEHOLDER_IMAGES.offerHero,
    promo_code: 'VYTA20',
    fine_print: 'Limited time offer. Valid for new customers only.',
  },
  {
    ...blankStep(5),
    delay_days: 9,
    subject: 'Still thinking about it, {{first_name}}?',
    preheader: "Don't miss out on {{discount}} off — our exclusive offer for new subscribers.",
    headline: 'Still Thinking About It?',
    body: "Your wellness goals are within reach. Don't miss out on {{discount}} off — our exclusive offer for new subscribers.",
    highlights: ['Premium Wellness', 'Discreet Shipping', 'Trusted Quality'],
    cta_label: 'Claim {{discount}} Off',
    cta_url: '/products',
    hero_image_url: PLACEHOLDER_IMAGES.reminderHero,
    promo_code: 'VYTA20',
  },
];

export function defaultStep(step: StepNumber): WelcomeFlowStep {
  const found = DEFAULT_STEPS.find((s) => s.step === step)!;
  return { ...found, highlights: [...found.highlights] };
}

export function isStepNumber(n: unknown): n is StepNumber {
  return typeof n === 'number' && (STEP_NUMBERS as readonly number[]).includes(n);
}

// ---------------------------------------------------------------------------
// Input shaping — the admin form and the PUT routes share these.
// ---------------------------------------------------------------------------

type Shaped<T> = { ok: true; value: T } | { ok: false; error: string };

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

export type SettingsInput = Omit<WelcomeFlowSettings, 'enabled_at' | 'updated_by_email' | 'updated_at'>;

export function shapeSettingsInput(raw: Record<string, unknown>): Shaped<SettingsInput> {
  const start = intIn(raw.send_window_start, 0, 23);
  const end = intIn(raw.send_window_end, 1, 24);
  if (start == null || end == null) return { ok: false, error: 'Send window hours must be whole hours between 0 and 24.' };
  if (start === end) return { ok: false, error: 'The send window must be at least one hour long.' };

  const tz = str(raw.default_timezone, 64);
  if (!isValidTimeZone(tz)) return { ok: false, error: `"${tz}" is not a time zone this server recognises (e.g. America/Toronto).` };

  const hours = intIn(raw.final_offer_hours, 1, 336);
  if (hours == null) return { ok: false, error: 'The final-offer countdown must be between 1 and 336 hours.' };

  const gap = intIn(raw.min_gap_hours, 0, 168);
  if (gap == null) return { ok: false, error: 'The minimum gap must be between 0 and 168 hours.' };

  return {
    ok: true,
    value: {
      enabled: raw.enabled === true,
      send_window_start: start,
      send_window_end: end,
      default_timezone: tz,
      final_offer_hours: hours,
      min_gap_hours: gap,
      footer_address: str(raw.footer_address, 300),
      footer_disclaimer: str(raw.footer_disclaimer, 500),
    },
  };
}

/**
 * Only http(s) or a site-relative path may become a link or image: the value is
 * typed by an admin and lands in an href in hundreds of inboxes.
 */
export function isSafeLink(url: string): boolean {
  if (!url) return true;
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  return /^https?:\/\/[^\s]+$/i.test(url);
}

/** Uppercase and strip everything that is not [A-Z0-9] — the discount-code rule. */
export function normalizeCode(raw: unknown): string {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export type StepInput = Omit<WelcomeFlowStep, 'updated_by_email' | 'updated_at'>;

export function shapeStepInput(step: StepNumber, raw: Record<string, unknown>): Shaped<StepInput> {
  const delay = intIn(raw.delay_days, 0, 90);
  if (delay == null) return { ok: false, error: 'Delay must be a whole number of days between 0 and 90.' };

  const subject = str(raw.subject, 200);
  if (!subject) return { ok: false, error: 'Every email needs a subject line.' };

  const links: Array<[string, string]> = [
    ['Button link', str(raw.cta_url, 500)],
    ['Card link', str(raw.card_link_url, 500)],
    ['Hero image', str(raw.hero_image_url, 500)],
    ['Card image', str(raw.card_image_url, 500)],
  ];
  for (const [label, url] of links) {
    if (!isSafeLink(url)) return { ok: false, error: `${label} must start with https:// or /` };
  }

  const highlights = (Array.isArray(raw.highlights) ? raw.highlights : String(raw.highlights ?? '').split('\n'))
    .map((h) => str(h, 60))
    .filter(Boolean)
    .slice(0, 6);

  const code = normalizeCode(raw.promo_code);

  return {
    ok: true,
    value: {
      step,
      enabled: raw.enabled !== false,
      delay_days: delay,
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

/** A DB row (or partial) into a full step, with defaults for anything missing. */
export function shapeStepRow(row: Partial<WelcomeFlowStep> & { step: number }): WelcomeFlowStep {
  const base = isStepNumber(row.step) ? defaultStep(row.step) : defaultStep(1);
  const merged = { ...base, ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined)) } as WelcomeFlowStep;
  merged.promo_code = row.promo_code ?? null;
  merged.highlights = Array.isArray(row.highlights) ? row.highlights.map(String) : base.highlights;
  merged.delay_days = Number(merged.delay_days) || 0;
  return merged;
}

export function shapeSettingsRow(row: Partial<WelcomeFlowSettings> | null | undefined): WelcomeFlowSettings {
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries(Object.entries(row ?? {}).filter(([, v]) => v !== null && v !== undefined)) } as WelcomeFlowSettings;
}

// ---------------------------------------------------------------------------
// What the admin reads
// ---------------------------------------------------------------------------

/** A step's code, as checked against discount_codes. */
export interface CodeCheck {
  code: string;
  /** Usable right now: exists, active, started, not expired, not used up. */
  usable: boolean;
  /** "20%" / "$10" — what {{discount}} renders as. */
  label: string | null;
  /** Why it is not usable, in a sentence. */
  problem: string | null;
}

export interface StepStats {
  step: StepNumber;
  sent: number;
  failed: number;
  skipped: number;
  opened: number;
  clicked: number;
  /** Purchases whose last flow email before buying was this one. */
  conversions: number;
  revenue: number;
}

export interface FlowOverview {
  enrolled: number;
  byStatus: Record<SubscriberStatus, number>;
  conversionRate: number | null;
  revenue: number;
  steps: StepStats[];
}

export interface SubscriberSendRow {
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

export interface SubscriberRow {
  id: string;
  customer_id: string | null;
  email: string;
  first_name: string | null;
  timezone: string;
  status: SubscriberStatus;
  source: string;
  tags: string[];
  enrolled_at: string;
  last_step: number;
  last_sent_at: string | null;
  converted_at: string | null;
  converted_order_ref: string | null;
  converted_amount: number | null;
  converted_currency: string | null;
  attributed_step: number | null;
  exit_reason: string | null;
  exited_at: string | null;
  unsubscribed_at: string | null;
  sends: SubscriberSendRow[];
  /** Estimated next email for an active subscriber. */
  next?: { step: StepNumber; at: string } | null;
}
