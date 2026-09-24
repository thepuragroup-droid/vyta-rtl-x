import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  createKlaviyoEvent,
  getKlaviyoAccount,
  isValidEmail,
  KlaviyoApiError,
  listKlaviyoLists,
  readKlaviyoSettings,
} from '@/lib/klaviyo/client';
import { isKlaviyoAdmin } from '@/lib/klaviyo/admin-auth';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * POST /api/admin/klaviyo/test  { private_api_key?, test_email? }
 *
 * Checks the Klaviyo connection. Uses the key in the body when one is given
 * (so a key can be tried before it is saved), else the stored one. Returns the
 * account (including its public key / Site ID, so the UI can fill it in), the
 * account's lists for the list picker, and a checklist of anything missing.
 * With `test_email`, also sends a "VYTA Test Event" to that profile so the
 * event pipeline can be seen landing in Klaviyo → Analytics → Metrics.
 */
export async function POST(req: NextRequest) {
  if (!(await isKlaviyoAdmin(db, req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }

  const settings = await readKlaviyoSettings(db);
  const typedKey = typeof body.private_api_key === 'string' ? body.private_api_key.trim() : '';
  const key = typedKey || settings.privateKey;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!key) {
    return NextResponse.json({
      ok: false,
      has_private_key: false,
      errors: ['No private API key — paste one from Klaviyo → Settings → API keys.'],
    });
  }

  let account = null;
  let lists: { id: string; name: string }[] = [];
  try {
    account = await getKlaviyoAccount(key);
  } catch (err) {
    const msg =
      err instanceof KlaviyoApiError
        ? err.status === 401 || err.status === 403
          ? 'Klaviyo rejected the key. Make sure it is a PRIVATE key (pk_…) with at least Accounts, Events, Lists, Profiles and Subscriptions access.'
          : err.detail
        : 'Could not reach Klaviyo.';
    return NextResponse.json({ ok: false, has_private_key: true, errors: [msg] });
  }

  try {
    lists = await listKlaviyoLists(key);
  } catch (err) {
    warnings.push(
      `Could not read lists (${err instanceof KlaviyoApiError ? err.detail : 'network error'}) — give the key Lists: Read access.`,
    );
  }

  if (!settings.enabled) warnings.push('The integration is switched off — nothing is being sent yet.');
  if (!settings.publicKey) {
    warnings.push('Public key / Site ID is not saved — onsite tracking and signup forms will not load.');
  } else if (account?.public_api_key && account.public_api_key !== settings.publicKey) {
    errors.push(
      `Saved Site ID (${settings.publicKey}) does not match this account's (${account.public_api_key}).`,
    );
  }
  if (!settings.listId) {
    warnings.push('No newsletter list chosen — consenting signups will get a profile but not be subscribed.');
  } else if (lists.length > 0 && !lists.some((l) => l.id === settings.listId)) {
    errors.push(`Saved list ${settings.listId} was not found in this account.`);
  }

  let testEvent: { sent: boolean; email?: string; error?: string } | null = null;
  const testEmail = typeof body.test_email === 'string' ? body.test_email.trim() : '';
  if (testEmail) {
    if (!isValidEmail(testEmail)) {
      testEvent = { sent: false, error: 'Enter a valid email for the test event.' };
    } else {
      try {
        await createKlaviyoEvent(key, {
          metric: 'VYTA Test Event',
          profile: { email: testEmail },
          properties: { Source: 'Admin → Settings → Klaviyo', SentAt: new Date().toISOString() },
        });
        testEvent = { sent: true, email: testEmail };
      } catch (err) {
        testEvent = {
          sent: false,
          error:
            err instanceof KlaviyoApiError
              ? `${err.detail} — the key needs Events: Full access.`
              : 'Could not reach Klaviyo.',
        };
      }
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    has_private_key: true,
    key_source: typedKey ? 'typed' : settings.keySource,
    account,
    lists,
    errors,
    warnings,
    test_event: testEvent,
  });
}
