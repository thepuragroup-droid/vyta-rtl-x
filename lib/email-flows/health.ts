/**
 * Email flows — the setup check. Server-only.
 *
 * Looks at every piece the flows need and reports each as pass / warn / fail
 * with the fix (rules and wording in ./health-rules.ts):
 *
 *   Sending       SMTP_* set, a real sign-in to the SMTP server (nothing is
 *                 sent), the From address, SPF and DMARC on its domain, the
 *                 CASL footer address.
 *   Database      every table and column the flows read and write.
 *   Scheduler     CRON_SECRET, the Supabase Cron job and its Vault secrets,
 *                 and the last time a scheduled run actually reached the app.
 *   Links         the secret that signs unsubscribe / open / click links.
 *   Each flow     switch, discount codes, merge tags, carts being saved.
 *   Recent sends  failures and sends cut off mid-way in the last 7 days.
 *
 * Read-only apart from loadConfig seeding missing default rows — the same as
 * opening the Email Flows page. Safe to run as often as you like.
 */
import { createHash } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SITE_URL } from '@/lib/config';
import { verifySmtp } from '@/lib/smtp';
import { checkCodes, loadConfig } from './engine';
import { mergeTagProblems } from './render';
import {
  TABLE_PROBES,
  dnsChecks,
  effectiveFrom,
  emailDomain,
  flowChecks,
  footerCheck,
  fromAddress,
  recentSendChecks,
  schedulerChecks,
  signingSecretCheck,
  smtpConfigured,
  smtpEnvChecks,
  smtpLoginCheck,
  summarize,
  tableCheck,
  trackingCheck,
  trackFunctionCheck,
  type CronStatus,
  type HealthCheck,
  type HealthReport,
  type RecentSendRow,
  type TxtLookup,
} from './health-rules';
import { FLOW_KEYS, FLOWS, STEP_NUMBERS, type FlowSettings } from './types';

type Db = SupabaseClient<any, any, any>;

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

async function txt(name: string): Promise<TxtLookup> {
  try {
    const records = await Promise.race([
      resolveTxt(name),
      new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), 5000)),
    ]);
    return { records: records.map((chunks) => chunks.join('')) };
  } catch (err: any) {
    return { error: err?.code ?? err?.message ?? 'lookup failed' };
  }
}

async function sendingChecks(env: NodeJS.ProcessEnv): Promise<HealthCheck[]> {
  const domain = emailDomain(fromAddress(effectiveFrom(env).from));
  const [login, spf, dmarc] = await Promise.all([
    smtpConfigured(env) ? verifySmtp() : Promise.resolve(null),
    domain ? txt(domain) : Promise.resolve(null),
    domain ? txt(`_dmarc.${domain}`) : Promise.resolve(null),
  ]);
  return [...smtpEnvChecks(env), smtpLoginCheck(login), ...dnsChecks(domain, spf, dmarc)];
}

async function databaseChecks(db: Db): Promise<{ checks: HealthCheck[]; ownTablesOk: boolean }> {
  const results = await Promise.all(
    TABLE_PROBES.map(async (p) => {
      const { error } = await db.from(p.table).select(p.columns).limit(1);
      return { p, check: tableCheck(p, error) };
    }),
  );
  // 'none' matches neither branch of the function: it is called, and changes nothing.
  const { error: trackErr } = await db.rpc('email_flow_track', { p_send_id: NIL_UUID, p_kind: 'none' });
  const [{ error: eventsErr }, { error: viaErr }] = await Promise.all([
    db.from('email_flow_events').select('id, send_id, kind, machine, order_ref').limit(1),
    db.from('email_flow_entries').select('converted_via').limit(1),
  ]);
  const checks = [...results.map((r) => r.check), trackFunctionCheck(trackErr), trackingCheck(eventsErr ?? viaErr)];
  return { checks, ownTablesOk: results.every((r) => !r.p.own || r.check.status === 'pass') };
}

async function cronStatus(db: Db): Promise<CronStatus | null> {
  const { data, error } = await db.rpc('email_flows_cron_status');
  if (error || !data) return null;
  return data as CronStatus;
}

async function lastCronAt(db: Db): Promise<string | null | undefined> {
  const { data, error } = await db.from('email_flow_settings').select('last_cron_at');
  if (error) return undefined;
  const stamps = (data ?? []).map((r: any) => r.last_cron_at as string | null).filter(Boolean) as string[];
  return stamps.sort().at(-1) ?? null;
}

export async function runHealthCheck(db: Db, now = new Date()): Promise<HealthReport> {
  const env = process.env;

  const [sending, database] = await Promise.all([sendingChecks(env), databaseChecks(db)]);
  const checks: HealthCheck[] = [...sending, ...database.checks];

  // Everything below reads the flows' own tables; without them it would only
  // repeat "run the migration" a dozen times.
  if (!database.ownTablesOk) {
    checks.push(signingSecretCheck(env));
    return summarize(checks, now);
  }

  const configs = await Promise.all(FLOW_KEYS.map((f) => loadConfig(db, f)));
  const settings: FlowSettings[] = [];
  const flowResults: HealthCheck[] = [];
  const weekAgo = new Date(now.getTime() - 7 * 864e5).toISOString();

  const [latestCart, recent, sent, cron, heartbeat] = await Promise.all([
    db.from('saved_carts').select('updated_at').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    db
      .from('email_flow_sends')
      .select('flow, step, status, attempts, error, updated_at')
      .in('status', ['failed', 'sending'])
      .gte('updated_at', weekAgo)
      .order('updated_at', { ascending: false })
      .limit(500),
    db.from('email_flow_sends').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('sent_at', weekAgo),
    cronStatus(db),
    lastCronAt(db),
  ]);

  for (const [i, flow] of FLOW_KEYS.entries()) {
    const loaded = configs[i];
    const group = FLOWS[flow].label as HealthCheck['group'];
    if (!loaded.ok) {
      flowResults.push({ id: `${flow}-config`, group, label: 'Settings', status: 'fail', detail: `Couldn’t load: ${loaded.error}` });
      continue;
    }
    const { config } = loaded;
    settings.push(config.settings);
    const steps = STEP_NUMBERS.map((n) => config.steps[n]);
    const codes = await checkCodes(db, steps.filter((s) => s.enabled).map((s) => s.promo_code), now);
    flowResults.push(
      ...flowChecks({
        flow,
        settings: config.settings,
        steps,
        codes,
        problems: new Map(steps.map((s) => [s.step, mergeTagProblems(s)])),
        latestCartAt: flow === 'cart' ? (latestCart.error ? undefined : (latestCart.data?.updated_at ?? null)) : undefined,
        now,
      }),
    );
  }

  const footer = footerCheck(settings[0] ?? null);
  if (footer) checks.push(footer);

  checks.push(
    ...schedulerChecks({
      env,
      siteUrl: SITE_URL,
      cron,
      cronSecretSha256: env.CRON_SECRET ? createHash('sha256').update(env.CRON_SECRET, 'utf8').digest('hex') : null,
      lastCronAt: heartbeat,
      anyFlowOn: settings.some((s) => s.enabled),
      now,
    }),
    signingSecretCheck(env),
    ...flowResults,
    ...recentSendChecks((recent.data ?? []) as RecentSendRow[], sent.count ?? 0, now),
  );
  return summarize(checks, now);
}
