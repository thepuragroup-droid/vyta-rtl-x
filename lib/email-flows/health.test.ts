/**
 * Unit tests for the email flows' setup check — the verdicts in
 * ./health-rules.ts. The probing (SMTP, DNS, Supabase) is in ./health.ts and
 * needs live services; these pin what each finding is called and how bad it is.
 *
 *   npx tsx --test lib/email-flows/health.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dnsChecks,
  effectiveFrom,
  flowChecks,
  footerCheck,
  fromAddress,
  recentSendChecks,
  schedulerChecks,
  signingSecretCheck,
  smtpEnvChecks,
  smtpLoginCheck,
  summarize,
  tableCheck,
  trackingCheck,
  TABLE_PROBES,
  type CronStatus,
  type HealthCheck,
  type SchedulerInput,
} from './health-rules';
import { defaultStep } from './defaults';
import { STEP_NUMBERS, type CodeCheck, type FlowSettings } from './types';

const NOW = new Date('2026-10-16T15:00:00Z');
const byId = (checks: HealthCheck[], id: string) => checks.find((c) => c.id === id);

const SMTP_OK = { SMTP_HOST: 'smtp.example.com', SMTP_USER: 'hello@vytabio.com', SMTP_PASSWORD: 'x', SMTP_FROM: 'VYTA <hello@vytabio.com>' };

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

test('smtpEnvChecks: complete settings pass', () => {
  const checks = smtpEnvChecks(SMTP_OK);
  assert.deepEqual(checks.map((c) => c.status), ['pass', 'pass', 'pass']);
});

test('smtpEnvChecks: names every missing variable', () => {
  const c = byId(smtpEnvChecks({ SMTP_HOST: 'h' }), 'smtp-env')!;
  assert.equal(c.status, 'fail');
  assert.match(c.detail, /SMTP_USER, SMTP_PASSWORD/);
});

test('smtpEnvChecks: port 25 warns, junk fails, unset defaults to 587', () => {
  assert.equal(byId(smtpEnvChecks({ ...SMTP_OK, SMTP_PORT: '25' }), 'smtp-port')!.status, 'warn');
  assert.equal(byId(smtpEnvChecks({ ...SMTP_OK, SMTP_PORT: 'abc' }), 'smtp-port')!.status, 'fail');
  assert.match(byId(smtpEnvChecks(SMTP_OK), 'smtp-port')!.detail, /587/);
});

test('smtpEnvChecks: From on another domain than the login warns; the built-in fallback fails', () => {
  assert.equal(byId(smtpEnvChecks({ ...SMTP_OK, SMTP_FROM: 'VYTA <hi@other.com>' }), 'smtp-from')!.status, 'warn');
  assert.equal(byId(smtpEnvChecks({}), 'smtp-from')!.status, 'fail');
  assert.equal(byId(smtpEnvChecks({ ...SMTP_OK, SMTP_FROM: 'VYTA' }), 'smtp-from')!.status, 'fail');
});

test('fromAddress / effectiveFrom: the same fallbacks as lib/smtp.ts', () => {
  assert.equal(fromAddress('VYTA <Hello@VytaBio.com>'), 'hello@vytabio.com');
  assert.equal(fromAddress('hello@vytabio.com'), 'hello@vytabio.com');
  assert.equal(fromAddress('VYTA'), null);
  assert.equal(effectiveFrom({ SMTP_USER: 'u@x.com', EMAIL_FROM: 'e@x.com' }).source, 'SMTP_USER');
  assert.equal(effectiveFrom({ EMAIL_FROM: 'e@x.com' }).source, 'EMAIL_FROM');
  assert.equal(effectiveFrom({}).source, 'default');
});

test('smtpLoginCheck: points at the likely cause', () => {
  assert.equal(smtpLoginCheck({ ok: true, ms: 120 }).status, 'pass');
  assert.equal(smtpLoginCheck(null).status, 'fail');
  assert.match(smtpLoginCheck({ ok: false, error: 'Invalid login: 535 5.7.8', ms: 1 }).fix!, /SMTP_PASSWORD/);
  assert.match(smtpLoginCheck({ ok: false, error: 'connect ETIMEDOUT 1.2.3.4:587', ms: 1 }).fix!, /SMTP_HOST/);
  assert.match(smtpLoginCheck({ ok: false, error: 'wrong version number', ms: 1 }).fix!, /465/);
});

test('dnsChecks: SPF and DMARC present, missing, doubled, or unreadable', () => {
  const good = dnsChecks('vytabio.com', { records: ['v=spf1 include:_spf.x.com ~all', 'google-site-verification=1'] }, { records: ['v=DMARC1; p=none'] });
  assert.deepEqual(good.map((c) => c.status), ['pass', 'pass']);

  const none = dnsChecks('vytabio.com', { error: 'ENODATA' }, { error: 'ENOTFOUND' });
  assert.deepEqual(none.map((c) => c.status), ['warn', 'warn']);

  const twice = dnsChecks('vytabio.com', { records: ['v=spf1 a ~all', 'v=spf1 mx ~all'] }, { records: [] });
  assert.equal(byId(twice, 'dns-spf')!.status, 'warn');
  assert.match(byId(twice, 'dns-spf')!.detail, /2 SPF records/);

  const down = dnsChecks('vytabio.com', { error: 'ETIMEOUT' }, { error: 'ESERVFAIL' });
  assert.deepEqual(down.map((c) => c.status), ['info', 'info']);

  assert.deepEqual(dnsChecks(null, null, null), []);
});

test('footerCheck: CASL needs a mailing address', () => {
  assert.equal(footerCheck({ footer_address: '' })!.status, 'fail');
  assert.equal(footerCheck({ footer_address: '1 King St W, Toronto' })!.status, 'pass');
  assert.equal(footerCheck(null), null);
});

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

test('tableCheck: missing table / column on our own tables → run the migration', () => {
  const own = TABLE_PROBES.find((p) => p.table === 'email_flow_steps')!;
  assert.equal(tableCheck(own, null).status, 'pass');
  const missing = tableCheck(own, { code: '42P01', message: 'relation "email_flow_steps" does not exist' });
  assert.equal(missing.status, 'fail');
  assert.match(missing.fix!, /email-flows-migration\.sql/);
  const column = tableCheck(own, { code: '42703', message: 'column email_flow_steps.hero_overlay does not exist' });
  assert.match(column.detail, /Out of date/);

  const store = TABLE_PROBES.find((p) => p.table === 'customers')!;
  assert.doesNotMatch(tableCheck(store, { code: '42703', message: 'column customers.contact_consent does not exist' }).fix!, /email-flows-migration/);
});

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

const HASH = 'a'.repeat(64);
const CRON_OK: CronStatus = {
  pg_cron: true,
  pg_net: true,
  vault: true,
  job: { schedule: '*/15 * * * *', active: true, calls_route: true, failed_24h: 0, last_run: { status: 'succeeded', start_time: '2026-10-16T14:45:00Z', end_time: '2026-10-16T14:45:01Z', message: '1 row' } },
  app_base_url: 'https://www.vytabio.com',
  cron_secret_sha256: HASH,
};
const sched = (over: Partial<SchedulerInput> = {}): SchedulerInput => ({
  env: { CRON_SECRET: 's' },
  siteUrl: 'https://www.vytabio.com',
  cron: CRON_OK,
  cronSecretSha256: HASH,
  lastCronAt: '2026-10-16T14:45:00Z',
  anyFlowOn: true,
  now: NOW,
  ...over,
});

test('schedulerChecks: a healthy scheduler passes everything', () => {
  const checks = schedulerChecks(sched());
  assert.deepEqual(
    checks.filter((c) => c.status !== 'pass').map((c) => c.id),
    [],
  );
  assert.match(byId(checks, 'cron-heartbeat')!.detail, /15 min ago/);
});

test('schedulerChecks: CRON_SECRET missing fails while a flow is on, warns while both are off', () => {
  assert.equal(byId(schedulerChecks(sched({ env: {}, cronSecretSha256: null })), 'cron-secret')!.status, 'fail');
  assert.equal(byId(schedulerChecks(sched({ env: {}, cronSecretSha256: null, anyFlowOn: false })), 'cron-secret')!.status, 'warn');
});

test('schedulerChecks: no job, paused job, wrong command', () => {
  assert.equal(byId(schedulerChecks(sched({ cron: { ...CRON_OK, job: null } })), 'cron-job')!.status, 'fail');
  assert.match(byId(schedulerChecks(sched({ cron: { ...CRON_OK, job: { ...CRON_OK.job!, active: false } } })), 'cron-job')!.detail, /paused/);
  assert.equal(byId(schedulerChecks(sched({ cron: { ...CRON_OK, job: { ...CRON_OK.job!, calls_route: false } } })), 'cron-job')!.status, 'fail');
});

test('schedulerChecks: missing extensions are named', () => {
  const c = byId(schedulerChecks(sched({ cron: { ...CRON_OK, pg_net: false } })), 'cron-ext')!;
  assert.equal(c.status, 'fail');
  assert.match(c.detail, /pg_net is not enabled/);
});

test('schedulerChecks: Vault secrets — missing, mismatched, or a different site', () => {
  assert.equal(byId(schedulerChecks(sched({ cron: { ...CRON_OK, cron_secret_sha256: 'b'.repeat(64) } })), 'cron-vault-secret')!.status, 'fail');
  assert.equal(byId(schedulerChecks(sched({ cron: { ...CRON_OK, cron_secret_sha256: null } })), 'cron-vault-secret')!.status, 'fail');
  assert.equal(byId(schedulerChecks(sched({ cron: { ...CRON_OK, app_base_url: null } })), 'cron-base-url')!.status, 'fail');
  assert.equal(byId(schedulerChecks(sched({ cron: { ...CRON_OK, app_base_url: 'https://preview.vercel.app' } })), 'cron-base-url')!.status, 'warn');
  // www. or not, it's the same site.
  assert.equal(byId(schedulerChecks(sched({ cron: { ...CRON_OK, app_base_url: 'https://vytabio.com/' } })), 'cron-base-url')!.status, 'pass');
});

test('schedulerChecks: the heartbeat — stale, never, or not installed', () => {
  assert.equal(byId(schedulerChecks(sched({ lastCronAt: '2026-10-16T13:00:00Z' })), 'cron-heartbeat')!.status, 'fail');
  assert.equal(byId(schedulerChecks(sched({ lastCronAt: null })), 'cron-heartbeat')!.status, 'fail');
  // Without the health migration, the job can't be seen: say so once, as info.
  const blind = schedulerChecks(sched({ cron: null, lastCronAt: undefined }));
  assert.deepEqual(blind.map((c) => [c.id, c.status]), [['cron-secret', 'pass'], ['cron-job', 'info']]);
});

test('schedulerChecks: a failed last run carries its message', () => {
  const failed = { ...CRON_OK, job: { ...CRON_OK.job!, failed_24h: 3, last_run: { status: 'failed', start_time: '2026-10-16T14:45:00Z', end_time: null, message: 'schema "net" does not exist' } } };
  const c = byId(schedulerChecks(sched({ cron: failed })), 'cron-last-run')!;
  assert.equal(c.status, 'fail');
  assert.match(c.detail, /schema "net" does not exist.*3 failed/);
});

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

test('signingSecretCheck: own secret passes, a borrowed one warns, none fails', () => {
  assert.equal(signingSecretCheck({ EMAIL_FLOWS_SECRET: 'x' }).status, 'pass');
  assert.match(signingSecretCheck({ CRON_SECRET: 'x' }).detail, /CRON_SECRET/);
  assert.equal(signingSecretCheck({ CRON_SECRET: 'x' }).status, 'warn');
  assert.equal(signingSecretCheck({}).status, 'fail');
});

// ---------------------------------------------------------------------------
// Each flow
// ---------------------------------------------------------------------------

const settings = (over: Partial<FlowSettings> = {}): FlowSettings => ({
  flow: 'welcome', enabled: true, enabled_at: '2026-10-01T00:00:00Z', send_window_start: 9, send_window_end: 11,
  default_timezone: 'America/Toronto', min_gap_hours: 20, reentry_days: 30, footer_address: 'x', footer_disclaimer: '', ...over,
});
const welcomeSteps = (code: string | null) => STEP_NUMBERS.map((n) => ({ ...defaultStep('welcome', n), promo_code: n === 1 || n === 4 || n === 5 ? code : null }));
const codes = (entries: Array<[string, Partial<CodeCheck>]>) =>
  new Map(entries.map(([k, v]) => [k, { code: k, usable: true, label: '10%', problem: null, ...v } as CodeCheck]));

test('flowChecks: a configured flow passes', () => {
  const checks = flowChecks({ flow: 'welcome', settings: settings(), steps: welcomeSteps('WELCOME10'), codes: codes([['WELCOME10', {}]]), problems: new Map(), now: NOW });
  assert.deepEqual(checks.filter((c) => c.status === 'fail' || c.status === 'warn'), []);
  assert.match(byId(checks, 'welcome-codes')!.detail, /WELCOME10/);
});

test('flowChecks: a missing or dead code fails while on, warns while off', () => {
  const missing = flowChecks({ flow: 'welcome', settings: settings(), steps: welcomeSteps(null), codes: new Map(), problems: new Map(), now: NOW });
  assert.equal(byId(missing, 'welcome-codes')!.status, 'fail');
  assert.match(byId(missing, 'welcome-codes')!.detail, /Email 1 offers a discount/);

  const off = flowChecks({ flow: 'welcome', settings: settings({ enabled: false }), steps: welcomeSteps(null), codes: new Map(), problems: new Map(), now: NOW });
  assert.equal(byId(off, 'welcome-codes')!.status, 'warn');

  const expired = flowChecks({
    flow: 'welcome', settings: settings(), steps: welcomeSteps('OLD10'),
    codes: codes([['OLD10', { usable: false, problem: 'OLD10 has expired.' }]]), problems: new Map(), now: NOW,
  });
  assert.match(byId(expired, 'welcome-codes')!.detail, /OLD10 has expired/);
});

test('flowChecks: merge-tag problems on live emails warn; switched-off emails are ignored', () => {
  const steps = welcomeSteps('W');
  steps[1] = { ...steps[1], enabled: false };
  const problems = new Map([[2, ['{{nope}} is not a merge tag.']], [3, ['{{cart_url}} is cart-only.']]]);
  const c = byId(flowChecks({ flow: 'welcome', settings: settings(), steps, codes: codes([['W', {}]]), problems, now: NOW }), 'welcome-copy')!;
  assert.equal(c.status, 'warn');
  assert.doesNotMatch(c.detail, /Email 2/);
  assert.match(c.detail, /Email 3/);
});

test('flowChecks: cart flow notices when no carts are being saved', () => {
  const steps = STEP_NUMBERS.map((n) => ({ ...defaultStep('cart', n), promo_code: n === 3 ? 'C' : null }));
  const base = { flow: 'cart' as const, settings: settings({ flow: 'cart' }), steps, codes: codes([['C', {}]]), problems: new Map(), now: NOW };
  assert.equal(byId(flowChecks({ ...base, latestCartAt: '2026-10-16T12:00:00Z' }), 'cart-carts')!.status, 'pass');
  assert.equal(byId(flowChecks({ ...base, latestCartAt: '2026-09-01T00:00:00Z' }), 'cart-carts')!.status, 'warn');
  assert.equal(byId(flowChecks({ ...base, latestCartAt: null, settings: settings({ flow: 'cart', enabled: false }) }), 'cart-carts')!.status, 'info');
});

// ---------------------------------------------------------------------------
// Recent sends and the summary
// ---------------------------------------------------------------------------

test('recentSendChecks: failures still retrying warn, given-up ones fail, stuck sends warn', () => {
  const row = (status: string, attempts: number, updated_at: string, error: string | null = null) => ({ flow: 'cart', step: 2, status, attempts, error, updated_at });
  assert.equal(byId(recentSendChecks([], 12, NOW), 'sends-failed')!.status, 'pass');
  assert.equal(byId(recentSendChecks([row('failed', 1, '2026-10-16T10:00:00Z', '421 try later')], 0, NOW), 'sends-failed')!.status, 'warn');
  const gaveUp = byId(recentSendChecks([row('failed', 3, '2026-10-16T10:00:00Z', '550 rejected')], 0, NOW), 'sends-failed')!;
  assert.equal(gaveUp.status, 'fail');
  assert.match(gaveUp.detail, /Cart Abandonment 2\): 550 rejected/);

  assert.equal(byId(recentSendChecks([row('sending', 1, '2026-10-16T14:55:00Z')], 0, NOW), 'sends-stuck'), undefined);
  assert.equal(byId(recentSendChecks([row('sending', 1, '2026-10-16T10:00:00Z')], 0, NOW), 'sends-stuck')!.status, 'warn');
});

test('summarize: ok means no failures — warnings don’t count', () => {
  const r = summarize([
    { id: 'a', group: 'Sending', label: 'a', status: 'pass', detail: '' },
    { id: 'b', group: 'Sending', label: 'b', status: 'warn', detail: '' },
  ], NOW);
  assert.equal(r.ok, true);
  assert.deepEqual(r.counts, { pass: 1, warn: 1, fail: 0, info: 0 });
  assert.equal(summarize([{ id: 'c', group: 'Links', label: 'c', status: 'fail', detail: '' }], NOW).ok, false);
});

test('trackingCheck: post-click tracking is optional — a warning, never a failure', () => {
  assert.equal(trackingCheck(null).status, 'pass');
  const missing = trackingCheck({ code: '42P01', message: 'relation "email_flow_events" does not exist' });
  assert.equal(missing.status, 'warn');
  assert.match(missing.fix!, /email-flows-tracking-migration\.sql/);
});
