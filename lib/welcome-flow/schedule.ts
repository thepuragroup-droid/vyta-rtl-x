/**
 * Welcome flow — when does each email go out?
 *
 * Pure and isomorphic: the cron deciding to send and the admin table showing
 * "next email Thu 9:00 AM" run the same arithmetic.
 *
 * The rules, from the flow design:
 *   - Email 1 goes the moment someone is enrolled, whatever the hour.
 *   - Emails 2-5 are due `delay_days` after enrolment, and then wait for the
 *     recipient's local send window (default 9-11 AM).
 *   - Emails go strictly in order, and never two closer than `min_gap_hours` —
 *     so a backlog (the flow switched off for a week, say) drains one email per
 *     day instead of landing three in one morning.
 */
import { MAX_SEND_ATTEMPTS, STEP_NUMBERS, type SendStatus, type StepNumber } from './types';

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

/** Canadian provinces and territories, by code and by name. */
const CA_ZONES: Record<string, string> = {
  BC: 'America/Vancouver', 'BRITISH COLUMBIA': 'America/Vancouver',
  AB: 'America/Edmonton', ALBERTA: 'America/Edmonton',
  SK: 'America/Regina', SASKATCHEWAN: 'America/Regina',
  MB: 'America/Winnipeg', MANITOBA: 'America/Winnipeg',
  ON: 'America/Toronto', ONTARIO: 'America/Toronto',
  QC: 'America/Toronto', QUEBEC: 'America/Toronto', 'QUÉBEC': 'America/Toronto',
  NB: 'America/Moncton', 'NEW BRUNSWICK': 'America/Moncton',
  NS: 'America/Halifax', 'NOVA SCOTIA': 'America/Halifax',
  PE: 'America/Halifax', PEI: 'America/Halifax', 'PRINCE EDWARD ISLAND': 'America/Halifax',
  NL: 'America/St_Johns', 'NEWFOUNDLAND AND LABRADOR': 'America/St_Johns', NEWFOUNDLAND: 'America/St_Johns',
  YT: 'America/Whitehorse', YUKON: 'America/Whitehorse',
  NT: 'America/Yellowknife', 'NORTHWEST TERRITORIES': 'America/Yellowknife',
  NU: 'America/Iqaluit', NUNAVUT: 'America/Iqaluit',
};

/** US states by code — the zone most of the state's population lives in. */
const US_ZONES: Record<string, string> = {
  CT: 'America/New_York', DE: 'America/New_York', DC: 'America/New_York', FL: 'America/New_York',
  GA: 'America/New_York', IN: 'America/Indiana/Indianapolis', KY: 'America/New_York', ME: 'America/New_York',
  MD: 'America/New_York', MA: 'America/New_York', MI: 'America/Detroit', NH: 'America/New_York',
  NJ: 'America/New_York', NY: 'America/New_York', NC: 'America/New_York', OH: 'America/New_York',
  PA: 'America/New_York', RI: 'America/New_York', SC: 'America/New_York', VT: 'America/New_York',
  VA: 'America/New_York', WV: 'America/New_York',
  AL: 'America/Chicago', AR: 'America/Chicago', IL: 'America/Chicago', IA: 'America/Chicago',
  KS: 'America/Chicago', LA: 'America/Chicago', MN: 'America/Chicago', MS: 'America/Chicago',
  MO: 'America/Chicago', NE: 'America/Chicago', ND: 'America/Chicago', OK: 'America/Chicago',
  SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago', WI: 'America/Chicago',
  AZ: 'America/Phoenix', CO: 'America/Denver', ID: 'America/Boise', MT: 'America/Denver',
  NM: 'America/Denver', UT: 'America/Denver', WY: 'America/Denver',
  CA: 'America/Los_Angeles', NV: 'America/Los_Angeles', OR: 'America/Los_Angeles', WA: 'America/Los_Angeles',
  AK: 'America/Anchorage', HI: 'Pacific/Honolulu', PR: 'America/Puerto_Rico',
};

/**
 * Best guess at someone's time zone from the address on their account.
 *
 * "CA" is both California and Canada, so the country decides which table a
 * two-letter code is read against. With no country, a Canadian province is
 * tried first — this is a Canadian store.
 */
export function timezoneFor(
  state: string | null | undefined,
  country: string | null | undefined,
  fallback: string,
): string {
  const s = String(state ?? '').trim().toUpperCase();
  if (!s) return fallback;
  const c = String(country ?? '').trim().toUpperCase();
  const isUS = c === 'US' || c === 'USA' || c === 'UNITED STATES';
  const isCA = c === 'CA' || c === 'CAN' || c === 'CANADA';
  if (isUS) return US_ZONES[s] ?? fallback;
  if (isCA) return CA_ZONES[s] ?? fallback;
  return CA_ZONES[s] ?? US_ZONES[s] ?? fallback;
}

/** The hour (0-23) and minute on the wall clock in `tz` at `at`. */
export function localTime(at: Date, tz: string): { hour: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? NaN);
    if (Number.isFinite(hour) && Number.isFinite(minute)) return { hour: hour % 24, minute };
  } catch {
    /* unknown zone — fall through to UTC */
  }
  return { hour: at.getUTCHours(), minute: at.getUTCMinutes() };
}

/**
 * Is `at` inside [start, end) local hours? A window that wraps midnight
 * (start 22, end 2) is honoured rather than read as empty.
 */
export function inSendWindow(at: Date, tz: string, start: number, end: number): boolean {
  const { hour } = localTime(at, tz);
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

const QUARTER_HOUR = 15 * 60 * 1000;

/**
 * The first moment at or after `from` that falls inside the window, to the
 * quarter hour. Walks forward rather than doing offset arithmetic, so DST
 * changes and half-hour zones (Newfoundland) come out right for free.
 */
export function nextWindowOpening(from: Date, tz: string, start: number, end: number): Date {
  if (inSendWindow(from, tz, start, end)) return from;
  let t = Math.ceil(from.getTime() / QUARTER_HOUR) * QUARTER_HOUR;
  for (let i = 0; i < 4 * 24 * 3; i++, t += QUARTER_HOUR) {
    if (inSendWindow(new Date(t), tz, start, end)) return new Date(t);
  }
  return from;
}

// ---------------------------------------------------------------------------
// Which email is next?
// ---------------------------------------------------------------------------

export interface SendRecord {
  step: number;
  status: SendStatus;
  attempts: number;
}

/**
 * Is this step finished with, one way or another? Sent, skipped, in flight,
 * or failed too many times to keep trying — the flow moves past all of them.
 */
export function stepSettled(rec: SendRecord | undefined): boolean {
  if (!rec) return false;
  if (rec.status === 'failed') return rec.attempts >= MAX_SEND_ATTEMPTS;
  return true;
}

/** The lowest step not yet settled, or null when the series is done. */
export function nextStep(sends: SendRecord[]): StepNumber | null {
  const byStep = new Map(sends.map((s) => [s.step, s]));
  for (const step of STEP_NUMBERS) {
    if (!stepSettled(byStep.get(step))) return step;
  }
  return null;
}

export interface TimingInput {
  step: StepNumber;
  delayDays: number;
  enrolledAt: Date;
  lastSentAt: Date | null;
  timezone: string;
  windowStart: number;
  windowEnd: number;
  minGapHours: number;
}

/** When the step becomes due, before the send window is applied. */
export function earliestSend(t: TimingInput): Date {
  const due = t.enrolledAt.getTime() + t.delayDays * 24 * 3600 * 1000;
  const gap = t.lastSentAt ? t.lastSentAt.getTime() + t.minGapHours * 3600 * 1000 : 0;
  return new Date(Math.max(due, gap));
}

export type SendDecision =
  | { send: true }
  | { send: false; reason: 'not_due' | 'outside_window'; at: Date };

/**
 * Should the step go out now? `at` on a "no" is the estimate the admin table
 * shows — exact for a due date, to the quarter hour for a window.
 */
export function decide(t: TimingInput, now: Date): SendDecision {
  const earliest = earliestSend(t);
  // Email 1 is "immediately after signup" — the window does not hold it back.
  const windowed = t.step !== 1;
  if (now < earliest) {
    const at = windowed ? nextWindowOpening(earliest, t.timezone, t.windowStart, t.windowEnd) : earliest;
    return { send: false, reason: 'not_due', at };
  }
  if (windowed && !inSendWindow(now, t.timezone, t.windowStart, t.windowEnd)) {
    return { send: false, reason: 'outside_window', at: nextWindowOpening(now, t.timezone, t.windowStart, t.windowEnd) };
  }
  return { send: true };
}

// ---------------------------------------------------------------------------
// Email 5's deadline
// ---------------------------------------------------------------------------

/** Days / hours / minutes left, floored, never negative — the countdown boxes. */
export function countdown(from: Date, to: Date): { days: number; hours: number; minutes: number } {
  const mins = Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60000));
  return { days: Math.floor(mins / 1440), hours: Math.floor((mins % 1440) / 60), minutes: mins % 60 };
}

/** "Fri, Oct 18 at 10:15 AM EDT" in the recipient's zone. */
export function formatDeadline(at: Date, tz: string): string {
  const fmt = (zone: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).formatToParts(at);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = fmt(tz);
  } catch {
    parts = fmt('UTC');
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')}, ${get('month')} ${get('day')} at ${get('hour')}:${get('minute')} ${get('dayPeriod')} ${get('timeZoneName')}`
    .replace(/\s+/g, ' ')
    .trim();
}
