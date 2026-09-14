import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';
import type { UserRole } from '@/lib/supabase';
import { logAuditServer } from '@/lib/admin/audit';

// Verify admin access
async function verifyAdmin(accessToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken);

  if (!user || userError) {
    return null;
  }

  const adminClient = getSupabase();
  const { data: customer } = await adminClient
    .from('customers')
    .select('role')
    .eq('id', user.id)
    .single();

  if (customer?.role !== 'admin') {
    return null;
  }

  return user;
}

// GET - List all users
export async function GET(request: NextRequest) {
  try {
    const accessToken = request.headers.get('authorization')?.replace('Bearer ', '');
    if (!accessToken || !(await verifyAdmin(accessToken))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabase();
    const { data: users, error } = await supabase
      .from('customers')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ users });
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// POST - Create new user
export async function POST(request: NextRequest) {
  try {
    const accessToken = request.headers.get('authorization')?.replace('Bearer ', '');
    const admin = accessToken ? await verifyAdmin(accessToken) : null;
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userData = await request.json();
    const { email, first_name, last_name, role, password, phone, active, email_verified, can_send_fulfillment_emails, preferred_currency } = userData;

    if (!email || !first_name || !last_name || !role || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabase = getSupabase();

    // Check if email exists
    const { data: existing } = await supabase
      .from('customers')
      .select('email')
      .eq('email', email)
      .single();

    if (existing) {
      return NextResponse.json({ error: 'Email already exists' }, { status: 400 });
    }

    // Step 1: Create user in Supabase Auth
    // Auto-confirm email when created by admin
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true,
      user_metadata: {
        first_name: first_name,
        last_name: last_name,
      },
    });

    if (authError || !authUser.user) {
      console.error('Error creating auth user:', authError);
      return NextResponse.json({ error: authError?.message || 'Failed to create auth user' }, { status: 500 });
    }

    // Step 2: Create entry in customers table
    const newCustomer = {
      id: authUser.user.id,
      email: email,
      first_name: first_name,
      last_name: last_name,
      phone: phone || null,
      role: role as UserRole,
      active: active ?? true,
      email_verified: true,
      is_admin: role === 'admin',
      can_send_fulfillment_emails: !!can_send_fulfillment_emails,
      preferred_currency: preferred_currency === 'USD' ? 'USD' : 'CAD',
      password_hash: null,
    };

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .insert([newCustomer])
      .select()
      .single();

    if (customerError) {
      console.error('Error creating customer:', customerError);
      // Rollback: delete auth user
      await supabase.auth.admin.deleteUser(authUser.user.id);
      return NextResponse.json({ error: 'Failed to create customer record' }, { status: 500 });
    }

    await logAuditServer(supabase, { actor_id: admin.id, actor_email: admin.email ?? null }, {
      action: 'user.create',
      entity_type: 'user',
      entity_id: customer.id,
    });

    return NextResponse.json({ success: true, user: customer });
  } catch (error) {
    console.error('Error creating user:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
