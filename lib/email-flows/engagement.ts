/**
 * Email flows — what happens after the email lands. Isomorphic, pure.
 *
 * The flow tables already count opens and clicks per send, and the engine
 * marks an entry converted when the person buys. That leaves three questions
 * the numbers could not answer, and this module holds the rules for each:
 *
 *   1. Was that open or click a person? Corporate mail gateways (Microsoft
 *      Safe Links, Proofpoint, Mimecast…) follow every link in an email the
 *      moment it arrives, and Apple Mail fetches every image on delivery. Left
 *      in, they make a flow look far more engaging than it is. `classifyHit`
 *      flags them, and only a person's click moves the send's click counter.
 *
 *   2. Where did the click go? `targetPathOf` / `linkKindOf` keep the path the
 *      link pointed at (never the query string — a cart link's query carries
 *      its restore token), so the report can say "cart links get the clicks,
 *      product links don't".
 *
 *   3. Did the click lead to the sale? A person's click leaves a signed cookie
 *      (`FlowClick`, written in tokens.ts) that the checkout copies into the
 *      order's attribution snapshot. `emailFlowTouchOf` reads that back — or,
 *      for orders placed before the cookie existed, the flow's UTM tags on the
 *      order's last touch — so analytics can tell a sale a flow email closed
 *      from one that merely happened while the person was in a flow.
 */
import { FLOWS, isFlowKey, isStepNumber, type FlowKey, type StepNumber } from './types';

// ---------------------------------------------------------------------------
// 1. Person or machine
// ---------------------------------------------------------------------------

export type HitKind = 'open' | 'click';

export type MachineReason =
  /** A HEAD request — link checkers probe, people navigate. */
  | 'head_request'
  /** No User-Agent at all. Every real mail client and browser sends one. */
  | 'no_user_agent'
  /** A User-Agent that names a scanner, crawler or HTTP library. */
  | 'scanner'
  /** Within seconds of sending — faster than anyone can open and click. */
  | 'too_fast'
  /** Apple Mail Privacy Protection: images fetched on delivery, read or not. */
  | 'privacy_proxy';

export interface HitClassification {
  machine: boolean;
  reason: MachineReason | null;
}

/**
 * Security gateways and link checkers. Deliberately specific: a false positive
 * hides a real person's click, which is worse than letting a rare scanner in.
 */
const SCANNER_UA =
  /\b(bot|crawler|spider|slurp|scanner|proofpoint|mimecast|barracuda|safelinks|urldefense|forcepoint|symantec|trendmicro|sophos|fortinet|cisco|ironport|zscaler|python|curl|wget|go-http-client|java\/|okhttp|axios|node-fetch|undici|headlesschrome|phantomjs|libwww|httpclient|preview)\b/i;

/**
 * Apple's privacy proxy sends a bare `Mozilla/5.0` and nothing else. Gmail's
 * image proxy (`GoogleImageProxy`) is NOT flagged: Gmail fetches images when
 * the message is opened, so its loads are real opens.
 */
const PRIVACY_PROXY_UA = /^Mozilla\/5\.0$/;

/** Gateways click within a second or two of delivery; people take longer. */
export const MACHINE_CLICK_SECONDS = 3;

export function classifyHit(input: {
  kind: HitKind;
  method?: string | null;
  userAgent?: string | null;
  sentAt?: string | null;
  now?: Date;
}): HitClassification {
  const ua = String(input.userAgent ?? '').trim();
  if (String(input.method ?? 'GET').toUpperCase() === 'HEAD') return { machine: true, reason: 'head_request' };
  if (!ua) return { machine: true, reason: 'no_user_agent' };
  if (SCANNER_UA.test(ua)) return { machine: true, reason: 'scanner' };
  if (input.kind === 'open' && PRIVACY_PROXY_UA.test(ua)) return { machine: true, reason: 'privacy_proxy' };
  if (input.sentAt) {
    const sent = Date.parse(input.sentAt);
    const now = (input.now ?? new Date()).getTime();
    if (Number.isFinite(sent) && now >= sent && now - sent < MACHINE_CLICK_SECONDS * 1000) {
      return { machine: true, reason: 'too_fast' };
    }
  }
  return { machine: false, reason: null };
}

/**
 * Does this hit move the send's own open/click counters?
 *
 * Clicks: only a person's. They are the firm signal the admin reads, and the
 * conversion check treats a click as proof the email was acted on.
 *
 * Opens: everything except an outright scanner. Opens were always a soft
 * signal and are labelled so; a privacy-proxy load or a fast open may well be
 * a person, and dropping them would make every Apple Mail reader look like
 * they never opened anything. The event log keeps the flag either way.
 */
export function countsTowardSendStats(kind: HitKind, hit: HitClassification): boolean {
  if (!hit.machine) return true;
  if (kind === 'click') return false;
  return hit.reason === 'privacy_proxy' || hit.reason === 'too_fast';
}

export const MACHINE_REASON_LABELS: Record<MachineReason, string> = {
  head_request: 'Link checker (HEAD request)',
  no_user_agent: 'No browser identified',
  scanner: 'Mail security scanner',
  too_fast: 'Within seconds of sending',
  privacy_proxy: 'Apple Mail privacy prefetch',
};

// ---------------------------------------------------------------------------
// 2. Where the click went
// ---------------------------------------------------------------------------

/** Path only, capped — never the query (a cart link's query is its restore token). */
export function targetPathOf(target: string): string | null {
  try {
    const path = new URL(target).pathname || '/';
    return path.slice(0, 200);
  } catch {
    return null;
  }
}

export type LinkKind = 'cart' | 'product' | 'shop' | 'lab_results' | 'home' | 'other';

export function linkKindOf(path: string | null | undefined): LinkKind {
  const p = String(path ?? '').toLowerCase();
  if (!p || p === '/') return 'home';
  if (p.startsWith('/cart') || p.startsWith('/checkout')) return 'cart';
  if (p.startsWith('/products/') || p.startsWith('/p/')) return 'product';
  if (p === '/products' || p.startsWith('/shop')) return 'shop';
  if (p.startsWith('/lab-results')) return 'lab_results';
  return 'other';
}

export const LINK_KIND_LABELS: Record<LinkKind, string> = {
  cart: 'Cart / checkout',
  product: 'A product page',
  shop: 'The shop',
  lab_results: 'Lab results',
  home: 'Home page',
  other: 'Other page',
};

// ---------------------------------------------------------------------------
// 3. The click that led to the sale
// ---------------------------------------------------------------------------

/** A person's click on a flow email, as carried by the click cookie. */
export interface FlowClick {
  sendId: string;
  flow: FlowKey;
  step: StepNumber;
  /** ISO time of the click. */
  at: string;
}

/** How we know an order came through a flow email. */
export type FlowTouchEvidence =
  /** The click cookie rode into checkout — this exact email was clicked. */
  | 'click'
  /** The order's last touch carries the flow's UTM tags (`withUtm` in render.ts). */
  | 'utm';

export interface EmailFlowTouch {
  flow: FlowKey;
  step: StepNumber | null;
  sendId: string | null;
  clickedAt: string | null;
  evidence: FlowTouchEvidence;
}

/**
 * The flow behind a set of UTM tags, as `withUtm` writes them:
 * utm_source=<flow>_flow, utm_medium=email, utm_campaign=<flow>_<step>.
 */
export function flowFromUtm(
  source: unknown,
  medium: unknown,
  campaign: unknown,
): { flow: FlowKey; step: StepNumber | null } | null {
  if (String(medium ?? '').toLowerCase() !== 'email') return null;
  const m = /^([a-z]+)_flow$/.exec(String(source ?? '').toLowerCase());
  if (!m || !isFlowKey(m[1])) return null;
  const flow = m[1];
  const s = new RegExp(`^${flow}_(\\d)$`).exec(String(campaign ?? '').toLowerCase());
  const step = s ? Number(s[1]) : null;
  return { flow, step: isStepNumber(step) ? step : null };
}

/** The `email_flow` object stored in an order's attribution snapshot. */
export function flowClickPayload(click: FlowClick): Record<string, unknown> {
  return { send_id: click.sendId, flow: click.flow, step: click.step, clicked_at: click.at };
}

/**
 * Which flow email (if any) an order came through, read off its attribution
 * snapshot. The click cookie is the stronger evidence and wins; the UTM tags
 * on the last touch, then the first, cover orders from before it existed and
 * buyers whose cookie had expired.
 */
export function emailFlowTouchOf(attribution: unknown): EmailFlowTouch | null {
  if (!attribution || typeof attribution !== 'object') return null;
  const a = attribution as Record<string, any>;

  const ef = a.email_flow;
  if (ef && typeof ef === 'object' && isFlowKey(ef.flow)) {
    const step = Number(ef.step);
    return {
      flow: ef.flow,
      step: isStepNumber(step) ? step : null,
      sendId: typeof ef.send_id === 'string' ? ef.send_id : null,
      clickedAt: typeof ef.clicked_at === 'string' ? ef.clicked_at : null,
      evidence: 'click',
    };
  }

  for (const touch of [a.last, a.first]) {
    if (!touch || typeof touch !== 'object') continue;
    const hit = flowFromUtm(touch.source, touch.medium, touch.campaign);
    if (hit) return { ...hit, sendId: null, clickedAt: typeof touch.at === 'string' ? touch.at : null, evidence: 'utm' };
  }
  return null;
}

/** "Cart Abandonment · email 3" — for a campaign tag or a touch. */
export function flowStepLabel(flow: FlowKey, step: StepNumber | null): string {
  const meta = FLOWS[flow];
  if (!step) return meta.label;
  return `${meta.label} · email ${step} (${meta.steps[step].label})`;
}

// ---------------------------------------------------------------------------
// 4. Crediting a conversion
// ---------------------------------------------------------------------------

/** How a flow conversion came about. */
export type ConversionVia =
  /** They clicked a flow email before paying (or paid through the checkout it opened). */
  | 'click'
  /** They bought while in the flow but never clicked — influenced at most. */
  | 'email_match';

export const CONVERSION_VIA_LABELS: Record<ConversionVia, string> = {
  click: 'Clicked through',
  email_match: 'Bought without clicking',
};

export interface CreditSend {
  id: string;
  step: number;
  sent_at: string | null;
  clicked_at: string | null;
}

/**
 * Which email gets the credit for a purchase, and whether it was clicked.
 *
 * Strongest evidence first:
 *   1. the email whose click opened the checkout that was paid;
 *   2. the most recent email clicked before the purchase;
 *   3. the checkout was opened from the flow but the send is unknown — still a
 *      click-through, credited to the latest email sent before it;
 *   4. otherwise the latest email sent before the purchase, as 'email_match'.
 *
 * Before this, every conversion was credited to the last email sent, which
 * gave the final reminder the credit for sales an earlier email's click made.
 */
export function creditConversion(
  sends: CreditSend[],
  convertedAt: string,
  viaCheckout: { sendId: string | null } | null,
): { via: ConversionVia; step: StepNumber | null; sendId: string | null } {
  const at = Date.parse(convertedAt);
  const asStep = (n: number): StepNumber | null => (isStepNumber(n) ? n : null);

  if (viaCheckout?.sendId) {
    const send = sends.find((s) => s.id === viaCheckout.sendId);
    if (send) return { via: 'click', step: asStep(send.step), sendId: send.id };
  }

  const clicked = sends
    .filter((s) => s.clicked_at && Date.parse(s.clicked_at) <= at)
    .sort((a, b) => Date.parse(b.clicked_at!) - Date.parse(a.clicked_at!));
  if (clicked[0]) return { via: 'click', step: asStep(clicked[0].step), sendId: clicked[0].id };

  const sent = sends
    .filter((s) => s.sent_at && Date.parse(s.sent_at) <= at)
    .sort((a, b) => Date.parse(b.sent_at!) - Date.parse(a.sent_at!));
  const latest = sent[0] ?? null;
  return {
    via: viaCheckout ? 'click' : 'email_match',
    step: latest ? asStep(latest.step) : null,
    sendId: latest?.id ?? null,
  };
}
