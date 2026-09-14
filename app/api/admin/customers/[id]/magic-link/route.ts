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
  // Admin ONLY. This route mints a set-password / sign-in link for the target
  // customer (and returns it in the body when SMTP is off), so allowing the
  // `assistant` role let an assistant generate a takeover link for ANY account,
  // including an admin's — a privilege-escalation path. Assistants are excluded.
  return data?.role === 'admin';
}

// POST - email an account link to the customer.
//
// `purpose` picks the copy: 'welcome' (default, preserves the original
// behaviour for callers that don't send it) greets a brand-new account,
// 'reset' sends a plain password-reset mail to someone who already has one.
// Both carry the same Supabase recovery link.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const redirectPath: string = body?.redirectPath || PASSWORD_RESET_PATH;
    const purpose: 'welcome' | 'reset' = body?.purpose === 'reset' ? 'reset' : 'welcome';
    const redirectTo = `${SITE_URL}${redirectPath}`;

    const { data: customer } = await db
      .from('customers')
      .select('email, first_name')
      .eq('id', params.id)
      .single();

    if (!customer?.email) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    // A reset goes through Supabase itself, so the recipient gets the same
    // email — from the same template — whether an admin sent it or they used
    // /forgot-password. The link never reaches this process, hence no
    // action_link fallback on this branch.
    if (purpose === 'reset') {
      const sent = await sendPasswordResetEmail(customer.email, redirectPath);
      if (!sent.success) {
        return NextResponse.json({ error: sent.error }, { status: 502 });
      }
      return NextResponse.json({ success: true, emailed: true, purpose, via: 'supabase' });
    }

    const { data: linkData, error: linkError } = await db.auth.admin.generateLink({
      type: 'recovery',
      email: customer.email,
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
      audience: 'customer',
      firstName: customer.first_name,
      actionLink,
    });

    const sent = await sendMail({ to: customer.email, subject, html, text });

    if (!sent.success) {
      return NextResponse.json({ error: sent.error }, { status: 500 });
    }

    return NextResponse.json({ success: true, emailed: true, purpose });
  } catch (error: any) {
    console.error('Error sending customer account link:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
