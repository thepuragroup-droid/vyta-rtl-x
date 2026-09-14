/**
 * Builder for the onboarding email an admin sends when an account is first
 * created — "your account is ready, set a password". It carries a Supabase
 * `recovery` action link, minted by `auth.admin.generateLink` and delivered
 * over our own SMTP so the copy can welcome the recipient by name.
 *
 * PASSWORD RESETS DO NOT COME THROUGH HERE. A reset is sent by Supabase itself
 * (see lib/admin/password-reset.ts), from the Reset Password template, so an
 * admin-triggered reset is identical to one the recipient requests from
 * /forgot-password. Reset copy previously lived in this file and drifted from
 * that template; keeping one owner per email is the point.
 *
 * Deliberately free of nodemailer/Supabase imports so the copy can be rendered
 * (and tested) without a mail transport.
 */
export type AccountLinkAudience = 'customer' | 'affiliate';

export interface AccountLinkEmailInput {
  audience: AccountLinkAudience;
  /** Recipient's first name. Falls back to a neutral greeting when absent. */
  firstName?: string | null;
  /** The Supabase action link the button points at. */
  actionLink: string;
  /** How long the link stays good for, in hours. Matches Supabase's default. */
  expiryHours?: number;
}

export interface AccountLinkEmail {
  subject: string;
  html: string;
  text: string;
}

/** Escapes text interpolated into the HTML body — names come from user input. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface Copy {
  subject: string;
  heading: string;
  intro: string;
  cta: string;
}

function copyFor(audience: AccountLinkAudience, greetingName: string): Copy {
  return audience === 'affiliate'
    ? {
        subject: 'Set up your Aminocan affiliate account',
        heading: 'Set Up Your Account',
        intro: `Hi ${greetingName}, your affiliate account is ready. Click below to set your password and sign in.`,
        cta: 'Set Password',
      }
    : {
        subject: 'Sign in to your Aminocan account',
        heading: 'Sign in to your account',
        intro: `Hi ${greetingName}, click below to set your password and sign in.`,
        cta: 'Set Password & Sign In',
      };
}

export function buildAccountLinkEmail(input: AccountLinkEmailInput): AccountLinkEmail {
  const { audience, actionLink, expiryHours = 1 } = input;
  const greetingName = (input.firstName || '').trim() || 'there';
  const { subject, heading, intro, cta } = copyFor(audience, greetingName);

  const footnote = `This link expires in ${expiryHours === 1 ? 'an hour' : `${expiryHours} hours`} and can only be used once.`;

  const affiliateKicker =
    audience === 'affiliate'
      ? `<p style="font-size: 11px; letter-spacing: 0.15em; color: #9C8B5A; margin: 4px 0 0; text-transform: uppercase;">Affiliate Program</p>`
      : '';

  const html = `
      <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <div style="padding: 32px 24px; text-align: center; border-bottom: 1px solid #E5E7EB;">
          <h1 style="font-size: 24px; font-weight: 700; color: #1A1A1A; margin: 0;">AMINOCAN</h1>${affiliateKicker}
        </div>
        <div style="padding: 32px 24px; text-align: center;">
          <h2 style="font-size: 20px; font-weight: 600; color: #1A1A1A; margin: 0 0 8px;">${escapeHtml(heading)}</h2>
          <p style="font-size: 14px; color: #6B7280; margin: 0 0 24px;">
            ${escapeHtml(intro)}
          </p>
          <a href="${actionLink}" style="display: inline-block; padding: 12px 24px; background: #1A1A1A; color: #FFFFFF; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">
            ${escapeHtml(cta)}
          </a>
          <p style="font-size: 12px; color: #9CA3AF; margin: 24px 0 0; line-height: 1.6;">
            ${escapeHtml(footnote)}
          </p>
        </div>
        <div style="padding: 24px; text-align: center; background: #F7F7F7; border-top: 1px solid #E5E7EB;">
          <p style="font-size: 12px; color: #9CA3AF; margin: 0;">Aminocan Peptides &bull; Canada</p>
        </div>
      </div>
    `;

  const text = [intro, '', actionLink, '', footnote, '', 'Aminocan Peptides • Canada'].join('\n');

  return { subject, html, text };
}
