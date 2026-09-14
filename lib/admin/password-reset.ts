/**
 * Admin-triggered password reset.
 *
 * Hands the send to Supabase Auth rather than minting a link and mailing it
 * ourselves. `resetPasswordForEmail` is the same call the self-serve
 * /forgot-password page makes, so an admin-triggered reset and a customer's own
 * reset now produce an identical email from an identical mechanism — one
 * template to maintain (Supabase → Authentication → Email Templates → Reset
 * Password) instead of branded copy that drifts out of step with it.
 *
 * Called with the ANON key, deliberately. This is the public `/auth/v1/recover`
 * endpoint; sending it a service-role token would exercise a different, admin
 * code path in GoTrue whose rate-limiting and behaviour are not what the
 * browser flow gets. Same key, same endpoint, same result.
 *
 * The `redirectTo` MUST be listed under Supabase → Authentication → URL
 * Configuration → Redirect URLs. When it is not, GoTrue silently falls back to
 * the project's Site URL, the buyer lands on the homepage with no recovery
 * session, and /reset-password reports the link as invalid or expired — which
 * looks exactly like a broken link rather than a missing allow-list entry.
 */
import { createClient } from '@supabase/supabase-js';
import { SITE_URL } from '@/lib/config';

/** Where the recovery link drops the recipient once GoTrue has verified it. */
export const PASSWORD_RESET_PATH = '/reset-password';

export interface PasswordResetResult {
  success: boolean;
  error?: string;
}

/**
 * Supabase throttles recovery sends per address and per project. An admin
 * resetting several accounts in a row will meet it, so it is worth saying so
 * plainly instead of surfacing the raw GoTrue string.
 */
function friendlyResetError(message: string | undefined, status: number | undefined): string {
  const msg = (message || '').toLowerCase();
  if (status === 429 || msg.includes('rate limit') || msg.includes('for security purposes')) {
    return 'Supabase is rate-limiting password reset emails. Wait a minute and try again.';
  }
  if (msg.includes('redirect') && msg.includes('not allowed')) {
    return 'The reset link\'s redirect URL is not in the Supabase allow-list (Authentication → URL Configuration).';
  }
  return message || 'Failed to send the password reset email';
}

/**
 * Ask Supabase to email its Reset Password template to `email`.
 *
 * Note this reports only whether the send was accepted — the link itself never
 * reaches this process, so there is no fallback that hands an admin a URL to
 * pass along by hand. That is the trade for having Supabase own the email.
 */
export async function sendPasswordResetEmail(
  email: string,
  redirectPath: string = PASSWORD_RESET_PATH,
): Promise<PasswordResetResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return { success: false, error: 'Supabase is not configured for password resets' };
  }

  const auth = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  const { error } = await auth.auth.resetPasswordForEmail(email, {
    redirectTo: `${SITE_URL}${redirectPath}`,
  });

  if (error) {
    console.error('[auth] password reset send failed:', error);
    return {
      success: false,
      error: friendlyResetError(error.message, (error as { status?: number }).status),
    };
  }

  return { success: true };
}
