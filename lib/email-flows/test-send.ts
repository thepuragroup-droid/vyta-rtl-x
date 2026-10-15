/**
 * Test sends — any of the flow emails, to one or more addresses, with the
 * details they're rendered with fed in. Everything not given has a default.
 *
 * Pure (no I/O): this shapes the request. The sending lives in
 * test-runner.ts, which the admin route and scripts/email-flows-test-send.ts
 * both call.
 */
import { sanitizeCartLines, type SavedCartLine } from './carts';
import {
  FLOWS,
  FLOW_KEYS,
  STEP_NUMBERS,
  isFlowKey,
  isStepNumber,
  isValidTimeZone,
  normalizeCode,
  type FlowKey,
  type Shaped,
  type StepNumber,
} from './types';

/** Per request. Ten addresses × ten emails is the most one request sends. */
export const TEST_LIMITS = { recipients: 10, emails: 10 } as const;

export const TEST_DEFAULTS = {
  firstName: 'Alex',
  /** Subjects read "[Test · Cart 3] …". Empty sends the subject as customers see it. */
  subjectTag: 'Test',
} as const;

export interface TestEmailRef {
  flow: FlowKey;
  step: StepNumber;
}

export interface TestSendInput {
  recipients: string[];
  /** In flow, then step order. */
  emails: TestEmailRef[];
  firstName: string;
  /** Replaces the code on every email that carries an offer. Null keeps each email's own. */
  code: string | null;
  /** Null uses each flow's default time zone. */
  timezone: string | null;
  /** The cart shown in cart emails. Null uses a sample from the catalogue. */
  cart: SavedCartLine[] | null;
  subjectTag: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "a@x.com, b@y.com" or a list, split on commas, semicolons, spaces and new lines. */
export function parseRecipients(raw: unknown): { emails: string[]; invalid: string[] } {
  const parts = (Array.isArray(raw) ? raw.map(String) : [String(raw ?? '')])
    .flatMap((s) => s.split(/[\s,;]+/))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    if (!EMAIL.test(p)) invalid.push(p);
    else if (!emails.includes(p)) emails.push(p);
  }
  return { emails, invalid };
}

export const ALL_TEST_EMAILS: TestEmailRef[] = FLOW_KEYS.flatMap((flow) => STEP_NUMBERS.map((step) => ({ flow, step })));

/**
 * Which emails to send. Takes `{ flow, step }` objects or strings: "cart:3",
 * or a flow name for all five of its emails. Nothing given means all ten.
 * Returns null when something can't be read.
 */
export function parseEmailRefs(raw: unknown): TestEmailRef[] | null {
  if (raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0)) return ALL_TEST_EMAILS;
  const items = Array.isArray(raw) ? raw : String(raw).split(/[\s,]+/).filter(Boolean);
  const picked = new Set<string>();
  for (const item of items) {
    let flow: unknown;
    let step: unknown;
    if (item && typeof item === 'object') {
      flow = (item as Record<string, unknown>).flow;
      step = Number((item as Record<string, unknown>).step);
    } else {
      const [f, s] = String(item).trim().toLowerCase().split(':');
      flow = f;
      step = s === undefined || s === '' ? 'all' : Number(s);
    }
    if (!isFlowKey(flow)) return null;
    if (step === 'all') for (const n of STEP_NUMBERS) picked.add(`${flow}:${n}`);
    else if (isStepNumber(step)) picked.add(`${flow}:${step}`);
    else return null;
  }
  return ALL_TEST_EMAILS.filter((r) => picked.has(`${r.flow}:${r.step}`));
}

export function emailName(ref: TestEmailRef): string {
  return `${ref.flow === 'welcome' ? 'Welcome' : 'Cart'} ${ref.step}`;
}

/** "[Test · Welcome 1] Welcome to VYTA, Alex" — or the bare subject with no tag. */
export function testSubject(tag: string, ref: TestEmailRef, subject: string): string {
  return tag ? `[${tag} · ${emailName(ref)}] ${subject}` : subject;
}

/** A test request, with every field it leaves out filled from the defaults. */
export function shapeTestSendInput(raw: Record<string, unknown>): Shaped<TestSendInput> {
  const { emails: recipients, invalid } = parseRecipients(raw.recipients ?? raw.to);
  if (invalid.length) return { ok: false, error: `Not an email address: ${invalid.slice(0, 3).join(', ')}` };
  if (!recipients.length) return { ok: false, error: 'Add at least one email address to send to.' };
  if (recipients.length > TEST_LIMITS.recipients) {
    return { ok: false, error: `Send to at most ${TEST_LIMITS.recipients} addresses at a time.` };
  }

  const emails = parseEmailRefs(raw.emails);
  if (!emails) return { ok: false, error: 'Pick emails as welcome:1 … cart:5, or a flow name for all five.' };
  if (!emails.length) return { ok: false, error: 'Pick at least one email to send.' };

  const firstName = String(raw.firstName ?? '').trim().slice(0, 60) || TEST_DEFAULTS.firstName;

  const code = normalizeCode(raw.code) || null;

  const tz = String(raw.timezone ?? '').trim();
  if (tz && !isValidTimeZone(tz)) return { ok: false, error: `${tz} isn't a time zone — use a name like America/Toronto.` };

  let cart: SavedCartLine[] | null = null;
  if (Array.isArray(raw.cart) && raw.cart.length) {
    cart = sanitizeCartLines(raw.cart);
    if (!cart.length) return { ok: false, error: 'The sample cart has no valid products.' };
  }

  const subjectTag = raw.subjectTag === undefined || raw.subjectTag === null
    ? TEST_DEFAULTS.subjectTag
    : String(raw.subjectTag).replace(/[[\]\r\n]/g, '').trim().slice(0, 30);

  return { ok: true, value: { recipients, emails, firstName, code, timezone: tz || null, cart, subjectTag } };
}

/** For the result table and the CLI's log line. */
export function describeRef(ref: TestEmailRef): string {
  return `${emailName(ref)} · ${FLOWS[ref.flow].steps[ref.step].label}`;
}
