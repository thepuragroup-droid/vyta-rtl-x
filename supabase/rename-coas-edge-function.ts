// ============================================================================
// Supabase Edge Function — rename COA PDFs to the no-dash naming
// ============================================================================
//
// A paste-and-run alternative to scripts/rename-coa-files.ts, for when you
// don't want a local Node setup. Renames the certificate PDFs in the
// `certificates` storage bucket:
//
//   bpc-157-10mg.pdf                    -> bpc15710mg.pdf
//   cjc-1295-ipamorelin-no-dac-10mg.pdf -> cjc1295ipamnodac10mg.pdf
//   ghk-cu-50mg.pdf                     -> ghkcu50mg.pdf
//   ipamorelin-10mg.pdf                 -> ipam10mg.pdf
//   tb-500-10mg.pdf                     -> tb50010mg.pdf
//
// Every dash goes, across every certificate in the bucket.
//
// ---------------------------------------------------------------------------
// HOW TO USE — entirely from the Supabase dashboard
// ---------------------------------------------------------------------------
// 1. Edge Functions -> Deploy a new function, name it `rename-coas`, paste
//    this in, deploy.
//
// 2. DRY RUN: hit Invoke / Test with no changes. It lists what it would
//    rename and touches nothing. This is the default — apply never happens
//    by accident.
//
// 3. APPLY: Edge Functions -> rename-coas -> Secrets, add
//
//        ALLOW_APPLY = true
//
//    then invoke again with body  {"apply": true}  (or add ?apply=true to
//    the URL). Both are accepted.
//
// 4. Run product-dash-removal-migration.sql to update the database links.
//
// 5. Remove the ALLOW_APPLY secret and DELETE THIS FUNCTION. It exists to be
//    run once.
//
// ---------------------------------------------------------------------------
// On authorisation: an Edge Function is a public HTTPS endpoint, and the gate
// Supabase applies by default is satisfied by the anon key, which is public
// (it ships in your frontend). So the anon key is not a meaningful control on
// something that mutates storage.
//
// Rather than demand a bearer token — which puts your service role key into
// shell history and breaks the dashboard's own Invoke button — the destructive
// half is gated on a secret only someone with dashboard access can set. A dry
// run stays open, which is harmless: it only lists the names of PDFs that are
// already publicly linked from the storefront.
//
// The service role key itself is read from the environment Supabase injects
// into this function. It is never pasted here and never sent over the wire.
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const BUCKET = 'certificates';

/**
 * Mirrors public.undash_compound_url() in the SQL migration and undash() in
 * scripts/rename-coa-files.ts. All three must agree, or storage and the
 * database drift apart.
 *
 * Every dash goes, across every certificate.
 */
function undash(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/ipamorelin/g, 'ipam')
    // "-ipa-" blend shorthand, expanded while the delimiting dashes still
    // exist. Whole segment only, so it cannot clip a longer word.
    .replace(/(?<=-)ipa(?=-|\.|$)/g, 'ipam')
    .replace(/-/g, '');
}

/** apply=true may arrive as a query param or in a JSON body — accept either. */
async function wantsApply(req: Request): Promise<boolean> {
  if (new URL(req.url).searchParams.get('apply') === 'true') return true;
  try {
    const body = await req.json();
    return body?.apply === true || body?.apply === 'true';
  } catch {
    return false; // no body, or not JSON — treat as a dry run
  }
}

Deno.serve(async (req: Request) => {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !serviceKey) {
    return json(
      { error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from the function environment.' },
      500,
    );
  }

  const requested = await wantsApply(req);
  const permitted = Deno.env.get('ALLOW_APPLY') === 'true';
  const apply = requested && permitted;

  const supabase = createClient(url, serviceKey);

  // Page through the bucket rather than assuming it fits in one response.
  const files: string[] = [];
  const PAGE = 100;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage.from(BUCKET).list('', { limit: PAGE, offset });
    if (error) return json({ error: `Could not list "${BUCKET}": ${error.message}` }, 500);
    if (!data || data.length === 0) break;
    files.push(...data.map((f) => f.name));
    if (data.length < PAGE) break;
  }

  const renames = files
    .map((from) => ({ from, to: undash(from) }))
    .filter((r) => r.from !== r.to);

  if (renames.length === 0) {
    return json({
      applied: false,
      scanned: files.length,
      message: 'Nothing to rename — every file already uses the dashless names.',
    });
  }

  if (!apply) {
    return json({
      applied: false,
      dryRun: true,
      scanned: files.length,
      wouldRename: renames,
      next: requested && !permitted
        ? 'apply was requested but the ALLOW_APPLY secret is not set to "true". Add it under Edge Functions -> rename-coas -> Secrets, then invoke again.'
        : 'Add the ALLOW_APPLY=true secret and invoke with {"apply": true} to perform these renames.',
    });
  }

  const renamed: { from: string; to: string }[] = [];
  const skipped: { from: string; to: string; reason: string }[] = [];

  for (const { from, to } of renames) {
    // Never clobber an existing object — a collision means the new name is
    // already taken and needs a human decision.
    if (files.includes(to)) {
      skipped.push({ from, to, reason: 'target already exists' });
      continue;
    }
    const { error } = await supabase.storage.from(BUCKET).move(from, to);
    if (error) {
      skipped.push({ from, to, reason: error.message });
      continue;
    }
    renamed.push({ from, to });
  }

  return json({
    applied: true,
    scanned: files.length,
    renamed,
    skipped,
    next: 'Now run product-dash-removal-migration.sql, then remove the ALLOW_APPLY secret and delete this function.',
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
