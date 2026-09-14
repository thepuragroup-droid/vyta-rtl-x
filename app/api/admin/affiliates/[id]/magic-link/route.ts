import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendMail } from '@/lib/smtp';
import { SITE_URL } from '@/lib/config';
import { buildAccountLinkEmail } from '@/lib/admin/account-link-email';
import { sendPasswordResetEmail, PASSWORD_RESET_PATH } from '@/lib/admin/password-reset';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function verifyAdmin(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return false;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return false;
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  return data?.role === 'admin';
}

// POST - email an account link to the affiliate.
//
// Affiliates authenticate through Supabase auth, not the vestigial
// `affiliates.password_hash` column, so a recovery link is the real mechanism
// for both onboarding and resets. `purpose` only picks the copy: 'welcome'
// (the default, so existing callers are unchanged) for a freshly created
// account, 'reset' for someone who already signed in and needs a new password.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const redirectPath: string = body?.redirectPath || PASSWORD_RESET_PATH;
    const purpose: 'welcome' | 'reset' = body?.purpose === 'reset' ? 'reset' : 'welcome';
    const redirectTo = `${SITE_URL}${redirectPath}`;

    const { data: affiliate } = await db
      .from('affiliates')
      .select('email, first_name')
      .eq('id', params.id)
      .single();

    if (!affiliate?.email) {
      return NextResponse.json({ error: 'Affiliate not found' }, { status: 404 });
    }

    // A reset goes through Supabase itself, so the recipient gets the same
    // email — from the same template — whether an admin sent it or they used
    // /forgot-password. The link never reaches this process, hence no
    // action_link fallback on this branch.
    if (purpose === 'reset') {
      const sent = await sendPasswordResetEmail(affiliate.email, redirectPath);
      if (!sent.success) {
        return NextResponse.json({ error: sent.error }, { status: 502 });
      }
      return NextResponse.json({ success: true, emailed: true, purpose, via: 'supabase' });
    }

    const { data: linkData, error: linkError } = await db.auth.admin.generateLink({
      type: 'recovery',
      email: affiliate.email,
      options: { redirectTo },
    });

    if (linkError || !linkData?.properties?.action_link) {
      return NextResponse.json({ error: linkError?.message || 'Failed to generate link' }, { status: 500 });
    }

    const actionLink = linkData.properties.action_link;

    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
      // No mailer configured — surface the link so the admin can deliver it.
      return NextResponse.json({ success: true, action_link: actionLink, emailed: false, purpose });
    }

    const { subject, html, text } = buildAccountLinkEmail({
      audience: 'affiliate',
      firstName: affiliate.first_name,
      actionLink,
    });

    const sent = await sendMail({ to: affiliate.email, subject, html, text });

    if (!sent.success) {
      return NextResponse.json({ error: sent.error }, { status: 500 });
    }

    return NextResponse.json({ success: true, emailed: true, purpose });
  } catch (error: any) {
    console.error('Error sending affiliate account link:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
