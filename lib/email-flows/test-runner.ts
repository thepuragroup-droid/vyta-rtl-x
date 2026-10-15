/**
 * Test sends — server side. Renders the chosen flow emails from their saved
 * settings, exactly as the flow would, with the request's details in place of
 * a real person's, and sends each one to every address given.
 *
 * Nothing here touches the flows themselves: no entries, no sends rows, no
 * tracking. Links are untracked and the unsubscribe link is the generic one.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendMail } from '@/lib/smtp';
import { packOptionsFor } from '@/lib/pricing';
import { checkCodes, loadConfig, type FlowConfig } from './engine';
import { renderFlowEmail, type RenderCart, type RenderedEmail } from './render';
import { CART_PRODUCT_COLUMNS, cartLineViews, type CartProductRow, type SavedCartLine } from './carts';
import { normalizeCode, requiresCode, type CodeCheck, type FlowKey } from './types';
import { TEST_DEFAULTS, TEST_LIMITS, describeRef, testSubject, type TestEmailRef, type TestSendInput } from './test-send';

type Db = SupabaseClient<any, any, any>;

/** SMTP sends in flight at once. */
const CONCURRENCY = 3;

export interface TestRender extends TestEmailRef {
  name: string;
  /** Set when this email can't go: the live flow would hold it too. */
  skipped: string | null;
  email: RenderedEmail | null;
}

export interface TestSendResult extends TestEmailRef {
  name: string;
  to: string;
  subject: string | null;
  status: 'sent' | 'skipped' | 'failed';
  detail: string | null;
}

export interface TestSendSummary {
  results: TestSendResult[];
  sent: number;
  skipped: number;
  failed: number;
}

/** The packs a product sells, smallest first. A product with none set sells single vials. */
function packsOf(p: CartProductRow): { size: number; label: string }[] {
  const packs = packOptionsFor(p as any).map((o) => ({ size: o.size, label: o.label }));
  return packs.length ? packs.sort((a, b) => a.size - b.size) : [{ size: 1, label: 'Single vial' }];
}

/** The sample cart: one of the first product's largest pack, two of the second's smallest. */
function sampleCartFrom(products: CartProductRow[]): SavedCartLine[] {
  return products.slice(0, 2).map((p, i) => {
    const packs = packsOf(p);
    return { productId: String(p.id).toLowerCase(), packSize: (i === 0 ? packs[packs.length - 1] : packs[0]).size, quantity: i === 0 ? 1 : 2 };
  });
}

async function activeProducts(db: Db, limit: number): Promise<CartProductRow[]> {
  const { data } = await db.from('products').select(CART_PRODUCT_COLUMNS).eq('active', true).order('name').limit(limit);
  return (data ?? []) as CartProductRow[];
}

async function cartProductRows(db: Db, lines: SavedCartLine[]): Promise<CartProductRow[]> {
  if (!lines.length) return [];
  const { data } = await db.from('products').select(CART_PRODUCT_COLUMNS).in('id', lines.map((l) => l.productId));
  return (data ?? []) as CartProductRow[];
}

/** Each chosen email, rendered once — the same copy goes to every address. */
export async function renderTestEmails(
  db: Db,
  input: TestSendInput,
  siteUrl: string,
  now = new Date(),
): Promise<{ ok: true; renders: TestRender[] } | { ok: false; error: string }> {
  const flows = [...new Set(input.emails.map((e) => e.flow))];
  const configs = {} as Record<FlowKey, FlowConfig>;
  for (const flow of flows) {
    const loaded = await loadConfig(db, flow);
    if (!loaded.ok) return { ok: false, error: loaded.migrationNeeded ? 'Run the email flows migration first.' : loaded.error };
    configs[flow] = loaded.config;
  }

  // The code each email offers: the test's code where one is given,
  // otherwise the email's own. Emails without an offer stay without one.
  const codeFor = (ref: TestEmailRef): string | null => {
    const step = configs[ref.flow].steps[ref.step];
    const hasOffer = requiresCode(ref.flow, ref.step) || !!step.promo_code;
    return hasOffer ? input.code ?? (normalizeCode(step.promo_code) || null) : null;
  };
  const codes: Map<string, CodeCheck> = await checkCodes(db, input.emails.map(codeFor), now);

  let cartLines: RenderCart['lines'] = [];
  if (flows.includes('cart')) {
    const lines = input.cart ?? sampleCartFrom(await activeProducts(db, 2));
    cartLines = cartLineViews(lines, await cartProductRows(db, lines));
  }

  const renders = input.emails.map((ref): TestRender => {
    const name = describeRef(ref);
    const { settings, steps } = configs[ref.flow];
    const step = steps[ref.step];
    const code = codeFor(ref);
    const hasOffer = requiresCode(ref.flow, ref.step) || !!step.promo_code;
    if (hasOffer && !code) {
      return { ...ref, name, email: null, skipped: 'No discount code chosen for this email. Choose one in the Emails tab, or set a code for the test.' };
    }
    const check = code ? codes.get(code) : null;
    if (code && !check?.usable) return { ...ref, name, email: null, skipped: check?.problem ?? `${code} can't be used.` };

    const offer = code && check?.label ? { code, label: check.label } : null;
    const email = renderFlowEmail({ ...step, promo_code: code }, {
      firstName: input.firstName,
      offer,
      offerEndsAt: step.deadline_hours ? new Date(now.getTime() + step.deadline_hours * 3600 * 1000) : null,
      now,
      timezone: input.timezone ?? settings.default_timezone,
      settings,
      siteUrl,
      unsubscribeUrl: `${siteUrl}/api/email-flows/unsubscribe`,
      cart: ref.flow === 'cart'
        ? { lines: cartLines, cartUrl: `${siteUrl}/cart`, checkoutUrl: `${siteUrl}/checkout${code ? `?discount=${encodeURIComponent(code)}` : ''}` }
        : null,
    });
    return { ...ref, name, skipped: null, email: { ...email, subject: testSubject(input.subjectTag, ref, email.subject) } };
  });
  return { ok: true, renders };
}

/** Runs `work` over `items`, at most `limit` at a time, keeping their order. */
async function inBatches<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return out;
}

/** Renders the chosen emails and sends every one to every address, one message each. */
export async function sendTestEmails(
  db: Db,
  input: TestSendInput,
  siteUrl: string,
  now = new Date(),
): Promise<{ ok: true; summary: TestSendSummary } | { ok: false; error: string }> {
  if (input.recipients.length > TEST_LIMITS.recipients || input.emails.length > TEST_LIMITS.emails) {
    return { ok: false, error: 'Too many emails for one test.' };
  }
  const rendered = await renderTestEmails(db, input, siteUrl, now);
  if (!rendered.ok) return rendered;

  const jobs = input.recipients.flatMap((to) => rendered.renders.map((r) => ({ to, r })));
  const results = await inBatches(jobs, CONCURRENCY, async ({ to, r }): Promise<TestSendResult> => {
    const base = { flow: r.flow, step: r.step, name: r.name, to, subject: r.email?.subject ?? null };
    if (!r.email) return { ...base, status: 'skipped', detail: r.skipped };
    const res = await sendMail({ to, subject: r.email.subject, html: r.email.html, text: r.email.text });
    return res.success
      ? { ...base, status: 'sent', detail: null }
      : { ...base, status: 'failed', detail: res.error ?? 'The email could not be sent.' };
  });

  const count = (s: TestSendResult['status']) => results.filter((r) => r.status === s).length;
  return { ok: true, summary: { results, sent: count('sent'), skipped: count('skipped'), failed: count('failed') } };
}

export interface TestDefaults {
  firstName: string;
  subjectTag: string;
  limits: typeof TEST_LIMITS;
  timezones: Record<FlowKey, string>;
  emails: Array<TestEmailRef & { name: string; subject: string; enabled: boolean; code: string | null; requiresCode: boolean }>;
  cart: SavedCartLine[];
  products: Array<{ id: string; name: string; packs: { size: number; label: string }[] }>;
}

/** What the test form starts from, and the products its sample cart can use. */
export async function testDefaults(db: Db): Promise<{ ok: true; defaults: TestDefaults } | { ok: false; error: string }> {
  const welcome = await loadConfig(db, 'welcome');
  const cart = await loadConfig(db, 'cart');
  if (!welcome.ok) return { ok: false, error: welcome.migrationNeeded ? 'Run the email flows migration first.' : welcome.error };
  if (!cart.ok) return { ok: false, error: cart.migrationNeeded ? 'Run the email flows migration first.' : cart.error };
  const configs: Record<FlowKey, FlowConfig> = { welcome: welcome.config, cart: cart.config };

  const rows = await activeProducts(db, 200);
  const products = rows.map((p) => ({ id: String(p.id).toLowerCase(), name: p.name, packs: packsOf(p) }));

  return {
    ok: true,
    defaults: {
      firstName: TEST_DEFAULTS.firstName,
      subjectTag: TEST_DEFAULTS.subjectTag,
      limits: TEST_LIMITS,
      timezones: { welcome: welcome.config.settings.default_timezone, cart: cart.config.settings.default_timezone },
      emails: (Object.keys(configs) as FlowKey[]).flatMap((flow) =>
        Object.values(configs[flow].steps).map((s) => ({
          flow,
          step: s.step,
          name: describeRef({ flow, step: s.step }),
          subject: s.subject,
          enabled: s.enabled,
          code: s.promo_code,
          requiresCode: requiresCode(flow, s.step) || !!s.promo_code,
        })),
      ),
      cart: sampleCartFrom(rows),
      products,
    },
  };
}
