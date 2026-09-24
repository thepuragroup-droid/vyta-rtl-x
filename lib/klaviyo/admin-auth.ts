import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canAccessAdmin, type UserRole } from '@/lib/permissions';

/**
 * Same gate as PUT /api/admin/settings: admins only — assistants and the
 * analytics role can't touch integration credentials.
 */
export async function isKlaviyoAdmin(db: SupabaseClient, req: NextRequest): Promise<boolean> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return false;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return false;
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  const role = (data?.role ?? 'customer') as UserRole;
  return canAccessAdmin(role) && role !== 'assistant' && role !== 'analytics';
}
