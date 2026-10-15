/**
 * Email flows — every email of both flows, rendered.
 *
 * One function builds every email for both the real send (lib/email-flows/
 * engine.ts) and the admin's live preview (/api/admin/email-flows/[flow]/
 * preview), so what an admin approves is what goes out. Each step has a fixed
 * layout (FLOWS[flow].steps[n].layout) — five for the welcome series, five for
 * cart abandonment — built from the shared blocks below.
 *
 * Isomorphic and import-light on purpose: no server modules, so it can be
 * unit-tested directly.
 *
 * Email-client rules this follows, as the rest of the VYTA emails do:
 *   - table layout with a `width="600"` attribute so Outlook keeps the measure;
 *   - every layout table is role="presentation";
 *   - text is never baked into images, so a client blocking images still reads
 *     the offer, and the copy stays editable;
 *   - every href is http(s) — admin-typed values are checked before they land.
 */
import {
  CART_ONLY_TAGS,
  FLOWS,
  MERGE_TAGS,
  MISSING_CODE_MESSAGE,
  requiresCode,
  type CartLineView,
  type FlowSettings,
  type Highlight,
  type IconKey,
  type FlowStep,
  type StepLayout,
} from './types';
import { countdown, formatDeadline } from './schedule';

export interface ResolvedOffer {
  code: string;
  /** "20%" or "$10" — the code's real value, read at send time. */
  label: string;
}

export interface RenderContext {
  firstName: string | null;
  offer: ResolvedOffer | null;
  /** This send's per-recipient deadline (step.deadline_hours after sending), or null. */
  offerEndsAt: Date | null;
  now: Date;
  timezone: string;
  settings: Pick<FlowSettings, 'footer_address' | 'footer_disclaimer'>;
  /** Cart flow: the cart, and the links that restore it. */
  cart?: RenderCart | null;
  /** Origin that site-relative links and images are resolved against. */
  siteUrl: string;
  /** Wraps an absolute link in the click tracker. Absent in previews. */
  trackLink?: (url: string) => string;
  /** 1x1 open pixel. Absent in previews. */
  openPixelUrl?: string | null;
  /** This email on the web — the header's "View in browser". Absent in previews. */
  viewUrl?: string | null;
  unsubscribeUrl: string | null;
}

export interface RenderCart {
  lines: CartLineView[];
  /** Restores the cart. */
  cartUrl: string;
  /** Restores the cart and goes straight to checkout, with the code applied. */
  checkoutUrl: string;
}

export interface RenderedEmail {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

const T = {
  font: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`,
  display: `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif`,
  paper: '#EDF3F5',
  card: '#FFFFFF',
  navy: '#05182B',
  button: '#0A2A4A',
  ink: '#07203A',
  body: '#33505F',
  muted: '#56707F',
  faint: '#6E8898',
  border: '#DCE7EB',
  panel: '#F1F6F9',
  teal: '#438B9E',
  tealLight: '#C4DFE3',
  urgent: '#C8102E',
  urgentSoft: '#FDECEE',
  radius: '14px',
} as const;

export function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Merge tags
// ---------------------------------------------------------------------------

export { MERGE_TAGS };

export function mergeTags(
  text: string,
  ctx: Pick<RenderContext, 'firstName' | 'offer' | 'offerEndsAt' | 'timezone'> & { cart?: RenderCart | null },
): string {
  const first = String(ctx.firstName ?? '').trim();
  const values: Record<string, string> = {
    first_name: first || 'there',
    code: ctx.offer?.code ?? '',
    discount: ctx.offer?.label ?? '',
    offer_ends: ctx.offerEndsAt ? formatDeadline(ctx.offerEndsAt, ctx.timezone) : '',
    cart_url: ctx.cart?.cartUrl ?? '',
    checkout_url: ctx.cart?.checkoutUrl ?? '',
  };
  let out = String(text ?? '');
  // With no name, "Welcome to VYTA, {{first_name}}" becomes "Welcome to VYTA"
  // rather than "Welcome to VYTA, there"; elsewhere the tag reads "there".
  if (!first) out = out.replace(/,\s*\{\{\s*first_name\s*\}\}(?=\s*[!?.]?\s*$)/g, '');
  return out.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key: string) => (key in values ? values[key] : whole));
}

/**
 * Copy that needs a code the step does not have. Shown in the editor, so an
 * admin who clears the code sees that "{{discount}} OFF" will print as " OFF".
 */
export function mergeTagProblems(step: FlowStep): string[] {
  const fields = [step.subject, step.preheader, step.eyebrow, step.headline, step.subheadline, step.body,
    step.cta_label, step.cta_url, step.card_title, step.card_body, step.card_link_url, step.cart_title,
    step.cart_body, step.fine_print, ...step.highlights.map((h) => h.label)].join('\n');
  const problems: string[] = [];
  if (!step.promo_code && step.enabled && requiresCode(step.flow, step.step)) {
    problems.push(`${MISSING_CODE_MESSAGE} Until you do, this email is on hold.`);
  } else if (!step.promo_code && /\{\{\s*(code|discount)\s*\}\}/.test(fields)) {
    problems.push('The copy uses {{code}} or {{discount}} but this email has no discount code — they would print blank.');
  }
  if (!step.deadline_hours && /\{\{\s*offer_ends\s*\}\}/.test(fields)) {
    problems.push('{{offer_ends}} needs an offer deadline on this email — it would print blank.');
  }
  if (step.flow !== 'cart') {
    const cartTags = (CART_ONLY_TAGS as readonly string[]).filter((t) => new RegExp(`\\{\\{\\s*${t}\\s*\\}\\}`).test(fields));
    if (cartTags.length) problems.push(`${cartTags.map((t) => `{{${t}}}`).join(', ')} only work in the cart abandonment flow.`);
  }
  const unknown = [...fields.matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
    .map((m) => m[1])
    .filter((k) => !(MERGE_TAGS as readonly string[]).includes(k));
  if (unknown.length) problems.push(`Unknown merge tag${unknown.length > 1 ? 's' : ''}: ${[...new Set(unknown)].map((k) => `{{${k}}}`).join(', ')}`);
  return problems;
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/** Resolve a site-relative path; refuse anything but http(s). */
export function absoluteUrl(url: string, siteUrl: string): string | null {
  const u = String(url ?? '').trim();
  if (!u) return null;
  if (u.startsWith('/') && !u.startsWith('//')) return `${siteUrl.replace(/\/$/, '')}${u}`;
  return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : null;
}

/** Tag links back to our own site so the analytics can see the flow's traffic. */
export function withUtm(url: string, siteUrl: string, step: number, flow: string = 'welcome'): string {
  try {
    const target = new URL(url);
    const site = new URL(siteUrl);
    if (target.hostname.replace(/^www\./, '') !== site.hostname.replace(/^www\./, '')) return url;
    if (!target.searchParams.has('utm_source')) {
      target.searchParams.set('utm_source', `${flow}_flow`);
      target.searchParams.set('utm_medium', 'email');
      target.searchParams.set('utm_campaign', `${flow}_${step}`);
    }
    return target.toString();
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

interface Kit {
  ctx: RenderContext;
  step: FlowStep;
  /** Set by coverHero: the cover's height ÷ width, for the phone-width rule in <head>. */
  coverRatio?: number;
  /** Set by coverHero: the photo to lighten on phones, where the copy runs over the subject. */
  coverWash?: { src: string; from: 'left' | 'top' };
  m: (s: string) => string;
  href: (url: string) => string | null;
  img: (url: string) => string | null;
}

function paragraphs(text: string, color: string = T.body, align = 'left'): string {
  return String(text ?? '')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map(
      (b) =>
        `<p style="font-family: ${T.font}; font-size: 15px; line-height: 1.7; color: ${color}; margin: 0 0 14px; text-align: ${align};">${escapeHtml(b).replace(/\n/g, '<br />')}</p>`,
    )
    .join('');
}

function button(k: Kit, label: string, url: string, opts: { light?: boolean; urgent?: boolean; align?: 'left' | 'center' } = {}): string {
  const href = k.href(url);
  const text = k.m(label);
  if (!href || !text) return '';
  const bg = opts.light ? '#FFFFFF' : opts.urgent ? T.urgent : T.button;
  const fg = opts.light ? T.ink : '#FFFFFF';
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${opts.align ?? 'center'}" style="margin: ${opts.align === 'left' ? '6px 0 4px' : '6px auto 4px'};">
      <tr>
        <td align="center" bgcolor="${bg}" style="border-radius: 8px; background: ${bg};">
          <a href="${escapeHtml(href)}" style="display: inline-block; padding: 14px 34px; font-family: ${T.font}; font-size: 12px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: ${fg}; text-decoration: none; border-radius: 8px;">${escapeHtml(text)} &nbsp;&rarr;</a>
        </td>
      </tr>
    </table>`;
}

function image(k: Kit, url: string, alt: string, opts: { radius?: string } = {}): string {
  const src = k.img(url);
  if (!src) return '';
  return `<img src="${escapeHtml(src)}" width="600" alt="${escapeHtml(alt)}" style="display: block; width: 100%; max-width: 600px; height: auto; border: 0; ${opts.radius ? `border-radius: ${opts.radius};` : ''}" />`;
}

const iconSrc = (k: Kit, icon: IconKey, dark: boolean) =>
  `${k.ctx.siteUrl.replace(/\/$/, '')}/images/email/icons/${icon}-${dark ? 'white' : 'navy'}.png`;

/** Badge row — up to four columns, each its own icon over a small-caps label. */
function badges(k: Kit, items: Highlight[], dark = false): string {
  const list = items.map((h) => ({ ...h, label: k.m(h.label) })).filter((h) => h.label).slice(0, 4);
  if (!list.length) return '';
  const width = Math.floor(100 / list.length);
  const cells = list
    .map(
      (h) => `
        <td width="${width}%" align="center" valign="top" style="padding: 0 6px;">
          <img src="${escapeHtml(iconSrc(k, h.icon, dark))}" width="26" height="26" alt="" style="display: block; margin: 0 auto 8px; border: 0;" />
          <p style="font-family: ${T.font}; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; line-height: 1.4; color: ${dark ? '#FFFFFF' : T.ink}; margin: 0;">${escapeHtml(h.label)}</p>
        </td>`,
    )
    .join('');
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>${cells}</tr>
    </table>`;
}

/** Vertical benefit list — each icon in a hairline circle, as in the designs. */
function checklist(k: Kit, items: Highlight[]): string {
  const list = items.map((h) => ({ ...h, label: k.m(h.label) })).filter((h) => h.label);
  if (!list.length) return '';
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 8px;">
      ${list
        .map(
          (h) => `
        <tr>
          <td valign="middle" style="padding: 6px 14px 6px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse: separate;">
              <tr><td align="center" valign="middle" width="38" height="38" style="width: 38px; height: 38px; border: 1px solid ${T.border}; border-radius: 19px; background: #FFFFFF;">
                <img src="${escapeHtml(iconSrc(k, h.icon, false))}" width="20" height="20" alt="" style="display: block; margin: 0 auto; border: 0;" />
              </td></tr>
            </table>
          </td>
          <td valign="middle" style="padding: 6px 0; font-family: ${T.font}; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${T.ink};">${escapeHtml(h.label)}</td>
        </tr>`,
        )
        .join('')}
    </table>`;
}

/** Side-by-side panel: copy on one side, a picture on the other. */
function card(k: Kit, opts: { imageLeft?: boolean; showCode?: boolean } = {}): string {
  const s = k.step;
  const title = k.m(s.card_title);
  const body = k.m(s.card_body);
  if (!title && !body) return '';
  const linkHref = s.card_link_label ? k.href(s.card_link_url) : null;
  const src = k.img(s.card_image_url);
  // The code as a chip — unless the card's own copy already names it.
  const code =
    opts.showCode && k.ctx.offer && !`${title} ${body}`.includes(k.ctx.offer.code)
      ? `<p style="font-family: ${T.font}; font-size: 13px; color: ${T.body}; margin: 10px 0 0;">Code: <span style="font-family: 'SFMono-Regular', Menlo, Consolas, monospace; font-weight: 700; letter-spacing: 0.08em; color: ${T.ink}; background: #FFFFFF; border: 1px dashed ${T.teal}; padding: 3px 8px; border-radius: 4px;">${escapeHtml(k.ctx.offer.code)}</span></p>`
      : '';
  const copy = `
    <td valign="middle" style="padding: 22px 20px;">
      ${title ? `<p style="font-family: ${T.display}; font-size: 21px; font-weight: 700; line-height: 1.25; color: ${T.ink}; margin: 0 0 8px;">${escapeHtml(title)}</p>` : ''}
      ${body ? `<p style="font-family: ${T.font}; font-size: 13px; line-height: 1.6; color: ${T.body}; margin: 0;">${escapeHtml(body)}</p>` : ''}
      ${code}
      ${linkHref ? `<p style="margin: 12px 0 0;"><a href="${escapeHtml(linkHref)}" style="font-family: ${T.font}; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: ${T.ink}; text-decoration: none;">${escapeHtml(k.m(s.card_link_label))} &rarr;</a></p>` : ''}
    </td>`;
  const pic = src
    ? `<td width="44%" valign="middle" style="padding: 0;"><img src="${escapeHtml(src)}" width="240" alt="" style="display: block; width: 100%; height: auto; border: 0;" /></td>`
    : '';
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: ${T.panel}; border-radius: 10px; border-collapse: separate; overflow: hidden;">
      <tr>${opts.imageLeft ? pic + copy : copy + pic}</tr>
    </table>`;
}

function headlineBlock(k: Kit, align: 'left' | 'center' = 'left', size = 30): string {
  const s = k.step;
  const eyebrow = k.m(s.eyebrow);
  const headline = k.m(s.headline);
  const sub = k.m(s.subheadline);
  return `
    ${eyebrow ? `<p style="font-family: ${T.font}; font-size: 11px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: ${T.teal}; margin: 0 0 10px; text-align: ${align};">${escapeHtml(eyebrow)}</p>` : ''}
    ${headline ? `<h1 style="font-family: ${T.display}; font-size: ${size}px; font-weight: 700; line-height: 1.15; color: ${T.ink}; margin: 0 0 10px; text-align: ${align};">${escapeHtml(headline)}</h1>` : ''}
    ${sub ? `<p style="font-family: ${T.font}; font-size: 15px; line-height: 1.6; color: ${T.muted}; margin: 0 0 6px; text-align: ${align};">${escapeHtml(sub)}</p>` : ''}`;
}

const pad = (inner: string, p = '28px 32px') => (inner.trim() ? `<tr><td style="padding: ${p};">${inner}</td></tr>` : '');

// ---------------------------------------------------------------------------
// Layouts — one per email in the series
// ---------------------------------------------------------------------------

/**
 * Text over the main image — the covers in the designs.
 *
 * The photo is the cell's background image, sized to keep its own shape
 * (`hero_image_ratio`), with the text set inside it:
 *   - Gmail, Apple Mail, Outlook.com and new Outlook read the CSS background;
 *   - classic Outlook for Windows gets the same photo through VML;
 *   - anything that shows neither gets a solid fallback the text still reads on.
 * On phones a media query (in <head>) scales the height with the width, so a
 * tall cover isn't cropped down to a sliver.
 */
function coverHero(k: Kit, inner: string, opts: { valign?: 'top' | 'bottom'; padding?: string; phoneWash?: 'left' | 'top' } = {}): string {
  const s = k.step;
  const src = k.img(s.hero_image_url);
  const ratio = s.hero_image_ratio && s.hero_image_ratio > 0 ? s.hero_image_ratio : 0.6;
  const h = Math.round(600 * ratio);
  const fallback = s.hero_text_tone === 'light' ? T.navy : '#DCE9F1';
  const valign = opts.valign ?? 'top';
  k.coverRatio = ratio;
  if (opts.phoneWash && src) k.coverWash = { src, from: opts.phoneWash };
  const bg = src
    ? `background="${escapeHtml(src)}" style="background-color: ${fallback}; background-image: url('${escapeHtml(src)}'); background-size: cover; background-position: center top; background-repeat: no-repeat; height: ${h}px;"`
    : `style="background-color: ${fallback}; height: ${h}px;"`;
  return `<tr><td class="ef-cover${opts.phoneWash && src ? ' ef-cover-wash' : ''}" ${bg} bgcolor="${fallback}" height="${h}" valign="${valign}">
    <!--[if gte mso 9]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;height:${h}px;"><v:fill type="frame"${src ? ` src="${escapeHtml(src)}"` : ''} color="${fallback}" /><v:textbox inset="0,0,0,0"><![endif]-->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td valign="${valign}" style="padding: ${opts.padding ?? '36px 32px'};">${inner}</td></tr>
    </table>
    <!--[if gte mso 9]></v:textbox></v:rect><![endif]-->
  </td></tr>`;
}

/** Colours for text set over a photo, by the step's tone. */
function overlayTone(k: Kit) {
  const light = k.step.hero_text_tone === 'light';
  return {
    heading: light ? '#FFFFFF' : T.ink,
    body: light ? '#FFFFFF' : '#1E3A50',
    eyebrow: light ? T.tealLight : T.teal,
    // A soft glow behind the letters keeps them legible over a busy sky.
    shadow: light ? 'text-shadow: 0 1px 14px rgba(5,24,43,0.55);' : 'text-shadow: 0 0 16px rgba(255,255,255,0.9), 0 0 3px rgba(255,255,255,0.8);',
    word: light ? 'vyta-word-white.png' : 'vyta-word-navy.png',
  };
}

/** Eyebrow, headline and subheadline, coloured for the photo they sit on. */
function overlayHeadline(k: Kit, align: 'left' | 'center' = 'left', size = 32): string {
  const s = k.step;
  const c = overlayTone(k);
  const eyebrow = k.m(s.eyebrow);
  const headline = k.m(s.headline);
  const sub = k.m(s.subheadline);
  return `
    ${eyebrow ? `<p style="font-family: ${T.font}; font-size: 11px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: ${c.eyebrow}; margin: 0 0 10px; text-align: ${align}; ${c.shadow}">${escapeHtml(eyebrow)}</p>` : ''}
    ${headline ? `<h1 style="font-family: ${T.display}; font-size: ${size}px; font-weight: 700; line-height: 1.12; color: ${c.heading}; margin: 0 0 10px; text-align: ${align}; ${c.shadow}">${escapeHtml(headline)}</h1>` : ''}
    ${sub ? `<p style="font-family: ${T.font}; font-size: 16px; font-weight: 500; line-height: 1.5; color: ${c.body}; margin: 0; text-align: ${align}; ${c.shadow}">${escapeHtml(sub)}</p>` : ''}`;
}

/** Left-set overlay text keeps to the side of the photo the subject isn't on. */
const narrow = (inner: string, width = 360) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${width}" style="width: ${width}px; max-width: 100%;"><tr><td>${inner}</td></tr></table>`;

/** Does this step set its text over the main image? */
const overlaid = (k: Kit) => k.step.hero_overlay && !!k.img(k.step.hero_image_url);

/**
 * The welcome title, as designed: "Welcome to" with VYTA in the brand
 * wordmark rather than typed. A headline that doesn't end in "VYTA" is set as
 * plain text.
 */
function welcomeTitle(k: Kit): string {
  const s = k.step;
  const c = overlayTone(k);
  const headline = k.m(s.headline);
  const sub = k.m(s.subheadline);
  const word = `${k.ctx.siteUrl.replace(/\/$/, '')}/images/email/${c.word}`;
  const brand = /^(.*?)\s*VYTA\s*$/i.exec(headline);
  const title = brand
    ? `${brand[1] ? `<p style="font-family: ${T.display}; font-size: 30px; font-weight: 600; line-height: 1.15; color: ${c.heading}; margin: 0 0 10px; ${c.shadow}">${escapeHtml(brand[1])}</p>` : ''}
       <img src="${escapeHtml(word)}" width="210" alt="VYTA" style="display: block; width: 210px; height: auto; border: 0; font-family: ${T.display}; font-size: 40px; font-weight: 700; color: ${c.heading};" />`
    : `<h1 style="font-family: ${T.display}; font-size: 34px; font-weight: 700; line-height: 1.15; color: ${c.heading}; margin: 0; ${c.shadow}">${escapeHtml(headline)}</h1>`;
  return `${title}
    ${sub ? `<p style="font-family: ${T.font}; font-size: 16px; font-weight: 500; line-height: 1.5; color: ${c.body}; margin: 14px 0 0; max-width: 300px; ${c.shadow}">${escapeHtml(sub)}</p>` : ''}`;
}

function welcomeLayout(k: Kit): string {
  const s = k.step;
  // White text sits low, on the darker ground; navy text sits high, on the sky.
  const low = s.hero_text_tone === 'light';
  return [
    overlaid(k)
      ? coverHero(k, welcomeTitle(k), low ? { valign: 'bottom', padding: '0 32px 34px' } : { valign: 'top', padding: '34px 32px 0', phoneWash: 'left' })
      : pad(headlineBlock(k, 'left', 32), '28px 32px 8px'),
    pad(badges(k, s.highlights), '24px 20px 14px'),
    pad(paragraphs(k.m(s.body)) + button(k, s.cta_label, s.cta_url), '10px 32px 24px'),
    pad(card(k, { showCode: true }), '0 20px 24px'),
  ].join('');
}

/** Headline over the photo, or headline then photo — the step decides. */
function heroWithHeadline(k: Kit, size = 30): string {
  const s = k.step;
  if (overlaid(k)) return coverHero(k, narrow(overlayHeadline(k, 'left', size + 2)));
  return [
    pad(headlineBlock(k, 'left', size), '32px 32px 18px'),
    `<tr><td style="padding: 0;">${image(k, s.hero_image_url, k.m(s.headline))}</td></tr>`,
  ].join('');
}

function educationLayout(k: Kit): string {
  const s = k.step;
  if (overlaid(k)) {
    // As designed: the headline, the benefits and the button all over the
    // photo, down its left side, the subject on the right.
    return [
      coverHero(
        k,
        narrow(
          overlayHeadline(k, 'left', 30) +
            `<div style="height: 22px; line-height: 22px; font-size: 0;">&nbsp;</div>` +
            checklist(k, s.highlights) +
            paragraphs(k.m(s.body), overlayTone(k).body) +
            button(k, s.cta_label, s.cta_url, { align: 'left' }),
          290,
        ),
        { padding: '36px 32px 32px', phoneWash: k.step.hero_text_tone === 'light' ? undefined : 'left' },
      ),
      pad(card(k, { imageLeft: true }), '24px 20px 24px'),
    ].join('');
  }
  return [
    heroWithHeadline(k),
    pad(checklist(k, s.highlights) + paragraphs(k.m(s.body)) + button(k, s.cta_label, s.cta_url), '24px 32px 24px'),
    pad(card(k, { imageLeft: true }), '0 20px 24px'),
  ].join('');
}

function trustLayout(k: Kit): string {
  const s = k.step;
  return [
    heroWithHeadline(k),
    pad(badges(k, s.highlights), '22px 20px 10px'),
    pad(paragraphs(k.m(s.body)) + button(k, s.cta_label, s.cta_url), '14px 32px 24px'),
    pad(card(k, { imageLeft: true }), '0 20px 24px'),
  ].join('');
}

function offerLayout(k: Kit): string {
  const s = k.step;
  const eyebrow = k.m(s.eyebrow);
  const headline = k.m(s.headline);
  const sub = k.m(s.subheadline);
  const code = k.ctx.offer
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 18px auto 0;">
         <tr><td style="border: 1px solid #FFFFFF; border-radius: 4px; padding: 10px 26px; font-family: ${T.font}; font-size: 15px; color: #FFFFFF;">Use Code: <strong style="letter-spacing: 0.08em;">${escapeHtml(k.ctx.offer.code)}</strong></td></tr>
       </table>`
    : '';
  const fine = k.m(s.fine_print);
  return [
    `<tr><td bgcolor="${T.navy}" style="background: ${T.navy}; padding: 36px 28px 30px; text-align: center;">
      ${eyebrow ? `<p style="font-family: ${T.font}; font-size: 11px; font-weight: 600; letter-spacing: 0.24em; text-transform: uppercase; color: ${T.tealLight}; margin: 0 0 14px;">${escapeHtml(eyebrow)}</p>` : ''}
      ${headline ? `<h1 style="font-family: ${T.display}; font-size: 56px; font-weight: 800; line-height: 1; letter-spacing: -0.01em; color: #FFFFFF; margin: 0 0 8px;">${escapeHtml(headline)}</h1>` : ''}
      ${sub ? `<p style="font-family: ${T.display}; font-size: 22px; font-weight: 600; color: #FFFFFF; margin: 0 0 14px;">${escapeHtml(sub)}</p>` : ''}
      ${paragraphs(k.m(s.body), '#D6E4EA', 'center')}
      ${code}
    </td></tr>`,
    `<tr><td bgcolor="${T.navy}" style="background: ${T.navy}; padding: 0;">${image(k, s.hero_image_url, sub || headline)}</td></tr>`,
    pad(badges(k, s.highlights), '24px 20px 12px'),
    pad(
      button(k, s.cta_label, s.cta_url) +
        (fine ? `<p style="font-family: ${T.font}; font-size: 11px; color: ${T.faint}; text-align: center; margin: 14px 0 0;">${escapeHtml(fine)}</p>` : ''),
      '10px 32px 28px',
    ),
  ].join('');
}

/** Days / hours / minutes boxes and the deadline in words — or nothing without a deadline. */
function countdownBlock(k: Kit, label = 'Offer ends'): string {
  const ends = k.ctx.offerEndsAt;
  if (!ends) return '';
  const left = countdown(k.ctx.now, ends);
  const box = (n: number, unit: string) => `
    <td align="center" style="padding: 0 5px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border: 1px solid ${T.border}; border-radius: 6px; border-collapse: separate; background: #FFFFFF;">
        <tr><td align="center" style="width: 64px; padding: 10px 0 8px;">
          <p style="font-family: ${T.display}; font-size: 26px; font-weight: 700; color: ${T.ink}; margin: 0; line-height: 1;">${String(n).padStart(2, '0')}</p>
          <p style="font-family: ${T.font}; font-size: 9px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: ${T.faint}; margin: 6px 0 0;">${unit}</p>
        </td></tr>
      </table>
    </td>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 6px auto 8px;">
         <tr>${box(left.days, 'Days')}${box(left.hours, 'Hours')}${box(left.minutes, 'Minutes')}</tr>
       </table>
       <p style="font-family: ${T.font}; font-size: 12px; font-weight: 500; color: ${T.body}; text-align: center; margin: 0 0 18px; text-shadow: 0 0 10px rgba(255,255,255,0.9);">${escapeHtml(label)} ${escapeHtml(formatDeadline(ends, k.ctx.timezone))}</p>`;
}

const finePrint = (k: Kit, pad_ = '14px 32px 0') => {
  const fine = k.m(k.step.fine_print);
  return fine ? pad(`<p style="font-family: ${T.font}; font-size: 11px; color: ${T.faint}; text-align: center; margin: 0;">${escapeHtml(fine)}</p>`, pad_) : '';
};

function reminderLayout(k: Kit): string {
  const s = k.step;
  const codeLine = k.ctx.offer
    ? `<p style="font-family: ${T.font}; font-size: 12px; color: ${T.body}; text-align: center; margin: 12px 0 0; text-shadow: 0 0 10px rgba(255,255,255,0.9);">Use code <strong style="color: ${T.ink}; letter-spacing: 0.06em;">${escapeHtml(k.ctx.offer.code)}</strong> at checkout.</p>`
    : '';
  if (overlaid(k)) {
    // As designed: the question, the countdown and the button over the sky,
    // the product below them.
    const c = overlayTone(k);
    return [
      coverHero(
        k,
        overlayHeadline(k, 'center', 30) +
          (s.body ? `<p style="font-family: ${T.font}; font-size: 15px; line-height: 1.6; color: ${c.body}; text-align: center; margin: 12px 0 18px; ${c.shadow}">${escapeHtml(k.m(s.body))}</p>` : '') +
          countdownBlock(k) +
          button(k, s.cta_label, s.cta_url) +
          codeLine,
        { padding: '40px 36px', phoneWash: k.step.hero_text_tone === 'light' ? undefined : 'top' },
      ),
      `<tr><td bgcolor="${T.navy}" style="background: ${T.navy}; padding: 22px 20px;">${badges(k, s.highlights, true)}</td></tr>`,
      finePrint(k),
    ].join('');
  }
  return [
    pad(headlineBlock(k, 'center', 28) + paragraphs(k.m(s.body), T.body, 'center'), '34px 36px 10px'),
    pad(countdownBlock(k) + button(k, s.cta_label, s.cta_url) + codeLine, '4px 32px 26px'),
    `<tr><td style="padding: 0;">${image(k, s.hero_image_url, k.m(s.headline))}</td></tr>`,
    `<tr><td bgcolor="${T.navy}" style="background: ${T.navy}; padding: 22px 20px;">${badges(k, s.highlights, true)}</td></tr>`,
    finePrint(k),
  ].join('');
}

// ---------------------------------------------------------------------------
// Cart abandonment
// ---------------------------------------------------------------------------

/**
 * What's in the cart: picture, name, pack and quantity, read from `products`
 * at send time. No prices — the checkout reprices every order (customer
 * pricing, currency, offers), and an email quoting a different figure from the
 * page it links to costs more trust than it earns.
 */
function cartLines(k: Kit): string {
  const lines = k.ctx.cart?.lines ?? [];
  if (!lines.length) return '';
  const shown = lines.slice(0, 4);
  const more = lines.length - shown.length;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 4px 0 6px;">
      ${shown
        .map((l) => {
          const src = l.imageUrl ? k.img(l.imageUrl) : null;
          return `
        <tr>
          <td width="64" valign="middle" style="padding: 8px 12px 8px 0; border-bottom: 1px solid ${T.border};">
            ${src ? `<img src="${escapeHtml(src)}" width="56" height="56" alt="" style="display: block; width: 56px; height: 56px; object-fit: cover; border-radius: 8px; border: 1px solid ${T.border}; background: #FFFFFF;" />` : ''}
          </td>
          <td valign="middle" style="padding: 8px 0; border-bottom: 1px solid ${T.border}; font-family: ${T.font};">
            <p style="font-size: 14px; font-weight: 600; color: ${T.ink}; margin: 0;">${escapeHtml(l.name)}</p>
            <p style="font-size: 12px; color: ${T.muted}; margin: 2px 0 0;">${escapeHtml(l.packLabel)}</p>
          </td>
          <td align="right" valign="middle" style="padding: 8px 0 8px 12px; border-bottom: 1px solid ${T.border}; font-family: ${T.font}; font-size: 13px; color: ${T.ink}; white-space: nowrap;">× ${l.quantity}</td>
        </tr>`;
        })
        .join('')}
    </table>
    ${more > 0 ? `<p style="font-family: ${T.font}; font-size: 12px; color: ${T.muted}; margin: 0 0 6px;">+ ${more} more item${more === 1 ? '' : 's'}</p>` : ''}`;
}

/** The "your cart is waiting" panel: heading, a line, the items, the button. */
function cartPanel(k: Kit, opts: { center?: boolean; urgent?: boolean } = {}): string {
  const s = k.step;
  if (!s.show_cart) return '';
  const title = k.m(s.cart_title);
  const body = k.m(s.cart_body);
  const align = opts.center ? 'center' : 'left';
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: ${T.panel}; border-radius: 10px; border-collapse: separate;">
      <tr><td style="padding: 20px 22px;">
        ${title ? `<p style="font-family: ${T.display}; font-size: 18px; font-weight: 700; color: ${T.ink}; margin: 0 0 4px; text-align: ${align};">${escapeHtml(title)}</p>` : ''}
        ${body ? `<p style="font-family: ${T.font}; font-size: 13px; line-height: 1.6; color: ${T.body}; margin: 0 0 10px; text-align: ${align};">${escapeHtml(body)}</p>` : ''}
        ${cartLines(k)}
        ${button(k, s.cta_label, s.cta_url, { urgent: opts.urgent })}
      </td></tr>
    </table>`;
}

function cartReminderLayout(k: Kit): string {
  const s = k.step;
  const product = k.img(s.card_image_url);
  const intro = paragraphs(k.m(s.body)) + (s.show_cart ? '' : button(k, s.cta_label, s.cta_url));
  return [
    ...(overlaid(k)
      ? [coverHero(k, narrow(overlayHeadline(k, 'left', 34))), pad(intro, '26px 32px 4px')]
      : [
          `<tr><td style="padding: 0;">${image(k, s.hero_image_url, k.m(s.headline))}</td></tr>`,
          pad(headlineBlock(k, 'left', 32) + intro, '28px 32px 8px'),
        ]),
    s.show_cart ? pad(cartPanel(k), '8px 20px 20px') : '',
    pad(badges(k, s.highlights), '6px 20px 22px'),
    product ? `<tr><td style="padding: 0;"><img src="${escapeHtml(product)}" width="600" alt="" style="display: block; width: 100%; max-width: 600px; height: auto; border: 0;" /></td></tr>` : '',
  ].join('');
}

function cartEducateLayout(k: Kit): string {
  const s = k.step;
  return [
    heroWithHeadline(k),
    pad(checklist(k, s.highlights) + paragraphs(k.m(s.body)), '24px 32px 8px'),
    pad(s.show_cart ? cartPanel(k, { center: true }) : button(k, s.cta_label, s.cta_url), '4px 20px 20px'),
    pad(card(k, { imageLeft: true }), '0 20px 24px'),
  ].join('');
}

function cartQuestionsLayout(k: Kit): string {
  const s = k.step;
  return [
    heroWithHeadline(k),
    pad(checklist(k, s.highlights) + paragraphs(k.m(s.body)), '24px 32px 8px'),
    pad(s.show_cart ? cartPanel(k, { center: true }) : button(k, s.cta_label, s.cta_url), '4px 20px 20px'),
    pad(card(k, { imageLeft: true }), '0 20px 24px'),
  ].join('');
}

function cartLastChanceLayout(k: Kit): string {
  const s = k.step;
  const eyebrow = k.m(s.eyebrow);
  return [
    eyebrow
      ? `<tr><td align="center" bgcolor="${T.urgentSoft}" style="background: ${T.urgentSoft}; padding: 12px 24px; font-family: ${T.font}; font-size: 12px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: ${T.urgent};">${escapeHtml(eyebrow)}</td></tr>`
      : '',
    ...(overlaid(k)
      ? [
          // As designed: the headline and countdown over the photo, the cart below.
          coverHero(
            k,
            `${s.headline ? `<h1 style="font-family: ${T.display}; font-size: 32px; font-weight: 700; line-height: 1.12; color: ${overlayTone(k).heading}; margin: 0 0 12px; text-align: center; ${overlayTone(k).shadow}">${escapeHtml(k.m(s.headline))}</h1>` : ''}` +
              (s.body ? `<p style="font-family: ${T.font}; font-size: 16px; line-height: 1.6; color: ${overlayTone(k).body}; text-align: center; margin: 0 0 16px; ${overlayTone(k).shadow}">${escapeHtml(k.m(s.body))}</p>` : '') +
              countdownBlock(k, 'Ends') +
              (s.show_cart ? '' : button(k, s.cta_label, s.cta_url, { urgent: true })),
            { padding: '34px 36px' },
          ),
          s.show_cart ? pad(cartPanel(k, { urgent: true }), '22px 20px 22px') : '',
        ]
      : [
          pad(
            `${s.headline ? `<h1 style="font-family: ${T.display}; font-size: 32px; font-weight: 700; line-height: 1.15; color: ${T.ink}; margin: 0 0 12px; text-align: center;">${escapeHtml(k.m(s.headline))}</h1>` : ''}` +
              paragraphs(k.m(s.body), T.body, 'center') +
              countdownBlock(k, 'Ends') +
              (s.show_cart ? '' : button(k, s.cta_label, s.cta_url, { urgent: true })),
            '30px 36px 10px',
          ),
          s.show_cart ? pad(cartPanel(k, { urgent: true }), '0 20px 22px') : '',
          `<tr><td style="padding: 0;">${image(k, s.hero_image_url, k.m(s.headline))}</td></tr>`,
        ]),
    pad(badges(k, s.highlights), '22px 20px 12px'),
    finePrint(k, '6px 32px 0'),
  ].join('');
}

const LAYOUTS: Record<StepLayout, (k: Kit) => string> = {
  welcome: welcomeLayout,
  education: educationLayout,
  trust: trustLayout,
  offer: offerLayout,
  reminder: reminderLayout,
  cart_reminder: cartReminderLayout,
  cart_educate: cartEducateLayout,
  // The offer email is the same design in both flows.
  cart_offer: offerLayout,
  cart_questions: cartQuestionsLayout,
  cart_last_chance: cartLastChanceLayout,
};

// ---------------------------------------------------------------------------
// The email
// ---------------------------------------------------------------------------

export function renderFlowEmail(step: FlowStep, ctx: RenderContext): RenderedEmail {
  const m = (s: string) => mergeTags(s, ctx);
  const href = (url: string) => {
    const abs = absoluteUrl(m(url), ctx.siteUrl);
    if (!abs) return null;
    const tagged = withUtm(abs, ctx.siteUrl, step.step, step.flow);
    return ctx.trackLink ? ctx.trackLink(tagged) : tagged;
  };
  const img = (url: string) => absoluteUrl(url, ctx.siteUrl);
  const k: Kit = { ctx, step, m, href, img };

  const subject = m(step.subject).replace(/\s+/g, ' ').trim();
  const preheader = m(step.preheader).trim();
  const site = ctx.siteUrl.replace(/\/$/, '');
  const home = href('/') ?? site;
  // The horizontal lockup from the designs: the V mark beside the wordmark.
  const logo = `${site}/images/email/vyta-lockup.png`;
  const viewLink = ctx.viewUrl
    ? `<a href="${escapeHtml(ctx.viewUrl)}" style="font-family: ${T.font}; font-size: 10px; color: ${T.faint}; text-decoration: underline;">View in browser</a>`
    : '';
  const content = LAYOUTS[FLOWS[step.flow].steps[step.step].layout](k);

  const footerLines = [
    ctx.settings.footer_disclaimer ? escapeHtml(ctx.settings.footer_disclaimer) : '',
    step.flow === 'cart'
      ? `You're receiving this because you left items in your cart at VYTA.`
      : `You're receiving this because you created a VYTA account and agreed to hear from us.`,
    ctx.settings.footer_address ? `VYTA Biosciences · ${escapeHtml(ctx.settings.footer_address)}` : 'VYTA Biosciences · Canada',
  ].filter(Boolean);

  const html = `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>${escapeHtml(subject)}</title>
${k.coverRatio ? `<style>
  /* Phones: the cover keeps its shape instead of being cropped to a strip. */
  @media only screen and (max-width: 620px) {
    .ef-cover { height: calc((100vw - 22px) * ${k.coverRatio}) !important; }${k.coverWash ? `
    /* The copy runs over the subject at this width: lighten the photo behind it. */
    .ef-cover-wash { background-image: ${k.coverWash.from === 'left'
      ? 'linear-gradient(90deg, rgba(255,255,255,0.78), rgba(255,255,255,0.55) 70%, rgba(255,255,255,0.2))'
      : 'linear-gradient(180deg, rgba(255,255,255,0.7), rgba(255,255,255,0.5) 80%, rgba(255,255,255,0))'}, url('${escapeHtml(k.coverWash.src)}') !important; }` : ''}
  }
</style>` : ''}
</head>
<body style="margin: 0; padding: 0; background: ${T.paper};">
${preheader ? `<div style="display: none; max-height: 0; overflow: hidden; mso-hide: all; font-size: 1px; line-height: 1px; color: ${T.paper};">${escapeHtml(preheader)}${'&#847; &zwnj; &nbsp; '.repeat(20)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; background: ${T.paper};">
  <tr>
    <td align="center" style="padding: 28px 10px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 600px; border-collapse: separate; background: ${T.card}; border: 1px solid ${T.border}; border-radius: ${T.radius}; overflow: hidden;">
        <tr>
          <td style="padding: 18px 20px 16px; border-bottom: 1px solid ${T.border};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="25%">&nbsp;</td>
                <td width="50%" align="center">
                  <a href="${escapeHtml(home)}" style="text-decoration: none;"><img src="${escapeHtml(logo)}" width="166" alt="VYTA Biosciences" style="display: block; width: 166px; height: auto; margin: 0 auto; border: 0; font-family: ${T.display}; font-size: 20px; letter-spacing: 0.3em; color: ${T.ink};" /></a>
                </td>
                <td width="25%" align="right" valign="top">${viewLink}</td>
              </tr>
            </table>
          </td>
        </tr>
        ${content}
        <tr><td style="padding: 0 0 8px;"></td></tr>
      </table>
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 600px;">
        <tr>
          <td align="center" style="padding: 20px 24px 6px; font-family: ${T.font}; font-size: 11px; line-height: 1.6; color: ${T.faint};">
            ${footerLines.map((l) => `<p style="margin: 0 0 6px;">${l}</p>`).join('')}
            ${ctx.unsubscribeUrl ? `<p style="margin: 8px 0 0;"><a href="${escapeHtml(ctx.unsubscribeUrl)}" style="color: ${T.muted}; text-decoration: underline;">Unsubscribe</a></p>` : ''}
          </td>
        </tr>
      </table>
      ${ctx.openPixelUrl ? `<img src="${escapeHtml(ctx.openPixelUrl)}" width="1" height="1" alt="" style="display: block; width: 1px; height: 1px; border: 0;" />` : ''}
    </td>
  </tr>
</table>
</body>
</html>`;

  return { subject, preheader, html, text: renderText(step, ctx, m) };
}

/** The plain-text alternative: same words, same links (untracked), same footer. */
function renderText(step: FlowStep, ctx: RenderContext, m: (s: string) => string): string {
  const link = (url: string) => {
    const abs = absoluteUrl(m(url), ctx.siteUrl);
    return abs ? withUtm(abs, ctx.siteUrl, step.step, step.flow) : null;
  };
  const lines: string[] = [];
  const push = (s: string) => {
    if (s.trim()) lines.push(s.trim());
  };
  push(m(step.eyebrow).toUpperCase());
  push(m(step.headline));
  push(m(step.subheadline));
  lines.push('');
  push(m(step.body));
  const hl = step.highlights.map((h) => m(h.label)).filter(Boolean);
  if (hl.length) {
    lines.push('');
    hl.forEach((h) => lines.push(`- ${h}`));
  }
  if (ctx.offer) {
    lines.push('');
    lines.push(`Use code ${ctx.offer.code} at checkout (${ctx.offer.label} off).`);
  }
  if (ctx.offerEndsAt) {
    lines.push(`Offer ends ${formatDeadline(ctx.offerEndsAt, ctx.timezone)}.`);
  }
  if (step.show_cart && ctx.cart?.lines.length) {
    lines.push('');
    push(m(step.cart_title));
    push(m(step.cart_body));
    ctx.cart.lines.forEach((l) => lines.push(`- ${l.name} (${l.packLabel}) × ${l.quantity}`));
  }
  const cta = link(step.cta_url);
  if (cta && step.cta_label) {
    lines.push('');
    lines.push(`${m(step.cta_label)}: ${cta}`);
  }
  if (step.card_title || step.card_body) {
    lines.push('');
    push(m(step.card_title));
    push(m(step.card_body));
    const cardLink = step.card_link_label ? link(step.card_link_url) : null;
    if (cardLink) lines.push(`${m(step.card_link_label)}: ${cardLink}`);
  }
  push(m(step.fine_print));
  lines.push('', '—');
  if (ctx.settings.footer_disclaimer) lines.push(ctx.settings.footer_disclaimer);
  lines.push(ctx.settings.footer_address ? `VYTA Biosciences · ${ctx.settings.footer_address}` : 'VYTA Biosciences · Canada');
  if (ctx.unsubscribeUrl) lines.push(`Unsubscribe: ${ctx.unsubscribeUrl}`);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
