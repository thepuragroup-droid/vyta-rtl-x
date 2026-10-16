/**
 * The email flows' setup check from the command line — the same thing as
 * Admin → Email Flows → Setup check. SMTP (signs in, sends nothing), the
 * database, the scheduler, the link secret, each flow's codes and copy, and
 * recent failures.
 *
 * Usage:
 *   npx tsx scripts/email-flows-check.ts           (every check)
 *   npx tsx scripts/email-flows-check.ts --issues  (only problems and warnings)
 *   npx tsx scripts/email-flows-check.ts --json    (the raw report)
 *
 * Exits 1 when any check fails, so it can gate a deploy.
 *
 * Reads .env.local if present. Needs SUPABASE_SERVICE_ROLE_KEY (and
 * NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL). Run it with the production
 * environment's variables to check production — the SMTP, secret and From
 * checks read whatever this shell has.
 */
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { runHealthCheck } from '@/lib/email-flows/health';
import { CHECK_GROUPS, type CheckStatus } from '@/lib/email-flows/health-rules';

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local — the environment has to carry everything.
}

const { values: args } = parseArgs({
  options: { issues: { type: 'boolean' }, json: { type: 'boolean' } },
});

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}

const MARK: Record<CheckStatus, string> = { pass: '✔', warn: '!', fail: '✘', info: 'i' };

async function main() {
  const report = await runHealthCheck(createClient(url, key, { auth: { persistSession: false } }));

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const group of CHECK_GROUPS) {
      const rows = report.checks.filter((c) => c.group === group && (!args.issues || c.status === 'fail' || c.status === 'warn'));
      if (!rows.length) continue;
      console.log(`\n${group}`);
      for (const c of rows) {
        console.log(`  ${MARK[c.status]} ${c.label} — ${c.detail}`);
        if (c.fix) console.log(`      Fix: ${c.fix}`);
      }
    }
    const { pass, warn, fail } = report.counts;
    console.log(`\n${fail ? `${fail} problem${fail === 1 ? '' : 's'} to fix` : 'No problems'} · ${pass} passed · ${warn} warning${warn === 1 ? '' : 's'}`);
  }
  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(2);
});
