/**
 * Welcome flow — the five emails, rendered.
 *
 * One function builds every email for both the real send (lib/welcome-flow/
 * engine.ts) and the admin's live preview (/api/admin/welcome-flow/preview),
 * so what an admin approves is what goes out.
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
import { STEP_META, type WelcomeFlowSettings, type WelcomeFlowStep } from './types';
import { countdown, formatDeadline } from './schedule';

export interface ResolvedOffer {
  code: string;
  /** "20%" or "$10" — the code's real value, read at send time. */
  label: string;
}

export interface RenderContext {
  firstName: string | null;
  offer: ResolvedOffer | null;
  /** Email 5's deadline; ignored by the other layouts. */
  offerEndsAt: Date | null;
  now: Date;
  timezone: string;
  settings: Pick<WelcomeFlowSettings, 'footer_address' | 'footer_disclaimer'>;
  /** Origin that site-relative links and images are resolved against. */
  siteUrl: string;
  /** Wraps an absolute link in the click tracker. Absent in previews. */
  trackLink?: (url: string) => string;
  /** 1x1 open pixel. Absent in previews. */
  openPixelUrl?: string | null;
  unsubscribeUrl: string | null;
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

export const MERGE_TAGS = ['first_name', 'code', 'discount', 'offer_ends'] as const;

export function mergeTags(text: string, ctx: Pick<RenderContext, 'firstName' | 'offer' | 'offerEndsAt' | 'timezone'>): string {
  const first = String(ctx.firstName ?? '').trim();
  const values: Record<string, string> = {
    first_name: first || 'there',
    code: ctx.offer?.code ?? '',
    discount: ctx.offer?.label ?? '',
    offer_ends: ctx.offerEndsAt ? formatDeadline(ctx.offerEndsAt, ctx.timezone) : '',
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
export function mergeTagProblems(step: WelcomeFlowStep): string[] {
  const fields = [step.subject, step.preheader, step.eyebrow, step.headline, step.subheadline, step.body,
    step.cta_label, step.card_title, step.card_body, step.fine_print, ...step.highlights].join('\n');
  const problems: string[] = [];
  if (!step.promo_code && /\{\{\s*(code|discount)\s*\}\}/.test(fields)) {
    problems.push('The copy uses {{code}} or {{discount}} but this email has no discount code — they would print blank.');
  }
  if (STEP_META[step.step].layout !== 'reminder' && /\{\{\s*offer_ends\s*\}\}/.test(fields)) {
    problems.push('{{offer_ends}} only has a value in the reminder email (email 5).');
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
export function withUtm(url: string, siteUrl: string, step: number): string {
  try {
    const target = new URL(url);
    const site = new URL(siteUrl);
    if (target.hostname.replace(/^www\./, '') !== site.hostname.replace(/^www\./, '')) return url;
    if (!target.searchParams.has('utm_source')) {
      target.searchParams.set('utm_source', 'welcome_flow');
      target.searchParams.set('utm_medium', 'email');
      target.searchParams.set('utm_campaign', `welcome_${step}`);
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
  step: WelcomeFlowStep;
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

function button(k: Kit, label: string, url: string, opts: { light?: boolean } = {}): string {
  const href = k.href(url);
  const text = k.m(label);
  if (!href || !text) return '';
  const bg = opts.light ? '#FFFFFF' : T.button;
  const fg = opts.light ? T.ink : '#FFFFFF';
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 6px auto 4px;">
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

/** Badge row — up to four columns, each a check mark over a small-caps label. */
function badges(k: Kit, items: string[], dark = false): string {
  const list = items.map((i) => k.m(i)).filter(Boolean).slice(0, 4);
  if (!list.length) return '';
  const icon = `${k.ctx.siteUrl.replace(/\/$/, '')}/images/email/${dark ? 'shield-check-white.png' : 'check-teal.png'}`;
  const width = Math.floor(100 / list.length);
  const cells = list
    .map(
      (label) => `
        <td width="${width}%" align="center" valign="top" style="padding: 0 6px;">
          <img src="${escapeHtml(icon)}" width="22" height="22" alt="" style="display: block; margin: 0 auto 8px; border: 0;" />
          <p style="font-family: ${T.font}; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; line-height: 1.4; color: ${dark ? '#FFFFFF' : T.ink}; margin: 0;">${escapeHtml(label)}</p>
        </td>`,
    )
    .join('');
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>${cells}</tr>
    </table>`;
}

/** Vertical benefit list — the education email's checklist. */
function checklist(k: Kit, items: string[]): string {
  const list = items.map((i) => k.m(i)).filter(Boolean);
  if (!list.length) return '';
  const icon = `${k.ctx.siteUrl.replace(/\/$/, '')}/images/email/check-teal.png`;
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 8px;">
      ${list
        .map(
          (label) => `
        <tr>
          <td valign="middle" style="padding: 7px 14px 7px 0;">
            <img src="${escapeHtml(icon)}" width="22" height="22" alt="" style="display: block; border: 0;" />
          </td>
          <td valign="middle" style="padding: 7px 0; font-family: ${T.font}; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${T.ink};">${escapeHtml(label)}</td>
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

function welcomeLayout(k: Kit): string {
  const s = k.step;
  return [
    `<tr><td style="padding: 0;">${image(k, s.hero_image_url, k.m(s.headline))}</td></tr>`,
    pad(headlineBlock(k, 'left', 32), '28px 32px 8px'),
    pad(badges(k, s.highlights), '18px 20px'),
    pad(paragraphs(k.m(s.body)) + button(k, s.cta_label, s.cta_url), '10px 32px 24px'),
    pad(card(k, { showCode: true }), '0 20px 24px'),
  ].join('');
}

function educationLayout(k: Kit): string {
  const s = k.step;
  return [
    pad(headlineBlock(k), '32px 32px 18px'),
    `<tr><td style="padding: 0;">${image(k, s.hero_image_url, k.m(s.headline))}</td></tr>`,
    pad(checklist(k, s.highlights) + paragraphs(k.m(s.body)) + button(k, s.cta_label, s.cta_url), '24px 32px 24px'),
    pad(card(k, { imageLeft: true }), '0 20px 24px'),
  ].join('');
}

function trustLayout(k: Kit): string {
  const s = k.step;
  return [
    pad(headlineBlock(k), '32px 32px 18px'),
    `<tr><td style="padding: 0;">${image(k, s.hero_image_url, k.m(s.headline))}</td></tr>`,
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

function reminderLayout(k: Kit): string {
  const s = k.step;
  const ends = k.ctx.offerEndsAt;
  const left = ends ? countdown(k.ctx.now, ends) : null;
  const box = (n: number, label: string) => `
    <td align="center" style="padding: 0 5px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border: 1px solid ${T.border}; border-radius: 6px; border-collapse: separate;">
        <tr><td align="center" style="width: 64px; padding: 10px 0 8px;">
          <p style="font-family: ${T.display}; font-size: 26px; font-weight: 700; color: ${T.ink}; margin: 0; line-height: 1;">${String(n).padStart(2, '0')}</p>
          <p style="font-family: ${T.font}; font-size: 9px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: ${T.faint}; margin: 6px 0 0;">${label}</p>
        </td></tr>
      </table>
    </td>`;
  const timer = left
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 6px auto 8px;">
         <tr>${box(left.days, 'Days')}${box(left.hours, 'Hours')}${box(left.minutes, 'Minutes')}</tr>
       </table>
       <p style="font-family: ${T.font}; font-size: 12px; color: ${T.muted}; text-align: center; margin: 0 0 18px;">Offer ends ${escapeHtml(formatDeadline(ends!, k.ctx.timezone))}</p>`
    : '';
  const fine = k.m(s.fine_print);
  return [
    pad(headlineBlock(k, 'center', 28) + paragraphs(k.m(s.body), T.body, 'center'), '34px 36px 10px'),
    pad(timer + button(k, s.cta_label, s.cta_url) + (k.ctx.offer ? `<p style="font-family: ${T.font}; font-size: 12px; color: ${T.muted}; text-align: center; margin: 12px 0 0;">Use code <strong style="color: ${T.ink}; letter-spacing: 0.06em;">${escapeHtml(k.ctx.offer.code)}</strong> at checkout.</p>` : ''), '4px 32px 26px'),
    `<tr><td style="padding: 0;">${image(k, s.hero_image_url, k.m(s.headline))}</td></tr>`,
    `<tr><td bgcolor="${T.navy}" style="background: ${T.navy}; padding: 22px 20px;">${badges(k, s.highlights, true)}</td></tr>`,
    fine ? pad(`<p style="font-family: ${T.font}; font-size: 11px; color: ${T.faint}; text-align: center; margin: 0;">${escapeHtml(fine)}</p>`, '14px 32px 0') : '',
  ].join('');
}

const LAYOUTS = {
  welcome: welcomeLayout,
  education: educationLayout,
  trust: trustLayout,
  offer: offerLayout,
  reminder: reminderLayout,
} as const;

// ---------------------------------------------------------------------------
// The email
// ---------------------------------------------------------------------------

export function renderWelcomeEmail(step: WelcomeFlowStep, ctx: RenderContext): RenderedEmail {
  const m = (s: string) => mergeTags(s, ctx);
  const href = (url: string) => {
    const abs = absoluteUrl(m(url), ctx.siteUrl);
    if (!abs) return null;
    const tagged = withUtm(abs, ctx.siteUrl, step.step);
    return ctx.trackLink ? ctx.trackLink(tagged) : tagged;
  };
  const img = (url: string) => absoluteUrl(url, ctx.siteUrl);
  const k: Kit = { ctx, step, m, href, img };

  const subject = m(step.subject).replace(/\s+/g, ' ').trim();
  const preheader = m(step.preheader).trim();
  const site = ctx.siteUrl.replace(/\/$/, '');
  const home = href('/') ?? site;
  const logo = `${site}/images/vyta-logo.png`;
  const content = LAYOUTS[STEP_META[step.step].layout](k);

  const footerLines = [
    ctx.settings.footer_disclaimer ? escapeHtml(ctx.settings.footer_disclaimer) : '',
    `You're receiving this because you created a VYTA account and agreed to hear from us.`,
    ctx.settings.footer_address ? `VYTA Biosciences · ${escapeHtml(ctx.settings.footer_address)}` : 'VYTA Biosciences · Canada',
  ].filter(Boolean);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background: ${T.paper};">
${preheader ? `<div style="display: none; max-height: 0; overflow: hidden; mso-hide: all; font-size: 1px; line-height: 1px; color: ${T.paper};">${escapeHtml(preheader)}${'&#847; &zwnj; &nbsp; '.repeat(20)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; background: ${T.paper};">
  <tr>
    <td align="center" style="padding: 28px 10px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 600px; border-collapse: separate; background: ${T.card}; border: 1px solid ${T.border}; border-radius: ${T.radius}; overflow: hidden;">
        <tr>
          <td align="center" style="padding: 22px 24px 18px; border-bottom: 1px solid ${T.border};">
            <a href="${escapeHtml(home)}" style="text-decoration: none;"><img src="${escapeHtml(logo)}" width="140" alt="VYTA Biosciences" style="display: block; width: 140px; height: auto; border: 0; font-family: ${T.display}; font-size: 22px; letter-spacing: 0.3em; color: ${T.ink};" /></a>
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
function renderText(step: WelcomeFlowStep, ctx: RenderContext, m: (s: string) => string): string {
  const link = (url: string) => {
    const abs = absoluteUrl(m(url), ctx.siteUrl);
    return abs ? withUtm(abs, ctx.siteUrl, step.step) : null;
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
  const hl = step.highlights.map(m).filter(Boolean);
  if (hl.length) {
    lines.push('');
    hl.forEach((h) => lines.push(`- ${h}`));
  }
  if (ctx.offer) {
    lines.push('');
    lines.push(`Use code ${ctx.offer.code} at checkout (${ctx.offer.label} off).`);
  }
  if (STEP_META[step.step].layout === 'reminder' && ctx.offerEndsAt) {
    lines.push(`Offer ends ${formatDeadline(ctx.offerEndsAt, ctx.timezone)}.`);
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
