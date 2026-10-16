/**
 * Email flows — the series as designed: default settings and copy for both
 * flows. The first load of /admin/email-flows seeds `email_flow_steps` from
 * here, so the copy is stated once.
 *
 * No discount code is pre-filled: the offer emails (types.ts `requiresCode`)
 * stay on hold until an admin chooses one from Discount Codes.
 *
 * Merge tags: {{first_name}}, {{code}}, {{discount}} (the code's real value,
 * e.g. "20%"), {{offer_ends}} (the step's per-recipient deadline), and — cart
 * flow only — {{cart_url}} (restores their cart) and {{checkout_url}} (restores
 * it and goes straight to checkout, with the step's code applied).
 */
import type { FlowKey, FlowSettings, FlowStep, StepNumber } from './types';
import { FLOW_KEYS, isStepNumber, normalizeHighlights } from './types';

export const DEFAULT_SETTINGS: Record<FlowKey, FlowSettings> = {
  welcome: {
    flow: 'welcome',
    enabled: false,
    enabled_at: null,
    send_window_start: 9,
    send_window_end: 11,
    default_timezone: 'America/Toronto',
    min_gap_hours: 20,
    reentry_days: 0,
    footer_address: '',
    footer_disclaimer: 'For research use only. Not for human consumption.',
  },
  cart: {
    flow: 'cart',
    enabled: false,
    enabled_at: null,
    send_window_start: 9,
    send_window_end: 11,
    default_timezone: 'America/Toronto',
    min_gap_hours: 12,
    reentry_days: 30,
    footer_address: '',
    footer_disclaimer: 'For research use only. Not for human consumption.',
  },
};

/**
 * The supplied photography, cropped to the shape each spot takes in the
 * mockups (public/images/email/photos). `ratio` is height ÷ width.
 */
export const PHOTOS = {
  /** The supplied woman-in-the-sun photo, head to waist on the right, sky on the left (Cart 2). */
  cartWomanSun: { url: '/images/email/photos/cart-woman-sun.jpg', ratio: 0.95 },
  /** The woman by the lake, head and shoulders on the right, the left paled for the headline. */
  cartWomanLake: { url: '/images/email/photos/cart-woman-lake.jpg', ratio: 0.68 },
  /** The supplied single vial on a rock, the lake and mountains behind (1200 wide). */
  vialRock: { url: '/images/email/photos/vial-rock.jpg', ratio: 0.7825 },
  /** The same shot with the sky above him — room for the reminder's copy. */
  manByLakeSky: { url: '/images/email/photos/man-lake-sky.jpg', ratio: 1.5 },
  /** Woman by the lake on the right, the left darkened for the white welcome title. */
  womanLakeDark: { url: '/images/email/photos/woman-lake-dark.jpg', ratio: 0.8 },
  /** The welcome offer panel: pale mountains behind the copy, the vials at the right. */
  offerCard: { url: '/images/email/photos/offer-card.jpg', ratio: 0.3933 },
  /**
   * The supplied woman-in-the-sun photo, whole and top to bottom, on the
   * right; its own sky stretched into a soft haze on the left for the copy.
   * 1200 wide for sharp screens.
   */
  womanPortrait: { url: '/images/email/photos/woman-portrait.jpg', ratio: 1.3 },
  /** The vials on the right, a pale haze at the upper left for the headline. */
  qualityVials: { url: '/images/email/photos/quality-vials.jpg', ratio: 0.84 },
  vialsMountains: { url: '/images/email/photos/vials-mountains.jpg', ratio: 1.0367 },
  labVial: { url: '/images/email/photos/lab-vial.jpg', ratio: 0.9383 },
  /** The supplied single vial on a rock, darkened, navy fading down into it: Cart 3's offer cover. */
  cartOfferCover: { url: '/images/email/photos/cart-offer-cover.jpg', ratio: 1.5 },
  /** The three vials darkened, with navy fading down into them: the offer is set over the top. */
  offerCover: { url: '/images/email/photos/offer-cover.jpg', ratio: 1.25 },
  dropper: { url: '/images/email/photos/dropper.jpg', ratio: 1.055 },
  dropperCard: { url: '/images/email/photos/dropper-card.jpg', ratio: 0.845 },
  /** The dropper over the vial at the right, a pale haze on the left for the help topics (Cart 4). */
  questionsCover: { url: '/images/email/photos/questions-cover.jpg', ratio: 1 },
  supportAgent: { url: '/images/email/photos/support-agent.jpg', ratio: 0.9 },
} as const;

/** A photo with the headline set over it (the mockups' overlay heroes). */
const overlay = (c: { url: string; ratio: number }) => ({
  hero_image_url: c.url,
  hero_image_ratio: c.ratio,
  hero_overlay: true,
  hero_text_tone: 'dark' as const,
});

/** A photo below the text (the mockups' product shots). */
const below = (c: { url: string; ratio: number }) => ({
  hero_image_url: c.url,
  hero_image_ratio: c.ratio,
  hero_overlay: false,
});

const blank = (flow: FlowKey, step: StepNumber): FlowStep => ({
  flow,
  step,
  enabled: true,
  delay_hours: 0,
  deadline_hours: null,
  show_cart: false,
  cart_title: '',
  cart_body: '',
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
  hero_overlay: false,
  hero_text_tone: 'dark',
  hero_image_ratio: null,
  card_title: '',
  card_body: '',
  card_link_label: '',
  card_link_url: '',
  card_image_url: '',
  promo_code: null,
  fine_print: '',
});

const F = PHOTOS;

const WELCOME: FlowStep[] = [
  {
    ...blank('welcome', 1),
    delay_hours: 0,
    subject: 'Welcome to VYTA, {{first_name}}',
    preheader: 'Your journey to better wellness starts here — plus {{discount}} off your first order.',
    headline: 'Welcome to VYTA',
    subheadline: 'Your journey to better wellness starts here.',
    body: "Thanks for joining the VYTA community. You'll be the first to know about new products, exclusive offers, and wellness insights.",
    highlights: [{ label: 'Premium Quality', icon: 'shield-check' }, { label: 'Canadian Owned', icon: 'maple-leaf' }, { label: 'Third-Party Tested', icon: 'shield-check' }, { label: 'Fast & Discreet Shipping', icon: 'truck' }],
    cta_label: 'Shop Now',
    cta_url: '/products',
    ...overlay(F.womanLakeDark),
    hero_text_tone: 'light',
    card_title: 'Enjoy {{discount}} Off Your First Order',
    card_body: 'Use code {{code}} at checkout.',
    card_image_url: F.offerCard.url,
  },
  {
    ...blank('welcome', 2),
    delay_hours: 48,
    subject: 'Modern wellness starts with knowledge',
    preheader: 'Explore the science, research, and possibilities behind peptide support.',
    headline: 'Modern Wellness Starts with Knowledge',
    subheadline: 'Explore the science, research, and possibilities behind peptide support.',
    highlights: [{ label: 'Supports Recovery', icon: 'heart-pulse' }, { label: 'Promotes Vitality', icon: 'sun' }, { label: 'Helps You Feel Your Best', icon: 'hand-heart' }, { label: 'Builds a Stronger Tomorrow', icon: 'sprout' }],
    cta_label: 'Explore the Collection',
    cta_url: '/products',
    ...overlay(F.womanPortrait),
    card_title: 'We Show Our Work',
    card_body: 'Every batch is third-party tested for identity, purity and quality.',
    card_link_label: 'Learn More',
    card_link_url: '/lab-results',
    card_image_url: F.labVial.url,
  },
  {
    ...blank('welcome', 3),
    delay_hours: 96,
    subject: 'Quality you can trust',
    preheader: 'Transparency. Testing. Peace of mind.',
    headline: 'Quality You Can Trust',
    subheadline: 'Transparency. Testing. Peace of mind.',
    body: 'We partner with independent laboratories to ensure every batch meets strict quality standards. Because your wellness journey deserves nothing less.',
    highlights: [{ label: 'Third-Party Tested', icon: 'shield-check' }, { label: 'Batch-Specific COA', icon: 'file-text' }, { label: 'Cold-Chain Handling', icon: 'snowflake' }, { label: 'Premium Sourcing', icon: 'leaf' }],
    cta_label: 'Our Testing Process',
    cta_url: '/lab-results',
    ...overlay(F.qualityVials),
    card_title: 'Research. Quality. Wellness.',
    card_body: "A higher standard for what's next.",
    card_image_url: F.dropperCard.url,
  },
  {
    ...blank('welcome', 4),
    delay_hours: 144,
    subject: '{{discount}} off your order — just for subscribers',
    preheader: 'Premium wellness. Trusted quality. Delivered to your door.',
    eyebrow: 'Exclusive for our subscribers',
    headline: '{{discount}} OFF',
    subheadline: 'Your Order Today',
    body: 'Premium wellness. Trusted quality. Delivered to your door.',
    highlights: [{ label: 'Premium Quality', icon: 'shield-check' }, { label: 'Canadian Owned', icon: 'maple-leaf' }, { label: 'Fast & Discreet Shipping', icon: 'truck' }, { label: 'Trusted Source', icon: 'shield-check' }],
    cta_label: 'Shop Now',
    cta_url: '/products',
    ...overlay(F.offerCover),
    hero_text_tone: 'light',
    fine_print: 'Limited time offer. Valid for new customers only.',
  },
  {
    ...blank('welcome', 5),
    delay_hours: 216,
    deadline_hours: 24,
    subject: 'Still thinking about it, {{first_name}}?',
    preheader: "Don't miss out on {{discount}} off — our exclusive offer for new subscribers.",
    headline: 'Still Thinking About It?',
    body: "Your wellness goals are within reach. Don't miss out on {{discount}} off — our exclusive offer for new subscribers.",
    highlights: [{ label: 'Premium Wellness', icon: 'shield-check' }, { label: 'Discreet Shipping', icon: 'truck' }, { label: 'Trusted Quality', icon: 'shield-check' }],
    cta_label: 'Claim {{discount}} Off',
    cta_url: '/products',
    ...overlay(F.manByLakeSky),
  },
];

const CART: FlowStep[] = [
  {
    ...blank('cart', 1),
    delay_hours: 1,
    show_cart: true,
    cart_title: 'In your cart',
    subject: 'You left something behind, {{first_name}}',
    preheader: 'Your cart is waiting — complete your order whenever you are ready.',
    headline: 'Still thinking about it?',
    subheadline: 'Your cart is waiting.',
    body: 'Great choices! Your items are still in your cart. Complete your order to support your wellness goals.',
    highlights: [{ label: 'Canadian Owned', icon: 'maple-leaf' }, { label: 'Premium Quality', icon: 'shield-check' }, { label: 'Fast & Discreet Shipping', icon: 'truck' }],
    cta_label: 'Return to Cart',
    cta_url: '{{cart_url}}',
    ...overlay(F.cartWomanLake),
    card_image_url: F.vialRock.url,
  },
  {
    ...blank('cart', 2),
    delay_hours: 24,
    show_cart: true,
    cart_title: 'Your cart is still waiting.',
    cart_body: 'Complete your order and take the next step toward your wellness goals.',
    subject: 'Invest in a healthier you',
    preheader: 'Research. Quality. Peace of mind. Your cart is still waiting.',
    headline: 'Invest in a Healthier You',
    subheadline: 'Research. Quality. Peace of Mind.',
    highlights: [{ label: 'Third-Party Tested', icon: 'flask-conical' }, { label: 'Batch-Specific COA', icon: 'shield-check' }, { label: 'Premium Sourcing', icon: 'leaf' }],
    cta_label: 'Return to Cart',
    cta_url: '{{cart_url}}',
    ...overlay(F.cartWomanSun),
    card_title: 'We Show Our Work',
    card_body: 'Every batch is tested for identity, purity and quality so you can shop with confidence.',
    card_link_label: 'Learn More',
    card_link_url: '/lab-results',
    card_image_url: F.labVial.url,
  },
  {
    ...blank('cart', 3),
    delay_hours: 48,
    deadline_hours: 48,
    subject: '{{discount}} off — your cart is waiting',
    preheader: 'Complete your order today and enjoy {{discount}} off.',
    eyebrow: 'Exclusive offer — just for you',
    headline: '{{discount}} OFF',
    subheadline: 'Your Cart Is Waiting',
    body: 'Complete your order today and enjoy {{discount}} off as a thank you for being part of the VYTA community.',
    highlights: [{ label: 'Premium Quality', icon: 'shield-check' }, { label: 'Canadian Owned', icon: 'maple-leaf' }, { label: 'Fast & Discreet Shipping', icon: 'truck' }, { label: 'Trusted Source', icon: 'shield-check' }],
    cta_label: 'Complete My Order',
    cta_url: '{{checkout_url}}',
    ...overlay(F.cartOfferCover),
    hero_text_tone: 'light',
    fine_print: 'Offer valid until {{offer_ends}}. Limited time only.',
  },
  {
    ...blank('cart', 4),
    delay_hours: 72,
    show_cart: true,
    cart_title: 'Your cart is still saved.',
    cart_body: "If you need anything or have questions, we're here to help.",
    subject: 'Have questions? We’ve got you covered',
    preheader: 'Product information, shipping, testing and ordering — answered.',
    headline: 'Have Questions?',
    subheadline: "We've Got You Covered.",
    highlights: [{ label: 'Product information', icon: 'circle-help' }, { label: 'Shipping & delivery', icon: 'truck' }, { label: 'Testing & quality', icon: 'shield-check' }, { label: 'Ordering & payments', icon: 'credit-card' }],
    cta_label: 'Return to Cart',
    cta_url: '{{cart_url}}',
    ...overlay(F.questionsCover),
    card_title: 'Real People. Real Support.',
    card_body: 'Our team is here to help with any questions you may have.',
    card_link_label: 'Contact Us',
    card_link_url: '/contact',
    card_image_url: F.supportAgent.url,
  },
  {
    ...blank('cart', 5),
    delay_hours: 120,
    deadline_hours: 24,
    show_cart: true,
    cart_title: 'Your cart',
    subject: 'Last chance to complete your order',
    preheader: 'Your cart will expire soon.',
    eyebrow: 'Final reminder',
    headline: 'Last Chance to Complete Your Order',
    body: 'Your cart will expire soon.',
    highlights: [{ label: 'Premium Quality', icon: 'shield-check' }, { label: 'Canadian Owned', icon: 'maple-leaf' }, { label: 'Fast & Discreet Shipping', icon: 'truck' }, { label: 'Trusted Source', icon: 'shield-check' }],
    cta_label: 'Complete My Order',
    cta_url: '{{checkout_url}}',
    ...below(F.labVial),
  },
];

export const DEFAULT_STEPS: Record<FlowKey, FlowStep[]> = { welcome: WELCOME, cart: CART };

/**
 * Images the flows used to ship with. The first load of the admin
 * saved each email's defaults to the database, so a saved email still naming
 * one of these is on an old default, not an admin's choice: it gets today's
 * image (and that image's shape and overlay) instead. An image an admin
 * uploaded is never on this list, so it is kept.
 */
const RETIRED_IMAGES: Record<FlowKey, { hero: readonly string[]; card: readonly string[] }> = {
  welcome: {
    hero: [
      '/images/email/welcome/welcome-hero.png',
      '/images/email/welcome/education-hero.png',
      '/images/email/welcome/trust-hero.png',
      '/images/email/welcome/offer-hero.png',
      '/images/email/welcome/reminder-hero.png',
      '/images/email/covers/cover-1.jpg',
      '/images/email/covers/cover-2.jpg',
      '/images/email/covers/cover-3.jpg',
      '/images/email/covers/cover-4.jpg',
      '/images/email/covers/cover-5.jpg',
      '/images/email/photos/woman-lake.jpg',
      '/images/email/photos/dropper.jpg',
      '/images/email/photos/vials-mountains.jpg',
      '/images/email/photos/woman-mountains.jpg',
      '/images/email/photos/vials-rock.jpg',
      '/images/email/photos/three-vials.jpg',
    ],
    card: [
      '/images/email/welcome/welcome-card.png',
      '/images/email/welcome/education-card.png',
      '/images/email/welcome/trust-card.png',
      '/images/email/photos/man-lake-vial.jpg',
    ],
  },
  cart: {
    hero: [
      '/images/email/photos/man-lake.jpg',
      '/images/email/covers/cover-1.jpg',
      '/images/email/cart/reminder-hero.png',
      '/images/email/photos/woman-lake.jpg',
      '/images/email/covers/cover-2.jpg',
      '/images/email/cart/educate-hero.png',
      '/images/email/photos/three-vials.jpg',
      '/images/email/cart/offer-hero.png',
      '/images/email/photos/dropper.jpg',
      '/images/email/cart/questions-hero.png',
    ],
    card: [
      '/images/email/photos/man-lake-vial.jpg',
      '/images/email/cart/reminder-product.png',
      '/images/email/cart/educate-card.png',
      '/images/email/cart/questions-card.png',
    ],
  },
};

export function defaultStep(flow: FlowKey, step: StepNumber): FlowStep {
  const found = DEFAULT_STEPS[flow].find((s) => s.step === step)!;
  return { ...found, highlights: found.highlights.map((h) => ({ ...h })) };
}

/** A DB row (or partial) into a full step, with defaults for anything missing. */
export function shapeStepRow(flow: FlowKey, row: Partial<FlowStep> & { step: number }): FlowStep {
  const base = defaultStep(flow, isStepNumber(row.step) ? row.step : 1);
  const present = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined));
  const merged = { ...base, ...present, flow } as FlowStep;
  merged.promo_code = row.promo_code ?? null;
  merged.deadline_hours = row.deadline_hours == null ? ('deadline_hours' in row ? null : base.deadline_hours) : Number(row.deadline_hours);
  merged.highlights = Array.isArray(row.highlights) ? normalizeHighlights(row.highlights) : base.highlights;
  merged.delay_hours = Number(merged.delay_hours) || 0;
  merged.hero_overlay = row.hero_overlay ?? base.hero_overlay;
  merged.hero_text_tone = row.hero_text_tone === 'light' ? 'light' : row.hero_text_tone === 'dark' ? 'dark' : base.hero_text_tone;
  merged.hero_image_ratio = row.hero_image_ratio == null ? ('hero_image_ratio' in row ? null : base.hero_image_ratio) : Number(row.hero_image_ratio);
  const retired = RETIRED_IMAGES[flow];
  if (retired.hero.includes(merged.hero_image_url) && merged.hero_image_url !== base.hero_image_url) {
    merged.hero_image_url = base.hero_image_url;
    merged.hero_image_ratio = base.hero_image_ratio;
    merged.hero_overlay = base.hero_overlay;
    merged.hero_text_tone = base.hero_text_tone;
  }
  if (retired.card.includes(merged.card_image_url) && merged.card_image_url !== base.card_image_url) {
    merged.card_image_url = base.card_image_url;
  }
  return merged;
}

export function shapeSettingsRow(flow: FlowKey, row: Partial<FlowSettings> | null | undefined): FlowSettings {
  const present = Object.fromEntries(Object.entries(row ?? {}).filter(([, v]) => v !== null && v !== undefined));
  return { ...DEFAULT_SETTINGS[flow], ...present, flow } as FlowSettings;
}

export { FLOW_KEYS };
