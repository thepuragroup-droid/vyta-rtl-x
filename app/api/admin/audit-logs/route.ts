import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { canAccessAdmin, type UserRole } from '@/lib/permissions';
import { getAuditLogs } from '@/lib/admin/audit';

async function verifyAdmin(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { ok: false };
  const db = getSupabase();
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return { ok: false };
  const { data } = await db.from('customers').select('role').eq('id', user.id).single();
  const role = (data?.role ?? 'customer') as UserRole;
  // Analytics partners can enter /admin but must not read audit logs.
  return { ok: canAccessAdmin(role) && role !== 'analytics' };
}

export async function GET(req: NextRequest) {
  const { ok } = await verifyAdmin(req);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const limitRaw = req.nextUrl.searchParams.get('limit');
  const limit = limitRaw ? parseInt(limitRaw, 10) : 200;
  const safeLimit = Number.isFinite(limit) ? limit : 200;

  const rows = await getAuditLogs(safeLimit);
  return NextResponse.json({ logs: rows });
}
