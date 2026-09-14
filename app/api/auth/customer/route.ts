import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  try {
    const { accessToken } = await request.json();
    if (!accessToken) {
      return NextResponse.json({ error: 'No access token' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://swpcvpkcfxihxmjpjqow.supabase.co';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    // Validate the token to get the user
    const authClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken);

    if (!user || userError) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Use service role client to bypass RLS for customer lookup
    const adminClient = getSupabase();

    // Try by ID first
    let { data: customer } = await adminClient
      .from('customers')
      .select('*')
      .eq('id', user.id)
      .single();

    // Fallback to email
    if (!customer && user.email) {
      const { data: emailMatch } = await adminClient
        .from('customers')
        .select('*')
        .eq('email', user.email.toLowerCase())
        .single();

      customer = emailMatch;
    }

    return NextResponse.json({ customer });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
